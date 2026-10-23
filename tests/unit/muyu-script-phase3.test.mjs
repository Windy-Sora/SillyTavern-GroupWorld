import test from 'node:test';
import assert from 'node:assert/strict';
import { createScriptExecutorSystem } from '../../systems/script-executor-system.js';
import { normalizeScriptExecutor } from '../../systems/script-executor-validation.js';
import { createScriptExecutorPort } from '../../muyu/host/script-executors.js';
import { createScriptExecutorModule } from '../../muyu/modules/script-executors/index.js';
import { createSourcePermissions } from '../../muyu/permissions/store.js';
import { createPermissions } from '../../muyu/application/permissions.js';
import { assistantToolAccess, permissionApprovalCurrent } from '../../muyu/application/capabilities.js';
import { scriptExecutionSource, validatePermission } from '../../muyu/permissions/contract.js';
import { createInteractionStore } from '../../muyu/interactions/store.js';

const target = { kind: 'chat', userKey: 'p', chatKey: 'A' };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function fixture(patch = {}, options = {}) {
    let currentTarget = target, settings = { scriptExecutors: [{ id: 'se_test', ...normalizeScriptExecutor({ name: 'manual', triggerOn: 'all', enabled: false, code: 'ctx.settings.executions=(ctx.settings.executions||0)+1; return ctx.chat.length;', ...patch }) }] };
    const context = { chat: [{ mes: 'hello', name: 'A' }], characters: [{ name: 'A' }], groups: [], groupId: null };
    const system = createScriptExecutorSystem({ settings, saveSettings() {}, ...options });
    const port = createScriptExecutorPort({ getSettings: () => settings, getTarget: () => currentTarget, getContext: () => context, system });
    const revision = port.list().items[0].revision;
    const prepare = (stage = 'round', extra = {}) => port.prepareExecution({ id: 'se_test', revision, stage, ...extra }, { target, taskId: 't' });
    const run = (ticket, extra = {}) => port.execute(ticket.executionId, { target, taskId: 't', ...extra });
    return { get settings() { return settings; }, context, system, port, prepare, run, revision,
        switchTarget: () => { currentTarget = { ...target, chatKey: 'B' }; }, replaceSettings: () => { settings = structuredClone(settings); } };
}
test('Manual execution runs only the specified disabled script, keeps automatic state isolated and deduplicates tickets', async () => {
    const f = fixture();
    f.settings.scriptExecutors.push({ id: 'other', ...normalizeScriptExecutor({ name: 'other', enabled: true, triggerOn: 'all', code: 'throw Error("must not run")' }) });
    const ticket = f.prepare(); assert.equal(f.settings.executions, undefined);
    assert.equal(f.prepare().executionId, ticket.executionId);
    const receipt = await f.run(ticket); assert.equal(receipt.status, 'completed'); assert.equal(receipt.text, '1');
    assert.equal(f.settings.executions, 1); assert.equal(f.settings.scriptExecutors[0].enabled, false);
    assert.deepEqual(f.system.getTurnShared(), {}); assert.equal(f.system.getDecisionSnapshot(), null);
    assert.deepEqual(await f.run(ticket), receipt); assert.equal(f.settings.executions, 1);
    await assert.rejects(f.run(ticket, { taskId: 'another-task' }), /STALE/);
});

test('prepared script ticket explains task lifetime without granting execution or promising later reapproval', () => {
    const f = fixture(), module = createScriptExecutorModule({ port: f.port, charge: () => true });
    module.bindRun({ id: 'lifetime', taskId: 't', target });
    const result = JSON.parse(module.handlers['muyu.scripts.prepare_execution']({ id: 'se_test', revision: f.revision, stage: 'round' }, { runId: 'lifetime', target }).text);
    assert.match(result.ticketLifecycle, /removed when it ends/);
    assert.match(result.ticketLifecycle, /do not suggest approving this old ticket later/);
    assert.equal(f.settings.executions, undefined);
    module.forgetTask('t');
    assert.equal(f.port.describeExecution(result.executionId, target), null);
});
test('Ticket rejects script revision, chat, message or settings replacement before execution', async () => {
    for (const mutate of [f => f.settings.scriptExecutors[0].code += ' ', f => f.switchTarget(), f => f.context.chat[0].mes = 'edited', f => f.context.chat = [...f.context.chat], f => f.replaceSettings()]) {
        const f = fixture(), ticket = f.prepare('message', { messageIndex: 0 }); mutate(f);
        assert.equal(f.port.describeExecution(ticket.executionId, target), null);
        await assert.rejects(f.run(ticket), /STALE/); assert.equal(f.settings.executions, undefined);
    }
});
test('Manual stage and message must match a real saved script and current message', () => {
    const f = fixture({ triggerOn: 'message' });
    for (const [stage, args] of [['round', {}], ['message', {}], ['message', { messageIndex: 3 }]]) assert.throws(() => f.prepare(stage, args));
    assert.equal(f.prepare('message', { messageIndex: 0 }).messageIndex, 0);
    assert.throws(() => fixture().prepare('round', { messageIndex: 0 }));
});
test('Real execution consent is exact, task-only, distinct from reads/tests/saving, and stale approval fails closed', () => {
    const f = fixture(), ticket = f.prepare(), source = scriptExecutionSource(ticket.executionId), permissions = createSourcePermissions();
    const request = { source: 'scriptExecution', executionId: ticket.executionId, reason: 'run', target, taskId: 't' };
    permissions.decide({ source: 'scriptTests', reason: 'test', target, taskId: 't' }, 'task', () => {});
    permissions.grantSource('source:scriptAssets', target); assert.equal(permissions.allows(source, target, 't'), false);
    assert.throws(() => permissions.decide(request, 'chat', () => {}));
    assert.throws(() => permissions.grantTaskSources([source], target, 't', () => {}));
    permissions.decide(request, 'task', () => {}); assert.equal(permissions.allows(source, target, 't'), true);
    assert.equal(permissions.allows(source, target, 'other'), false);
    assert.equal(permissions.allows(scriptExecutionSource(crypto.randomUUID()), target, 't'), false);
    assert.equal(permissionApprovalCurrent(request, null, f.port), true);
    f.settings.scriptExecutors[0].enabled = true; assert.equal(permissionApprovalCurrent(request, null, f.port), false);
    permissions.forgetTask(target, 't'); assert.equal(permissions.allows(source, target, 't'), false);
});
test('Deny survives continuation and malformed execution permissions cannot enter the interaction store', () => {
    const f = fixture(), ticket = f.prepare(), permissions = createSourcePermissions(), source = scriptExecutionSource(ticket.executionId);
    const request = { source: 'scriptExecution', executionId: ticket.executionId, reason: 'run', target, taskId: 't' };
    permissions.decide(request, 'deny', () => {}); assert.equal(permissions.denied(source, target, 't'), true);
    const store = createInteractionStore();
    const r = store.create({ sessionId: 's', taskId: 't', target }, { ...request, kind: 'permission' }); assert.equal(r.executionId, ticket.executionId);
    assert.throws(() => validatePermission({ source: 'scriptExecution', reason: 'run' }));
    assert.throws(() => validatePermission({ source: 'scriptAssets', reason: 'read', executionId: ticket.executionId }));
});
test('Full access bypasses prompts but preserves the ticket target/revision validation', () => {
    const f = fixture(), ticket = f.prepare(), permissions = createPermissions({ fullAccess: () => true });
    const definition = { id: 'muyu.scripts.execute', effect: 'external' };
    assert.equal(assistantToolAccess(definition, ticket, target, 't', permissions, null, f.port).decision, true);
    f.switchTarget(); assert.equal(assistantToolAccess(definition, ticket, target, 't', permissions, null, f.port).decision, 'target_unavailable');
});
test('Timeout reports unknown, late side effects remain possible and retry cannot run the script twice', async () => {
    const f = fixture({ code: 'return new Promise(resolve=>setTimeout(()=>{ctx.settings.executions=(ctx.settings.executions||0)+1;resolve(7)},40));' }, { phaseTimeoutMs: 5 });
    const ticket = f.prepare(), receipt = await f.run(ticket);
    assert.equal(receipt.status, 'outcome_unknown'); assert.equal(receipt.code, 'TIMEOUT');
    await wait(70); assert.equal(f.settings.executions, 1);
    assert.deepEqual(await f.run(ticket), receipt); assert.equal(f.settings.executions, 1);
});
test('Concurrent calls, cancellation and thrown code never imply no effects or permit replay', async () => {
    const f = fixture({ code: 'ctx.settings.executions=1; return new Promise(()=>{});' }, { phaseTimeoutMs: 100 });
    const ticket = f.prepare(), abort = new AbortController(), pending = f.run(ticket, { signal: abort.signal });
    await wait(1); assert.equal((await f.run(ticket)).code, 'ALREADY_STARTED');
    abort.abort(); const receipt = await pending; assert.equal(receipt.status, 'outcome_unknown'); assert.equal(receipt.code, 'CANCELLED');
    assert.equal(f.settings.executions, 1); assert.deepEqual(await f.run(ticket), receipt);
    const broken = fixture({ code: 'ctx.settings.executions=1; throw Error("SECRET_DETAIL");' });
    const result = await broken.run(broken.prepare()); assert.equal(result.status, 'outcome_unknown'); assert.doesNotMatch(JSON.stringify(result), /SECRET_DETAIL/);
});
test('Real parameter rendering is granted execution; cancellation or version change prevents the later script body', async () => {
    let resolve, rendered = 0;
    const f = fixture({ renderParams: true, params: [{ key: 'x', type: 'string', default: '{{userProvider}}' }, { key: 'y', type: 'string', default: '{{anotherProvider}}' }] }, { renderPrompt: () => { rendered++; return new Promise(r => { resolve = r; }); }, phaseTimeoutMs: 10 });
    const ticket = f.prepare(), pending = f.run(ticket); await wait(1); assert.equal(rendered, 1);
    const receipt = await pending; assert.equal(receipt.status, 'outcome_unknown'); resolve('late'); await wait(1); assert.equal(f.settings.executions, undefined); assert.equal(rendered, 1);
    let change;
    const g = fixture({ renderParams: true, params: [{ key: 'x', type: 'string', default: '{{userProvider}}' }] }, { renderPrompt: async () => { change(); return 'value'; } });
    change = () => g.switchTarget(); const result = await g.run(g.prepare()); assert.equal(result.status, 'outcome_unknown'); assert.equal(g.settings.executions, undefined);
});
test('Aborted-before-start and syntax failure report not_started; output omission does not pretend execution failed', async () => {
    const f = fixture(), abort = new AbortController(); abort.abort();
    assert.equal((await f.run(f.prepare(), { signal: abort.signal })).status, 'not_started'); assert.equal(f.settings.executions, undefined);
    const broken = fixture({ code: 'return {' }); assert.equal((await broken.run(broken.prepare())).status, 'not_started');
    for (const [code, expected] of [['return "x".repeat(3000)', 'too_large'], ['const x={}; x.x=x; return x;', 'unsupported']]) {
        const g = fixture({ code }), r = await g.run(g.prepare()); assert.equal(r.status, 'completed'); assert.equal(r.outputStatus, expected); assert.equal(r.text, '');
    }
});
test('Module refuses real execution before spending its output budget and preserves task binding across permission continuation', async () => {
    const f = fixture(), module = createScriptExecutorModule({ port: f.port, charge: () => false }), ticket = f.prepare();
    module.bindRun({ id: 'r', taskId: 't', target }); module.transferRun('r', { id: 'r2', taskId: 't', target });
    const result = await module.handlers['muyu.scripts.execute']({ executionId: ticket.executionId }, { runId: 'r2', target });
    assert.equal(JSON.parse(result.text).status, 'not_started'); assert.equal(JSON.parse(result.text).code, 'RESULT_BUDGET_EXCEEDED');
    assert.equal(f.settings.executions, undefined); module.dispose(); assert.equal(f.port.describeExecution(ticket.executionId, target), null);
});

test('Execution evidence never upgrades script output or counter writes into persistence or side-effect proof', async () => {
    const f = fixture({ code: 'ctx.settings.executions=1; return {saved:true,sideEffects:false,coins:7};' });
    const module = createScriptExecutorModule({ port: f.port, charge: () => true });
    module.bindRun({ id: 'r', taskId: 't', target });
    const output = await module.handlers['muyu.scripts.execute']({ executionId: f.prepare().executionId }, { runId: 'r', target });
    const receipt = JSON.parse(output.text);
    assert.equal(f.settings.executions, 1); assert.equal(JSON.parse(receipt.text).saved, true);
    assert.equal(receipt.evidence.persistence, 'not_verified'); assert.equal(receipt.evidence.currentValues, 'not_independently_read');
    assert.match(receipt.evidence.sideEffects, /not_audited/); assert.match(receipt.evidence.verification, /Do not rerun/);
    assert.match(receipt.evidence.verification, /unsupported custom keys/);
    assert.match(receipt.evidence.priorValues, /not_observed/); assert.match(receipt.evidence.verification, /refresh\/reload\/reapply/);
    assert.equal(receipt.automaticPipelineMergePerformed, false); assert.equal(receipt.automaticStateUpdated, undefined);
    assert.ok(new TextEncoder().encode(output.text).length < 16000);
    const description = module.registry.get('muyu.scripts.execute').description;
    assert.match(description, /新任务、新票据、全权限/); assert.match(description, /不代表settings.read能读任意键/);
    module.dispose();
});

test('Execution evidence keeps not-started, unknown and completed meanings distinct', async () => {
    const { scriptExecutionEvidence } = await import('../../muyu/scripts/execution-evidence.js');
    for (const [status, meaning] of [['not_started', 'this_invocation_not_started'], ['outcome_unknown', 'outcome_unknown'], ['completed', 'function_returned']]) {
        const receipt = scriptExecutionEvidence({ status, evidence: { persistence: 'confirmed' } });
        assert.equal(receipt.evidence.execution, meaning); assert.equal(receipt.evidence.persistence, 'not_verified');
        assert.equal(receipt.evidence.currentValues, 'not_independently_read');
    }
});
