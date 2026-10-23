import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskPlanModule, projectTaskPlan, taskPlanSchema } from '../../muyu/modules/task-plan/index.js';
import { createSourcePermissions } from '../../muyu/permissions/store.js';
import { createWorkspace } from '../../muyu/workspace/store.js';
import { taskPlanReviewPort } from '../../muyu/modules/task-plan/review.js';

const target = { kind: 'chat', userKey: 'page:1', chatKey: 'group:A' };
const input = { goal: 'Create a coin system for this chat', scope: 'mixed', sources: ['configSettings', 'variables'],
    steps: [
        { kind: 'read', title: 'Inspect', detail: 'Read current chat variables and relevant settings' },
        { kind: 'settings', title: 'Prepare switches', detail: 'Preview only; requires separate apply approval' },
        { kind: 'variables', title: 'Create balance', detail: 'Needs a future variable write port' },
    ], risks: ['An existing variable could be overwritten; no write is authorized'], unknowns: ['Existing balance variable may conflict'] };

test('Plan length hints keep the original per-item character limit and reject oversized English', () => {
    for (const field of ['risks', 'unknowns']) {
        assert.equal(taskPlanSchema.properties[field].items.maxLength, 200);
        assert.match(taskPlanSchema.properties[field].items.description, /200 characters.*not 200 words/);
        assert.doesNotThrow(() => projectTaskPlan({ ...input, [field]: ['a'.repeat(200)] }, target));
        assert.throws(() => projectTaskPlan({ ...input, [field]: ['a'.repeat(201)] }, target));
    }
});

test('Binding rejection exposes only closed validation reasons and never reports completion', () => {
    let failure = 'INVALID_BUNDLE_STEP_BINDING';
    const module = createTaskPlanModule({ bindStep() { throw Error(failure); } });
    module.bindRun({ id: 'binding', taskId: 'task', target });
    const call = () => module.handlers['muyu.task.bind_step']({}, { runId: 'binding', target });
    const bundle = call();
    assert.equal(bundle.bound, false);
    assert.match(bundle.notice, /variable→variables, settings→settings, script→code/);
    assert.match(bundle.notice, /draft remains unapplied; no step completed/);
    assert.ok(bundle.notice.length <= 300);
    failure = 'INVALID_STEP_BINDING';
    assert.equal(call().bound, false);
    failure = 'private host error';
    assert.throws(call, /private host error/); // Broker still redacts unknown exceptions.
    module.dispose();
    assert.throws(call, /RUN_NOT_BOUND/);
});

test('Plan review only hands off successful plan proposals, not failed or ordinary reads', () => {
    const plan = { toolId: 'muyu.task.plan' }, read = { toolId: 'muyu.settings.read' };
    assert.equal(taskPlanReviewPort.isControl(plan), true);
    assert.equal(taskPlanReviewPort.isControl(read), false);
    assert.equal(taskPlanReviewPort.read(plan, { ok: false, error: { code: 'INVALID_ARGUMENT' } }), null);
    assert.equal(taskPlanReviewPort.read(plan, { ok: true, data: {} }), null);
    assert.equal(taskPlanReviewPort.read(read, { ok: true, data: { candidateId: 'not-a-plan' } }), null);
    assert.match(taskPlanReviewPort.read(plan, { ok: true, data: { candidateId: 'plan:1' } }), /方案本身不批准修改或代码执行/);
});

test('Task plan is bounded, read-only and labels unavailable write paths', () => {
    const plan = projectTaskPlan(input, target);
    assert.deepEqual(plan.steps.map(step => step.availability), ['read-only', 'bundle-or-separate-draft-approval-required', 'bundle-or-separate-draft-approval-required']);
    assert.equal(plan.risks.length, 1);
    assert.throws(() => projectTaskPlan({ ...input, sources: ['variables', 'variables'] }, target), /INVALID_TASK_PLAN/);
    assert.throws(() => projectTaskPlan({ ...input, sources: ['providerExecution'] }, target));
    assert.throws(() => projectTaskPlan(input, { kind: 'global', userKey: 'page:1' }), /INVALID_TASK_PLAN/);
    assert.throws(() => projectTaskPlan({ ...input, scope: 'global' }, target), /INVALID_TASK_PLAN/);
    assert.throws(() => projectTaskPlan({ ...input, steps: [] }, target), /INVALID_TASK_PLAN/);
    assert.throws(() => projectTaskPlan({ ...input, steps: [{ kind: 'write-anywhere', title: 'x', detail: 'x' }] }, target));
});

test('plan operation availability cannot be mistaken for source read availability', () => {
    const module = createTaskPlanModule(); module.bindRun({ id: 'routing', taskId: 'task', target });
    const definition = module.registry.get('muyu.task.plan');
    assert.match(definition.inputSchema.properties.steps.items.properties.kind.description, /Operation kind, not subject/);
    assert.match(definition.description, /Every reading\/contract-lookup\/analysis step uses kind=read/);
    const proposal = { ...input, sources: ['variables', 'storyBlueprint'], steps: [
        { kind: 'read', title: 'Read blueprint condition', detail: 'Read current task requirements' },
        { kind: 'blueprint', title: 'Future write', detail: 'Unavailable through this plan' },
    ] };
    const result = JSON.parse(module.handlers['muyu.task.plan'](proposal, { runId: 'routing', target }).text);
    assert.equal(result.steps[0].availability, 'read-only');
    assert.equal(result.steps[1].availability, 'not-available');
    assert.match(result.notice, /write restrictions do not prohibit reading/);
});

test('Broad infinite-flow proposals remain bounded and cannot include undeclared execution', () => {
    const plan = projectTaskPlan({ goal: '设计当前聊天的无限流规则', scope: 'mixed', sources: ['variables', 'storyBlueprint', 'configSettings'],
        steps: Array.from({ length: 8 }, (_, index) => ({ kind: index % 2 ? 'variables' : 'read', title: `步骤 ${index}`, detail: '仅核对或预览已列出的范围' })),
        risks: ['多模块保存不能视为原子操作'], unknowns: ['现有变量是否冲突'] }, target);
    assert.equal(plan.steps.length, 8);
    assert.equal(plan.steps.filter(step => step.availability === 'bundle-or-separate-draft-approval-required').length, 4);
    assert.throws(() => projectTaskPlan({ ...plan, steps: [...plan.steps.map(({ availability, ...step }) => step), { kind: 'code', title: 'extra', detail: 'execute' }] }, target));
    assert.throws(() => projectTaskPlan({ ...input, sources: ['variables', 'providerExecution'] }, target));
});

test('Plan candidate publishes only after a succeeded same-target run and carries no authority', () => {
    const module = createTaskPlanModule();
    const workspace = createWorkspace();
    const artifacts = [];
    const app = { snapshot: () => ({ runs: [{ id: 'r', taskId: 't', target, status: 'succeeded' }] }),
        createArtifact: value => { const artifact = workspace.create({ id: 'a', sessionId: 's', ...value }); artifacts.push(artifact); return artifact; },
        getArtifact: id => workspace.get(id), validateArtifact: (id, revision, validation) => workspace.validate(id, revision, validation) };
    module.bindRun({ id: 'r', taskId: 't', target });
    const { candidateId } = module.handlers['muyu.task.plan'](input, { runId: 'r', target });
    assert.equal(artifacts.length, 0);
    assert.throws(() => module.publishDraft(app, 'r', 'wrong'), /INVALID_CANDIDATE_SOURCE/);
    const artifact = module.publishDraft(app, 'r', candidateId);
    assert.equal(artifact.kind, 'task-plan');
    assert.equal(artifact.content.plan.steps[2].availability, 'bundle-or-separate-draft-approval-required');
    assert.equal(module.validateSaved(app, artifact.id, artifact.revision).validation.intent, 'read-scope-review');
    module.dispose();
});

test('One task decision grants only listed read sources, rolls back failed continuation and expires', () => {
    const permissions = createSourcePermissions();
    let resumed = 0;
    assert.throws(() => permissions.grantTaskSources(['source:configSettings', 'source:variables'], target, 't', () => { throw Error('not queued'); }), /not queued/);
    assert.equal(permissions.allows('source:configSettings', target, 't'), false);
    permissions.grantTaskSources(['source:configSettings', 'source:variables'], target, 't', () => { resumed++; });
    assert.equal(resumed, 1);
    assert.equal(permissions.allows('source:variables', target, 't'), true);
    assert.equal(permissions.allows('source:chatHistory', target, 't'), false);
    assert.equal(permissions.allows('source:variables', { ...target, chatKey: 'group:B' }, 't'), false);
    assert.equal(permissions.allows('source:variables', target, 'another-task'), false);
    assert.throws(() => permissions.grantTaskSources(['source:providerExecution'], target, 't', () => {}), /INVALID_TASK_SCOPE/);
    permissions.forgetTask(target, 't');
    assert.equal(permissions.allows('source:variables', target, 't'), false);
});
