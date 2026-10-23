import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryGenerationModule } from '../../muyu/modules/memory-generation/index.js';
import { createPermissions } from '../../muyu/application/permissions.js';
import { assistantToolAccess, permissionApprovalCurrent, requiredSources } from '../../muyu/application/capabilities.js';
import { memoryExecutionSource, validatePermission } from '../../muyu/permissions/contract.js';
import { validateJson } from '../../muyu/core/json-contract.js';
import { createBuiltins } from '../../muyu/modules/builtins.js';
import { projectTaskPlan } from '../../muyu/modules/task-plan/index.js';

const target = { kind: 'chat', userKey: 'test', chatKey: 'A' }, id = '01234567-89ab-cdef-0123-456789abcdef';
function fixture(accept = true) {
    const calls = { prepare: 0, execute: 0, reserved: [], forgotten: [], clear: 0 };
    const port = { listTargets: () => ({ items: [], nextOffset: -1 }), prepareExecution: () => { calls.prepare++; return { executionId: id, mode: 'trial' }; },
        describeExecution: () => ({ executionId: id }), execute: async () => { calls.execute++; return { status: 'trial_completed', chatSave: 'not_started' }; },
        forgetExecutions: task => calls.forgotten.push(task), clearExecutions: () => { calls.clear++; } };
    const module = createMemoryGenerationModule({ port, charge: (_run, bytes) => { calls.reserved.push(bytes); return accept; } });
    const identity = { id: 'r', taskId: 't', target }, ctx = { runId: 'r', target };
    module.bindRun(identity); return { module, calls, port, identity, ctx };
}
test('generation tools have explicit effects, closed schemas and scope-specific permissions', () => {
    const f = fixture(); assert.equal(f.module.registry.list().length, 3);
    for (const d of f.module.registry.list()) {
        assert.equal(d.scope, 'chat'); assert.equal(d.inputSchema.additionalProperties, false);
        assert.equal(d.effect, d.id.endsWith('.execute') ? 'external' : 'read');
        assert.deepEqual(requiredSources(d.id, { executionId: id }), [d.id.endsWith('.execute') ? memoryExecutionSource(id) : 'source:memoryGenerationTargets']);
    }
});
for (const args of [{ character: 'memory-character:0', mode: 'save' }, { character: 'memory-character:0', revision: 'rev', mode: 'unknown' },
    { character: 'memory-character:0', revision: 'rev', mode: 'save', target: 'B' }]) test('prepare rejects missing revision, unsupported mode or model-selected target: '+JSON.stringify(args), () => {
    const d = fixture().module.registry.list().find(d => d.id.endsWith('.prepare')); assert.throws(() => validateJson(d.inputSchema, args));
});
test('no result budget means no paid execution or write', async () => {
    const f = fixture(false), out = await f.module.handlers['muyu.memory_generation.execute']({ executionId: id }, f.ctx);
    assert.equal(JSON.parse(out.text).status, 'not_started'); assert.equal(f.calls.execute, 0); assert.deepEqual(f.calls.reserved, [16000]);
});
test('execution output budget reserved before port call and result matches registered schema', async () => {
    const f = fixture(), out = await f.module.handlers['muyu.memory_generation.execute']({ executionId: id }, f.ctx);
    assert.equal(f.calls.execute, 1); assert.equal(f.calls.reserved[0], 16000);
    const d = f.module.registry.list().find(d => d.id.endsWith('.execute')); validateJson(d.outputSchema, out);
});
test('module rejects unbound or changed targets without execution', async () => {
    const f = fixture(); await assert.rejects(f.module.handlers['muyu.memory_generation.execute']({ executionId: id }, { ...f.ctx, runId: 'other' }), /RUN_NOT_BOUND/);
    await assert.rejects(f.module.handlers['muyu.memory_generation.execute']({ executionId: id }, { ...f.ctx, target: { ...target, chatKey: 'B' } }), /RUN_NOT_BOUND/);
    assert.equal(f.calls.execute, 0);
});
test('lifecycle transfer only moves a bound same-task target; inactive module is a no-op', () => {
    const f = fixture(); f.module.transferRun('not-bound', { id: 'new', taskId: 'another', target });
    assert.throws(() => f.module.transferRun('r', { id: 'new', taskId: 'wrong', target }), /RUN_NOT_BOUND/);
    f.module.transferRun('r', { ...f.identity, id: 'next' }); f.module.forgetRun('next');
    // Binding alone allocated no execution resources; do not clear a shared port.
    f.module.forgetTask('t'); f.module.dispose(); assert.deepEqual(f.calls.forgotten, []); assert.equal(f.calls.clear, 0);
});
test('read/diagnostic/broad chat grants never approve paid memory generation', () => {
    const f = fixture(), p = createPermissions(), d = f.module.registry.list().find(d => d.id.endsWith('.execute'));
    p.grant('diagnostics', target); p.grant('chat', target); p.grant('extended', target); p.grantSource('source:memoryGenerationTargets', target);
    const out = assistantToolAccess(d, { executionId: id }, target, 't', p, null, null, null, f.port);
    assert.equal(out.decision, 'permission_required'); assert.deepEqual(out.missingSources, [memoryExecutionSource(id)]);
});
test('exact execution consent is task-only and never grants another ticket or a different target', () => {
    const p = createPermissions(), request = { source: 'memoryExecution', executionId: id, reason: 'generate', target, taskId: 't' };
    validatePermission({ source: request.source, executionId: id, reason: 'generate' });
    assert.throws(() => p.decide(request, 'chat', () => {}), /INVALID_PERMISSION_DECISION/);
    p.decide(request, 'task', () => {}); assert.equal(p.allows(memoryExecutionSource(id), target, 't'), true);
    assert.equal(p.allows(memoryExecutionSource(id), target, 'other'), false);
    assert.equal(p.allows(memoryExecutionSource(crypto.randomUUID()), target, 't'), false);
    assert.equal(p.allows(memoryExecutionSource(id), { ...target, chatKey: 'B' }, 't'), false);
    assert.equal(p.sourceGrants(target).length, 0); p.forgetTask(target, 't'); assert.equal(p.allows(memoryExecutionSource(id), target, 't'), false);
});
test('full access still requires a current executable ticket', () => {
    const f = fixture(), p = createPermissions({ fullAccess: () => true }), d = f.module.registry.list().find(d => d.id.endsWith('.execute'));
    assert.equal(assistantToolAccess(d, { executionId: id }, target, 't', p, null, null, null, f.port).decision, true);
    assert.equal(assistantToolAccess(d, { executionId: id }, target, 't', p, null, null, null, { describeExecution: () => null }).decision, 'target_unavailable');
});
test('refused execution remains refused without other-source fallback', () => {
    const f = fixture(), p = createPermissions(), d = f.module.registry.list().find(d => d.id.endsWith('.execute'));
    p.decide({ source: 'memoryExecution', executionId: id, reason: 'run', target, taskId: 't' }, 'deny', () => {});
    assert.equal(assistantToolAccess(d, { executionId: id }, target, 't', p, null, null, null, f.port).decision, 'user_denied');
});
test('readonly task plans cannot grant execution; malformed UUIDs are invalid', () => {
    assert.throws(() => validatePermission({ source: 'memoryExecution', executionId: 'fake', reason: 'run' }));
    assert.throws(() => projectTaskPlan({ goal: 'generate', scope: 'current-chat', sources: ['memoryExecution'], steps: [{ kind: 'read', title: 'read', detail: 'run' }], unknowns: [] }, target));
});
test('permission approval rechecks host ticket freshness', () => {
    const request = { source: 'memoryExecution', executionId: id, target };
    assert.equal(permissionApprovalCurrent(request, null, null, null, { describeExecution: () => null }), false);
    assert.equal(permissionApprovalCurrent(request, null, null, null, fixture().port), true);
});
test('generation tools disappear entirely when the host has no controlled port', () => {
    const host = { memoryPorts: { extensionKey: 'gd', getTarget: () => target, getSettings: () => ({}), getMetadata: () => ({}), getGroup: () => null, getMessageCount: () => 0 }, getSettings: () => ({}), configTarget: () => target, currentTarget: () => target };
    const without = createBuiltins(host); assert.equal(without.registry.list().some(d => d.id.startsWith('muyu.memory_generation.')), false); without.dispose();
    const withPort = createBuiltins({ ...host, memoryGeneration: fixture().port });
    assert.equal(withPort.registry.list().filter(d => d.id.startsWith('muyu.memory_generation.')).length, 3); withPort.dispose();
});
