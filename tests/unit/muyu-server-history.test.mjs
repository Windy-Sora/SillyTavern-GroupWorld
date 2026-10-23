import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHistoryPort } from '../../muyu/host/history.js';
import { createMemoryHistoryStore } from '../../muyu/sessions/memory-store.js';
import { createSessionLibrary } from '../../muyu/sessions/library.js';
import { openServerHistoryStore } from '../../muyu/sessions/server-store.js';
import { validateRecord } from '../../muyu/sessions/contract.js';
import { fingerprint } from '../../muyu/context/planner.js';

const require = createRequire(import.meta.url);
const { createFileStore, init } = require('../../muyu/server-plugin/index.cjs');
const scope = JSON.stringify(['assistant', 'chat', 'A']);
const record = () => validateRecord({ version: 5, id: crypto.randomUUID(), revision: 0, scope, title: 'Hello', createdAt: 1, updatedAt: 1, messages: [{ role: 'user', content: 'Hello', runId: 'r' }], required: [], status: 'succeeded', archived: false, imported: false, contextSummary: null, receipts: [] });

test('Full server history remains manageable without silently reading or importing browser history', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gd-muyu-migration-full-'));
    const browser = createMemoryHistoryStore(); const old = record(); await browser.create(old);
    const server = { ...createFileStore(root), close() {} }, ids = [];
    let library;
    try {
        for (let i = 0; i < 64; i++) ids.push((await server.create(record())).id);
        const port = createHistoryPort({ getAccount: async () => ({ enabled: false }), getSettings: () => ({ muyuHistoryEnabled: true }), saveSettings: async () => {}, openStore: async () => browser, openServer: async () => server });
        library = createSessionLibrary({ port }); await library.ready;
        const s = library.snapshot(scope); assert.equal(s.enabled, true); assert.equal(s.error, null);
        assert.equal(s.sessions.length, 64); assert.equal(s.migration, null);
        await library.load(ids[0]); assert.match(library.export(ids[0]), /Hello/);
        await library.refresh(); assert.equal(library.snapshot(scope).migration, null);
        assert.ok(await browser.read(old.id)); assert.equal(await server.read(old.id), null);
        await library.remove(ids[0]); await library.refresh();
        assert.equal(library.snapshot(scope).migration, null); assert.equal(library.snapshot(scope).sessions.length, 63);
        assert.equal(await server.read(old.id), null); assert.ok(await browser.read(old.id));
    } finally { await library?.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('Selected server read errors are not masked by fallback or browser migration', async () => {
    const browser = createMemoryHistoryStore(); await browser.create(record());
    let closed = 0;
    const port = createHistoryPort({ getAccount: async () => ({ enabled: false }), getSettings: () => ({}), saveSettings: async () => {}, openStore: async () => browser,
        openServer: async () => ({ list: async () => { throw Error('HISTORY_SAVE_FAILED'); }, close() { closed++; } }) });
    const opened = await port.open(); await assert.rejects(opened.list(), /HISTORY_SAVE_FAILED/); opened.close(); await Promise.resolve(); assert.equal(closed, 1);
});

test('Private file store agrees with the large-context archive contract', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gd-muyu-large-store-'));
    try {
        const store = createFileStore(root), input = record();
        input.messages = Array.from({ length: 400 }, (_, n) => ({ role: n % 2 ? 'assistant' : 'user', content: '中'.repeat(n === 0 ? 100000 : 2000), runId: String(Math.floor(n / 2)) }));
        input.contextSummary = { through: 2, fingerprint: fingerprint(input.messages.slice(0, 2)), text: '交接资料'.repeat(4000), createdAt: 1 };
        const first = await store.create(validateRecord(input));
        assert.equal(first.messages.length, 400);
        assert.equal((await store.read(input.id)).messages[0].content.length, 100000);
        assert.equal(validateRecord(await store.read(input.id)).contextSummary.text, input.contextSummary.text);
        assert.ok((await store.list())[0].bytes > 2 * 1024 * 1024);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Private file store persists, reloads, rejects stale writes and confines IDs', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gd-muyu-store-'));
    try {
        const dir = path.join(root, '.group-director', 'muyu', 'history', crypto.randomUUID());
        const store = createFileStore(dir), input = record();
        const first = await store.create(input);
        assert.equal(first.revision, 1);
        assert.equal((await createFileStore(dir).read(input.id)).messages[0].content, 'Hello');
        assert.equal((await store.list())[0].count, 1);
        await assert.rejects(store.update({ ...input, title: 'stale' }, 0), /HISTORY_CONFLICT/);
        await assert.rejects(store.read('../other'), /HISTORY_INVALID/);
        await store.remove(input.id, 1);
        assert.equal(await store.read(input.id), null);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Server-store adapter detects a missing plugin but does not import browser records on open', async () => {
    const browser = createMemoryHistoryStore(), old = record();
    await browser.create(old);
    const server = createMemoryHistoryStore();
    const port = createHistoryPort({ getAccount: async () => ({ enabled: false }), getSettings: () => ({ muyuHistoryEnabled: true }), saveSettings: async () => {},
        openStore: async () => browser, openServer: async () => server });
    const opened = await port.open();
    assert.equal((await opened.list()).length, 0);
    assert.equal(await server.read(old.id), null);
    assert.equal((await browser.read(old.id)).messages[0].content, 'Hello');
    const absent = await openServerHistoryStore({ namespace: crypto.randomUUID(), fetcher: async () => ({ status: 404 }) });
    assert.equal(absent, null);
});

test('Server plugin registers only its private authenticated API routes', () => {
    const routes = [];
    const router = Object.fromEntries(['get', 'post', 'put', 'delete'].map(method => [method, (route) => routes.push(`${method} ${route}`)]));
    init(router);
    assert.deepEqual(routes, ['get /web/health', 'post /web/search', ...['roots', 'list', 'search', 'read'].map(operation => 'post /documents/' + operation), 'post /web/page', ...['preview', 'apply', 'validate'].map(operation => 'post /workspace/' + operation), 'get /service/status', 'post /service/storage-check', 'get /service/diagnostics', 'post /service/diagnostics/clear', 'get /health', 'get /records', 'get /records/:id', 'put /records/:id', 'delete /records/:id']);
});

test('Deleting migrated history survives reopening and does not retain private text on the server', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gd-muyu-deleted-'));
    try {
        const browser = createMemoryHistoryStore(), old = record();
        await browser.create(old);
        const dir = path.join(root, 'history');
        const port = createHistoryPort({ getAccount: async () => ({ enabled: false }), getSettings: () => ({ muyuHistoryEnabled: true }), saveSettings: async () => {},
            openStore: async () => browser, openServer: async () => ({ ...createFileStore(dir), close() {} }) });
        const opened = await port.open();
        await opened.create(old);
        await opened.remove(old.id, (await opened.read(old.id)).revision);
        opened.close();
        const reopened = await port.open();
        assert.deepEqual(await reopened.list(), []);
        assert.equal(await reopened.read(old.id), null);
        assert.ok(await browser.read(old.id), 'migration backup stays intact');
        for (const name of await fs.readdir(dir)) assert.ok(!(await fs.readFile(path.join(dir, name), 'utf8')).includes('Hello'), 'deletion marker contains no conversation');
        const fresh = record(); await browser.create(fresh);
        assert.deepEqual(await (await port.open()).list(), [], 'opening a reader cannot silently migrate new browser histories');
    } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Two tabs opening server history do not silently import the same browser backup', async () => {
    const browser = createMemoryHistoryStore(), old = record(); await browser.create(old);
    const backing = createMemoryHistoryStore(), server = backing;
    const port = createHistoryPort({ getAccount: async () => ({ enabled: false }), getSettings: () => ({}), saveSettings: async () => {},
        openStore: async () => browser, openServer: async () => server });
    const opened = await Promise.all([port.open(), port.open()]);
    assert.equal(opened.length, 2); assert.equal(await backing.read(old.id), null);
    assert.equal((await backing.list()).length, 0); assert.ok(await browser.read(old.id));
});

for (const relative of [false, true]) test(`HTTP adapter writes and restores a private account file with a ${relative ? 'relative' : 'absolute'} host root`, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gd-muyu-http-'));
    try {
        const routes = new Map(), router = Object.fromEntries(['get', 'post', 'put', 'delete'].map(method => [method, (route, handler) => routes.set(`${method.toUpperCase()} ${route}`, handler)]));
        init(router);
        const fetcher = async (url, options) => new Promise(resolve => {
            const parsed = new URL(url, 'http://st.test'), id = parsed.pathname.split('/').at(-1);
            const route = id === 'health' ? '/health' : id === 'records' ? '/records' : '/records/:id';
            const handler = routes.get(`${options.method} ${route}`);
            if (!handler) return resolve({ status: 404 });
            const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { resolve({ status: this.statusCode, ok: this.statusCode < 400, json: async () => value }); } };
            handler({ user: { directories: { root: relative ? path.relative(process.cwd(), root) : root } }, query: { namespace: parsed.searchParams.get('namespace'), root: 'IGNORED_REQUEST_PATH' }, params: { id }, body: options.body ? JSON.parse(options.body) : undefined }, res);
        });
        const namespace = crypto.randomUUID(), store = await openServerHistoryStore({ namespace, fetcher });
        const input = record(), saved = await store.create(input);
        assert.equal(saved.revision, 1);
        assert.equal((await store.read(input.id)).messages[0].content, 'Hello');
        assert.equal((await store.list())[0].id, input.id);
        assert.equal((await fs.readdir(path.join(root, '.group-director', 'muyu', 'history', namespace))).length, 1);
        await store.remove(input.id, 1);
        assert.equal(await store.read(input.id), null);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Missing or invalid host account roots remain rejected and cannot be supplied by request data', async () => {
    const routes = new Map(), router = Object.fromEntries(['get', 'post', 'put', 'delete'].map(method => [method, (route, handler) => routes.set(`${method.toUpperCase()} ${route}`, handler)]));
    init(router);
    for (const root of [undefined, null, '', '   ', 42, '\0invalid']) {
        const response = await new Promise(resolve => {
            const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { resolve({ status: this.statusCode, value }); } };
            routes.get('GET /records')({ user: { directories: { root } }, query: { namespace: crypto.randomUUID(), root: process.cwd() }, body: { root: process.cwd() } }, res);
        });
        assert.equal(response.status, 500); assert.deepEqual(response.value, { error: 'HISTORY_IDENTITY_UNAVAILABLE' });
    }
    const response = await new Promise(resolve => {
        const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { resolve({ status: this.statusCode, value }); } };
        routes.get('GET /records')({ user: { directories: { root: process.cwd() } }, query: { namespace: '../escape' } }, res);
    });
    assert.equal(response.status, 400); assert.deepEqual(response.value, { error: 'HISTORY_INVALID' });
});

test('HTTP adapter retains the safe account error but never exposes unknown server details or falls back', async () => {
    for (const code of ['HISTORY_IDENTITY_UNAVAILABLE', 'SECRET_RAW_BACKEND_DETAIL']) {
        const fetcher = async url => ({ ok: url.endsWith('/health'), status: url.endsWith('/health') ? 200 : 500,
            json: async () => url.endsWith('/health') ? { version: 1 } : { error: code, detail: 'PRIVATE_SERVER_PATH' } });
        const store = await openServerHistoryStore({ namespace: crypto.randomUUID(), fetcher });
        await assert.rejects(store.list(), error => error.message === (code === 'HISTORY_IDENTITY_UNAVAILABLE' ? code : 'HISTORY_UNAVAILABLE'));
    }
});
test('BUG-1: Windows namespace aliases share revision and deletion queues', { skip: process.platform !== 'win32' }, async t => {
    const account = await fs.mkdtemp(path.join(os.tmpdir(), 'muyu-namespace-alias-'));
    t.after(() => fs.rm(account, { recursive: true, force: true }));
    const routes = new Map();
    init(Object.fromEntries(['get', 'put', 'delete', 'post'].map(method => [method, (route, handler) => routes.set(method + route, handler)])));
    const namespace = 'abcdefab-abcd-abcd-abcd-abcdefabcdef';
    const call = (method, ns, saved, body) => new Promise(resolve => {
        const res = { code: 200, status(code) { this.code = code; return this; }, json(value) { resolve({ code: this.code, value }); } };
        routes.get(method + '/records/:id')({ user: { directories: { root: account } }, query: { namespace: ns }, params: { id: saved.id }, body }, res);
    });
    const original = record(), created = await call('put', namespace, original, { record: original, expectedRevision: 0 });
    assert.equal(created.code, 200);
    const results = await Promise.all(['A', 'B'].map((title, i) => call('put', i ? namespace.toUpperCase() : namespace, original, {
        record: { ...created.value, title }, expectedRevision: 1,
    })));
    assert.deepEqual(results.map(row => row.code).sort(), [200, 409]);
    assert.equal(results.find(row => row.code === 409).value.error, 'HISTORY_CONFLICT');
    const winner = results.find(row => row.code === 200).value;
    const dir = path.join(account, '.group-director', 'muyu', 'history', namespace);
    assert.deepEqual(await createFileStore(dir).read(original.id), winner);
    const mixed = await Promise.all([
        call('put', namespace, winner, { record: { ...winner, title: 'Updated' }, expectedRevision: 2 }),
        call('delete', namespace.toUpperCase(), winner, { revision: 2 }),
    ]);
    assert.deepEqual(mixed.map(row => row.code).sort(), [200, 409]);
});

test('BUG-1: case-distinct namespace directories remain separate on non-Windows systems', { skip: process.platform === 'win32' }, async t => {
    const account = await fs.mkdtemp(path.join(os.tmpdir(), 'muyu-namespace-distinct-'));
    t.after(() => fs.rm(account, { recursive: true, force: true }));
    const lower = createFileStore(path.join(account, 'abcdef')), upper = createFileStore(path.join(account, 'ABCDEF'));
    const original = record();
    const saved = await Promise.all([lower.create(original), upper.create({ ...original, title: 'Upper' })]);
    assert.equal(saved[0].revision, 1); assert.equal(saved[1].revision, 1);
    assert.equal((await lower.read(original.id)).title, original.title);
    assert.equal((await upper.read(original.id)).title, 'Upper');
});
