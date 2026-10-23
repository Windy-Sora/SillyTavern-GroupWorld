import test from 'node:test';
import assert from 'node:assert/strict';
import { createServiceDocumentModule } from '../../muyu/modules/service-documents/index.js';
import { createServicesPort } from '../../muyu/host/services.js';
import { projectDocumentResult } from '../../muyu/services/documents.js';
import { createServiceToolGate } from '../../muyu/services/tool-gate.js';
import { createPermissions } from '../../muyu/application/permissions.js';
import { assistantToolAccess } from '../../muyu/application/capabilities.js';
const roots = () => ({ version: 1, status: 'ok', roots: [{ id: 'workspace', title: 'Workspace', revision: '1'.repeat(64) }] });
const status = () => ({ version: 1, serviceVersion: '0.4.0', capabilities: { history: 1 }, toolProtocols: { documentSearch: 1 },
    limits: { records: 64, messages: 100, recordBytes: 10000, totalBytes: 10000 } });

test('Local document projection rejects extra secrets and malformed paths/revisions', () => {
    assert.deepEqual(projectDocumentResult('roots', roots()), roots());
    assert.throws(() => projectDocumentResult('roots', { ...roots(), absolutePath: 'SECRET' }), /INCOMPATIBLE/);
    const base = { version: 1, status: 'ok', root: 'workspace', items: [{ path: 'guide.md', revision: '2'.repeat(64) }], scanned: 1, skipped: 0, limited: false, nextOffset: -1 };
    assert.deepEqual(projectDocumentResult('list', base), base);
    for (const path of ['../private.md', '/private.md', 'C:/private.md', 'x\\private.md', '.env', 'bad. /x.md']) {
        assert.throws(() => projectDocumentResult('list', { ...base, items: [{ ...base.items[0], path }] }), /INCOMPATIBLE/);
    }
    assert.throws(() => projectDocumentResult('list', { ...base, items: [{ ...base.items[0], revision: 'guess' }] }), /INCOMPATIBLE/);
    const empty = { version: 1, status: 'empty', root: 'workspace', items: [], limited: false, nextOffset: -1 };
    assert.deepEqual(projectDocumentResult('read', empty), empty);
    assert.throws(() => projectDocumentResult('read', { ...empty, root: '/private' }), /INCOMPATIBLE/);
});

test('Service tool enable is persisted independently, old capabilities stay valid, transport uses fixed routes', async () => {
    let config = {}, network = 0; const calls = [];
    const port = createServicesPort({ getEnabled: () => config, saveEnabled: async next => { config = next; }, getHeaders: () => ({ 'X-CSRF-Token': 'csrf' }),
        fetcher: async (url, options) => { network++; calls.push([url, options]); return new Response(JSON.stringify(url.endsWith('/service/status') ? status() : roots()), { headers: { 'Content-Type': 'application/json' } }); } });
    port.captureTools(); assert.equal(network, 0);
    await port.setDocumentsEnabled(true); assert.equal(port.documentsEnabled(), true); assert.equal(network, 1);
    const captured = port.captureTools(); assert.equal(captured.allows('documentSearch'), true);
    assert.deepEqual(await port.document('roots', {}, new AbortController().signal), roots());
    assert.equal(calls[1][0], '/api/plugins/gd-muyu-history/documents/roots'); assert.equal(calls[1][1].headers['X-CSRF-Token'], 'csrf');
    assert.equal(calls[1][1].method, 'POST'); assert.equal(calls[1][1].redirect, 'error');
    await port.setDocumentsEnabled(false); assert.equal(captured.allows('documentSearch'), false); assert.equal(network, 2);
    await assert.rejects(port.document('arbitrary/path', {}), /DOCUMENT_INVALID/);
});

test('Document transport propagates parent cancellation and never sends a pre-aborted request', async () => {
    let calls = 0, aborted = 0;
    const port = createServicesPort({ fetcher: (_url, { signal }) => { calls++; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => { aborted++; reject(Error('SECRET')); })); } });
    const abort = new AbortController(), pending = port.document('roots', {}, abort.signal); abort.abort();
    await assert.rejects(pending); assert.equal(calls, 1); assert.equal(aborted, 1);
    await assert.rejects(port.document('roots', {}, abort.signal)); assert.equal(calls, 1);
});

test('Document read permission is distinct from enable, covers all declared tools, and respects denial in read-all', () => {
    const module = createServiceDocumentModule({ usage: () => ({ used: 0, limit: 10000 }), charge: () => true });
    const target = { kind: 'global', userKey: 'u' }, permissions = createPermissions();
    for (const definition of module.registry.list()) {
        const access = assistantToolAccess(definition, {}, target, 'task', permissions);
        assert.equal(access.decision, 'permission_required'); assert.deepEqual(access.missingSources, ['source:serviceDocuments']);
    }
    const all = createPermissions({ readAccess: () => true });
    assert.equal(all.allows('source:serviceDocuments', target, 'task'), true);
    all.decide({ source: 'serviceDocuments', target, taskId: 'task', reason: 'Read approved documents' }, 'deny', () => {});
    assert.equal(all.allows('source:serviceDocuments', target, 'task'), false);
});

test('Thin service module charges UTF-8 output and never calls transport when disabled or budget exhausted', async () => {
    let calls = 0, charged = 0, used = 0;
    const gate = createServiceToolGate({ check: async () => ({ status: 'available', toolProtocols: { documentSearch: 1 } }), getEnabled: () => ({ documentSearch: true }) });
    await gate.detect(); const capture = gate.capture();
    const module = createServiceDocumentModule({ port: { document: async () => { calls++; return roots(); } }, usage: () => ({ used, limit: 10000, exhausted: used >= 10000 }),
        charge: (_id, bytes) => { charged += bytes; return true; } });
    const ctx = { runId: 'r', signal: new AbortController().signal };
    module.bindRun({ id: 'r' }, { serviceTools: capture });
    assert.equal((await module.handlers['muyu.service.list_roots']({}, ctx)).status, 'ok');
    assert.equal(charged, new TextEncoder().encode(JSON.stringify(roots())).length);
    used = 10000; assert.equal((await module.handlers['muyu.service.list_roots']({}, ctx)).status, 'budget_exceeded'); assert.equal(calls, 1);
    used = 0; capture.unavailable('documentSearch');
    assert.equal((await module.handlers['muyu.service.list_roots']({}, ctx)).status, 'unavailable'); assert.equal(calls, 1);
});

test('Transport loss disables a capability for the task, while stale documents remain correctable', async () => {
    let error = 'DOCUMENT_STALE', calls = 0;
    const gate = createServiceToolGate({ check: async () => ({ status: 'available', toolProtocols: { documentSearch: 1 } }), getEnabled: () => ({ documentSearch: true }) });
    await gate.detect(); const capture = gate.capture();
    const module = createServiceDocumentModule({ port: { document: async () => { calls++; throw Error(error); } }, usage: () => ({ used: 0, limit: 10000 }), charge: () => true });
    module.bindRun({ id: 'r' }, { serviceTools: capture }); const ctx = { runId: 'r', signal: new AbortController().signal };
    assert.equal((await module.handlers['muyu.service.list_roots']({}, ctx)).status, 'DOCUMENT_STALE');
    assert.equal(capture.allows('documentSearch'), true);
    error = 'SERVICE_MISSING'; assert.equal((await module.handlers['muyu.service.list_roots']({}, ctx)).status, 'unavailable');
    await module.handlers['muyu.service.list_roots']({}, ctx); assert.equal(calls, 2);
});
