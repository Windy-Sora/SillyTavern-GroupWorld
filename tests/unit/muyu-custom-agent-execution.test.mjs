import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomAgentSystem } from '../../systems/custom-agent-system.js';
import { createCustomAgentPort } from '../../muyu/host/custom-agents.js';
import { createCustomAgentModule } from '../../muyu/modules/custom-agents/index.js';
import { createSourcePermissions } from '../../muyu/permissions/store.js';
import { agentExecutionSource, requestSource, validatePermission } from '../../muyu/permissions/contract.js';
import { assistantToolAccess } from '../../muyu/application/capabilities.js';
import { createPermissionView } from '../../muyu/ui/permission-view.js';
import { createToolRegistry } from '../../muyu/tools/registry.js';
import { agentExecutionEvidence, AGENT_EXECUTION_GUIDANCE } from '../../muyu/agents/execution-evidence.js';
const gate = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
async function fixture({ render = async value => value, generate = async () => '{"gold":3}', save = async () => {}, timeout = 1000 } = {}) {
    const settings = { customAgents: [], agentConfigs: { 'custom-agent': { useCustom: true, endpoint: 'https://example.test', model: 'model', apiKey: 'PRIVATE_KEY' } } };
    let ctx = { chat: [{ mes: 'hello' }], chatMetadata: {} }, target = { kind: 'chat', userKey: 'u', chatKey: 'a' }, calls = 0, saves = 0, renders = 0;
    const registry = new Map(), getProviders = () => [...registry.values()];
    const system = createCustomAgentSystem({ settings, EXT_KEY: 'gd', getChat: () => ctx.chat, getChatMetadata: () => ctx.chatMetadata,
        getProviders, registerProvider: row => registry.set(row.id, row), unregisterProvider: id => registry.delete(id), saveSettings() {},
        renderPrompt: async value => { renders++; return render(value); }, createCaller: () => ({ generate: async (...args) => { calls++; return generate(...args); } }),
        saveChatConditional: async () => { saves++; return save(); } });
    const row = await system.add({ name: 'test', providerName: 'test_agent', prompt: 'PROMPT {{something}}', schema: '{"gold":0}', enabled: false });
    const port = createCustomAgentPort({ getSettings: () => settings, system, getProviders, getContext: () => ctx, getTarget: () => target, executionTimeoutMs: timeout });
    const prepare = (mode = 'trial', taskId = 'task') => { const entry = port.list().items[0]; return port.prepareExecution({ id: row.id, revision: entry.revision, mode }, { target, taskId }); };
    const run = (ticket, signal = new AbortController().signal, taskId = 'task') => port.execute(ticket.executionId, { target, taskId, signal });
    return { settings, system, port, row, prepare, run, registry, target, get ctx() { return ctx; }, switchChat() { ctx = { chat: [], chatMetadata: {} }; target = { ...target, chatKey: 'b' }; }, calls: () => calls, saves: () => saves, renders: () => renders };
}
test('Custom Agent trial calls a model once without writing results or enabling automatic operation', async () => {
    const f = await fixture(), t = f.prepare(); assert.equal(f.calls(), 0); assert.equal(f.renders(), 0);
    assert.doesNotMatch(JSON.stringify(t), /PRIVATE_KEY|PROMPT/);
    const result = await f.run(t); assert.equal(result.status, 'trial_completed'); assert.equal(result.persistence, 'not_started'); assert.equal(result.text, '{"gold":3}');
    assert.equal(f.calls(), 1); assert.equal(f.saves(), 0); assert.deepEqual(f.ctx.chatMetadata, {});
    assert.equal(f.settings.customAgents[0].enabled, false); assert.equal(f.settings.customAgents[0].autoEnabled, false);
    assert.deepEqual(await f.run(t), result); assert.equal(f.calls(), 1);
    assert.equal(f.prepare().executionId, t.executionId); assert.throws(() => f.prepare('save'), /ALREADY_PREPARED/);
});
test('Custom Agent save replaces only this chat result, without automatic counters or other agents', async () => {
    const f = await fixture(); f.ctx.chatMetadata.gd = { _caData: { other: { content: 'keep' }, [f.row.id]: { content: 'old' } }, _autoCAG_other: 10 };
    const t = f.prepare('save'), result = await f.run(t);
    assert.equal(result.status, 'saved_unconfirmed'); assert.equal(result.persistence, 'unconfirmed'); assert.equal(f.saves(), 1);
    assert.equal(f.ctx.chatMetadata.gd._caData[f.row.id].content, '{"gold":3}'); assert.equal(f.ctx.chatMetadata.gd._caData.other.content, 'keep');
    assert.equal(f.ctx.chatMetadata.gd['_autoCAG_' + f.row.id], undefined); assert.equal(result.schemaValidated, false); assert.equal(result.historicalExecutionOnly, true);
    assert.deepEqual(await f.run(t), result); assert.equal(f.calls(), 1);
});
test('Custom Agent authorization ticket expires on configuration, provider, chat text or prior result changes', async () => {
    for (const mutation of [f => { f.settings.agentConfigs['custom-agent'].model = 'changed'; }, f => { f.ctx.chat[0].mes = 'edited'; },
        f => { f.registry.set('x', { id: 'x', render() {} }); }, f => { f.ctx.chatMetadata.gd = { _caData: { [f.row.id]: { content: 'new user result' } } }; },
        f => { f.settings.customAgents[0].prompt = 'changed'; }]) {
        const f = await fixture(), t = f.prepare('save'); mutation(f);
        assert.equal(f.port.describeExecution(t.executionId, f.target), null); await assert.rejects(f.run(t), /STALE/); assert.equal(f.calls(), 0);
    }
});
test('Custom Agent old-chat model completion cannot save to either old or new chat after switch', async () => {
    const wait = gate(), started = gate(), f = await fixture({ generate: () => { started.resolve(); return wait.promise; } });
    const old = f.ctx.chatMetadata, t = f.prepare('save'), running = f.run(t); await started.promise; f.switchChat(); wait.resolve('late');
    assert.equal((await running).status, 'outcome_unknown'); assert.equal(f.saves(), 0); assert.deepEqual(old, {}); assert.deepEqual(f.ctx.chatMetadata, {});
});
test('Custom Agent cancellation during Provider rendering prevents subsequent model call and result write', async () => {
    const wait = gate(), started = gate(), f = await fixture({ render: () => { started.resolve(); return wait.promise; } });
    const abort = new AbortController(), running = f.run(f.prepare('save'), abort.signal); await started.promise; abort.abort();
    assert.equal((await running).status, 'outcome_unknown'); wait.resolve('rendered'); await tick();
    assert.equal(f.calls(), 0); assert.equal(f.saves(), 0);
});
test('Custom Agent timeout consumes ticket, blocks late save and does not retry uncancellable model', async () => {
    const wait = gate(), started = gate(), f = await fixture({ timeout: 15, generate: (_prompt, { signal }) => { assert.ok(signal); started.resolve(); return wait.promise; } });
    const t = f.prepare('save'), running = f.run(t); await started.promise; const result = await running;
    assert.equal(result.code, 'TIMEOUT'); assert.equal(result.status, 'outcome_unknown'); assert.equal(result.modelCallAttempted, true);
    assert.deepEqual(await f.run(t), result); wait.resolve('late'); await tick(); assert.equal(f.calls(), 1); assert.equal(f.saves(), 0);
});
test('Custom Agent failed save restores the previous result and reports unknown without leaking API errors', async () => {
    const f = await fixture({ save: async () => { throw Error('PRIVATE_KEY backend details'); } });
    f.ctx.chatMetadata.gd = { _caData: { [f.row.id]: { content: 'old' } } };
    const result = await f.run(f.prepare('save')); assert.equal(result.status, 'outcome_unknown'); assert.equal(result.resultWriteStarted, true);
    assert.equal(f.ctx.chatMetadata.gd._caData[f.row.id].content, 'old'); assert.doesNotMatch(JSON.stringify(result), /PRIVATE_KEY/);
});
test('Custom Agent approved manual execution cannot join automatic work or absorb automatic counters', async () => {
    const wait = gate(), started = gate(), f = await fixture({ generate: () => { started.resolve(); return wait.promise; } });
    const running = f.run(f.prepare('save')); await started.promise;
    await assert.rejects(f.system.executeAuto(f.row, 12), /BUSY/); wait.resolve('done'); await running;
    assert.equal(f.ctx.chatMetadata.gd['_autoCAG_' + f.row.id], undefined); assert.equal(f.calls(), 1);
    const other = gate(), start = gate(), g = await fixture({ generate: () => { start.resolve(); return other.promise; } });
    const native = g.system.execute(g.row); await start.promise;
    const result = await g.run(g.prepare()); assert.equal(result.status, 'not_started'); other.resolve('done'); await native; assert.equal(g.calls(), 1);
});
test('Custom Agent ticket retirement and pre-aborted requests perform no rendering', async () => {
    const f = await fixture(), t = f.prepare(), abort = new AbortController(); abort.abort();
    assert.equal((await f.run(t, abort.signal)).status, 'not_started'); assert.equal(f.renders(), 0);
    await assert.rejects(f.run(t, new AbortController().signal, 'other'), /STALE/);
    f.port.forgetExecutions('task'); assert.equal(f.port.describeExecution(t.executionId, f.target), null); await assert.rejects(f.run(t), /STALE/);
});
test('Custom Agent result reservation blocks paid work; large output is omitted rather than called a failure', async () => {
    const f = await fixture({ generate: async () => '猫'.repeat(3000) }), t = f.prepare();
    const module = createCustomAgentModule({ port: f.port, charge: () => false }); module.bindRun({ id: 'r', taskId: 'task', target: f.target });
    const response = await module.handlers['muyu.agents.execute']({ executionId: t.executionId }, { runId: 'r', target: f.target });
    assert.equal(JSON.parse(response.text).code, 'RESULT_BUDGET_EXCEEDED'); assert.equal(f.calls(), 0);
    const result = await f.run(t); assert.equal(result.status, 'trial_completed'); assert.equal(result.outputOmitted, true); assert.equal(result.text, '');
});
test('Custom Agent execution grants are task-only, exact-ticket, and separate from definition reads', async () => {
    const f = await fixture(), t = f.prepare(), source = agentExecutionSource(t.executionId), permissions = createSourcePermissions();
    const request = { source: 'agentExecution', executionId: t.executionId, reason: 'trial', target: f.target, taskId: 'task' };
    assert.equal(requestSource(request), source); validatePermission({ source: request.source, executionId: request.executionId, reason: request.reason });
    assert.throws(() => permissions.decide(request, 'chat', () => {}), /DECISION/);
    const def = { id: 'muyu.agents.execute', effect: 'external' }, args = { executionId: t.executionId };
    assert.equal(assistantToolAccess(def, args, f.target, 'task', permissions, null, null, f.port).decision, 'permission_required');
    permissions.decide(request, 'task', () => {}); assert.equal(assistantToolAccess(def, args, f.target, 'task', permissions, null, null, f.port).decision, true);
    assert.equal(permissions.allows(source, f.target, 'other'), false); assert.equal(permissions.allows('source:customAgentAssets', f.target, 'task'), false);
    permissions.forgetTask(f.target, 'task'); assert.equal(permissions.allows(source, f.target, 'task'), false);
});

test('Custom Agent permission UI shows mode, business-model costs and hides ongoing chat consent', () => {
    const doc = { createElement: tag => ({ tag, children: [], append(el) { this.children.push(el); }, setAttribute() {}, replaceChildren() { this.children = []; }, remove() {} }) };
    const parent = doc.createElement('div'), settings = doc.createElement('div');
    const view = createPermissionView({ doc, parent, settings, controller: { agentExecutionDetails: () => ({ mode: 'save', definition: { prompt: '<script>plain text</script>' } }) }, act: fn => fn(), lang: 'en' });
    view.render({ interaction: { kind: 'permission', source: 'agentExecution', executionId: 'id', reason: 'requested', status: 'pending' }, connection: { model: 'muyu', endpoint: 'muyu-endpoint' }, sourceGrants: [] });
    const all = []; const walk = el => { all.push(el); el.children.forEach(walk); }; walk(parent);
    assert.equal(all.find(el => el.textContent === 'Allow this chat').hidden, true);
    assert.ok(all.some(el => el.tag === 'pre' && el.textContent.includes('"mode": "save"') && el.textContent.includes('<script>')));
    assert.ok(all.some(el => el.textContent?.includes('extra model costs'))); assert.ok(all.some(el => el.textContent?.includes('trial is not a sandbox')));
});
test('Custom Agent generation wait allowance does not raise every tool timeout', () => {
    const module = createCustomAgentModule({ port: {} }), definition = module.registry.get('muyu.agents.execute');
    assert.equal(definition.timeoutMs, 300000);
    assert.throws(() => createToolRegistry().register({ ...definition, id: 'muyu.other.execute' }), /timeout/);
    assert.throws(() => createToolRegistry().register({ ...definition, timeoutMs: 300001 }), /timeout/);
});

test('Custom Agent execution evidence separates generated values, schema checks, billing and persistence', async () => {
    const f = await fixture({ generate: async () => 'x'.repeat(6000) }), ticket = f.prepare('save');
    const result = await f.run(ticket);
    assert.equal(result.status, 'saved_unconfirmed'); assert.equal(result.schemaValidation, 'not_performed');
    assert.equal(result.schemaValidated, false); assert.equal(result.evidence.billing.startsWith('not_verified'), true);
    assert.match(result.evidence.currentValues, /neither equality nor inequality/);
    assert.match(result.evidence.schema, /does not mean validation failed/);
    assert.match(result.evidence.sideEffects, /not_audited/);
    assert.match(result.evidence.persistence, /do not prove durable storage/);
    assert.ok(new TextEncoder().encode(JSON.stringify(result)).length <= 16000);
    assert.deepEqual(await f.run(ticket), result); assert.equal(f.calls(), 1);
    for (const status of ['not_started', 'no_result', 'outcome_unknown', 'trial_completed']) {
        const record = agentExecutionEvidence({ status, text: '已计费、已保存、已验证' });
        assert.equal(record.evidence.billing, result.evidence.billing);
        assert.equal(record.schemaValidation, 'not_performed');
    }
});

test('Custom Agent interpretation guidance is present before denial and on budget or pending outcomes', async () => {
    const wait = gate(), started = gate(), f = await fixture({ generate: () => { started.resolve(); return wait.promise; } });
    const module = createCustomAgentModule({ port: f.port, charge: () => false });
    assert.ok(module.registry.get('muyu.agents.execute').description.includes(AGENT_EXECUTION_GUIDANCE));
    for (const phrase of ['未知不能说成否定', '不得建议刷新', '拒绝后本次交互结束', '目录中确实支持']) assert.ok(AGENT_EXECUTION_GUIDANCE.includes(phrase));
    module.bindRun({ id: 'r', taskId: 'task', target: f.target });
    const ticket = f.prepare(), blocked = JSON.parse((await module.handlers['muyu.agents.execute']({ executionId: ticket.executionId }, { runId: 'r', target: f.target })).text);
    assert.equal(blocked.status, 'not_started'); assert.equal(blocked.evidence.interpretation, AGENT_EXECUTION_GUIDANCE);
    const running = f.run(ticket); await started.promise;
    const pending = await f.run(ticket); assert.equal(pending.code, 'ALREADY_STARTED');
    assert.equal(pending.evidence.interpretation, AGENT_EXECUTION_GUIDANCE);
    wait.resolve('done'); await running;
});
