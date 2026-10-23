import test from 'node:test';
import assert from 'node:assert/strict';
import { createServiceToolGate, projectToolProtocols, serviceToolAllowed } from '../../muyu/services/tool-gate.js';
import { createServicesPort } from '../../muyu/host/services.js';
const available = (toolProtocols = {}) => ({ status: 'available', toolProtocols });
const flush = () => new Promise(resolve => setImmediate(resolve));

test('All new capabilities default off; capture makes zero network requests and never affects old tools', async () => {
    let calls = 0;
    const gate = createServiceToolGate({ check: async () => { calls++; return available({ webFetch: 1 }); } });
    for (let i = 0; i < 5; i++) assert.equal(serviceToolAllowed('muyu.service.fetch_page', gate.capture()), false);
    await flush(); assert.equal(calls, 0); assert.equal(gate.snapshot().status, 'unchecked');
    for (const id of ['muyu.web.search', 'muyu.provider.read', 'muyu.history.read']) assert.equal(serviceToolAllowed(id, null), true);
    assert.equal(serviceToolAllowed('muyu.service.unknown', { allows: () => true }), false);
    assert.equal(serviceToolAllowed('muyu.service.fetch_page', { allows: () => { throw Error('PRIVATE'); } }), false);
});

test('Exact known protocol and literal user enable are both required; metadata cannot register code', async () => {
    assert.deepEqual(projectToolProtocols({ webFetch: '1', workspaceRead: 2, workspaceWrite: true, jsonValidate: 1, arbitrary: 1 }),
        { documentSearch: false, workspaceRead: false, webFetch: false, workspaceWrite: false, jsonValidate: true });
    assert.equal(projectToolProtocols(Object.create({ webFetch: 1 })).webFetch, false);
    const config = { webFetch: true, workspaceRead: true, workspaceWrite: true, jsonValidate: 'true' };
    const gate = createServiceToolGate({ check: async () => available({ webFetch: 1, workspaceRead: 2, jsonValidate: 1 }), getEnabled: () => config });
    await gate.detect(); const capture = gate.capture();
    assert.equal(capture.allows('webFetch'), true); assert.equal(capture.allows('workspaceRead'), false);
    assert.equal(capture.allows('workspaceWrite'), false); assert.equal(capture.allows('jsonValidate'), false);
    assert.equal(capture.allows('__proto__'), false);
    assert.equal(serviceToolAllowed('muyu.service.fetch_page', capture), true);
    assert.equal(serviceToolAllowed('muyu.service.write_file', capture), false);
});

test('Missing, legacy, incompatible and unavailable services fail closed and preserve independent old capabilities', async () => {
    for (const status of ['missing', 'legacy', 'incompatible', 'unavailable']) {
        const gate = createServiceToolGate({ check: async () => ({ status, toolProtocols: { webFetch: 1 } }), getEnabled: () => ({ webFetch: true }) });
        await gate.detect(); assert.equal(gate.snapshot().status, status); assert.equal(gate.capture().allows('webFetch'), false);
    }
    const gate = createServiceToolGate({ check: async () => { throw Error('PRIVATE'); }, getEnabled: () => ({ webFetch: true }) });
    gate.capture(); await flush(); assert.equal(gate.snapshot().status, 'unavailable');
    assert.equal(gate.capture().allows('webFetch'), false); assert.doesNotMatch(JSON.stringify(gate.snapshot()), /PRIVATE/);
});

test('Background detection is merged, bounded by cache and cannot expand an already captured task', async () => {
    let finish, calls = 0, time = 0;
    const gate = createServiceToolGate({ check: () => { calls++; return new Promise(resolve => { finish = resolve; }); }, getEnabled: () => ({ webFetch: true }), now: () => time, ttlMs: 100 });
    const first = gate.capture(); gate.capture(); await flush(); assert.equal(calls, 1);
    assert.equal(gate.snapshot().status, 'checking'); assert.equal(first.allows('webFetch'), false);
    finish(available({ webFetch: 1 })); await flush();
    assert.equal(first.allows('webFetch'), false); assert.equal(gate.capture().allows('webFetch'), true);
    time = 99; gate.capture(); await flush(); assert.equal(calls, 1);
    time = 100; assert.equal(gate.capture().allows('webFetch'), false); await flush(); assert.equal(calls, 2);
    finish(available({ webFetch: 1 })); await flush();
});

test('Disable, missing routes and capability loss are sticky for that task, never permission grants', async () => {
    const config = { webFetch: true, workspaceWrite: true }; let result = available({ webFetch: 1, workspaceWrite: 1 });
    const gate = createServiceToolGate({ check: async () => result, getEnabled: () => config });
    await gate.detect(); const task = gate.capture();
    task.unavailable('webFetch'); assert.equal(task.allows('webFetch'), false); assert.equal(task.allows('workspaceWrite'), true);
    assert.equal(gate.capture().allows('webFetch'), false); await gate.detect();
    assert.equal(gate.capture().allows('webFetch'), true);
    config.workspaceWrite = false; assert.equal(task.allows('workspaceWrite'), false);
    config.workspaceWrite = true; assert.equal(task.allows('workspaceWrite'), false);
    const next = gate.capture(); result = available({ webFetch: 1 }); await gate.detect();
    assert.equal(next.allows('workspaceWrite'), false);
    result = available({ webFetch: 1, workspaceWrite: 1 }); await gate.detect(); assert.equal(next.allows('workspaceWrite'), false);
    assert.deepEqual(Object.keys(task).sort(), ['allows', 'unavailable']);
});

test('Reset rejects late detection and invalidates task captures across host lifetime changes', async () => {
    let finish; const gate = createServiceToolGate({ check: () => new Promise(resolve => { finish = resolve; }), getEnabled: () => ({ webFetch: true }) });
    const pending = gate.detect(); await flush(); gate.reset(); finish(available({ webFetch: 1 })); await pending;
    assert.equal(gate.snapshot().status, 'unchecked');
    const current = gate.detect(); await flush(); finish(available({ webFetch: 1 })); await current;
    const task = gate.capture(); assert.equal(task.allows('webFetch'), true); gate.reset(); assert.equal(task.allows('webFetch'), false);
});

test('Services port keeps old status valid and discards unknown protocol metadata; cancellation resets gate', async () => {
    let calls = 0;
    const port = createServicesPort({ getEnabled: () => ({ webFetch: true }), fetcher: async () => {
        calls++; return new Response(JSON.stringify({ version: 1, serviceVersion: '0.3.0', capabilities: { history: 1, search: 1 },
            limits: { records: 64, recordBytes: 10000, totalBytes: 20000, messages: 100 },
            toolProtocols: { webFetch: 1, workspaceRead: 2, unknown: 'SECRET' } }), { headers: { 'Content-Type': 'application/json' } });
    } });
    assert.equal(port.toolStatus().status, 'unchecked'); assert.equal(calls, 0);
    const a = port.check(), b = port.check(); assert.equal(a, b); const status = await a;
    assert.equal(calls, 1); assert.equal(status.capabilities.history, true);
    assert.deepEqual(status.toolProtocols, { webFetch: 1, workspaceRead: 2 });
    const capture = port.captureTools(); assert.equal(capture.allows('webFetch'), true);
    port.cancel(); assert.equal(capture.allows('webFetch'), false); assert.equal(port.toolStatus().status, 'unchecked');
});

test('Cancelled detection cannot start a late legacy fallback or repopulate capabilities', async () => {
    let finish, calls = 0;
    const port = createServicesPort({ fetcher: () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
    const pending = port.check(); port.cancel();
    finish(new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } }));
    await assert.rejects(pending, /SERVICE_UNAVAILABLE/);
    assert.equal(calls, 1); assert.equal(port.toolStatus().status, 'unchecked');
});

test('Unavailable detections have a cooldown; enabled tasks continue without awaiting a retry', async () => {
    let calls = 0, time = 0;
    const gate = createServiceToolGate({ check: async () => { calls++; throw Error('PRIVATE'); }, getEnabled: () => ({ webFetch: true }), now: () => time, ttlMs: 100 });
    gate.capture(); await flush(); assert.equal(calls, 1);
    for (let i = 0; i < 10; i++) assert.equal(gate.capture().allows('webFetch'), false);
    await flush(); assert.equal(calls, 1);
    time = 100; assert.equal(gate.capture().allows('webFetch'), false); await flush(); assert.equal(calls, 2);
});
