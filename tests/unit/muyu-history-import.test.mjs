import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionLibrary } from '../../muyu/sessions/library.js';
import { createMemoryHistoryStore } from '../../muyu/sessions/memory-store.js';
import { importedRecord, historyImportFingerprint, exportHistoryRecord } from '../../muyu/sessions/exchange.js';
import { deferred } from './helpers/muyu-subject.mjs';

const scope = '["assistant","chat","A"]';
const source = () => ({ version: 7, id: crypto.randomUUID(), revision: 5, scope, title: 'Backup', createdAt: 1, updatedAt: 2,
    messages: [{ role: 'user', content: 'question', runId: 'r', origin: 'question' }, { role: 'assistant', content: 'answer', runId: 'r' }],
    required: ['source:memoryConfig'], status: 'succeeded', archived: false, imported: false,
    receipts: [], contextSummary: null, scopeChanges: [] });
async function fixture(store = createMemoryHistoryStore(), enabled = true) {
    const port = { enabled: () => enabled, open: async () => store, setEnabled: async value => { enabled = value; } };
    const library = createSessionLibrary({ port }); await library.ready;
    return { library, store, port };
}

test('Identical imports skip duplicates without writes; originals remain separate and runnable', async () => {
    const f = await fixture(), original = source(); await f.store.create({ ...original, revision: 0 });
    const id = await f.library.import(JSON.stringify(original)); await f.library.flush();
    assert.notEqual(id, original.id); assert.equal(f.library.get(id).imported, true);
    const before = await f.store.read(id);
    assert.equal(await f.library.import(JSON.stringify(original)), id); await f.library.flush();
    assert.deepEqual(await f.store.read(id), before); assert.equal((await f.store.list()).length, 2);
    assert.equal((await f.store.read(original.id)).imported, false);
    assert.deepEqual(f.library.snapshot(scope, id).importReport, { id, status: 'identical' });
    assert.throws(() => f.library.assertRoom(id), /HISTORY_READ_ONLY/); await f.library.close();
});

test('Repeat import survives reload, archived backups and export/import round trips', async () => {
    const f = await fixture(), raw = JSON.stringify(source());
    const id = await f.library.import(raw); await f.library.flush(); await f.library.archive(id, true);
    const exported = f.library.export(id); await f.library.close();
    const next = createSessionLibrary({ port: f.port }); await next.ready;
    assert.equal(await next.import(raw), id);
    assert.equal(await next.import(exported), id);
    assert.equal((await next.load(id)).archived, true); assert.equal(next.snapshot(scope).total, 1);
    await next.close();
});

test('Editing the same file creates another read-only version; retry matches each version independently', async () => {
    const f = await fixture(), a = source(), b = structuredClone(a); b.messages[1].content = 'edited answer';
    const first = await f.library.import(JSON.stringify(a)), second = await f.library.import(JSON.stringify(b)); await f.library.flush();
    assert.notEqual(first, second); assert.notEqual(first, a.id); assert.notEqual(second, a.id);
    assert.equal(f.library.get(first).messages[1].content, 'answer');
    assert.equal(f.library.get(second).messages[1].content, 'edited answer');
    assert.equal(await f.library.import(JSON.stringify(a)), first); assert.equal(await f.library.import(JSON.stringify(b)), second);
    for (const id of [first, second]) { assert.equal(f.library.get(id).imported, true); assert.throws(() => f.library.assertRoom(id), /HISTORY_READ_ONLY/); }
    await f.library.close();
});

test('Fingerprint ignores rewritten identity/lifecycle but keeps content, title, scope, summary and order', async () => {
    const a = source(), same = importedRecord(a, 9000);
    same.archived = true; same.revision = 100;
    assert.equal(await historyImportFingerprint(a), await historyImportFingerprint(same));
    // Reorder keys recursively without changing arrays or text.
    const reorder = value => Array.isArray(value) ? value.map(reorder) : value && typeof value === 'object'
        ? Object.fromEntries(Object.keys(value).reverse().map(key => [key, reorder(value[key])])) : value;
    assert.equal(await historyImportFingerprint(a), await historyImportFingerprint(reorder(a)));
    for (const patch of [{ title: 'Edited title' }, { scope: '["assistant","chat","B"]' }, { status: 'failed' },
        { messages: [...a.messages].reverse() }, { contextSummary: { through: 2, fingerprint: '1:2:3', text: 'summary', createdAt: 2 } },
        { scopeChanges: [{ at: 1, from: scope, to: '["assistant","chat","B"]', messageIndex: 1 }] }]) {
        assert.notEqual(await historyImportFingerprint(a), await historyImportFingerprint({ ...a, ...patch }));
    }
    const running = { ...a, status: 'running' };
    assert.equal(await historyImportFingerprint(running), await historyImportFingerprint(importedRecord(running)));
});

test('Legacy imported records deduplicate without a DTO upgrade or provenance sidecar', async () => {
    const f = await fixture(), a = { version: 1, id: crypto.randomUUID(), revision: 0, scope: '["chat","chat","A"]', title: 'Legacy',
        createdAt: 1, updatedAt: 1, messages: [], required: [], status: 'running' };
    const old = importedRecord(a, 10); await f.store.create(old);
    assert.equal(await f.library.import(JSON.stringify(a)), old.id);
    assert.equal(await f.library.import(exportHistoryRecord(old)), old.id);
    assert.equal((await f.store.list()).length, 1); await f.library.close();
});

test('Automatic save off still checks the reader, while new imports remain page-only', async () => {
    const f = await fixture(undefined, false), a = source(), saved = importedRecord(a);
    await f.store.create(saved);
    assert.equal(await f.library.import(JSON.stringify(a)), saved.id);
    const edited = { ...a, title: 'Different' }, id = await f.library.import(JSON.stringify(edited)); await f.library.flush();
    assert.equal(await f.store.read(id), null); assert.equal(await f.library.import(JSON.stringify(edited)), id);
    assert.equal(f.library.snapshot(scope, id).enabled, false); await f.library.close();
});

test('A full library permits duplicate recognition but rejects a genuinely new version', async () => {
    const library = createSessionLibrary(), a = source(), id = await library.import(JSON.stringify(a));
    for (let n = 1; n < 64; n++) library.create(scope);
    assert.equal(await library.import(JSON.stringify(a)), id);
    await assert.rejects(library.import(JSON.stringify({ ...a, title: 'New version' })), /HISTORY_CAPACITY/);
    assert.equal(library.snapshot(scope).total, 64); await library.close();
});

test('Source failures are not empty directories and do not reserve a new record', async () => {
    const backing = createMemoryHistoryStore(); let fail = false;
    const f = await fixture({ ...backing, async list() { if (fail) throw Error('HISTORY_UNAVAILABLE'); return backing.list(); } });
    fail = true; await assert.rejects(f.library.import(JSON.stringify(source())), /HISTORY_UNAVAILABLE/);
    assert.equal(f.library.snapshot(scope).total, 0); assert.equal((await backing.list()).length, 0);
    fail = false; await f.library.close();
});

test('External edits to a loaded backup are not overwritten or mistaken for a matching page cache', async () => {
    const f = await fixture(), a = source(), id = await f.library.import(JSON.stringify(a)); await f.library.flush();
    const previous = await f.store.read(id); await f.store.update({ ...previous, title: 'External change' }, previous.revision);
    await assert.rejects(f.library.import(JSON.stringify(a)), /HISTORY_CONFLICT/);
    await assert.rejects(f.library.import(JSON.stringify({ ...a, title: 'External change' })), /HISTORY_CONFLICT/);
    assert.equal(f.library.get(id).title, a.title); assert.equal((await f.store.read(id)).title, 'External change');
    assert.equal(f.library.snapshot(scope).total, 1); await f.library.close();
});

test('A candidate changed during verification aborts rather than skipping or creating another copy', async () => {
    const backing = createMemoryHistoryStore(), a = source(), saved = await backing.create(importedRecord(a));
    const gate = deferred(), entered = deferred(); let held = false;
    const f = await fixture({ ...backing, async read(id) { const record = await backing.read(id); if (!held) { held = true; entered.resolve(); await gate.promise; } return record; } });
    const pending = f.library.import(JSON.stringify(a)); await entered.promise;
    await backing.update({ ...saved, title: 'Changed while reading' }, saved.revision); gate.resolve();
    await assert.rejects(pending, /HISTORY_CONFLICT/); assert.equal((await backing.list()).length, 1); await f.library.close();
});

test('Concurrent import attempts cannot reserve duplicate page copies; retry locates the first one', async () => {
    const library = createSessionLibrary(), text = JSON.stringify(source());
    const results = await Promise.allSettled([library.import(text), library.import(text)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.find(r => r.status === 'rejected').reason.message, 'NOT_READY');
    const id = results.find(r => r.status === 'fulfilled').value;
    assert.equal(await library.import(text), id); assert.equal(library.snapshot(scope).total, 1); await library.close();
});

test('Different read sources do not share a duplicate index or import ID', async () => {
    const a = await fixture(), b = await fixture(), text = JSON.stringify(source());
    const first = await a.library.import(text), second = await b.library.import(text);
    assert.notEqual(first, second); assert.equal(await a.library.import(text), first); assert.equal(await b.library.import(text), second);
    await a.library.close(); await b.library.close();
});
