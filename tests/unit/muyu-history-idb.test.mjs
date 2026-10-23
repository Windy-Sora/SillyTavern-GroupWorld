import test from 'node:test';
import assert from 'node:assert/strict';
import { historyIDB } from './helpers/history-idb.mjs';
import { openIndexedHistoryStore } from '../../muyu/sessions/indexeddb-store.js';
import { historyScope } from '../../muyu/sessions/contract.js';

function record() { return { version: 1, id: crypto.randomUUID(), revision: 0, scope: historyScope('chat', { kind: 'chat', chatKey: 'A' }), title: 'test', createdAt: 1, updatedAt: 1, messages: [], required: [], status: 'idle' }; }
test('IndexedDB adapter separates account namespaces and lists metadata without bodies', async () => {
    const indexedDB = historyIDB(), a = await openIndexedHistoryStore({ indexedDB, namespace: crypto.randomUUID() }), b = await openIndexedHistoryStore({ indexedDB, namespace: crypto.randomUUID() });
    const value = record(); await a.write(value, 0);
    assert.equal((await a.list()).length, 1); assert.equal('messages' in (await a.list())[0], false);
    assert.deepEqual(await b.list(), []); assert.equal(await b.read(value.id), null);
    assert.equal((await a.read(value.id)).revision, 1); a.close(); b.close();
});
test('IndexedDB adapter serializes compare-and-swap, and rejected writes do not partially commit', async () => {
    const indexedDB = historyIDB(), namespace = crypto.randomUUID(), a = await openIndexedHistoryStore({ indexedDB, namespace }), b = await openIndexedHistoryStore({ indexedDB, namespace });
    const value = record(); await a.write(value, 0);
    const results = await Promise.allSettled([a.write({ ...value, title: 'A' }, 1), b.write({ ...value, title: 'B' }, 1)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.match(results.find(r => r.status === 'rejected').reason.message, /HISTORY_CONFLICT/);
    const before = await a.read(value.id), list = await a.list(); indexedDB.failNextPut('summaries');
    await assert.rejects(a.write({ ...before, title: 'not committed' }, before.revision), /HISTORY_SAVE_FAILED/);
    assert.deepEqual(await a.read(value.id), before); assert.deepEqual(await a.list(), list);
});
test('IndexedDB adapter fails closed when no storage or account namespace is available', async () => {
    await assert.rejects(openIndexedHistoryStore({ namespace: 'shared', indexedDB: historyIDB() }), /HISTORY_UNAVAILABLE/);
    await assert.rejects(openIndexedHistoryStore({ namespace: crypto.randomUUID(), indexedDB: null }), /HISTORY_UNAVAILABLE/);
});

test('IndexedDB deletion is atomic, revision checked, frees records and rejects stale updates', async () => {
    const indexedDB = historyIDB(), namespace = crypto.randomUUID(), store = await openIndexedHistoryStore({ indexedDB, namespace });
    const saved = await store.create(record());
    await assert.rejects(store.remove(saved.id, 99), /HISTORY_CONFLICT/);
    indexedDB.failNextPut('records'); await assert.rejects(store.remove(saved.id, saved.revision), /HISTORY_SAVE_FAILED/);
    assert.deepEqual(await store.read(saved.id), saved); assert.equal((await store.list()).length, 1);
    await store.remove(saved.id, saved.revision); assert.equal(await store.read(saved.id), null); assert.deepEqual(await store.list(), []);
    await assert.rejects(store.update(saved, saved.revision), /HISTORY_DELETED/);
    await assert.rejects(store.update(saved, 0), /HISTORY_CONFLICT/);
});

test('IndexedDB v3 opens existing v1 data without deleting it and prevents old-version writers', async () => {
    const indexedDB = historyIDB(), namespace = crypto.randomUUID(), legacy = { ...record(), revision: 1 };
    await new Promise((resolve, reject) => {
        const req = indexedDB.open('gd-muyu-history-v1', 1);
        req.onupgradeneeded = () => { for (const name of ['records', 'summaries']) req.result.createObjectStore(name).createIndex('namespace', 'namespace'); };
        req.onsuccess = () => {
            const tx = req.result.transaction(['records', 'summaries'], 'readwrite'), { messages, required, ...metadata } = legacy;
            tx.objectStore('records').put({ namespace, id: legacy.id, record: legacy });
            tx.objectStore('summaries').put({ namespace, ...metadata, count: 0, bytes: JSON.stringify(legacy).length }); tx.oncomplete = resolve; tx.onabort = reject;
        };
    });
    const store = await openIndexedHistoryStore({ indexedDB, namespace });
    const restored = await store.read(legacy.id); assert.equal(restored.version, 3); assert.equal(restored.archived, false);
    const saved = await store.update({ ...restored, archived: true }, restored.revision); assert.equal(saved.revision, 2);
    assert.equal((await store.list())[0].archived, true);
    await new Promise(resolve => { const req = indexedDB.open('gd-muyu-history-v1', 1); req.onerror = resolve; req.onsuccess = () => assert.fail('Old client reopened storage'); });
});
