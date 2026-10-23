import test from 'node:test';
import assert from 'node:assert/strict';
import { openWorldBookHistoryStore } from '../../muyu/sessions/worldbook-store.js';
import { volumeRepository, volumeBookName, decodeVolume, volumeTargetMiB } from '../../muyu/sessions/worldbook-volume.js';
import { encodeHistoryBook, historyBookName } from '../../muyu/sessions/worldbook-contract.js';
import { isInternalWorldBookName } from '../../systems/internal-world-books.js';

const namespace = '12345678-1234-1234-1234-123456789012';
const record = () => ({ version: 7, id: crypto.randomUUID(), revision: 0, scope: '["assistant","global",null]', title: 'Conversation', createdAt: 1, updatedAt: 2,
    messages: [{ role: 'user', content: 'Private content 🦉', runId: 'r', origin: 'question' }], required: [], status: 'succeeded', archived: false, imported: false, contextSummary: null, receipts: [], scopeChanges: [] });
function fixture(options = {}) {
    const books = new Map();
    const repository = {
        list: async () => [...books].map(([file_id, data]) => ({ file_id, extensions: structuredClone(data.extensions || {}) })),
        load: async name => structuredClone(books.get(name) || { entries: {} }),
        save: async (name, data) => { books.set(name, structuredClone(data)); },
        remove: async name => { books.delete(name); },
    };
    const open = () => openWorldBookHistoryStore({ namespace, repository: volumeRepository(namespace, repository, options) });
    return { books, repository, open };
}

test('Multiple conversations share one inert archive; edits and deletion preserve neighbours', async () => {
    const f = fixture(), store = f.open();
    const [a, b] = await Promise.all([store.create(record()), f.open().create(record())]);
    assert.equal(f.books.size, 1); assert.ok(isInternalWorldBookName(volumeBookName(namespace)));
    assert.equal((await f.open().list()).length, 2);
    await store.update({ ...a, title: 'Updated A' }, 1);
    assert.deepEqual(await f.open().read(b.id), b);
    await store.remove(a.id, 2);
    assert.equal(await store.read(a.id), null);
    assert.deepEqual(await f.open().read(b.id), b);
    await assert.rejects(store.create(a), /HISTORY_DELETED/);
    assert.ok(!JSON.stringify(f.books.get(volumeBookName(namespace))).includes('Updated A'));
    for (const row of Object.values(f.books.get(volumeBookName(namespace)).entries)) {
        assert.equal(row.disable, true); assert.deepEqual(row.key, []); assert.equal(row.constant, false);
    }
});

test('Old per-conversation archives remain readable and updatable without automatic migration', async () => {
    const f = fixture(), old = { ...record(), revision: 1 };
    const encoded = await encodeHistoryBook({ namespace, record: old, revision: 1 });
    f.books.set(encoded.name, encoded.data);
    assert.deepEqual(await f.open().read(old.id), old);
    await f.open().update({ ...old, title: 'Old updated' }, 1);
    const fresh = await f.open().create(record());
    assert.equal(f.books.size, 2);
    assert.equal((await f.open().list()).length, 2);
    assert.equal((await f.open().read(old.id)).title, 'Old updated');
    assert.deepEqual(await f.open().read(fresh.id), fresh);
});

test('Combined archive tampering and reserved-name collisions fail closed without overwriting', async () => {
    const f = fixture(), a = await f.open().create(record());
    const data = f.books.get(volumeBookName(namespace));
    const last = Object.values(data.entries).at(-1); last.content += 'tampered';
    const before = structuredClone(data);
    await assert.rejects(f.open().update({ ...a, title: 'No' }, 1), /HISTORY_INVALID/);
    assert.deepEqual(f.books.get(volumeBookName(namespace)), before);
    const g = fixture(); g.books.set(volumeBookName(namespace), { entries: { 0: { content: 'User lore' } } });
    await assert.rejects(g.open().create(record()), /HISTORY_INVALID/);
});

test('A duplicate legacy and combined record is a conflict, not an arbitrary source choice', async () => {
    const f = fixture(), saved = await f.open().create(record());
    const map = await decodeVolume(namespace, f.books.get(volumeBookName(namespace)));
    const file = historyBookName(namespace, saved.id);
    f.books.set(file, map.get(file));
    await assert.rejects(f.open().list(), /HISTORY_CONFLICT/);
    await assert.rejects(f.open().read(saved.id), /HISTORY_CONFLICT/);
});

test('Lost acknowledgement can be retried without duplicating a conversation or rewriting', async () => {
    const f = fixture(), input = record(), save = f.repository.save; let writes = 0;
    f.repository.save = async (...args) => { writes++; await save(...args); throw Error('HISTORY_SAVE_FAILED'); };
    await assert.rejects(f.open().create(input), /HISTORY_SAVE_FAILED/);
    assert.equal((await f.open().create(input)).revision, 1);
    assert.equal(writes, 1); assert.equal(f.books.size, 1);
});

test('Another account and ordinary lore are untouched; opening an empty archive creates nothing', async () => {
    const f = fixture(), lore = { entries: { 0: { content: 'Ordinary lore' } } };
    f.books.set('Ordinary', lore);
    assert.deepEqual(await f.open().list(), []); assert.equal(f.books.size, 1);
    const other = '87654321-4321-4321-4321-210987654321';
    const encoded = await encodeHistoryBook({ namespace: other, record: { ...record(), revision: 1 }, revision: 1 });
    f.books.set(encoded.name, encoded.data);
    await f.open().create(record());
    assert.deepEqual(f.books.get('Ordinary'), lore);
    assert.deepEqual(f.books.get(encoded.name), encoded.data);
    assert.equal((await f.open().list()).length, 1);
});

test('A listed but missing volume fails closed, and unknown volumes are not silently hidden', async () => {
    const f = fixture();
    f.repository.list = async () => [{ file_id: volumeBookName(namespace) }];
    await assert.rejects(f.open().list(), /HISTORY_CONFLICT/);
    assert.equal(f.books.size, 0);
    f.repository.list = async () => [{ file_id: volumeBookName(namespace).replace(/000000000001$/, '000000001025') }];
    await assert.rejects(f.open().list(), /HISTORY_VERSION/);
});

test('An unrelated conversation changed during volume preparation prevents a stale whole-book save', async () => {
    const f = fixture(), store = f.open(), a = await store.create(record()), b = await store.create(record());
    const before = structuredClone(f.books.get(volumeBookName(namespace))), load = f.repository.load;
    let count = 0;
    // Access the adapter directly so the conflict is deterministic, not dependent on hash timing.
    const adapter = volumeRepository(namespace, f.repository), file = historyBookName(namespace, a.id);
    await adapter.load(file);
    const replacement = await encodeHistoryBook({ namespace, record: { ...a, revision: 2, title: 'No stale save' }, revision: 2 });
    f.repository.load = async name => {
        if (name === volumeBookName(namespace) && ++count === 2) {
            const current = f.books.get(name);
            current.extensions.gdMuyuHistory.commitId = crypto.randomUUID();
        }
        return load(name);
    };
    await assert.rejects(adapter.save(file, replacement.data), /HISTORY_CONFLICT/);
    // Only the simulated concurrent commit marker changed; neither conversation was replaced.
    f.books.get(volumeBookName(namespace)).extensions.gdMuyuHistory.commitId = before.extensions.gdMuyuHistory.commitId;
    assert.deepEqual(f.books.get(volumeBookName(namespace)), before);
    assert.deepEqual(await f.open().read(b.id), b);
});

test('Volume targets are bounded integers and names preserve the original main volume', () => {
    assert.equal(volumeTargetMiB(undefined), 8);
    for (const value of [0, 17, 1.5, '8', NaN, Infinity]) assert.throws(() => volumeTargetMiB(value), /HISTORY_INVALID/);
    for (const value of [0, 1025, 1.5]) assert.throws(() => volumeBookName(namespace, value), /HISTORY_CAPACITY/);
    assert.match(volumeBookName(namespace), /00000000-0000-0000-0000-000000000001$/);
    assert.ok(isInternalWorldBookName(volumeBookName(namespace, 2)));
});

test('New conversations roll into bounded volumes; changing the target preserves existing records and tombstones', async () => {
    let target = 1;
    const f = fixture({ getTargetMiB: () => target }), store = f.open();
    const large = () => { const row = record(); row.messages[0].content = 'x'.repeat(600000); return row; };
    const a = await store.create(large()), b = await store.create(large());
    assert.equal(f.books.size, 2);
    assert.deepEqual(await f.open().read(a.id), a); assert.deepEqual(await f.open().read(b.id), b);
    target = 16;
    const c = await store.create(record()); assert.equal(f.books.size, 2);
    target = 1;
    const grown = await store.update({ ...a, messages: [...a.messages, ...large().messages] }, 1);
    assert.equal(f.books.size, 2); // Soft target: no relocation while updating an existing conversation.
    assert.deepEqual(await store.read(grown.id), grown);
    await store.remove(b.id, 1);
    assert.equal(await f.open().read(b.id), null);
    await assert.rejects(f.open().create(b), /HISTORY_DELETED/);
    assert.deepEqual(await store.read(c.id), c);
    assert.deepEqual((await store.list()).map(row => row.id).sort(), [a.id, c.id].sort());
});

test('An oversized single conversation owns a volume and a failed rollover preserves all earlier volumes', async () => {
    const f = fixture({ getTargetMiB: () => 1 }), store = f.open(), large = record();
    large.messages = [0, 1].map(() => ({ role: 'user', content: 'x'.repeat(600000), runId: 'r' }));
    const a = await store.create(large), before = structuredClone([...f.books]);
    assert.equal(f.books.size, 1);
    const save = f.repository.save;
    f.repository.save = async () => { throw Error('HISTORY_SAVE_FAILED'); };
    const input = record();
    await assert.rejects(store.create(input), /HISTORY_SAVE_FAILED/);
    assert.deepEqual([...f.books], before); assert.deepEqual(await store.read(a.id), a);
    let writes = 0;
    f.repository.save = async (...args) => { writes++; await save(...args); throw Error('HISTORY_SAVE_FAILED'); };
    await assert.rejects(store.create(input), /HISTORY_SAVE_FAILED/);
    assert.equal(f.books.size, 2); // Rollover committed, but its acknowledgement was lost.
    const b = await store.create(input);
    assert.equal(writes, 1); assert.equal(f.books.size, 2); assert.deepEqual(await f.open().read(b.id), b);
});

test('Duplicate conversation IDs across volumes fail closed, including deleted records', async () => {
    const f = fixture(), a = await f.open().create(record());
    await f.open().remove(a.id, 1);
    f.books.set(volumeBookName(namespace, 2), structuredClone(f.books.get(volumeBookName(namespace))));
    await assert.rejects(f.open().list(), /HISTORY_CONFLICT/);
    await assert.rejects(f.open().create(a), /HISTORY_CONFLICT/);
});

async function seedLegacy(f, value = { ...record(), revision: 3 }, deleted = false) {
    const encoded = await encodeHistoryBook({ namespace, record: value, recordId: value.id, revision: value.revision, deleted });
    f.books.set(encoded.name, encoded.data);
    return { value, ...encoded };
}

test('Explicit consolidation preserves IDs, revisions and tombstones, keeps old books and survives ordinary updates', async () => {
    const f = fixture(), a = await seedLegacy(f), b = await seedLegacy(f), dead = await seedLegacy(f, { ...record(), revision: 4 }, true);
    const original = structuredClone([...f.books]);
    const store = f.open(), report = await store.mergeLegacyHistory();
    assert.equal(report.error, null); assert.equal(report.copied, 3); assert.equal(report.remaining, 0);
    assert.equal(f.books.size, 4);
    for (const [name, data] of original) assert.deepEqual(f.books.get(name), data);
    assert.deepEqual(await f.open().read(a.value.id), a.value);
    assert.deepEqual(await f.open().read(b.value.id), b.value);
    assert.equal(await store.read(dead.value.id), null);
    assert.equal((await store.list()).length, 2);
    const updated = await store.update({ ...a.value, title: 'After consolidation' }, 3);
    assert.equal(updated.revision, 4); assert.deepEqual(f.books.get(a.name), a.data);
    await store.remove(a.value.id, 4);
    assert.equal(await f.open().read(a.value.id), null);
    await assert.rejects(f.open().create(a.value), /HISTORY_DELETED/);
    const retry = await f.open().mergeLegacyHistory();
    assert.equal(retry.identical, 3); assert.equal(retry.copied, 0);
    const cleaned = await store.mergeLegacyHistory(true);
    assert.equal(cleaned.error, null); assert.equal(cleaned.cleaned, 3); assert.equal(f.books.size, 1);
    assert.deepEqual(await store.read(b.value.id), b.value);
    await assert.rejects(f.open().create(a.value), /HISTORY_DELETED/);
    assert.equal((await store.mergeLegacyHistory(true)).total, 0);
});

test('Lost consolidation and cleanup acknowledgements remain retryable without overwriting or duplicating records', async () => {
    const f = fixture(), old = await seedLegacy(f), save = f.repository.save;
    let writes = 0;
    f.repository.save = async (...args) => { writes++; await save(...args); throw Error('HISTORY_SAVE_FAILED'); };
    const first = await f.open().mergeLegacyHistory();
    assert.equal(first.error, 'HISTORY_SAVE_FAILED'); assert.equal(first.copied, 0); assert.equal(first.remaining, 1);
    assert.deepEqual(await f.open().read(old.value.id), old.value);
    assert.equal((await f.open().mergeLegacyHistory()).identical, 1); assert.equal(writes, 1);
    const remove = f.repository.remove;
    f.repository.remove = async name => { await remove(name); throw Error('HISTORY_SAVE_FAILED'); };
    const cleaned = await f.open().mergeLegacyHistory(true);
    assert.equal(cleaned.error, 'HISTORY_SAVE_FAILED'); assert.equal(cleaned.cleaned, 0);
    assert.equal((await f.open().mergeLegacyHistory(true)).total, 0);
    assert.deepEqual(await f.open().read(old.value.id), old.value);
});

test('External edits to retained legacy backups fail closed and are never cleaned or selected arbitrarily', async () => {
    const f = fixture(), old = await seedLegacy(f);
    await f.open().mergeLegacyHistory();
    const changed = await encodeHistoryBook({ namespace, record: { ...old.value, revision: 4, title: 'Other device' }, revision: 4 });
    f.books.set(old.name, changed.data);
    const before = structuredClone([...f.books]);
    await assert.rejects(f.open().list(), /HISTORY_CONFLICT/);
    await assert.rejects(f.open().read(old.value.id), /HISTORY_CONFLICT/);
    assert.equal((await f.open().mergeLegacyHistory()).error, 'HISTORY_CONFLICT');
    assert.equal((await f.open().mergeLegacyHistory(true)).error, 'HISTORY_CONFLICT');
    assert.deepEqual([...f.books], before);
});

test('Cleanup never migrates or deletes unmerged archives, ordinary lore or another account', async () => {
    const f = fixture(), old = await seedLegacy(f);
    const foreign = await encodeHistoryBook({ namespace: '87654321-4321-4321-4321-210987654321', record: { ...record(), revision: 1 }, revision: 1 });
    f.books.set(foreign.name, foreign.data); f.books.set('Ordinary lore', { entries: {} });
    const before = structuredClone([...f.books]), report = await f.open().mergeLegacyHistory(true);
    assert.equal(report.cleaned, 0); assert.equal(report.conflicts, 1); assert.deepEqual([...f.books], before);
    await f.open().mergeLegacyHistory();
    const volume = f.books.get(volumeBookName(namespace)); Object.values(volume.entries).at(-1).content += 'broken';
    assert.equal((await f.open().mergeLegacyHistory(true)).error, 'HISTORY_INVALID');
    assert.deepEqual(f.books.get(old.name), old.data); assert.deepEqual(f.books.get(foreign.name), foreign.data);
});

test('Consolidation uses the configured volume target and does not reset original revisions', async () => {
    const f = fixture({ getTargetMiB: () => 1 });
    const large = () => { const value = { ...record(), revision: 7 }; value.messages[0].content = 'x'.repeat(600000); return value; };
    const a = await seedLegacy(f, large()), b = await seedLegacy(f, large());
    assert.equal((await f.open().mergeLegacyHistory()).copied, 2);
    assert.equal(f.books.size, 4);
    assert.deepEqual(await f.open().read(a.value.id), a.value);
    assert.deepEqual(await f.open().read(b.value.id), b.value);
});

test('Partial consolidation retries skip confirmed copies and retain every source after a later failure', async () => {
    const f = fixture(), a = await seedLegacy(f), b = await seedLegacy(f), save = f.repository.save;
    let writes = 0;
    f.repository.save = async (...args) => { if (++writes === 2) throw Error('HISTORY_SAVE_FAILED'); return save(...args); };
    const first = await f.open().mergeLegacyHistory();
    assert.equal(first.copied, 1); assert.equal(first.remaining, 1); assert.equal(first.error, 'HISTORY_SAVE_FAILED');
    assert.deepEqual(f.books.get(a.name), a.data); assert.deepEqual(f.books.get(b.name), b.data);
    const second = await f.open().mergeLegacyHistory();
    assert.equal(second.copied, 1); assert.equal(second.identical, 1); assert.equal(second.remaining, 0); assert.equal(second.error, null);
    assert.equal((await f.open().list()).length, 2);
});

test('A source edited during consolidation remains intact and is reported as a conflict, never a confirmed copy', async () => {
    const f = fixture(), old = await seedLegacy(f), save = f.repository.save;
    const changed = await encodeHistoryBook({ namespace, record: { ...old.value, title: 'Concurrent edit', revision: 4 }, revision: 4 });
    f.repository.save = async (...args) => { await save(...args); f.books.set(old.name, changed.data); };
    const report = await f.open().mergeLegacyHistory();
    assert.equal(report.copied, 0); assert.equal(report.remaining, 1); assert.equal(report.error, 'HISTORY_CONFLICT');
    assert.deepEqual(f.books.get(old.name), changed.data);
    await assert.rejects(f.open().read(old.value.id), /HISTORY_CONFLICT/);
    assert.equal((await f.open().mergeLegacyHistory(true)).cleaned, 0);
});
