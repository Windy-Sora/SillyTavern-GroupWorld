import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createHistoryPort } from '../../muyu/host/history.js';
import { createMemoryHistoryStore } from '../../muyu/sessions/memory-store.js';
import { createArchiveInspectionModule } from '../../muyu/modules/archive-inspection/index.js';
import { openIndexedHistoryReader } from '../../muyu/sessions/indexeddb-reader.js';
import { summarizeRecord } from '../../muyu/sessions/contract.js';
import { encodeHistoryBook } from '../../muyu/sessions/worldbook-contract.js';
import { encodeVolume, volumeBookName } from '../../muyu/sessions/worldbook-volume.js';
import { createPermissions } from '../../muyu/application/permissions.js';
import { assistantToolAccess, requiredSources } from '../../muyu/application/capabilities.js';
import { createHostBridge } from '../../muyu/host/bridge.js';
import { createBuiltins } from '../../muyu/modules/builtins.js';
import { deferred } from './helpers/muyu-subject.mjs';

const sources = ['browser', 'account-settings', 'world-book', 'server'];
const permission = { browser: 'muyuArchiveBrowser', 'account-settings': 'muyuArchiveSettings', 'world-book': 'muyuArchiveWorldBook', server: 'muyuArchiveServer' };
const target = { kind: 'chat', userKey: 'u', chatKey: 'A' }, identity = { id: 'run', taskId: 'task', target };
const ctx = () => ({ runId: 'run', target, signal: new AbortController().signal });
const record = (title = 'Saved conversation') => ({ version: 7, id: crypto.randomUUID(), revision: 1, scope: '["assistant","chat","PRIVATE_CHAT_KEY"]', title, createdAt: 1, updatedAt: 2,
    messages: [{ role: 'user', content: 'PRIVATE_QUESTION', runId: 'r', origin: 'question' }, { role: 'assistant', content: 'PRIVATE_ANSWER', runId: 'r' }],
    required: ['source:memoryConfig'], status: 'failed', archived: false, imported: false, contextSummary: null, receipts: [], scopeChanges: [] });
const namespace = () => { const hex = createHash('sha256').update('gd-muyu-history-v1:["single-user"]').digest('hex').slice(0, 32); return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-'); };
function fixture({ fetcher = null, openBrowser, charge = () => true } = {}) {
    let settings = { muyuHistoryEnabled: false, muyuHistoryReadSource: 'browser', muyuHistoryWriteTargets: [] }, account = { enabled: false }, writes = 0;
    const calls = [], records = new Map(), stores = Object.fromEntries(sources.map(source => [source, createMemoryHistoryStore()]));
    const open = source => async options => { calls.push({ source, namespace: options.namespace }); return stores[source === 'runtime-browser' ? 'browser' : source]; };
    const port = createHistoryPort({ getAccount: async () => account, getSettings: () => settings, saveSettings: async () => { writes++; }, fetcher,
        openStore: open('runtime-browser'), openArchiveBrowser: openBrowser || open('browser'),
        ...(fetcher ? {} : { openServer: open('server'), openWorldBook: open('world-book') }) });
    const module = createArchiveInspectionModule({ port: port.inspection, charge }); module.bindRun(identity);
    return { port, module, calls, stores, records, get settings() { return settings; }, writes: () => writes, replace() { settings = { ...settings }; }, account(value) { account = value; },
        call: (operation, args) => module.handlers['muyu.archives.' + operation](args, ctx()) };
}
const body = result => { assert.equal(result.status, 'ok'); return JSON.parse(result.text); };

for (const source of sources) test('explicit ' + source + ' inspection while saving is off does not route, write, merge or expose bodies', async () => {
    const f = fixture(), saved = record();
    if (source === 'account-settings') f.settings.muyuHistoryData = { version: 1, namespace: namespace(), records: [saved] };
    else await f.stores[source].create(saved);
    const before = JSON.stringify(f.settings), routing = JSON.stringify(f.port.routing());
    const list = body(await f.call('list', { source })); assert.equal(list.total, 1); assert.equal(list.bodyReturned, false);
    assert.doesNotMatch(JSON.stringify(list), /PRIVATE_|memoryConfig/); assert.equal(list.items[0].historicalStatus, 'failed');
    const check = body(await f.call('inspect', { source, id: list.items[0].id, revision: list.revision }));
    assert.equal(check.integrity, 'decoded-and-metadata-matched'); assert.equal(check.messageCount, 2); assert.equal(check.receiptCount, 0);
    assert.doesNotMatch(JSON.stringify(check), /PRIVATE_|memoryConfig/);
    assert.equal(JSON.stringify(f.settings), before); assert.equal(JSON.stringify(f.port.routing()), routing); assert.equal(f.writes(), 0);
    assert.ok(f.calls.every(call => call.source === source));
});

test('uninstalled service is unavailable without browser fallback or changing normal browser use', async () => {
    const requests = [], f = fixture({ fetcher: async (url, options) => { requests.push([url, options.method]); return new Response('{}', { status: 404 }); } });
    await f.stores.browser.create(record());
    assert.equal((await f.call('list', { source: 'server' })).status, 'unavailable');
    assert.deepEqual(requests, [['/api/plugins/gd-muyu-history/health', 'GET']]); assert.equal(f.calls.length, 0);
    assert.equal(body(await f.call('list', { source: 'browser' })).total, 1); assert.equal(f.settings.muyuHistoryReadSource, 'browser');
});

test('archive readers and runtime use exactly the same legacy account namespace', async () => {
    const f = fixture();
    await f.call('list', { source: 'browser' }); await f.port.open({ source: 'browser' });
    assert.deepEqual(f.calls.map(call => call.namespace), [namespace(), namespace()]);
});

test('world-book verification reads v1 and combined v2 archives without editing, activating or migrating', async () => {
    const books = new Map(), calls = [];
    const legacy = record('Legacy record'), combined = record('Combined record');
    const a = await encodeHistoryBook({ namespace: namespace(), record: legacy, revision: 1 });
    const b = await encodeHistoryBook({ namespace: namespace(), record: combined, revision: 1 });
    books.set(a.name, a.data); books.set(volumeBookName(namespace()), await encodeVolume(namespace(), new Map([[b.name, b.data]])));
    const before = JSON.stringify([...books]);
    const f = fixture({ fetcher: async (url, options) => {
        calls.push([url, options.method]); const input = JSON.parse(options.body);
        if (url.endsWith('/list')) return Response.json([...books].map(([file_id, data]) => ({ file_id, extensions: data.extensions })));
        if (url.endsWith('/get')) return Response.json(books.get(input.name) || { entries: {} });
        throw Error('Unexpected write');
    } });
    const list = body(await f.call('list', { source: 'world-book' })); assert.equal(list.total, 2);
    for (const item of list.items) assert.equal(body(await f.call('inspect', { source: 'world-book', id: item.id, revision: list.revision })).messageCount, 2);
    assert.ok(calls.every(([url, method]) => method === 'POST' && /\/worldinfo\/(list|get)$/.test(url)));
    assert.equal(JSON.stringify([...books]), before); assert.doesNotMatch(JSON.stringify(list), /GD-Muyu|PRIVATE_/);
});

test('empty world-book inspection does not create a book, and an absent browser DB is not a service failure', async () => {
    const calls = [], f = fixture({ fetcher: async (url, options) => { calls.push(url); return Response.json(url.endsWith('/list') ? [] : { entries: {} }); }, openBrowser: async () => null });
    assert.equal(body(await f.call('list', { source: 'world-book' })).total, 0);
    const browser = body(await f.call('list', { source: 'browser' })); assert.equal(browser.state, 'absent'); assert.equal(browser.total, 0);
    assert.ok(calls.every(url => /\/(list|get)$/.test(url)));
});

test('existing service protocol supports metadata and integrity reads without new endpoints', async () => {
    const saved = { ...record(), id: crypto.randomUUID().toUpperCase() }, calls = [];
    const f = fixture({ fetcher: async (url, options) => {
        calls.push([url, options.method]);
        if (url.endsWith('/health')) return Response.json({ version: 1 });
        if (url.includes('/records/')) return Response.json(saved);
        return Response.json([summarizeRecord(saved)]);
    } });
    const list = body(await f.call('list', { source: 'server' }));
    assert.equal(body(await f.call('inspect', { source: 'server', id: list.items[0].id, revision: list.revision })).messageCount, 2);
    assert.ok(calls.every(([url, method]) => url.startsWith('/api/plugins/gd-muyu-history/') && method === 'GET'));
});

test('changed or reordered inventory requires relisting; no arbitrary record ID can be read', async () => {
    const f = fixture(), saved = await f.stores.browser.create(record());
    const list = body(await f.call('list', { source: 'browser' }));
    assert.equal((await f.call('inspect', { source: 'browser', id: saved.id, revision: list.revision })).status, 'not_found');
    await f.stores.browser.update({ ...saved, title: 'changed' }, saved.revision);
    assert.equal((await f.call('inspect', { source: 'browser', id: 'archive:0', revision: list.revision })).status, 'stale_source');
    const fresh = body(await f.call('list', { source: 'browser' })); f.replace();
    assert.equal((await f.call('inspect', { source: 'browser', id: 'archive:0', revision: fresh.revision })).status, 'stale_source');
});

test('invalid record or list/body disagreement is never reported as a valid or empty archive', async () => {
    const f = fixture(), saved = await f.stores.browser.create(record());
    const list = body(await f.call('list', { source: 'browser' }));
    f.stores.browser.read = async () => ({ ...saved, messages: 'corrupted' });
    assert.equal((await f.call('inspect', { source: 'browser', id: 'archive:0', revision: list.revision })).status, 'unsupported');
    f.stores.browser.read = async () => ({ ...saved, messages: [] });
    assert.equal((await f.call('inspect', { source: 'browser', id: 'archive:0', revision: list.revision })).status, 'stale_source');
});

for (const change of ['account', 'settings', 'cancel']) test('in-flight archive observations stop after ' + change, async () => {
    const started = deferred(), gate = deferred(); let closed = 0, charged = 0;
    const f = fixture({ openBrowser: async () => ({ list: async () => { started.resolve(); await gate.promise; return []; }, close: () => closed++ }), charge: () => { charged++; return true; } });
    const abort = new AbortController(), c = { ...ctx(), signal: abort.signal };
    const work = f.module.handlers['muyu.archives.list']({ source: 'browser' }, c); await started.promise;
    if (change === 'account') f.account({ enabled: true, handle: 'other', created: 1 });
    if (change === 'settings') f.replace();
    if (change === 'cancel') abort.abort();
    gate.resolve();
    if (change === 'cancel') await assert.rejects(work);
    else assert.equal((await work).status, 'unavailable');
    assert.equal(charged, 0); assert.equal(closed, 1);
});

test('archive permissions are specific to each backend, honor denial and do not follow settings or world-book grants', () => {
    const f = fixture(), definition = f.module.registry.get('muyu.archives.list');
    const permissions = createPermissions({ readAccess: () => false, fullAccess: () => false });
    permissions.grantSource('source:muyuSelfConfig', target); permissions.grantSource('source:stWorldBooks', target);
    for (const source of sources) {
        assert.deepEqual(requiredSources(definition.id, { source }), ['source:' + permission[source]]);
        assert.equal(assistantToolAccess(definition, { source }, target, 'task', permissions).decision, 'permission_required');
        permissions.grantSource('source:' + permission[source], target);
        assert.equal(assistantToolAccess(definition, { source }, target, 'task', permissions).decision, true);
        permissions.decide({ source: permission[source], reason: 'no archive metadata', target, taskId: 'task' }, 'deny', () => {});
        assert.equal(assistantToolAccess(definition, { source }, target, 'task', permissions).decision, 'user_denied');
    }
});

test('bounded listing and shared UTF-8 budget preserve data and scope during run transfer', async () => {
    const costs = [], f = fixture({ charge: (_id, bytes) => { costs.push(bytes); return true; } });
    for (let i = 0; i < 10; i++) await f.stores.browser.create(record('记录 ' + i));
    const result = await f.call('list', { source: 'browser' }), first = body(result); assert.equal(first.nextOffset, 8);
    assert.equal(costs[0], new TextEncoder().encode(JSON.stringify(result)).length);
    assert.equal((await f.call('list', { source: 'browser', offset: 8 })).status, 'stale_source');
    const next = body(await f.call('list', { source: 'browser', offset: 8, revision: first.revision })); assert.equal(next.complete, true); assert.equal(next.items.length, 2);
    f.module.transferRun('run', { ...identity, id: 'next' });
    const checked = await f.module.handlers['muyu.archives.inspect']({ source: 'browser', id: 'archive:0', revision: first.revision }, { ...ctx(), runId: 'next' }); assert.equal(checked.status, 'ok');
    const refused = fixture({ charge: () => false }); assert.deepEqual(await refused.call('list', { source: 'browser' }), { status: 'budget_exceeded', text: '' });
});

test('optional archive tools are absent without an inspection port and available without a service', () => {
    const settings = {}, context = { groupId: 'g', chatId: 'A', chatMetadata: {} };
    const host = createHostBridge({ getContext: () => context, getSettings: () => settings, extensionKey: 'gd' });
    const absent = createBuiltins(host); assert.equal(absent.registry.get('muyu.archives.list'), null); absent.dispose();
    const f = fixture(), present = createBuiltins({ ...host, history: f.port });
    assert.equal(present.toolGroups['muyu.archives.list'].id, 'archive-inspection'); assert.equal(present.candidateTool('muyu.archives.inspect'), false); present.dispose();
});

test('browser inspection aborts database creation and never requests a schema upgrade', async () => {
    let created = false, aborted = 0;
    const indexedDB = { open(name, version) {
        assert.equal(name, 'gd-muyu-history-v1'); assert.equal(version, undefined);
        const request = { transaction: { abort() { aborted++; created = false; queueMicrotask(() => request.onerror()); } } };
        queueMicrotask(() => { created = true; request.onupgradeneeded(); }); return request;
    } };
    assert.equal(await openIndexedHistoryReader({ namespace: namespace(), indexedDB }), null); assert.equal(created, false); assert.equal(aborted, 1);
});

test('browser inspection reads existing records in readonly transactions and closes on version changes', async () => {
    const saved = record(), modes = []; let closes = 0;
    const db = { objectStoreNames: { contains: name => ['summaries', 'records'].includes(name) }, close: () => { closes++; },
        transaction(names, mode) {
            modes.push(mode); assert.equal(mode, 'readonly'); const tx = {};
            const request = value => { const r = {}; queueMicrotask(() => { r.result = value; r.onsuccess(); queueMicrotask(() => tx.oncomplete()); }); return r; };
            tx.objectStore = () => ({ get: () => request({ namespace: namespace(), record: saved }), index: () => ({ getAll: () => request([{ namespace: namespace(), ...summarizeRecord(saved) }]) }) });
            return tx;
        } };
    const indexedDB = { open(_name, version) { assert.equal(version, undefined); const r = { result: db }; queueMicrotask(() => r.onsuccess()); return r; } };
    const store = await openIndexedHistoryReader({ namespace: namespace(), indexedDB });
    assert.equal((await store.list())[0].title, saved.title); assert.equal((await store.read(saved.id)).messages[0].content, 'PRIVATE_QUESTION');
    assert.equal(store.write, undefined); assert.equal(store.remove, undefined); assert.deepEqual(modes, ['readonly', 'readonly']);
    db.onversionchange(); await assert.rejects(store.list(), /HISTORY_UNAVAILABLE/); assert.equal(closes, 1);
});

test('large saved summary bodies do not pass through the small DTO copier during directory revision calculation', async () => {
    const { createStorageInspectionPort } = await import('../../muyu/host/storage-inspection.js');
    const { createStorageInspectionModule } = await import('../../muyu/modules/storage-inspection/index.js');
    const owner = { summaryEnabled: false }, metadata = { gd: { summaries: [{ active: true, content: 'x'.repeat(40000) }] } };
    const port = createStorageInspectionPort({ getSettings: () => owner, getContext: () => ({ chatMetadata: metadata }), getTarget: () => target, extensionKey: 'gd' });
    const module = createStorageInspectionModule({ port, charge: () => true }); module.bindRun(identity);
    const list = body(await module.handlers['muyu.storage.list']({ resource: 'summaries' }, ctx()));
    assert.equal(list.items[0].length, 40000); assert.doesNotMatch(JSON.stringify(list), /x{100}/);
});
