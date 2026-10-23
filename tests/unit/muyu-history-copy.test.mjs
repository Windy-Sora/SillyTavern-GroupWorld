import test from 'node:test';
import assert from 'node:assert/strict';
import { copyHistory } from '../../muyu/sessions/copy-history.js';
import { createMemoryHistoryStore } from '../../muyu/sessions/memory-store.js';
import { createSessionLibrary } from '../../muyu/sessions/library.js';
import { historyScope } from '../../muyu/sessions/contract.js';

const scope = historyScope('assistant', { kind: 'chat', chatKey: 'A' });
const record = n => ({ version: 5, id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, revision: 0, scope,
    title: 'Private conversation', createdAt: 1, updatedAt: 2, messages: [{ role: 'user', content: 'hello', runId: 'r' }],
    required: ['source:memoryConfig'], status: 'succeeded', archived: false, imported: false, receipts: [], contextSummary: null });
async function setup(count = 2) {
    const source = createMemoryHistoryStore(), target = createMemoryHistoryStore();
    for (let n = 1; n <= count; n++) await source.create(record(n));
    return { source, target };
}

test('Explicit history copy keeps IDs, text, scope and dependencies, leaves originals untouched and is idempotent', async () => {
    const f = await setup(), before = await f.source.list();
    assert.deepEqual(await copyHistory(f), { total: 2, copied: 2, identical: 0, conflicts: 0, remaining: 0, error: null });
    assert.deepEqual(await f.source.list(), before);
    assert.deepEqual(await f.target.read(record(1).id), await f.source.read(record(1).id));
    assert.deepEqual(await copyHistory(f), { total: 2, copied: 0, identical: 2, conflicts: 0, remaining: 0, error: null });
});

test('Identical copies ignore only storage revision, while changed destination contents are never overwritten', async () => {
    const f = await setup();
    let saved = await f.source.read(record(1).id); saved = await f.source.update(saved, saved.revision);
    await f.target.create(saved);
    await f.target.create({ ...record(2), title: 'Other device' });
    const report = await copyHistory(f);
    assert.equal(report.identical, 1); assert.equal(report.conflicts, 1); assert.equal(report.remaining, 0);
    assert.equal((await f.target.read(record(2).id)).title, 'Other device');
});

for (const code of ['HISTORY_CAPACITY', 'HISTORY_SAVE_FAILED', 'HISTORY_VERSION', 'HISTORY_IDENTITY_UNAVAILABLE']) test(`Partial copy stops on ${code}, keeps successes and safely retries`, async () => {
    const f = await setup(3), create = f.target.create.bind(f.target); let calls = 0;
    f.target.create = async value => { if (++calls === 2) throw Error(code); return create(value); };
    const report = await copyHistory(f);
    assert.equal(report.copied, 1); assert.equal(report.remaining, 2); assert.equal(report.error, code); assert.equal(calls, 2);
    f.target.create = create;
    const retried = await copyHistory(f);
    assert.equal(retried.identical, 1); assert.equal(retried.copied, 2); assert.equal(retried.remaining, 0);
    assert.equal((await f.source.list()).length, 3);
});

test('Lost acknowledgement is unconfirmed initially and recognized as identical on retry', async () => {
    const f = await setup(1), create = f.target.create.bind(f.target);
    f.target.create = async value => { await create(value); throw Error('private network error'); };
    const report = await copyHistory(f);
    assert.equal(report.copied, 0); assert.equal(report.remaining, 1); assert.equal(report.error, 'HISTORY_SAVE_FAILED');
    f.target.create = create;
    assert.equal((await copyHistory(f)).identical, 1);
});

test('Deleted destinations and changing source records are skipped without updates or resurrection', async () => {
    const f = await setup(), read = f.source.read.bind(f.source); let reads = 0, writes = 0;
    f.source.read = async id => { const value = await read(id); if (id === record(1).id && ++reads === 2) value.title = 'changed'; return value; };
    f.target.create = async () => { writes++; throw Error('HISTORY_DELETED'); };
    assert.equal((await copyHistory(f)).conflicts, 2); assert.equal(writes, 1);
});

test('Identity guard rejects before opening the source inventory or writing', async () => {
    let calls = 0;
    await assert.rejects(copyHistory({ source: { list() { calls++; } }, target: {}, check: async () => { throw Error('HISTORY_IDENTITY_UNAVAILABLE'); } }), /HISTORY_IDENTITY_UNAVAILABLE/);
    assert.equal(calls, 0);
});

test('Library refreshes copied summaries without replacing the selected working copy', async () => {
    const f = await setup(1);
    f.target.copyHistoryFrom = () => copyHistory(f);
    const library = createSessionLibrary({ port: { enabled: () => true, open: async () => f.target } });
    await library.ready;
    const id = library.create(scope); library.update(id, { messages: [{ role: 'user', content: 'local', runId: 'r' }] }); await library.flush();
    const before = library.get(id);
    assert.equal((await library.copyHistoryFrom('browser')).copied, 1);
    assert.deepEqual(library.get(id), before);
    assert.equal(library.snapshot(scope, id).sessions.length, 2);
    assert.equal(library.snapshot(scope, id).copyReport.source, 'browser');
    assert.equal((await library.load(record(1).id)).messages[0].content, 'hello');
    await library.close();
});

test('Library refuses to copy while local records remain unsaved', async () => {
    const f = await setup(); let copied = 0;
    f.target.copyHistoryFrom = async () => { copied++; };
    const library = createSessionLibrary({ port: { enabled: () => false, open: async () => f.target } });
    await library.ready; await library.refresh(); library.create(scope);
    await assert.rejects(library.copyHistoryFrom('browser'), /HISTORY_CONFLICT/);
    assert.equal(copied, 0); await library.close();
});

test('Failure to open a copy source reports unknown inventory, not an empty successful migration', async () => {
    const store = createMemoryHistoryStore();
    store.copyHistoryFrom = async () => { throw Error('HISTORY_UNAVAILABLE'); };
    const library = createSessionLibrary({ port: { enabled: () => true, open: async () => store } });
    await library.ready;
    await assert.rejects(library.copyHistoryFrom('server'), /HISTORY_UNAVAILABLE/);
    const status = library.snapshot(scope);
    assert.equal(status.copyReport.total, null); assert.equal(status.copyReport.error, 'HISTORY_UNAVAILABLE');
    assert.equal(status.copyingHistory, false); assert.equal(status.loading, false);
    await library.close();
});
