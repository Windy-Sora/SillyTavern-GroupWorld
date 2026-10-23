import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionLibrary } from '../../muyu/sessions/library.js';
import { createMemoryHistoryStore } from '../../muyu/sessions/memory-store.js';
import { validateRecord, summarizeRecord, validateSummary, historyScope } from '../../muyu/sessions/contract.js';
import { parseHistoryImport, importedRecord, exportHistoryRecord } from '../../muyu/sessions/exchange.js';
import { deferred, flush } from './helpers/muyu-subject.mjs';

const scope = historyScope('chat', { kind: 'chat', chatKey: 'A' });
const messages = [{ role: 'user', content: 'question', runId: 'r' }, { role: 'assistant', content: 'answer', runId: 'r' }];
function legacy() { return { version: 1, id: crypto.randomUUID(), revision: 0, scope, title: 'Old', createdAt: 1, updatedAt: 1, messages: structuredClone(messages), required: ['chat'], status: 'succeeded' }; }
function fixture(store = createMemoryHistoryStore()) {
    const port = { enabled: () => true, open: async () => store, setEnabled: async () => {} };
    return { store, port, library: createSessionLibrary({ port }) };
}
test('V1 records and summaries migrate without mutating input; future schemas remain untouched', () => {
    const input = legacy(), result = validateRecord(input);
    assert.equal(input.version, 1); assert.equal(result.version, 3); assert.equal(result.archived, false); assert.equal(result.imported, false); assert.equal(result.contextSummary, null);
    assert.equal(validateSummary(summarizeRecord(input)).version, 3);
    assert.throws(() => validateRecord({ ...result, version: 99 }), /HISTORY_VERSION/);
    assert.throws(() => validateRecord({ ...result, scope: JSON.stringify(['draft', 'chat', 'A']) }), /HISTORY_INVALID/);
});
test('Rename and archive preserve messages, survive reload and do not free capacity', async () => {
    const f = fixture(); await f.library.ready; const id = f.library.create(scope); f.library.update(id, { messages }); await f.library.flush();
    await f.library.rename(id, ' New title '); await f.library.archive(id, true);
    assert.equal(f.library.get(id).title, 'New title'); assert.deepEqual(f.library.get(id).messages, messages);
    assert.equal(f.library.snapshot(scope, id).total, 1); assert.throws(() => f.library.assertRoom(id), /HISTORY_READ_ONLY/);
    const restored = createSessionLibrary({ port: f.port }); await restored.ready; assert.equal((await restored.load(id)).archived, true);
    await restored.archive(id, false); assert.equal(restored.get(id).archived, false); await f.library.close(); await restored.close();
});
test('An answer arriving during metadata persistence is retained alongside the new title', async () => {
    const backing = createMemoryHistoryStore(), wait = deferred(); let blocked = false;
    const f = fixture({ ...backing, async write(record, revision) { if (blocked) { blocked = false; await wait.promise; } return backing.write(record, revision); } });
    await f.library.ready; const id = f.library.create(scope); await f.library.flush(); blocked = true;
    const rename = f.library.rename(id, 'Renamed'); await flush();
    f.library.update(id, { messages, status: 'succeeded' }); wait.resolve(); await rename; await f.library.flush();
    const saved = await backing.read(id); assert.equal(saved.title, 'Renamed'); assert.deepEqual(saved.messages, messages); assert.equal(saved.status, 'succeeded'); await f.library.close();
});
test('Explicit metadata edits with auto-save off do not persist new replies; delete still removes disk copy', async () => {
    const f = fixture(); await f.library.ready; const id = f.library.create(scope); await f.library.flush(); await f.library.setEnabled(false);
    f.library.update(id, { messages }); await f.library.rename(id, 'Named');
    assert.equal((await f.store.read(id)).title, 'Named'); assert.deepEqual((await f.store.read(id)).messages, []);
    assert.deepEqual(f.library.get(id).messages, messages); assert.equal(f.library.snapshot(scope, id).dirty, true);
    await f.library.remove(id); assert.equal(await f.store.read(id), null); assert.equal(f.library.get(id), null); await f.library.close();
});
test('Delete failure retains record; a confirmed deletion frees the session slot', async () => {
    const backing = createMemoryHistoryStore(); let fail = true;
    const f = fixture({ ...backing, async remove(...args) { if (fail) throw Error('HISTORY_SAVE_FAILED'); return backing.remove(...args); } });
    await f.library.ready; const id = f.library.create(scope); await f.library.flush();
    await assert.rejects(f.library.remove(id), /HISTORY_SAVE_FAILED/); assert.ok(f.library.get(id)); assert.ok(await backing.read(id));
    fail = false; await f.library.remove(id); assert.equal(f.library.snapshot(scope).total, 0);
    const next = f.library.create(scope); assert.notEqual(next, id); await f.library.close();
});
test('Another tab cannot resurrect a deleted record with queued updates or retries', async () => {
    const f = fixture(); await f.library.ready; const id = f.library.create(scope); await f.library.flush();
    const other = createSessionLibrary({ port: f.port }); await other.ready; await other.load(id);
    await f.library.remove(id); other.update(id, { messages }); await other.flush(); await other.retry();
    assert.equal(other.snapshot(scope, id).error, 'HISTORY_DELETED'); assert.equal(await f.store.read(id), null);
    assert.deepEqual(other.get(id).messages, messages); await other.remove(id); assert.equal(other.get(id), null); await f.library.close(); await other.close();
});

test('At the full session limit archive retains capacity and confirmed delete permits a new session', async () => {
    const library = createSessionLibrary(), ids = Array.from({ length: 64 }, () => library.create(scope));
    await library.archive(ids[0], true); assert.throws(() => library.create(scope), /HISTORY_CAPACITY/);
    await library.remove(ids[0]); const next = library.create(scope); assert.notEqual(next, ids[0]); assert.equal(library.snapshot(scope).total, 64); await library.close();
});
test('Delayed read cannot restore a record deleted locally in the meantime', async () => {
    const f = fixture(); await f.library.ready; const id = f.library.create(scope); await f.library.flush();
    const wait = deferred(); let reads = 0;
    const g = fixture({ ...f.store, async read(key) { const value = await f.store.read(key); if (++reads === 1) await wait.promise; return value; } });
    await g.library.ready; const slow = g.library.load(id); await flush();
    await g.library.load(id); await g.library.remove(id); wait.resolve();
    await assert.rejects(slow, /NOT_READY/); assert.equal(g.library.get(id), null); await g.library.close(); await f.library.close();
});
test('Scope, archive, task and title filters work on summaries without loading all bodies', async () => {
    const f = fixture(); await f.library.ready;
    const a = f.library.create(scope), b = f.library.create(historyScope('memory', { kind: 'chat', chatKey: 'A' })), c = f.library.create(historyScope('draft', { kind: 'global' }));
    await f.library.rename(a, 'Alpha'); await f.library.rename(b, 'ALPHA memory'); await f.library.archive(a, true);
    const filter = { range: 'current', chatKey: 'A', archive: 'active', task: '', query: 'alpha' };
    assert.deepEqual(f.library.snapshot(scope, null, filter).sessions.map(r => r.id), [b]);
    assert.deepEqual(f.library.snapshot(scope, null, { ...filter, range: 'global', query: '' }).sessions.map(r => r.id), [c]);
    assert.deepEqual(f.library.snapshot(scope, null, { ...filter, archive: 'all', task: 'chat' }).sessions.map(r => r.id), [a]); await f.library.close();
});
test('Import is a new read-only record, rejects authority/unknown fields and exports round-trip JSON', async () => {
    const source = legacy(), parsed = parseHistoryImport(JSON.stringify(source)), imported = importedRecord(parsed);
    assert.notEqual(imported.id, source.id); assert.equal(imported.imported, true); assert.equal(imported.scope, source.scope);
    assert.equal(parseHistoryImport(exportHistoryRecord(imported)).imported, true);
    assert.throws(() => parseHistoryImport(JSON.stringify({ ...source, apiKey: 'secret' })), /HISTORY_INVALID/);
    assert.throws(() => parseHistoryImport('{"__proto__":{}}'), /HISTORY_INVALID/);
    assert.throws(() => parseHistoryImport('x'.repeat(33554433)), /HISTORY_CAPACITY/);
    const f = fixture(); await f.library.ready; const id = await f.library.import(JSON.stringify(source));
    assert.throws(() => f.library.assertRoom(id), /HISTORY_READ_ONLY/); assert.equal(f.library.get(id).revision, 0); await f.library.close();
});
test('Markdown export keeps arbitrary HTML/images and backticks in literal blocks', () => {
    const r = legacy(); r.messages[0] = { ...r.messages[0], content: '```\n<img src=x>\n![image](https://example.test/x)' };
    const md = exportHistoryRecord(r, 'markdown'); assert.match(md, /````text\n```\n<img src=x>/); assert.match(md, /## User/);
    assert.throws(() => exportHistoryRecord(r, 'html'), /HISTORY_INVALID/);
});
