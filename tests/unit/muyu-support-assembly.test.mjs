import test from 'node:test';
import assert from 'node:assert/strict';
import { createModuleAssembly } from '../../muyu/modules/assembly.js';
import { createBuiltins } from '../../muyu/modules/builtins.js';
import { createHostBridge } from '../../muyu/host/bridge.js';

function fixture(extra = {}) {
    const host = createHostBridge({ getContext: () => ({ groupId: 'g', chatId: 'A', chatMetadata: {}, chat: [] }),
        getSettings: () => ({}), extensionKey: 'gd', pageId: 'test', ...extra });
    const target = host.currentTarget();
    return { host: { ...host, ...extra }, target, identity: (id, taskId = 'task') => ({ id, taskId, target }),
        ctx: runId => ({ runId, target, signal: new AbortController().signal }) };
}
function budgetDescriptor(id = 'budget') {
    const calls = [];
    return { calls, id, module: { registry: { list: () => [{ id, effect: 'read' }] }, handlers: { [id]() {} },
        bindRun: (...args) => calls.push(['bind', ...args]), transferRun: (...args) => calls.push(['budget-transfer', ...args]),
        usage: id => ({ id }), forgetRun: id => calls.push(['forget', id]), retainArtifacts() {}, dispose() {} },
        bindAssistant: null, budgetLifecycle: true, tools: [{ id, group: null }], artifacts: [] };
}
const options = { capabilityFor: () => ({ effect: 'read', sources: () => [] }), labels: { budget: ['预算', 'Budget'], other: ['其他', 'Other'] }, actions: [] };
test('Budget lifecycle has one explicit owner and never receives the ordinary identity transfer', () => {
    const d = budgetDescriptor(), a = createModuleAssembly([d], options);
    a.bindAssistant({ id: 'r' }, {}); assert.deepEqual(d.calls, []);
    a.bindBudget('r', 9000); a.bindBudget('next', 8000, 'r'); a.transferRun('r', { id: 'next' });
    assert.deepEqual(d.calls, [['bind', 'r', 9000], ['budget-transfer', 'r', 'next', 8000]]);
    assert.deepEqual(a.resourceUsage('next'), { id: 'next' });
    a.forgetRun('next'); assert.deepEqual(d.calls.at(-1), ['forget', 'next']);
    assert.equal(a.describe()[0].budgetLifecycle, true); a.dispose();
    assert.throws(() => a.bindBudget('x', 6000), /DISPOSED/); assert.throws(() => a.resourceUsage('x'), /DISPOSED/);
});
test('Budget descriptor rejects duplicate owners, implicit assistant binding and missing interfaces', () => {
    assert.throws(() => createModuleAssembly([budgetDescriptor(), budgetDescriptor('other')], options), /DESCRIPTOR/);
    for (const mutate of [d => { d.budgetLifecycle = 'true'; }, d => { d.bindAssistant = () => {}; },
        d => { delete d.module.bindRun; }, d => { delete d.module.usage; }]) {
        const d = budgetDescriptor(); mutate(d); assert.throws(() => createModuleAssembly([d], options), /DESCRIPTOR/);
    }
    const d = budgetDescriptor(); delete d.budgetLifecycle;
    const a = createModuleAssembly([d], options); assert.throws(() => a.bindBudget('r', 6000), /OWNER_MISSING/);
});
test('Task-plan read review cannot masquerade as write approval or external execution', () => {
    const d = budgetDescriptor(); delete d.budgetLifecycle;
    d.module.publishDraft = () => {}; d.module.validateSaved = () => {};
    const artifact = { moduleId: 'task-plan', kind: 'task-plan', actionOwner: null, review: 'read-scope', tools: ['budget'] };
    d.artifacts = [artifact]; assert.equal(createModuleAssembly([d], options).artifactEntries.length, 1);
    for (const patch of [{ kind: 'config-draft' }, { actionOwner: 'fake' }, { review: undefined }]) {
        d.artifacts = [{ ...artifact, ...patch }]; assert.throws(() => createModuleAssembly([d], options), /ARTIFACT/);
    }
    d.artifacts = [artifact]; d.module.registry.list = () => [{ id: 'budget', effect: 'external' }];
    assert.throws(() => createModuleAssembly([d], { ...options, capabilityFor: () => ({ effect: 'external', sources: () => [] }) }), /ARTIFACT/);
});
test('All 45 enabled modules own exact tools, publications and group metadata, including optional task bindings', () => {
    const ports = Object.fromEntries(['selectionEditor', 'ledgerEditor', 'blueprintNodeEditor', 'stPresetEditor', 'characterCards', 'worldBookEditor', 'variableEditor', 'memoryEditor', 'profileEditor', 'npcEditor', 'providerAssets',
        'customPrompts', 'skills', 'profileLibraries', 'npcLibraries', 'blueprintLibraries', 'profileLibraryChat', 'npcLibraryChat', 'blueprintLibraryChat',
        'scriptExecutors', 'customAgents', 'generationBatch', 'memoryGeneration', 'profileGeneration', 'npcGeneration'].map(key => [key, {}]));
    ports.skills.catalog = async () => ({ entries: [] });
    const f = fixture({ ...ports, bindTaskStep: () => ({ bound: true, notice: '' }), bindTaskRead: () => ({ bound: true, notice: '' }) });
    const b = createBuiltins(f.host), rows = b.moduleDescriptors(); assert.equal(rows.length, 45);
    const ids = rows.flatMap(r => r.tools); assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual([...ids].sort(), b.registry.list().map(d => d.id).sort());
    assert.deepEqual(Object.keys(b.toolGroups).sort(), [...ids].sort());
    assert.equal(rows.filter(r => r.budgetLifecycle).length, 1); assert.equal(rows.filter(r => r.taskLifecycle).length, 9);
    assert.equal(b.toolGroups['muyu.profile.preview'].id, 'config-drafts');
    for (const id of ['muyu.provider.execute', 'muyu.web.search', 'muyu.notes.remember', 'muyu.notes.forget']) {
        assert.equal(b.registry.get(id).effect, 'external'); assert.equal(b.candidateTool(id), false);
    }
    b.bindBudget('r', 1000000); b.tasks.assistant.bind(f.identity('r'), {});
    assert.equal(b.handlers['muyu.task.bind_step']({}, f.ctx('r')).bound, true);
    b.bindBudget('next', 1000000, 'r'); b.transferRun('r', f.identity('next'), {});
    b.forgetRun('r'); b.forgetRun('next'); b.forgetTask('task'); b.dispose();
    const absent = createBuiltins(fixture().host); assert.equal(absent.moduleDescriptors().length, 19);
    assert.equal(absent.registry.list().some(d => d.id === 'muyu.task.bind_step'), false); absent.dispose();
});
test('Production Provider continuation keeps tokens, cumulative bytes and the lower budget after handoff', () => {
    const f = fixture();
    const b = createBuiltins({ ...f.host, providerPort: { read: () => ({ text: 'x'.repeat(4000), limited: false }) } }); b.bindBudget('r', 12000); b.tasks.assistant.bind(f.identity('r'), {});
    const first = b.handlers['muyu.provider.read']({ id: 'recentMessages' }, f.ctx('r'));
    assert.equal(first.status, 'ok'); assert.equal(b.resourceUsage('r').used, 2000);
    b.bindBudget('next', 8000, 'r'); b.transferRun('r', f.identity('next'), {}); b.forgetRun('r');
    const continuation = first.readHint.continuation;
    const tail = b.handlers['muyu.provider.read']({ id: continuation.id, continuationToken: continuation.token }, f.ctx('next'));
    assert.equal(tail.status, 'ok'); assert.equal(tail.text.length, 2000);
    assert.deepEqual(b.resourceUsage('next'), { used: 4000, limit: 8000, exhausted: false });
    b.forgetRun('next'); assert.equal(b.resourceUsage('next').limit, 0); b.dispose();
});
test('Task plans and profile drafts transfer and publish via explicit owners without applying settings', () => {
    const f = fixture(), b = createBuiltins(f.host), artifacts = [];
    b.tasks.assistant.bind(f.identity('r'), {});
    const plan = b.handlers['muyu.task.plan']({ goal: 'Read settings', scope: 'global', sources: ['memoryConfig'], steps: [{ kind: 'read', title: 'Read', detail: 'Read memory settings' }], unknowns: [] }, f.ctx('r'));
    const profile = b.handlers['muyu.profile.preview']({ name: 'Preview', settingsJson: '{"autoMemoryInterval":15}' }, f.ctx('r'));
    b.transferRun('r', f.identity('next'), {}); b.forgetRun('r');
    const app = { snapshot: () => ({ runs: [{ ...f.identity('next'), status: 'succeeded' }] }),
        createArtifact: value => { const a = { ...value, id: String(artifacts.length), revision: 1 }; artifacts.push(a); return a; },
        getArtifact: id => artifacts.find(a => a.id === id), validateArtifact: () => ({ status: 'passed' }) };
    const result = b.tasks.assistant.publish(app, 'next', { candidates: new Map([
        ['plan', { toolId: 'muyu.task.plan', candidateId: plan.candidateId }], ['profile', { toolId: 'muyu.profile.preview', candidateId: profile.candidateId }],
    ]) });
    assert.equal(result.notice, null); assert.equal(result.published.size, 2);
    assert.deepEqual(artifacts.map(a => a.kind), ['task-plan', 'profile-draft']);
    assert.equal(artifacts[0].content.plan.steps[0].availability, 'read-only');
    b.retainArtifacts(artifacts); b.revalidate(app, '0', 1); b.revalidate(app, '1', 1); b.dispose();
});
test('Web task quota survives both Run transfer and new plan segment; renewed consent still gates searches', async () => {
    const f = fixture(), b = createBuiltins(f.host); let calls = 0, allowed = true;
    const intent = { webSearch: { limits: { maxSearches: 1, resultBytes: 10000 }, search: async () => { calls++; return { status: 'empty', provider: 'brave', query: 'query', fetchedAt: '', results: [], truncated: false }; } }, webAllowed: () => allowed };
    b.tasks.assistant.bind(f.identity('r'), intent);
    await b.handlers['muyu.web.search']({ query: 'query' }, f.ctx('r'));
    b.transferRun('r', f.identity('next'), intent); b.forgetRun('r');
    assert.equal((await b.handlers['muyu.web.search']({ query: 'query' }, f.ctx('next'))).status, 'budget_exceeded');
    b.forgetRun('next'); b.tasks.assistant.bind(f.identity('approved'), intent);
    assert.equal((await b.handlers['muyu.web.search']({ query: 'query' }, f.ctx('approved'))).status, 'budget_exceeded');
    b.forgetRun('approved'); b.forgetTask('task'); b.tasks.assistant.bind(f.identity('fresh'), intent);
    allowed = false; assert.equal((await b.handlers['muyu.web.search']({ query: 'query' }, f.ctx('fresh'))).status, 'disabled');
    allowed = true; await b.handlers['muyu.web.search']({ query: 'query' }, f.ctx('fresh')); assert.equal(calls, 2); b.dispose();
});
test('Long-term note writes remain idempotent across Run continuation and cleanup never erases storage', async () => {
    let saves = 0, removes = 0;
    const port = { enabled: () => true, save: async () => { saves++; return { id: 'note', revision: 1, scope: 'chat' }; }, remove: () => { removes++; }, list: async () => [] };
    const f = fixture({ agentMemory: port }), b = createBuiltins(f.host), args = { quote: '记住：喜欢简洁', scope: 'chat' };
    b.bindBudget('r', 12000); b.tasks.assistant.bind(f.identity('r'), { userQuestion: args.quote });
    assert.equal((await b.handlers['muyu.notes.remember'](args, f.ctx('r'))).status, 'saved');
    b.bindBudget('next', 12000, 'r'); b.transferRun('r', f.identity('next'), {}); b.forgetRun('r');
    assert.equal((await b.handlers['muyu.notes.remember'](args, f.ctx('next'))).status, 'saved'); assert.equal(saves, 1);
    b.forgetRun('next'); b.forgetTask('task'); b.dispose(); assert.equal(removes, 0);
});
