import test from 'node:test';
import assert from 'node:assert/strict';
import { createServicePageModule } from '../../muyu/modules/service-pages/index.js';
import { createServicesPort } from '../../muyu/host/services.js';
import { createServiceToolGate } from '../../muyu/services/tool-gate.js';
import { projectPageResult } from '../../muyu/services/pages.js';
import { assistantToolAccess } from '../../muyu/application/capabilities.js';
import { createPermissions } from '../../muyu/application/permissions.js';
const dto = () => ({ version: 1, status: 'ok', url: 'https://example.com/', fetchedAt: '2026-10-09T00:00:00.000Z', title: 'Public', text: '外部资料', limited: false });
const status = () => ({ version: 1, serviceVersion: '0.5.0', capabilities: { history: 1, search: 1, storageCheck: 1, diagnostics: 1 }, toolProtocols: { webFetch: 1 }, limits: { records: 64, recordBytes: 33554432, totalBytes: 268435456, messages: 4096 } });
test('Page DTO rejects extra fields, oversized text, credentialed URLs and invalid timestamps', () => {
    assert.deepEqual(projectPageResult(dto()), dto());
    for (const row of [{ ...dto(), raw: 'SECRET' }, { ...dto(), text: 'x'.repeat(24001) }, { ...dto(), url: 'file:///etc/passwd' }, { ...dto(), url: 'https://key@example.com/' }, { ...dto(), url: 'https://example.com:4430/' }, { ...dto(), fetchedAt: 'not a date' }]) assert.throws(() => projectPageResult(row), /INCOMPATIBLE/);
});
test('Page opt-in is saved independently, fixed transport has CSRF only toward ST and cancellation propagates', async () => {
    let config = {}, calls = 0; const requests = [];
    const port = createServicesPort({ getEnabled: () => config, saveEnabled: async value => { config = value; }, getHeaders: () => ({ 'X-CSRF-Token': 'csrf' }),
        fetcher: async (url, options) => { calls++; requests.push({ url, options }); return new Response(JSON.stringify(url.endsWith('/service/status') ? status() : dto()), { headers: { 'Content-Type': 'application/json' } }); } });
    assert.equal(port.pagesEnabled(), false); port.captureTools(); assert.equal(calls, 0);
    await port.setPagesEnabled(true); const captured = port.captureTools(); assert.equal(captured.allows('webFetch'), true);
    await port.page({ url: dto().url, maxChars: 1000 }, new AbortController().signal);
    assert.equal(requests[1].url, '/api/plugins/gd-muyu-history/web/page');
    assert.equal(requests[1].options.headers['X-CSRF-Token'], 'csrf'); assert.equal(requests[1].options.credentials, 'same-origin');
    await port.setPagesEnabled(false); assert.equal(captured.allows('webFetch'), false); assert.equal(calls, 2);
    const abort = new AbortController(); abort.abort(); await assert.rejects(port.page({ url: dto().url, maxChars: 1000 }, abort.signal)); assert.equal(calls, 2);
});
test('Page effect is explicit external capability, not a read-all grant; task budget persists across transfer', async () => {
    let calls = 0, charged = 0;
    const gate = createServiceToolGate({ check: async () => ({ status: 'available', toolProtocols: { webFetch: 1 } }), getEnabled: () => ({ webFetch: true }) });
    await gate.detect(); const capture = gate.capture();
    const module = createServicePageModule({ port: { page: async () => { calls++; return dto(); } }, usage: () => ({ used: charged, limit: 100000 }), charge: (_id, bytes) => { charged += bytes; return true; } });
    const definition = module.registry.get('muyu.service.fetch_page');
    assert.equal(definition.effect, 'external'); assert.deepEqual(assistantToolAccess(definition, {}, { kind: 'global', userKey: 'u' }, 't', createPermissions()), { decision: true, required: [] }); // Opt-in is checked separately by controller and handler.
    const ctx = id => ({ runId: id, signal: new AbortController().signal }), args = { url: dto().url, maxChars: 1000 };
    module.bindRun({ id: 'r', taskId: 't' }, { serviceTools: capture });
    assert.equal((await module.handlers[definition.id](args, ctx('r'))).status, 'ok');
    assert.equal(charged, new TextEncoder().encode(JSON.stringify(dto())).length);
    module.transferRun('r', { id: 'next', taskId: 't' }); module.forgetRun('r');
    for (let i = 0; i < 5; i++) await module.handlers[definition.id](args, ctx('next'));
    assert.equal((await module.handlers[definition.id](args, ctx('next'))).status, 'budget_exceeded'); assert.equal(calls, 6);
    module.forgetRun('next'); module.bindRun({ id: 'again', taskId: 't' }, { serviceTools: capture });
    assert.equal((await module.handlers[definition.id](args, ctx('again'))).status, 'budget_exceeded');
    capture.unavailable('webFetch'); assert.equal((await module.handlers[definition.id](args, ctx('again'))).status, 'unavailable');
    module.dispose();
});
test('Blocked pages do not disable the capability; missing transport does, exhausted data budget sends nothing', async () => {
    let calls = 0, used = 0, lost = false, error = 'PAGE_BLOCKED';
    const capture = { allows: () => !lost, unavailable: () => { lost = true; } };
    const module = createServicePageModule({ port: { page: async () => { calls++; throw Error(error); } }, usage: () => ({ used, limit: 10000 }), charge: () => true });
    module.bindRun({ id: 'r' }, { serviceTools: capture }); const ctx = { runId: 'r', signal: new AbortController().signal }, read = () => module.handlers['muyu.service.fetch_page']({ url: dto().url, maxChars: 1000 }, ctx);
    used = 10000; assert.equal((await read()).status, 'budget_exceeded'); assert.equal(calls, 0);
    used = 0; assert.equal((await read()).status, 'PAGE_BLOCKED'); assert.equal(lost, false);
    error = 'SERVICE_MISSING'; assert.equal((await read()).status, 'unavailable'); assert.equal(lost, true);
    await read(); assert.equal(calls, 2); module.dispose();
});
test('Disabled page tools never accumulate task quota or call network across thousands of normal chats', async () => {
    const module = createServicePageModule({ port: { page: () => { throw Error('not expected'); } }, usage: () => { throw Error('not expected'); }, charge: () => false });
    for (let i = 0; i < 1100; i++) { module.bindRun({ id: String(i), taskId: String(i) }, {}); module.forgetRun(String(i)); }
    module.dispose();
});
