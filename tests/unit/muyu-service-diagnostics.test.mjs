import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServicesPort } from '../../muyu/host/services.js';
import { projectServiceDiagnostics } from '../../muyu/services/diagnostics.js';
import { createProviderPort } from '../../muyu/host/providers.js';
import { createPermissions } from '../../muyu/application/permissions.js';
import { assistantToolAccess } from '../../muyu/application/capabilities.js';
const { createDiagnostics, registerDiagnostics, diagnostics } = createRequire(import.meta.url)('../../muyu/server-plugin/diagnostics.cjs');
const { init } = createRequire(import.meta.url)('../../muyu/server-plugin/index.cjs');
const req = root => ({ user: { directories: { root } } });
const row = () => ({ operation: 'history.write', stage: 'request', code: 'HISTORY_CONFLICT', durationMs: 10, body: 'SECRET', key: 'SECRET', root: 'SECRET', error: Error('SECRET') });
const response = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

test('Service errors retain only closed metadata and isolate accounts, clearing and expiry', () => {
    let now = 10000; const store = createDiagnostics({ now: () => now });
    store.record(req('account-A'), row()); store.record(req('account-B'), { ...row(), code: 'WEB_TIMEOUT', operation: 'search.request' });
    assert.equal(store.read(req('account-A')).records.length, 1); assert.equal(store.read(req('account-B')).records[0].code, 'WEB_TIMEOUT');
    assert.ok(!JSON.stringify(store.read(req('account-A'))).includes('SECRET'));
    store.record(req('account-A'), { ...row(), code: 'SECRET_CODE' }); assert.equal(store.read(req('account-A')).records.length, 1);
    store.clear(req('account-A')); assert.equal(store.read(req('account-A')).records.length, 0); assert.equal(store.read(req('account-B')).records.length, 1);
    now += 1800000; assert.equal(store.read(req('account-B')).records.length, 0);
    store.record({ body: { root: 'account-B' } }, row()); assert.throws(() => store.read({}), /IDENTITY/);
});
test('Service error collection caps per-account records, accounts and aggregate retention', () => {
    const store = createDiagnostics(); for (let i = 0; i < 250; i++) store.record(req('A'), row());
    assert.equal(store.read(req('A')).records.length, 200);
    for (let i = 0; i < 300; i++) for (let n = 0; n < 20; n++) store.record(req('user-' + i), row());
    let total = store.read(req('A')).records.length;
    for (let i = 0; i < 300; i++) total += store.read(req('user-' + i)).records.length;
    assert.ok(total <= 4096);
});
test('Projection strips unknown details and rejects malformed classification, duplicates and oversize', () => {
    const store = createDiagnostics(); store.record(req('A'), row()); const value = store.read(req('A'));
    const clean = projectServiceDiagnostics({ ...value, root: 'SECRET', records: value.records.map(r => ({ ...r, key: 'SECRET' })) });
    assert.ok(!JSON.stringify(clean).includes('SECRET'));
    for (const records of [[{ ...clean.records[0], code: 'SECRET' }], [clean.records[0], clean.records[0]], Array(201).fill(clean.records[0])]) assert.throws(() => projectServiceDiagnostics({ ...value, records }), /INCOMPATIBLE/);
});
test('Diagnostics HTTP endpoints need host identity, clear only their account and reject path overrides', async () => {
    const store = createDiagnostics(); store.record(req('A'), row()); store.record(req('B'), row());
    const routes = new Map(); registerDiagnostics({ get: (p, h) => routes.set('GET ' + p, h), post: (p, h) => routes.set('POST ' + p, h) }, store);
    const invoke = (route, request) => new Promise(resolve => { const res = { code: 200, status(code) { this.code = code; return this; }, json(value) { resolve({ code: this.code, value }); } }; routes.get(route)(request, res); });
    assert.equal((await invoke('GET /service/diagnostics', { query: { root: 'A' } })).code, 500);
    assert.equal((await invoke('POST /service/diagnostics/clear', { ...req('A'), body: { confirm: true, root: 'B' } })).code, 400);
    await invoke('POST /service/diagnostics/clear', { ...req('A'), body: { confirm: true } });
    assert.equal(store.read(req('A')).records.length, 0); assert.equal(store.read(req('B')).records.length, 1);
});
test('Actual history route errors feed diagnostics without capturing request records or paths', async () => {
    const routes = new Map(), router = Object.fromEntries(['get', 'post', 'put', 'delete'].map(method => [method, (p, h) => routes.set(method + ' ' + p, h)])); init(router);
    const request = { ...req('diagnostic-route-test'), query: { namespace: 'INVALID_SECRET' }, params: {}, body: { key: 'SECRET' } };
    diagnostics.clear(request);
    await new Promise(resolve => routes.get('get /records')(request, { status() { return this; }, json: resolve }));
    const result = diagnostics.read(request); assert.equal(result.records.length, 1); assert.equal(result.records[0].code, 'HISTORY_INVALID');
    assert.ok(!JSON.stringify(result).includes('SECRET')); diagnostics.clear(request);
});
test('Host diagnostics are read-only by default and clear is an explicit POST; source read is permission guarded', async () => {
    const store = createDiagnostics(); store.record(req('A'), row()); const calls = [];
    const services = createServicesPort({ fetcher: async (url, options) => { calls.push({ url, options }); return response(url.endsWith('/clear') ? { version: 1, cleared: true } : store.read(req('A'))); } });
    const provider = createProviderPort({ services, getContext: () => ({}), getSettings: () => ({}) });
    const target = { kind: 'global', userKey: 'u' }, permissions = createPermissions();
    const access = () => assistantToolAccess({ id: 'muyu.provider.read', effect: 'read' }, { id: 'serviceDiagnostics' }, target, 't', permissions, provider);
    assert.deepEqual(access().missingSources, ['source:serviceDiagnostics']); assert.equal(calls.length, 0);
    permissions.decide({ source: 'serviceDiagnostics', reason: 'inspect', taskId: 't', target }, 'task', () => {}); assert.equal(access().decision, true);
    assert.match((await provider.read('serviceDiagnostics', '')).text, /recent:N/);
    assert.match((await provider.read('serviceDiagnostics', 'recent:10')).text, /HISTORY_CONFLICT/);
    assert.ok(calls.every(c => c.options.method === 'GET'));
    await assert.rejects(provider.read('serviceDiagnostics', 'arbitrary:SECRET'), /INVALID_SELECTOR/);
    await services.clearDiagnostics(); assert.equal(calls.at(-1).options.method, 'POST'); assert.deepEqual(JSON.parse(calls.at(-1).options.body), { confirm: true });
    permissions.forgetTask(target, 't'); assert.deepEqual(access().missingSources, ['source:serviceDiagnostics']);
});
