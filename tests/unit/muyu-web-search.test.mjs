import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createWebSearchPort } from '../../muyu/host/web-search.js';
import { createWebSearchModule } from '../../muyu/modules/web/index.js';
import { WEB_DEFAULTS, WEB_TOOL, webBytes, webResult, validateWebResult } from '../../muyu/web/contract.js';

const require = createRequire(import.meta.url);
const { createWebSearchService } = require('../../muyu/server-plugin/web-search.cjs');
const input = { provider: 'brave', apiKey: 'PRIVATE_SEARCH_KEY', query: 'SillyTavern docs', maxResults: 5 };
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const upstream = { type: 'search', web: { results: [{ title: 'Documentation', url: 'https://docs.example.test/st', description: 'Public source' }] } };
const result = () => ({ ...webResult('ok', 'query'), fetchedAt: new Date().toISOString(), results: [{ title: 'Docs', url: 'https://docs.example.test/', snippet: 'Public content' }] });

test('Installation probe needs no key and sends only a local GET without credentials in its body', async () => {
    const calls = [], port = createWebSearchPort({ getSettings: () => ({}), saveSettings: async () => { throw Error('must not save'); }, fetcher: async (url, options) => {
        calls.push({ url, options }); return response({ version: 1, provider: 'brave' });
    } });
    await port.checkInstallation();
    assert.equal(port.describe().backend, 'available'); assert.equal(port.describe().hasKey, false);
    assert.equal(calls.length, 1); assert.equal(calls[0].url, '/api/plugins/gd-muyu-history/web/health');
    assert.equal(calls[0].options.method, 'GET'); assert.equal(calls[0].options.body, undefined);
    await assert.rejects(port.check(), /WEB_KEY_REQUIRED/);
    assert.equal(port.describe().backend, 'available'); assert.equal(calls.length, 2);
});

test('Installation probe distinguishes missing, incompatible and unreachable services and permits retry', async () => {
    for (const [raw, status, code, state] of [[{}, 404, 'MISSING', 'missing'], [{ version: 2, provider: 'brave' }, 200, 'INCOMPATIBLE', 'incompatible'], [{ version: 1, provider: 'other' }, 200, 'INCOMPATIBLE', 'incompatible'], [null, 200, 'INCOMPATIBLE', 'incompatible'], [{}, 503, 'UNAVAILABLE', 'unavailable']]) {
        let retry = false;
        const port = createWebSearchPort({ getSettings: () => ({}), saveSettings: async () => {}, fetcher: async () => retry ? response({ version: 1, provider: 'brave' }) : response(raw, status) });
        await assert.rejects(port.checkInstallation(), new RegExp(code)); assert.equal(port.describe().backend, state);
        retry = true; await port.checkInstallation(); assert.equal(port.describe().backend, 'available');
    }
});

test('Saving search limits alone preserves credentials, session keys and captured task limits', async () => {
    let fail = false;
    const settings = {}, port = createWebSearchPort({ getSettings: () => settings, saveSettings: async () => { if (fail) throw Error('disk'); } });
    await port.save({ config: WEB_DEFAULTS, apiKey: input.apiKey, rememberKey: false });
    const captured = port.capture();
    await port.saveLimits({ ...WEB_DEFAULTS, maxSearches: 2 });
    assert.equal(port.describe().maxSearches, 2); assert.equal(port.describe().hasKey, true); assert.equal(port.describe().remembered, false);
    assert.equal(captured.limits.maxSearches, WEB_DEFAULTS.maxSearches);
    assert.equal(settings.agentConfigs['muyu-web-search'], undefined);
    fail = true; await assert.rejects(port.saveLimits({ ...WEB_DEFAULTS, maxSearches: 1 }), /SAVE_FAILED/);
    assert.equal(port.describe().maxSearches, 2); assert.equal(port.describe().hasKey, true);
});

test('Search service uses the fixed Brave endpoint, never fetches result URLs and filters unsafe links', async () => {
    const calls = [];
    const service = createWebSearchService({ fetcher: async (url, options) => { calls.push({ url, options }); return response({ type: 'search', web: { results: [...upstream.web.results, { title: 'Bad', url: 'javascript:alert(1)' }, { title: 'Private', url: 'https://user:pass@example.test' }, upstream.web.results[0]] } }); } });
    const value = await service.search({ ...input, query: 'https://127.0.0.1/private', freshness: 'week' }, { account: 'A' });
    assert.equal(calls.length, 1); const url = new URL(calls[0].url);
    assert.equal(url.origin, 'https://api.search.brave.com'); assert.equal(url.searchParams.get('freshness'), 'pw');
    assert.equal(calls[0].options.redirect, 'error'); assert.equal(calls[0].options.headers['X-Subscription-Token'], input.apiKey);
    assert.equal(value.results.length, 1); assert.ok(!JSON.stringify(value).includes(input.apiKey));
    await assert.rejects(service.search({ ...input, apiKey: 'bad\nkey' }, { account: 'A' }), /INVALID/);
    assert.equal(calls.length, 1);
});

test('Search errors are normalized without exposing upstream bodies or credentials', async () => {
    for (const [status, expected] of [[401, 'auth_error'], [403, 'auth_error'], [429, 'rate_limit'], [500, 'unavailable']]) {
        const service = createWebSearchService({ fetcher: async () => response({ secret: input.apiKey }, status) });
        const value = await service.search(input, { account: 'A' }); assert.equal(value.status, expected); assert.deepEqual(value.results, []); assert.ok(!JSON.stringify(value).includes(input.apiKey));
    }
    const service = createWebSearchService({ fetcher: async () => response({ unexpected: true }) });
    assert.equal((await service.search(input, { account: 'A' })).status, 'invalid_response');
});

test('Deadline cancels upstream fetch and releases account concurrency capacity', async () => {
    let aborted = false;
    const service = createWebSearchService({ timeoutMs: 10, fetcher: (_url, { signal }) => new Promise((_resolve, reject) => { signal.addEventListener('abort', () => { aborted = true; reject(Error('SECRET')); }, { once: true }); }) });
    const value = await service.search(input, { account: 'A' }); assert.equal(value.status, 'timeout'); assert.equal(aborted, true);
    assert.equal((await service.search(input, { account: 'A' })).status, 'timeout');
});

test('Host key is optional to persist, excluded from snapshots, and sent only to the local plugin', async () => {
    const settings = {}, requests = [];
    const port = createWebSearchPort({ getSettings: () => settings, saveSettings: async () => {}, getHeaders: () => ({ 'X-CSRF-Token': 'CSRF' }), fetcher: async (url, options) => { requests.push({ url, options }); return response(url.endsWith('/health') ? { version: 1, provider: 'brave' } : result()); } });
    await port.save({ config: WEB_DEFAULTS, apiKey: input.apiKey, rememberKey: false });
    assert.equal(settings.agentConfigs['muyu-web-search'], undefined); assert.equal(port.describe().hasKey, true);
    assert.ok(!JSON.stringify(port.describe()).includes(input.apiKey));
    await port.check(); const captured = port.capture();
    await captured.search({ query: 'query' }, new AbortController().signal);
    assert.equal(requests[1].url, '/api/plugins/gd-muyu-history/web/search');
    assert.equal(JSON.parse(requests[1].options.body).apiKey, input.apiKey); assert.equal(requests[1].options.headers['X-CSRF-Token'], 'CSRF');
    await port.save({ config: WEB_DEFAULTS, apiKey: '', rememberKey: true }); assert.equal(settings.agentConfigs['muyu-web-search'].apiKey, input.apiKey);
    await port.forgetKey(); assert.equal(port.describe().hasKey, false); assert.equal(settings.agentConfigs['muyu-web-search'], undefined);
});

test('Failed settings save rolls back and missing plugin is explicit', async () => {
    const settings = {}, port = createWebSearchPort({ getSettings: () => settings, saveSettings: async () => { throw Error('PRIVATE'); } });
    await assert.rejects(port.save({ config: WEB_DEFAULTS, apiKey: input.apiKey, rememberKey: true }), /SAVE_FAILED/);
    assert.equal(settings.muyuWebSearchConfig, undefined); assert.equal(settings.agentConfigs['muyu-web-search'], undefined); assert.equal(port.describe().hasKey, false);
    const missing = createWebSearchPort({ getSettings: () => ({ agentConfigs: { 'muyu-web-search': { apiKey: input.apiKey } } }), saveSettings: async () => {}, fetcher: async () => response({}, 404) });
    await assert.rejects(missing.check(), /BACKEND_MISSING/); assert.equal(missing.describe().backend, 'missing');
});

test('Closing network access aborts the local request rather than racing away from it', async () => {
    let aborted = false, started;
    const pending = new Promise(resolve => { started = resolve; });
    const port = createWebSearchPort({ getSettings: () => ({ agentConfigs: { 'muyu-web-search': { apiKey: input.apiKey } } }), saveSettings: async () => {}, fetcher: (_url, { signal }) => new Promise((_resolve, reject) => { signal.addEventListener('abort', () => { aborted = true; reject(Error('cancelled')); }); started(); }) });
    const work = port.capture().search({ query: 'query' }, new AbortController().signal);
    await pending; port.cancel(); assert.equal((await work).status, 'network_error'); assert.equal(aborted, true);
});

test('Search limits survive task handoffs and large snippets stay within the byte budget', async () => {
    const module = createWebSearchModule(); let calls = 0, allowed = true;
    const capture = { limits: { maxSearches: 1, maxResults: 5, resultBytes: 2000 }, search: async () => { calls++; const value = result(); value.results[0].snippet = '中'.repeat(1200); return value; } };
    module.bindRun({ id: 'first' }, { webSearch: capture, webAllowed: () => allowed });
    const ctx = { runId: 'first', signal: new AbortController().signal }, search = module.handlers[WEB_TOOL];
    const value = await search({ query: 'query' }, ctx); assert.equal(value.status, 'ok'); assert.equal(value.truncated, true); assert.ok(webBytes(value) <= 2000);
    module.transferRun('first', { id: 'second' });
    assert.equal((await search({ query: 'another' }, { ...ctx, runId: 'second' })).status, 'budget_exceeded'); assert.equal(calls, 1);
    allowed = false; assert.equal((await search({ query: 'another' }, { ...ctx, runId: 'second' })).status, 'disabled'); module.dispose();
});

test('Ten valid multibyte results are fitted after transport validation instead of rejected as invalid', async () => {
    const raw = { ...webResult('ok', 'query'), results: Array.from({ length: 10 }, (_, i) => ({ title: '\u6587'.repeat(300), snippet: '\u6587'.repeat(1200), url: `https://example.test/${i}` })) };
    assert.ok(webBytes(raw) > 32768);
    const port = createWebSearchPort({ getSettings: () => ({ agentConfigs: { 'muyu-web-search': { apiKey: input.apiKey } }, muyuWebSearchConfig: { ...WEB_DEFAULTS, maxResults: 10 } }), saveSettings: async () => {}, fetcher: async () => response(raw) });
    const module = createWebSearchModule();
    module.bindRun({ id: 'large', taskId: 'task' }, { webSearch: port.capture(), webAllowed: () => true });
    const fitted = await module.handlers[WEB_TOOL]({ query: 'query' }, { runId: 'large', signal: new AbortController().signal });
    assert.equal(fitted.status, 'ok'); assert.equal(fitted.truncated, true);
    assert.ok(fitted.results.length); assert.ok(webBytes(fitted) <= WEB_DEFAULTS.resultBytes);
    raw.results[9].url = 'javascript:alert(1)';
    assert.throws(() => validateWebResult(raw), /INVALID/);
    const accessor = { ...raw }; Object.defineProperty(accessor, 'results', { enumerable: true, get() { throw Error('must not invoke'); } });
    assert.throws(() => validateWebResult(accessor), /INVALID/);
    module.dispose();
});

test('Search count and byte limits stay pinned when a completed segment continues the same task', async () => {
    const module = createWebSearchModule(); let calls = 0;
    const capture = { limits: { maxSearches: 1, maxResults: 5, resultBytes: 12000 }, search: async args => { calls++; return { ...result(), query: args.query }; } };
    const signal = new AbortController().signal;
    module.bindRun({ id: 'first', taskId: 'task' }, { webSearch: capture, webAllowed: () => true });
    await module.handlers[WEB_TOOL]({ query: 'first' }, { runId: 'first', signal }); module.forgetRun('first');
    module.bindRun({ id: 'next', taskId: 'task' }, { webSearch: { ...capture, limits: { ...capture.limits, maxSearches: 8 } }, webAllowed: () => true });
    assert.equal((await module.handlers[WEB_TOOL]({ query: 'second' }, { runId: 'next', signal })).status, 'budget_exceeded');
    assert.equal(calls, 1);
    module.forgetTask('task'); module.forgetRun('next');
    module.bindRun({ id: 'fresh', taskId: 'fresh-task' }, { webSearch: capture, webAllowed: () => true });
    assert.equal((await module.handlers[WEB_TOOL]({ query: 'fresh' }, { runId: 'fresh', signal })).status, 'ok');
    assert.equal(calls, 2); module.dispose();
});

test('Continued tasks keep captured search settings while renewed consent can disable them', async () => {
    const module = createWebSearchModule(), requested = [];
    const settings = { agentConfigs: { 'muyu-web-search': { apiKey: input.apiKey } }, muyuWebSearchConfig: { ...WEB_DEFAULTS, maxResults: 5 } };
    const port = createWebSearchPort({ getSettings: () => settings, saveSettings: async () => {}, fetcher: async (_, options) => {
        requested.push(JSON.parse(options.body).maxResults); return response(result());
    } });
    const signal = new AbortController().signal, search = module.handlers[WEB_TOOL]; let allowed = true;
    module.bindRun({ id: 'first', taskId: 'task' }, { webSearch: port.capture(), webAllowed: () => true });
    await search({ query: 'query' }, { runId: 'first', signal }); module.forgetRun('first');
    settings.muyuWebSearchConfig = { ...WEB_DEFAULTS, maxResults: 10 };
    module.bindRun({ id: 'next', taskId: 'task' }, { webSearch: port.capture(), webAllowed: () => allowed });
    assert.equal((await search({ query: 'query' }, { runId: 'next', signal })).status, 'ok');
    assert.deepEqual(requested, [5, 5]);
    allowed = false;
    assert.equal((await search({ query: 'query' }, { runId: 'next', signal })).status, 'disabled');
    assert.deepEqual(requested, [5, 5]); module.dispose();
});
