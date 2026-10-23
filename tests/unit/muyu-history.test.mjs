import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionLibrary } from '../../muyu/sessions/library.js';
import { createMemoryHistoryStore } from '../../muyu/sessions/memory-store.js';
import { createHistoryPort } from '../../muyu/host/history.js';
import { historyScope, validateRecord, selectHistory, HISTORY_LIMITS, historyBytes } from '../../muyu/sessions/contract.js';
import { deferred } from './helpers/muyu-subject.mjs';
import { DEFAULT_SETTINGS } from '../../settings.js';

const scope = historyScope('chat', { kind: 'chat', chatKey: 'A' });
function fixture(store = createMemoryHistoryStore(), initiallyEnabled = false) {
    let enabled = initiallyEnabled;
    const port = { enabled: () => enabled, setEnabled: async value => { enabled = value; }, open: async () => store };
    return { store, port, library: createSessionLibrary({ port }) };
}
const pair = (runId = 'r', body = 'answer') => [{ role: 'user', content: 'question', runId }, { role: 'assistant', content: body, runId }];

test('Unavailable storage does not prevent saving the auto-save preference or later disabling it', async () => {
    const backing = createMemoryHistoryStore(); let requested = false, fail = true, writes = 0;
    const library = createSessionLibrary({ port: { enabled: () => requested,
        setEnabled: async value => { requested = value; writes++; },
        open: async () => { if (fail) throw Error('HISTORY_UNAVAILABLE'); return backing; },
    } });
    await library.ready;
    const id = library.create(scope); library.update(id, { messages: pair() });
    await assert.rejects(library.setEnabled(true), /HISTORY_UNAVAILABLE/);
    assert.equal(requested, true, 'the requested preference is saved independently of backend availability');
    assert.equal(library.snapshot(scope, id).enabled, false, 'no false claim of working storage');
    assert.equal(library.snapshot(scope, id).autoSaveRequested, true);
    assert.equal(library.snapshot(scope, id).error, 'HISTORY_UNAVAILABLE');
    assert.deepEqual(library.get(id).messages, pair());
    await library.setEnabled(false); assert.equal(requested, false);
    assert.equal(library.snapshot(scope, id).error, null);
    await assert.rejects(library.setEnabled(true), /HISTORY_UNAVAILABLE/);
    fail = false; await library.retry();
    assert.deepEqual((await backing.read(id)).messages, pair());
    assert.equal(library.snapshot(scope, id).enabled, true); assert.equal(writes, 3);
    await library.close();
});

test('Failed preference save does not connect or enable a history backend', async () => {
    let opens = 0;
    const library = createSessionLibrary({ port: { enabled: () => false,
        setEnabled: async () => { throw Error('HISTORY_SETTINGS_FAILED'); },
        open: async () => { opens++; return createMemoryHistoryStore(); },
    } });
    await library.ready; const id = library.create(scope);
    await assert.rejects(library.setEnabled(true), /HISTORY_SETTINGS_FAILED/);
    assert.equal(opens, 0); assert.equal(library.snapshot(scope, id).enabled, false);
    await library.close();
});

test('Retry reopens a failed default-on history store and persists the retained conversation', async () => {
    const store = createMemoryHistoryStore(); let fail = true, opens = 0, preferenceWrites = 0, requested = true;
    const library = createSessionLibrary({ port: { enabled: () => requested,
        open: async () => { opens++; if (fail) throw Error('HISTORY_UNAVAILABLE'); return store; },
        setEnabled: async value => { requested = value; preferenceWrites++; },
    } });
    await library.ready;
    const id = library.create(scope); library.update(id, { messages: pair() });
    assert.equal(library.snapshot(scope, id).autoSaveRequested, true);
    assert.equal(library.snapshot(scope, id).enabled, false);
    await assert.rejects(library.retry(), /HISTORY_UNAVAILABLE/);
    assert.deepEqual(library.get(id).messages, pair());
    assert.equal(library.snapshot(scope, id).loading, false);
    fail = false; await library.retry();
    assert.deepEqual((await store.read(id)).messages, pair());
    assert.equal(library.snapshot(scope, id).enabled, true);
    assert.equal(library.snapshot(scope, id).error, null);
    assert.equal(preferenceWrites, 0); assert.equal(opens, 3);
    await library.setEnabled(false);
    await assert.rejects(library.retry(), /NOT_READY/);
    await library.close();
});

test('Refreshing after failed default-on initialization resumes saves, but does not opt in disabled storage', async () => {
    for (const requested of [true, false]) {
        const store = createMemoryHistoryStore(); let fail = true;
        const library = createSessionLibrary({ port: { enabled: () => requested,
            open: async () => { if (fail) throw Error('HISTORY_UNAVAILABLE'); return store; }, setEnabled: async () => {},
        } });
        await library.ready;
        const id = library.create(scope); library.update(id, { messages: pair() });
        fail = false; await library.refresh(); await library.flush();
        assert.equal(library.snapshot(scope, id).enabled, requested);
        assert.equal((await store.read(id))?.messages.length || 0, requested ? 2 : 0);
        await library.close();
    }
});

test('Archive admission reserves serialized input plus a maximum answer, not a fixed small turn', async () => {
    const f = fixture(), id = f.library.create(scope);
    const messages = Array.from({ length: 29 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', runId: String(i), content: 'x'.repeat(1024 * 1024 - 100) }));
    f.library.update(id, { messages });
    f.library.assertRoom(id, 'small');
    assert.throws(() => f.library.assertRoom(id, '中'.repeat(350000)), /HISTORY_CAPACITY/);
    assert.equal(f.library.get(id).messages.length, 29);
    await f.library.close();
});

test('Overflow capture has a bounded exportable recovery without relaxing disk/import limits', async () => {
    const f = fixture(undefined, true); await f.library.ready; const id = f.library.create(scope);
    const messages = Array.from({ length: 32 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', runId: String(i), content: 'x'.repeat(1010000) }));
    f.library.update(id, { messages, status: 'running' }); await f.library.flush();
    const next = [...messages, ...pair('new', 'RECOVERY_MARKER' + 'y'.repeat(1500000))];
    assert.ok(historyBytes({ ...f.library.get(id), messages: next }) > HISTORY_LIMITS.recordBytes);
    assert.throws(() => f.library.update(id, { messages: next, status: 'succeeded' }), /HISTORY_CAPACITY/);
    f.library.retainRecovery(id, next, 'succeeded');
    assert.equal(f.library.snapshot(scope, id).error, 'HISTORY_CAPACITY');
    assert.equal(f.library.snapshot(scope, id).dirty, true);
    assert.equal(f.library.snapshot(scope, id).recovery, true);
    const backup = JSON.parse(f.library.export(id));
    assert.equal(backup.format, 'muyu-unsaved-recovery'); assert.equal(backup.status, 'succeeded');
    assert.match(backup.messages.at(-1).content, /^RECOVERY_MARKER/);
    assert.match(f.library.export(id, 'markdown'), /UNSAVED RECOVERY/);
    await assert.rejects(f.library.import(f.library.export(id)), /HISTORY_CAPACITY/);
    assert.throws(() => f.library.assertRoom(id), /HISTORY_CAPACITY/);
    f.library.update(id, { contextSummary: null });
    assert.equal(f.library.snapshot(scope, id).recovery, true, 'metadata/summary edits cannot discard an unsaved answer');
    assert.match(f.library.recoveryMessages(id).at(-1).content, /^RECOVERY_MARKER/);
    await f.library.retry(); assert.equal(f.library.snapshot(scope, id).error, 'HISTORY_CAPACITY');
    assert.equal((await f.store.read(id)).messages.length, 32);
    await f.library.close();
});

test('History defaults to temporary storage; opt-in saves and reload reads without runtime authority', async () => {
    const f = fixture(); await f.library.ready;
    const id = f.library.create(scope); f.library.update(id, { messages: pair(), required: ['chat'], status: 'running' });
    await f.library.flush(); assert.deepEqual(await f.store.list(), []);
    await f.library.setEnabled(true); await f.library.flush();
    const g = createSessionLibrary({ port: f.port }); await g.ready;
    assert.equal(g.get(id), null, 'body not loaded with list');
    const record = await g.load(id, scope); assert.equal(record.status, 'interrupted'); assert.deepEqual(record.required, ['chat']);
    assert.deepEqual(record.messages, pair()); assert.equal(g.snapshot(scope, id).sessions.length, 1);
    assert.throws(() => validateRecord({ ...record, apiKey: 'secret' }), /HISTORY_INVALID/);
    assert.throws(() => validateRecord({ ...record, version: 99 }), /HISTORY_VERSION/);
    await f.library.close(); await g.close();
});

test('Disabling history leaves disk intact and new in-memory replies are not saved', async () => {
    const f = fixture(); const id = f.library.create(scope);
    await f.library.setEnabled(true); await f.library.flush();
    await f.library.setEnabled(false); f.library.update(id, { messages: pair() }); await f.library.flush();
    assert.equal((await f.store.read(id)).messages.length, 0);
    assert.equal(JSON.parse(f.library.export(id)).messages.length, 2);
    await f.library.setEnabled(true); await f.library.flush(); assert.equal((await f.store.read(id)).messages.length, 2);
    await f.library.close();
});

test('Save rejection keeps working answer, exposes dirty status and retry confirms persistence', async () => {
    const backing = createMemoryHistoryStore(); let fail = true;
    const f = fixture({ ...backing, async write(...args) { if (fail) throw Error('HISTORY_SAVE_FAILED'); return backing.write(...args); } }, true);
    await f.library.ready; const id = f.library.create(scope); f.library.update(id, { messages: pair() });
    await f.library.flush(); assert.equal(f.library.get(id).messages.length, 2);
    assert.equal(f.library.snapshot(scope, id).error, 'HISTORY_SAVE_FAILED'); assert.equal(f.library.snapshot(scope, id).dirty, true);
    fail = false; await f.library.retry(); assert.equal(f.library.snapshot(scope, id).error, null);
    assert.equal(f.library.snapshot(scope, id).dirty, false); assert.equal((await backing.read(id)).messages.length, 2); await f.library.close();
});

test('Concurrent tabs use revisions; stale tab cannot overwrite another answer even on retry', async () => {
    const f = fixture(undefined, true); await f.library.ready; const id = f.library.create(scope); await f.library.flush();
    const other = createSessionLibrary({ port: f.port }); await other.ready; await other.load(id, scope);
    f.library.update(id, { messages: pair('a', 'first tab') }); await f.library.flush();
    other.update(id, { messages: pair('b', 'second tab') }); await other.flush();
    assert.equal(other.snapshot(scope, id).error, 'HISTORY_CONFLICT'); await other.retry();
    assert.equal((await f.store.read(id)).messages.at(-1).content, 'first tab');
    assert.equal(JSON.parse(other.export(id)).messages.at(-1).content, 'second tab'); await f.library.close(); await other.close();
});

test('Edits made during asynchronous saving remain dirty until their own write completes', async () => {
    const backing = createMemoryHistoryStore(), wait = deferred(); let first = true;
    const f = fixture({ ...backing, async write(...args) { if (first) { first = false; await wait.promise; } return backing.write(...args); } }, true);
    await f.library.ready; const id = f.library.create(scope); await Promise.resolve();
    f.library.update(id, { messages: pair() }); wait.resolve(); await f.library.flush();
    assert.deepEqual((await backing.read(id)).messages, pair()); assert.equal(f.library.snapshot(scope, id).dirty, false); await f.library.close();
});

test('Storage scope cannot be rebound, future schema is rejected and capacity does not evict', async () => {
    const f = fixture(); const id = f.library.create(scope);
    await assert.rejects(f.library.load(id, historyScope('chat', { kind: 'chat', chatKey: 'B' })), /HISTORY_SCOPE/);
    for (let i = 1; i < HISTORY_LIMITS.sessions; i++) f.library.create(scope);
    assert.throws(() => f.library.create(scope), /HISTORY_CAPACITY/); assert.ok(f.library.get(id));
    f.library.update(id, { messages: Array.from({ length: HISTORY_LIMITS.messages / 2 }, (_, n) => pair(String(n))).flat() });
    assert.throws(() => f.library.assertRoom(id), /HISTORY_CAPACITY/); await f.library.close();
});

test('Context selection keeps complete recent turns, bounds size and never replays orphaned messages', () => {
    const history = [...pair('a'), { role: 'user', content: 'failed', runId: 'failed' }, ...pair('b')];
    assert.deepEqual(selectHistory(history, { maxTurns: 1 }).messages, pair('b').map(({ role, content }) => ({ role, content })));
    assert.equal(selectHistory(history, { maxChars: 1 }).messages.length, 0);
    assert.equal(selectHistory(history).omitted, 1);
    assert.equal(selectHistory(pair('large', '文'.repeat(11000))).messages.length, 0, 'also respects UTF-8 runtime DTO limit');
});

test('Overlapping lazy reads cannot replace locally edited working history', async () => {
    const backing = createMemoryHistoryStore(), initial = fixture(backing, true); await initial.library.ready;
    const id = initial.library.create(scope); await initial.library.flush(); const wait = deferred(); let calls = 0;
    const library = createSessionLibrary({ port: { enabled: () => true, open: async () => ({ ...backing, async read(key) { const result = await backing.read(key); if (++calls === 1) await wait.promise; return result; } }) } });
    await library.ready; const slow = library.load(id, scope); await Promise.resolve(); await library.load(id, scope);
    library.update(id, { messages: pair('new') }); wait.resolve(); await slow;
    assert.deepEqual(library.get(id).messages, pair('new')); await library.close(); await initial.library.close();
});

test('Host history requires verified account identity, stable namespace and confirmed settings save', async () => {
    const settings = {}, namespaces = [], store = createMemoryHistoryStore(); let fail = true, account = { enabled: true, handle: 'alice', created: 123 };
    const port = createHistoryPort({ getAccount: async () => account, getSettings: () => settings, saveSettings: async () => { if (fail) throw Error('secret'); }, openStore: async ({ namespace }) => { namespaces.push(namespace); return store; } });
    assert.equal(port.enabled(), false);
    await assert.rejects(port.setEnabled(true), /HISTORY_SETTINGS_FAILED/); assert.equal(port.enabled(), false);
    fail = false; const opened = await port.open(); await port.open(); assert.equal(namespaces[0], namespaces[1]);
    account = { enabled: true, handle: 'bob', created: 123 }; await assert.rejects(opened.list(), /HISTORY_IDENTITY_UNAVAILABLE/);
    await port.open(); assert.notEqual(namespaces[0], namespaces.at(-1));
    account = { enabled: true }; await assert.rejects(port.open(), /HISTORY_IDENTITY_UNAVAILABLE/);
    account = {}; await assert.rejects(port.open(), /HISTORY_IDENTITY_UNAVAILABLE/);
    account = { enabled: false }; await port.open(); assert.notEqual(namespaces[0], namespaces.at(-1));
});

test('Local history is on for new installations but an existing opt-out remains respected', async () => {
    assert.equal(DEFAULT_SETTINGS.muyuHistoryEnabled, true);
    const settings = { ...DEFAULT_SETTINGS };
    const port = createHistoryPort({ getAccount: async () => ({ enabled: false }), getSettings: () => settings, saveSettings: async () => {}, openStore: async () => createMemoryHistoryStore() });
    assert.equal(port.enabled(), true);
    await port.setEnabled(false);
    assert.equal(port.enabled(), false);
    assert.equal(settings.muyuHistoryEnabled, false);
});

test('Cross-chat retarget persists provenance and restores it without carrying grants', async () => {
    const f = fixture(undefined, true); await f.library.ready;
    const a = historyScope('assistant', { kind: 'chat', chatKey: 'A' });
    const b = historyScope('assistant', { kind: 'chat', chatKey: 'B' });
    const id = f.library.create(a);
    f.library.update(id, { messages: pair(), required: ['source:variables'] });
    f.library.retarget(id, b); await f.library.flush();
    const g = createSessionLibrary({ port: f.port }); await g.ready;
    assert.equal(g.snapshot(b, id, { range: 'all', archive: 'active', query: '', task: '', chatKey: 'B' }).sessions.length, 1);
    const restored = await g.load(id, b);
    assert.equal(restored.version, 6);
    assert.deepEqual(restored.scopeChanges.map(({ from, to, messageIndex }) => ({ from, to, messageIndex })), [{ from: a, to: b, messageIndex: 2 }]);
    assert.deepEqual(restored.required, ['source:variables']);
    await f.library.close(); await g.close();
});
