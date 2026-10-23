import test from 'node:test';
import assert from 'node:assert/strict';
import { interactionLimit, MAX_READ_PERMISSIONS, MAX_CODE_PERMISSIONS } from '../../muyu/interactions/limits.js';
import { startMuyuRun } from '../../muyu/composition.js';
import { createApplication } from '../../muyu/application/service.js';
import { permissionSchema } from '../../muyu/permissions/contract.js';
import { identity, registry, toolId, call, request, text, done, scriptedModel, flush } from './helpers/muyu-subject.mjs';

test('Read, code approval and clarification limits are independent and bounded', () => {
    assert.equal(interactionLimit({ clarifications: 3 }, { kind: 'permission', source: 'recentMessages' }), null);
    assert.equal(interactionLimit({ readPermissions: MAX_READ_PERMISSIONS }, { kind: 'permission', source: 'recentMessages' }), 'PERMISSION_LIMIT');
    assert.equal(interactionLimit({ readPermissions: MAX_READ_PERMISSIONS }, {}), null);
    assert.equal(interactionLimit({ readPermissions: MAX_READ_PERMISSIONS }, { kind: 'permission', source: 'providerExecution' }), null);
    assert.equal(interactionLimit({ codePermissions: MAX_CODE_PERMISSIONS }, { kind: 'permission', source: 'providerExecution' }), 'PERMISSION_LIMIT');
    assert.equal(interactionLimit({ codePermissions: MAX_CODE_PERMISSIONS }, { kind: 'permission', source: 'recentMessages' }), null);
    assert.equal(interactionLimit({ clarifications: 3 }, {}), 'CLARIFICATION_LIMIT');
});

test('Automatic permission exhaustion returns a not-started result and permits evidence-only finalization', async () => {
    let reads = 0;
    const model = scriptedModel([[request(call()), done], input => {
        const result = input.messages.find(m => m.role === 'tool').result;
        assert.equal(result.error.code, 'PERMISSION_LIMIT'); assert.equal(result.effectState, 'not_started');
        return [text('Source not read; existing evidence only.'), done];
    }]);
    const run = startMuyuRun({ identity, input: 'read', registry: registry(), allowedTools: [toolId], model,
        handlers: { [toolId]: () => { reads++; return 1; } },
        policy: () => ({ decision: 'permission_required', missingSources: ['source:recentMessages'] }),
        interactionAdmission: () => 'PERMISSION_LIMIT' });
    const result = await run.completion; await run.drained;
    assert.equal(result.state.status, 'succeeded'); assert.equal(result.interaction, null); assert.equal(result.resume, null);
    assert.equal(reads, 0); assert.equal(model.requests.length, 2);
});

test('Explicit permission requests use the same admission limit without producing a pending card', async () => {
    const id = 'muyu.permission.request', args = { source: 'recentMessages', reason: 'Read chat' };
    const model = scriptedModel([[request({ toolId: id, callId: 'p', version: 1, args }), done], input => {
        assert.equal(input.messages.find(m => m.role === 'tool').result.error.code, 'PERMISSION_LIMIT');
        return [text('Cannot request another source.'), done];
    }]);
    const run = startMuyuRun({ identity, input: 'read', model,
        registry: registry({ id, inputSchema: permissionSchema, outputSchema: permissionSchema }), allowedTools: [id],
        handlers: { [id]: args => args }, policy: () => true, interactionAdmission: () => 'PERMISSION_LIMIT' });
    const result = await run.completion; await run.drained;
    assert.equal(result.state.status, 'succeeded'); assert.equal(result.interaction, null); assert.equal(result.resume, null);
});

test('Application independently enforces the read limit and preserves the safe error while disposing continuation', async () => {
    let disposed = 0;
    const app = createApplication({ currentTarget: identity.target, startRun: () => ({
        completion: Promise.resolve({ state: { status: 'yielded' }, answer: 'Request',
            interaction: { kind: 'permission', source: 'recentMessages', reason: 'Synthetic test' },
            resume: { dispose: () => { disposed++; } } }), drained: Promise.resolve(), cancel() {},
    }) });
    const session = app.createSession(identity.target); app.submit(session, 'test'); await flush();
    for (let i = 0; i < MAX_READ_PERMISSIONS; i++) {
        const r = app.snapshot().interactions.find(r => r.status === 'pending');
        assert.ok(r, `request ${i + 1}`); app.answerPermission(r.id, 'task'); await flush();
    }
    const s = app.snapshot(), run = s.runs.at(-1);
    assert.equal(run.status, 'failed'); assert.equal(run.error, 'PERMISSION_LIMIT');
    assert.equal(run.process.error, 'PERMISSION_LIMIT'); assert.equal(disposed, 1);
    assert.ok(!s.interactions.some(r => r.status === 'pending')); app.dispose();
});
