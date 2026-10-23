import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskStateStore } from '../../muyu/application/task-state.js';
import { createTaskPlanModule } from '../../muyu/modules/task-plan/index.js';
import { identity } from './helpers/muyu-subject.mjs';

function fixture(kinds = ['settings', 'settings', 'variables', 'read']) {
    const store = createTaskStateStore({ canCarryReceipt: () => true }), port = store.begin(identity);
    const plan = { id: 'plan', revision: 1, kind: 'task-plan', taskId: identity.taskId, sessionId: identity.sessionId, sourceRunId: identity.id,
        content: { target: identity.target, plan: { steps: kinds.map(kind => ({ kind })) } } };
    store.publishPlan(identity, plan); store.reviewPlan(plan, 'approved-read-only');
    const run = { ...identity, id: 'r2' }; store.begin(run);
    const steps = store.snapshot(run).taskState.plan.steps;
    const candidate = { toolId: 'muyu.config.preview', candidateId: 'candidate:1' }, candidates = new Map([['config', candidate]]);
    const observe = (c = candidate, id = 'preview') => port.observe({ toolId: c.toolId, callId: id, args: {} }, { ok: true, data: { candidateId: c.candidateId } }, run.id);
    const args = { planArtifactId: plan.id, planRevision: 1, candidateId: candidate.candidateId, stepIds: [steps[0].id] };
    const artifact = { id: 'draft', revision: 1, kind: 'config-draft', taskId: run.taskId, sessionId: run.sessionId, sourceRunId: run.id, content: { secret: 'PRIVATE_VALUE' } };
    const action = { id: 'op', artifactId: artifact.id, revision: 1, sessionId: run.sessionId, target: run.target, content: artifact.content, status: 'pending' };
    const frame = () => JSON.parse(port.project()[0].content.split('\n')[1]);
    return { store, port, run, plan, steps, candidate, candidates, observe, args, artifact, action, frame };
}

test('Explicit current-step candidate association becomes exact published artifact linkage, never permission or completion', () => {
    const f = fixture(); f.observe(); const result = f.store.bindCandidate(f.run, f.args, f.candidates);
    assert.equal(result.bound, true); assert.match(result.notice, /no permission/);
    f.store.publishBindings(f.run, new Map([[f.candidate.candidateId, f.artifact]]));
    f.store.observeAction(f.action, f.artifact);
    const op = f.frame().actionEvidence.operations[0];
    assert.equal(op.stepMapping, 'explicit-model-proposal'); assert.deepEqual(op.stepReference.stepIds, [f.steps[0].id]);
    assert.equal(op.stepReference.intentVerification, 'not-assessed'); assert.equal(op.stepReference.artifactRevision, 1);
    assert.equal(f.frame().taskState.plan.steps[0].status, 'not-assessed');
    assert.doesNotMatch(JSON.stringify(f.frame()), /PRIVATE_VALUE/);
});

test('Foreign/stale plan, nonexistent/wrong-kind step, missing/ambiguous candidate and stale run fail closed', () => {
    const f = fixture(); f.observe();
    for (const patch of [{ planArtifactId: 'other' }, { planRevision: 2 }, { stepIds: ['forged'] }, { stepIds: [f.steps[2].id] },
        { stepIds: [f.steps[3].id] }, { stepIds: [f.steps[0].id, f.steps[0].id] }, { candidateId: 'missing' }]) {
        assert.throws(() => f.store.bindCandidate(f.run, { ...f.args, ...patch }, f.candidates), /INVALID_STEP/);
    }
    assert.throws(() => f.store.bindCandidate(identity, f.args, f.candidates), /STALE/);
    assert.throws(() => f.store.bindCandidate({ ...f.run, sessionId: 'other' }, f.args, f.candidates), /STALE/);
    const ambiguous = new Map([...f.candidates, ['settings', { toolId: 'muyu.settings.preview', candidateId: f.candidate.candidateId }]]);
    assert.throws(() => f.store.bindCandidate(f.run, f.args, ambiguous), /INVALID_STEP_CANDIDATE/);
});

test('Only observed success binds; approval not yet granted cannot bind; association cannot silently change', () => {
    const f = fixture(); assert.throws(() => f.store.bindCandidate(f.run, f.args, f.candidates), /INVALID_STEP_BINDING/);
    f.observe(); f.store.bindCandidate(f.run, f.args, f.candidates);
    assert.equal(f.store.bindCandidate(f.run, f.args, f.candidates).bound, true);
    assert.throws(() => f.store.bindCandidate(f.run, { ...f.args, stepIds: [f.steps[1].id] }, f.candidates), /CONFLICT/);
    f.store.publishPlan(f.run, { ...f.plan, revision: 2, sourceRunId: f.run.id });
    assert.throws(() => f.store.bindCandidate(f.run, { ...f.args, planRevision: 2 }, f.candidates), /INVALID_STEP_BINDING|STEP_BINDING_STALE/);
});

test('Replacement of reused candidate ID discards old association; unbound drafts never auto-match by kind', () => {
    const f = fixture(); f.observe(); f.store.bindCandidate(f.run, f.args, f.candidates);
    f.observe(f.candidate, 'replacement');
    f.store.publishBindings(f.run, new Map([[f.candidate.candidateId, f.artifact]])); f.store.observeAction(f.action, f.artifact);
    assert.equal(f.frame().actionEvidence.operations[0].stepMapping, 'unmapped');
});

test('Unpublished, wrong-kind/owner artifacts cannot turn candidate association into execution linkage', () => {
    for (const patch of [{ kind: 'variable-draft' }, { sessionId: 'other' }, { taskId: 'other' }, { sourceRunId: 'foreign' }]) {
        const f = fixture(); f.observe(); f.store.bindCandidate(f.run, f.args, f.candidates);
        f.store.publishBindings(f.run, new Map([[f.candidate.candidateId, { ...f.artifact, ...patch }]]));
        f.store.observeAction(f.action, f.artifact);
        assert.equal(f.frame().actionEvidence.operations[0].stepMapping, 'unmapped');
    }
});

test('Revised/deleted draft or replaced plan invalidates linkage, retains original historical result without completing step', () => {
    const f = fixture(); f.observe(); f.store.bindCandidate(f.run, f.args, f.candidates);
    f.store.publishBindings(f.run, new Map([[f.candidate.candidateId, f.artifact]])); f.store.observeAction(f.action, f.artifact);
    f.store.retainArtifacts([f.plan, { ...f.artifact, revision: 2 }]);
    const action = { ...f.action, status: 'outcome_unknown' };
    f.store.observeAction(action, null, { operationId: action.id, artifactId: f.artifact.id, revision: 1, at: 10, status: 'outcome_unknown', diff: [], saveError: false, changed: false });
    assert.equal(f.frame().actionEvidence.operations[0].stepReference.referenceState, 'stale');
    assert.equal(f.frame().actionEvidence.operations[0].executionResult, 'unknown');
    f.store.clear(); assert.deepEqual(f.port.project(), []);
});

test('Mixed bundle can explicitly reference multiple write steps; receipt substeps are not guessed onto proposal steps', () => {
    const f = fixture(), candidate = { toolId: 'muyu.task.preview', candidateId: 'bundle:1' }; f.observe(candidate);
    f.store.bindCandidate(f.run, { ...f.args, candidateId: candidate.candidateId, stepIds: [f.steps[0].id, f.steps[2].id] }, new Map([['bundle', candidate]]));
    const artifact = { ...f.artifact, kind: 'task-bundle' };
    f.store.publishBindings(f.run, new Map([[candidate.candidateId, artifact]])); f.store.observeAction(f.action, artifact);
    assert.equal(f.frame().actionEvidence.operations[0].stepReference.stepIds.length, 2);
    assert.equal(f.frame().taskState.plan.steps[2].status, 'not-assessed');
});

test('Repeated observation cannot erase a binding, and later ambiguous candidate publication cannot misattach it', () => {
    const f = fixture(); f.observe(); f.store.bindCandidate(f.run, f.args, f.candidates); f.observe();
    const ambiguous = new Map([...f.candidates, ['other', { toolId: 'muyu.settings.preview', candidateId: f.candidate.candidateId }]]);
    f.store.publishBindings(f.run, new Map([[f.candidate.candidateId, f.artifact]]), ambiguous);
    f.store.observeAction(f.action, f.artifact); assert.equal(f.frame().actionEvidence.operations[0].stepMapping, 'unmapped');
    const g = fixture(); g.observe(); g.store.bindCandidate(g.run, g.args, g.candidates); g.observe();
    g.store.publishBindings(g.run, new Map([[g.candidate.candidateId, g.artifact]]), g.candidates);
    g.store.observeAction(g.action, g.artifact); assert.equal(g.frame().actionEvidence.operations[0].stepMapping, 'explicit-model-proposal');
});

test('Candidate association has an explicit capacity bound and cannot be moved to a new task', () => {
    const f = fixture();
    for (let i = 0; i < 33; i++) {
        const candidate = { toolId: 'muyu.settings.preview', candidateId: 'draft:' + i }; f.observe(candidate, 'observe' + i);
        const bind = () => f.store.bindCandidate(f.run, { ...f.args, candidateId: candidate.candidateId }, new Map([['only', candidate]]));
        if (i < 32) assert.equal(bind().bound, true); else assert.throws(bind, /CAPACITY/);
    }
    const run = { ...f.run, taskId: 'other' }; f.store.begin(run);
    assert.throws(() => f.store.bindCandidate(run, f.args, f.candidates), /INVALID_STEP_BINDING/);
});

test('Observation exhaustion clears bindings so a later reused candidate cannot inherit old association', () => {
    const f = fixture();
    for (let i = 0; i < 128; i++) f.observe(f.candidate, 'observe' + i);
    f.store.bindCandidate(f.run, f.args, f.candidates);
    f.observe(f.candidate, 'replacement-at-capacity');
    assert.throws(() => f.store.bindCandidate(f.run, f.args, f.candidates), /INVALID_STEP_BINDING/);
    f.store.publishBindings(f.run, new Map([[f.candidate.candidateId, f.artifact]]), f.candidates); f.store.observeAction(f.action, f.artifact);
    assert.equal(f.frame().actionEvidence.operations[0].stepMapping, 'unmapped');
});

function bundleFixture() {
    const f = fixture(), candidate = { toolId: 'muyu.task.preview', candidateId: 'bundle:exact' };
    const steps = ['variable', 'settings'].map((kind, index) => ({ id: candidate.candidateId + ':step:' + (index + 1), kind, displayIndex: index + 1 }));
    f.port.observe({ toolId: candidate.toolId, callId: 'bundle-preview', args: {} }, { ok: true, data: { candidateId: candidate.candidateId, steps } }, f.run.id);
    const args = { ...f.args, candidateId: candidate.candidateId, stepIds: [f.steps[2].id, f.steps[0].id],
        bundleSteps: [{ bundleStepId: steps[0].id, stepId: f.steps[2].id }, { bundleStepId: steps[1].id, stepId: f.steps[0].id }] };
    const artifact = { ...f.artifact, kind: 'task-bundle', content: { module: 'task-bundle', version: 1, variables: [{ preview: { id: 'coins' } }], settings: {} } };
    const action = { ...f.action, content: artifact.content };
    const candidates = new Map([['bundle', candidate]]);
    const publish = () => { f.store.bindCandidate(f.run, args, candidates); f.store.publishBindings(f.run, new Map([[candidate.candidateId, artifact]]), candidates); f.store.observeAction(action, artifact); };
    const receipt = { version: 4, operationId: action.id, artifactId: artifact.id, revision: 1, at: 10, status: 'partial', steps: [
        { kind: 'variable', id: 'coins', status: 'applied_confirmed', chatSave: 'confirmed', settingsSave: 'not_started', diff: [], saveError: false, changed: false },
        { kind: 'settings', id: 'global-settings', status: 'applied_unconfirmed', chatSave: 'not_started', settingsSave: 'unconfirmed', diff: [], saveError: false, changed: false },
    ] };
    return { ...f, candidate, args, artifact, action, candidates, publish, receipt };
}

test('Wrong bundle kind is explained without recording a binding; corrected exact mapping still works', () => {
    const f = bundleFixture();
    const module = createTaskPlanModule({ bindStep: args => f.store.bindCandidate(f.run, args, f.candidates) });
    module.bindRun({ id: f.run.id, taskId: f.run.taskId, target: f.run.target });
    const wrong = { ...f.args, bundleSteps: f.args.bundleSteps.map(row => ({ ...row, stepId: f.steps[0].id })) };
    const result = module.handlers['muyu.task.bind_step'](wrong, { runId: f.run.id, target: f.run.target });
    assert.equal(result.bound, false);
    assert.match(result.notice, /same operation kind/);
    f.store.publishBindings(f.run, new Map([[f.candidate.candidateId, f.artifact]]), f.candidates);
    f.store.observeAction(f.action, f.artifact);
    assert.equal(f.frame().actionEvidence.operations[0].stepMapping, 'unmapped');
    assert.equal(module.handlers['muyu.task.bind_step'](f.args, { runId: f.run.id, target: f.run.target }).bound, true);
    assert.ok(f.frame().taskState.plan.steps.every(step => step.status === 'not-assessed'));
    module.dispose();
});

test('Exact bundle IDs associate only verified receipt layout; partial persistence never completes proposed steps', () => {
    const f = bundleFixture(); f.publish();
    f.store.observeAction({ ...f.action, status: 'partial' }, f.artifact, f.receipt);
    const op = f.frame().actionEvidence.operations[0];
    assert.equal(op.executionResult, 'partial');
    assert.deepEqual(op.executedSteps.map(row => row.proposalStepId), [f.steps[2].id, f.steps[0].id]);
    assert.deepEqual(op.executedSteps.map(row => row.status), ['applied_confirmed', 'applied_unconfirmed']);
    assert.ok(op.executedSteps.every(row => row.intentVerification === 'not-assessed'));
    assert.ok(f.frame().taskState.plan.steps.every(row => row.status === 'not-assessed'));
    assert.doesNotMatch(JSON.stringify(op), /coins|global-settings/);
    f.store.retainArtifacts([f.plan]);
    assert.ok(f.frame().actionEvidence.operations[0].executedSteps.every(row => row.referenceState === 'stale'));
});

test('Forged, wrong-kind, duplicate and out-of-scope bundle mappings fail closed', () => {
    const f = bundleFixture();
    for (const bundleSteps of [
        [{ bundleStepId: 'forged', stepId: f.steps[2].id }],
        [{ bundleStepId: f.args.bundleSteps[0].bundleStepId, stepId: f.steps[0].id }],
        [f.args.bundleSteps[0], f.args.bundleSteps[0]],
        [{ bundleStepId: f.args.bundleSteps[1].bundleStepId, stepId: f.steps[1].id }],
    ]) assert.throws(() => f.store.bindCandidate(f.run, { ...f.args, bundleSteps }, f.candidates), /INVALID_BUNDLE_STEP/);
});

test('Mismatched publication layout cannot associate, mismatched receipt source IDs cannot project substeps', () => {
    const f = bundleFixture(); f.artifact.content.variables = []; f.publish();
    assert.equal(f.frame().actionEvidence.operations[0].stepMapping, 'unmapped');
    const g = bundleFixture(); g.publish(); g.receipt.steps[0].id = 'other_variable';
    g.store.observeAction({ ...g.action, status: 'partial' }, g.artifact, g.receipt);
    const op = g.frame().actionEvidence.operations[0];
    assert.equal(op.substepEvidence, 'layout-mismatch'); assert.equal(op.executedSteps, undefined);
});

test('Unmapped bundle children remain unmapped even when the whole draft references several plan steps', () => {
    const f = bundleFixture(); f.args.bundleSteps.pop(); f.publish();
    f.store.observeAction({ ...f.action, status: 'partial' }, f.artifact, f.receipt);
    const children = f.frame().actionEvidence.operations[0].executedSteps;
    assert.equal(children[0].proposalStepId, f.steps[2].id); assert.equal(children[1].proposalStepId, undefined);
});

test('V9 script receipt binds by canonical private definition identity, not script name or model text', () => {
    const f = fixture(['code']), candidate = { toolId: 'muyu.task.preview', candidateId: 'bundle:script' };
    f.port.observe({ toolId: candidate.toolId, callId: 'script-preview', args: {} }, { ok: true, data: { candidateId: candidate.candidateId,
        steps: [{ id: candidate.candidateId + ':step:1', kind: 'script', displayIndex: 1 }] } }, f.run.id);
    const candidates = new Map([['script', candidate]]);
    f.store.bindCandidate(f.run, { ...f.args, candidateId: candidate.candidateId,
        bundleSteps: [{ bundleStepId: candidate.candidateId + ':step:1', stepId: f.steps[0].id }] }, candidates);
    const artifact = { ...f.artifact, kind: 'task-bundle', content: { module: 'task-bundle', version: 2, variables: [], scripts: [{ id: 'private-script', operation: 'update' }] } };
    const action = { ...f.action, content: artifact.content };
    f.store.publishBindings(f.run, new Map([[candidate.candidateId, artifact]]), candidates); f.store.observeAction(action, artifact);
    f.store.observeAction({ ...action, status: 'applied_unconfirmed' }, artifact, { version: 9, operationId: action.id,
        artifactId: artifact.id, revision: 1, at: 10, status: 'applied_unconfirmed', steps: [{ kind: 'script', id: 'private-script',
            status: 'applied_unconfirmed', chatSave: 'not_started', settingsSave: 'unconfirmed', saveError: false, changed: false, diff: [],
            script: { name: 'PRIVATE_SCRIPT_NAME', scriptId: 'private-script', operation: 'update', persistence: 'unconfirmed' } }] });
    const op = f.frame().actionEvidence.operations[0];
    assert.equal(op.executedSteps[0].proposalStepId, f.steps[0].id);
    assert.equal(op.executionResult, 'persistence-unconfirmed');
    assert.doesNotMatch(JSON.stringify(op), /private-script|PRIVATE_SCRIPT_NAME/);
    assert.equal(f.frame().taskState.plan.steps[0].status, 'not-assessed');
});
