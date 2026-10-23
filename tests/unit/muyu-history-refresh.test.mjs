import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionLibrary } from '../../muyu/sessions/library.js';
import { createMemoryHistoryStore } from '../../muyu/sessions/memory-store.js';
import { historyScope } from '../../muyu/sessions/contract.js';
import { deferred, flush } from './helpers/muyu-subject.mjs';

const scope = historyScope('assistant', { kind: 'chat', chatKey: 'A' });
const messages = text => [{ role: 'user', content: text, runId: 'r' }];
async function fixture() {
    const store = createMemoryHistoryStore(); store.kind = 'browser'; store.sourceKey = 'account-A:browser';
    let enabled = true;
    const port = { enabled: () => enabled, setEnabled: async value => { enabled = value; }, open: async () => store };
    const library = createSessionLibrary({ port }); await library.ready;
    const id = library.create(scope); library.update(id, { messages: messages('saved') }); await library.flush();
    return { library, store, port, id };
}

test('Refresh detects changed loaded records, preserves the page and reloads only on request', async () => {
    const { library, store, id } = await fixture(), old = await store.read(id);
    await store.update({ ...old, messages: messages('external') }, old.revision);
    await library.refresh();
    assert.equal(library.snapshot(scope, id).external, 'changed');
    assert.equal(library.snapshot(scope, id).error, 'HISTORY_CONFLICT');
    assert.deepEqual(library.get(id).messages, messages('saved'));
    assert.throws(() => library.assertRoom(id), /HISTORY_CONFLICT/);
    let detached = false;
    await library.reload(id, { beforeReplace: () => { detached = true; assert.deepEqual(library.get(id).messages, messages('saved')); } });
    assert.equal(detached, true); assert.deepEqual(library.get(id).messages, messages('external'));
    await library.refresh(); assert.equal(library.snapshot(scope, id).external, null);
    assert.equal(library.snapshot(scope, id).error, null); await library.close();
});

test('External deletion is shown explicitly and confirmed reload removes only the old local copy', async () => {
    const { library, store, id } = await fixture(), saved = await store.read(id);
    await store.remove(id, saved.revision); await library.refresh();
    assert.equal(library.snapshot(scope, id).external, 'deleted'); assert.ok(library.get(id));
    assert.throws(() => library.assertRoom(id), /HISTORY_DELETED/);
    assert.equal(await library.reload(id), null);
    assert.equal(library.get(id), null); assert.equal(library.snapshot(scope).total, 0); assert.equal(await store.read(id), null);
    await library.close();
});

test('Re-enabling saving detects external changes before scheduling dirty local messages', async () => {
    const { library, store, id } = await fixture();
    await library.setEnabled(false); library.update(id, { messages: messages('local unsaved') });
    const saved = await store.read(id); await store.update({ ...saved, messages: messages('external') }, saved.revision);
    await library.setEnabled(true); await library.flush();
    assert.deepEqual((await store.read(id)).messages, messages('external'));
    assert.deepEqual(library.get(id).messages, messages('local unsaved'));
    assert.equal(library.snapshot(scope, id).external, 'changed');
    await assert.rejects(library.reload(id), /HISTORY_UNSAVED/);
    await library.reload(id, { discardLocal: true });
    assert.deepEqual(library.get(id).messages, messages('external')); assert.equal(library.snapshot(scope, id).dirty, false);
    await library.close();
});

test('Unchanged refresh and interrupted-status projection do not create false conflicts', async () => {
    const { library, store, port, id } = await fixture();
    library.update(id, { status: 'running' }); await library.flush(); await library.close();
    const other = createSessionLibrary({ port }); await other.ready; await other.load(id); await other.refresh();
    assert.equal(other.get(id).status, 'interrupted'); assert.equal(other.snapshot(scope, id).external, null);
    await other.setEnabled(false); await other.setEnabled(true); assert.equal(other.snapshot(scope, id).external, null);
    assert.equal((await store.read(id)).status, 'running'); await other.close();
});

test('Failed reload preserves the working record and does not detach its runtime', async () => {
    const { library, store, id } = await fixture(); let detached = false;
    store.read = async () => { throw Error('HISTORY_UNAVAILABLE'); };
    await assert.rejects(library.reload(id, { discardLocal: true, beforeReplace: () => { detached = true; } }), /HISTORY_UNAVAILABLE/);
    assert.equal(detached, false); assert.deepEqual(library.get(id).messages, messages('saved'));
    assert.equal(library.snapshot(scope, id).loading, false); await library.close();
});

test('Local changes arriving during a reload invalidate the replacement even after earlier discard consent', async () => {
    const { library, store, id } = await fixture(), gate = deferred(), read = store.read.bind(store);
    await library.setEnabled(false);
    store.read = async key => { const value = await read(key); await gate.promise; return value; };
    let detached = false;
    const pending = library.reload(id, { discardLocal: true, beforeReplace: () => { detached = true; } }); await flush();
    library.update(id, { messages: messages('arrived later') }); gate.resolve();
    await assert.rejects(pending, /HISTORY_CONFLICT/); assert.equal(detached, false);
    assert.deepEqual(library.get(id).messages, messages('arrived later')); await library.close();
});

test('A loaded library cannot silently change account or storage source', async () => {
    const { library, store, id } = await fixture(); store.sourceKey = 'account-B:world-book';
    await assert.rejects(library.refresh(), /HISTORY_SOURCE_CHANGED/);
    await assert.rejects(library.load(id), /HISTORY_SOURCE_CHANGED/);
    await assert.rejects(library.reload(id), /HISTORY_SOURCE_CHANGED/);
    assert.throws(() => library.assertRoom(id), /HISTORY_SOURCE_CHANGED/);
    library.update(id, { messages: messages('must not write into another source') }); await library.flush();
    assert.deepEqual((await store.read(id)).messages, messages('saved')); await library.close();
});

test('Source changes during an asynchronous list do not publish another source into the cache', async () => {
    const { library, store, id } = await fixture(), list = store.list.bind(store);
    store.list = async () => { const rows = await list(); store.sourceKey = 'account-B:browser'; return rows; };
    await assert.rejects(library.refresh(), /HISTORY_SOURCE_CHANGED/);
    assert.equal(library.snapshot(scope, id).sourceKey, 'account-A:browser');
    assert.deepEqual(library.get(id).messages, messages('saved')); await library.close();
});

test('Reload refuses a target updated again between reading its body and fresh inventory', async () => {
    const { library, store, id } = await fixture(), list = store.list.bind(store);
    store.list = async () => { const value = await store.read(id); await store.update({ ...value, title: 'changed during reload' }, value.revision); return list(); };
    let detached = false;
    await assert.rejects(library.reload(id, { beforeReplace: () => { detached = true; } }), /HISTORY_CONFLICT/);
    assert.equal(detached, false); assert.equal(library.get(id).title, ''); await library.close();
});
