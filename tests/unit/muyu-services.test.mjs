import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServicesPort } from '../../muyu/host/services.js';
const { registerServiceStatus, checkStorage } = createRequire(import.meta.url)('../../muyu/server-plugin/service-status.cjs');
const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const status = () => ({ version: 1, serviceVersion: '0.6.0', capabilities: { history: 1, search: 1, storageCheck: 1, diagnostics: 1 }, limits: { records: 64, recordBytes: 33554432, totalBytes: 268435456, messages: 4096 } });

test('Service checks send only fixed local routes and sanitize the status projection', async () => {
    const calls = [], port = createServicesPort({ getHeaders: () => ({ 'X-CSRF-Token': 'csrf' }), fetcher: async (url, options) => {
        calls.push({ url, options }); return reply({ ...status(), privatePath: 'SECRET' });
    } });
    const value = await port.check(); assert.equal(value.status, 'available'); assert.equal(value.capabilities.history, true);
    assert.ok(!JSON.stringify(value).includes('SECRET')); assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/api/plugins/gd-muyu-history/service/status');
    assert.equal(calls[0].options.method, 'GET'); assert.equal(calls[0].options.body, undefined);
    assert.equal(calls[0].options.headers['X-CSRF-Token'], 'csrf'); assert.equal(calls[0].options.redirect, 'error');
});
test('Missing, legacy and incompatible services are distinct; unknown errors are sanitized', async () => {
    for (const [value, expected] of [[null, 'missing'], [{ version: 1 }, 'legacy']]) {
        const port = createServicesPort({ fetcher: async url => url.endsWith('/service/status') || !value ? reply({}, 404) : reply(value) });
        assert.equal((await port.check()).status, expected);
    }
    for (const value of [{ ...status(), version: 2 }, { ...status(), serviceVersion: 'SECRET /path' }, { ...status(), limits: { records: -1 } }]) {
        assert.equal((await createServicesPort({ fetcher: async () => reply(value) }).check()).status, 'incompatible');
    }
    for (const error of ['PRIVATE_ERROR', 'HISTORY_IDENTITY_UNAVAILABLE']) {
        await assert.rejects(createServicesPort({ fetcher: async () => reply({ error, detail: 'SECRET' }, 500) }).check(), e => e.message === (error === 'PRIVATE_ERROR' ? 'SERVICE_UNAVAILABLE' : error));
    }
});
test('Storage self-test requires explicit POST and rejects false success or oversized replies', async () => {
    const calls = [], port = createServicesPort({ fetcher: async (url, options) => { calls.push({ url, options }); return reply({ version: 1, status: 'ok', stage: 'complete', cleanup: 'complete', privatePath: 'SECRET' }); } });
    assert.deepEqual(await port.checkStorage(), { status: 'ok', stage: 'complete', cleanup: 'complete' });
    assert.equal(calls.length, 1); assert.equal(calls[0].options.method, 'POST'); assert.deepEqual(JSON.parse(calls[0].options.body), { confirm: true });
    await assert.rejects(createServicesPort({ fetcher: async () => reply({ version: 1, status: 'ok', stage: 'complete', cleanup: 'failed' }) }).checkStorage(), /INCOMPATIBLE/);
    await assert.rejects(createServicesPort({ fetcher: async () => reply({ ...status(), huge: 'x'.repeat(17000) }) }).check(), /UNAVAILABLE/);
});
test('Private self-test handles relative and absolute roots without changing actual history', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'muyu-services-'));
    try {
        const history = path.join(root, '.group-director', 'muyu', 'history'); await fs.mkdir(history, { recursive: true });
        await fs.writeFile(path.join(history, 'existing.json'), 'KEEP');
        for (const value of [root, path.relative(process.cwd(), root)]) {
            const result = await checkStorage({ user: { directories: { root: value } }, body: { root: 'IGNORED' } });
            assert.equal(result.status, 'ok'); assert.equal(result.cleanup, 'complete');
            assert.equal(await fs.readFile(path.join(history, 'existing.json'), 'utf8'), 'KEEP');
            assert.deepEqual(await fs.readdir(path.join(history, '.service-probes')), []);
        }
        for (const value of [undefined, '', ' ', '\0bad']) await assert.rejects(checkStorage({ user: { directories: { root: value } } }), /IDENTITY_UNAVAILABLE/);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('Permission, full disk and cleanup failures are closed results, never false success', async () => {
    for (const [code, expected] of [['EACCES', 'SERVICE_STORAGE_PERMISSION'], ['ENOSPC', 'SERVICE_STORAGE_FULL'], ['UNKNOWN_SECRET', 'SERVICE_STORAGE_UNAVAILABLE']]) {
        const result = await checkStorage({ user: { directories: { root: process.cwd() } } }, { mkdir: async () => { throw Object.assign(Error('SECRET'), { code }); } });
        assert.equal(result.error, expected); assert.equal(result.stage, 'prepare'); assert.equal(result.status, 'failed'); assert.ok(!JSON.stringify(result).includes('SECRET'));
    }
    const result = await checkStorage({ user: { directories: { root: process.cwd() } } }, { mkdir: async () => {}, mkdtemp: async p => p + 'isolated', writeFile: async () => {}, readFile: async () => 'mismatch', rm: async () => { throw Object.assign(Error('SECRET'), { code: 'EPERM' }); } });
    assert.equal(result.status, 'failed'); assert.equal(result.stage, 'read'); assert.equal(result.cleanup, 'failed');
});
test('Status uses host identity and storage route rejects missing confirmation or request paths', async () => {
    const routes = new Map(), router = { get: (p, h) => routes.set('GET ' + p, h), post: (p, h) => routes.set('POST ' + p, h) };
    registerServiceStatus(router, status().limits);
    const invoke = (route, req) => new Promise(resolve => { const res = { code: 200, status(code) { this.code = code; return this; }, json(value) { resolve({ code: this.code, value }); } }; routes.get(route)(req, res); });
    const missing = await invoke('GET /service/status', { query: { root: process.cwd() } }); assert.equal(missing.code, 500); assert.equal(missing.value.error, 'HISTORY_IDENTITY_UNAVAILABLE');
    const loaded = await invoke('GET /service/status', { user: { directories: { root: process.cwd() } } }); assert.deepEqual(loaded.value, { ...status(), toolProtocols: { documentSearch: 1, webFetch: 1, workspaceWrite: 1, jsonValidate: 1 } });
    for (const body of [undefined, {}, { confirm: false }, { confirm: true, root: process.cwd() }]) assert.equal((await invoke('POST /service/storage-check', { body })).code, 400);
});

test('Storage tests serialize per account and permit a new check after cleanup', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'muyu-check-limit-'));
    try {
        const routes = new Map(); registerServiceStatus({ get: (p, h) => routes.set(p, h), post: (p, h) => routes.set(p, h) }, status().limits);
        const request = { user: { directories: { root } }, body: { confirm: true } };
        const invoke = () => new Promise(resolve => { const res = { code: 200, status(code) { this.code = code; return this; }, json(value) { resolve({ code: this.code, value }); } }; routes.get('/service/storage-check')(request, res); });
        const first = invoke(), second = await invoke(); assert.equal(second.code, 429); assert.equal(second.value.error, 'SERVICE_CHECK_BUSY');
        assert.equal((await first).value.status, 'ok'); await new Promise(resolve => setImmediate(resolve));
        assert.equal((await invoke()).value.status, 'ok');
    } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('Cancelling a service request aborts transport and sanitizes the failure', async () => {
    let aborted = false;
    const port = createServicesPort({ fetcher: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(Error('SECRET')); })) });
    const pending = port.check(); port.cancel(); await assert.rejects(pending, /SERVICE_UNAVAILABLE/); assert.equal(aborted, true);
});
