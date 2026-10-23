import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskStateStore } from '../../muyu/application/task-state.js';
import { identity } from './helpers/muyu-subject.mjs';
import { createApprovedActions } from '../../muyu/actions/coordinator.js';
import { actionReceipt } from '../../muyu/actions/receipts.js';
import { deferred } from './helpers/muyu-subject.mjs';

const artifact = () => ({ id: 'a', revision: 1, taskId: identity.taskId, sessionId: identity.sessionId, sourceRunId: identity.id,
    kind: 'config-draft', content: { privateValue: 'NEVER_PROJECT' } });
const action = (a, status = 'pending', id = 'op') => ({ id, artifactId: a.id, revision: a.revision, sessionId: a.sessionId, target: identity.target, content: a.content, status });
const receipt = (status = 'applied_unconfirmed') => ({ operationId: 'op', artifactId: 'a', revision: 1, at: 100, status,
    diff: [{ field: 'autoMemoryInterval', before: '10', after: '15' }], saveError: false, changed: false });
const frame = p => JSON.parse(p.project()[0].content.split('\n')[1]);

test('Exact action ownership projects pending/running/receipt without completing proposed steps or exposing values', () => {
    const s = createTaskStateStore({ canCarryReceipt: () => true }), p = s.begin(identity), a = artifact();
    const plan = { ...a, id: 'plan', kind: 'task-plan', content: { target: identity.target, plan: { steps: [{ kind: 'settings' }] } } };
    s.publishPlan(identity, plan);
    s.observeAction(action(a), a);
    assert.equal(frame(p).actionEvidence.operations[0].executionResult, 'not-dispatched');
    s.observeAction(action(a, 'applying'), a); s.observeAction(action(a), a);
    assert.equal(frame(p).actionEvidence.operations[0].status, 'applying');
    s.observeAction(action(a, 'applied_unconfirmed'), a, receipt());
    const op = frame(p).actionEvidence.operations[0];
    assert.equal(op.executionResult, 'persistence-unconfirmed'); assert.equal(op.stepMapping, 'unmapped');
    assert.equal(op.planReference.artifactId, 'plan');
    assert.equal(frame(p).taskState.plan.steps[0].status, 'not-assessed');
    assert.doesNotMatch(p.project()[0].content, /NEVER_PROJECT|before|after|memoryConfig/);
    assert.equal(s.snapshot(identity).actionEvidence, undefined);
    s.observeAction(action(a, 'outcome_unknown'), a, receipt('outcome_unknown'));
    assert.equal(frame(p).actionEvidence.operations[0].status, 'applied_unconfirmed');
    s.publishPlan(identity, { ...plan, revision: 2 });
    assert.equal(frame(p).actionEvidence.operations[0].planReference.referenceState, 'stale');
});

test('Foreign artifacts, revisions, sessions, source runs and malformed receipts never establish outcomes', () => {
    const s = createTaskStateStore({ canCarryReceipt: () => true }), p = s.begin(identity), a = artifact();
    for (const bad of [{ ...a, taskId: 'other' }, { ...a, sessionId: 'other' }, { ...a, sourceRunId: 'foreign' }, { ...a, revision: 2 }]) s.observeAction(action(a), bad);
    assert.deepEqual(frame(p).actionEvidence.operations, []);
    s.observeAction(action(a, 'applied_confirmed'), a, { ...receipt('applied_confirmed'), operationId: 'foreign' });
    s.observeAction(action(a, 'applied_confirmed'), a, { ...receipt('applied_confirmed'), bogus: true });
    assert.deepEqual(frame(p).actionEvidence.operations, []);
});

test('Cancellation does not undo an applying action; revised/deleted artifacts keep only historical original receipt linkage', () => {
    const s = createTaskStateStore({ canCarryReceipt: () => true }), p = s.begin(identity), a = artifact();
    s.observeAction(action(a, 'applying'), a); s.settle(identity, 'cancelled');
    assert.equal(frame(p).actionEvidence.operations[0].status, 'applying');
    s.retainArtifacts([{ ...a, revision: 2 }]);
    s.observeAction(action(a, 'outcome_unknown'), { ...a, revision: 2 }, receipt('outcome_unknown'));
    const op = frame(p).actionEvidence.operations[0];
    assert.equal(op.artifactRevision, 1); assert.equal(op.referenceState, 'stale'); assert.equal(op.executionResult, 'unknown');
    assert.equal(frame(p).taskState.goalCompletion, 'not-assessed');
    s.clear(); s.observeAction(action(a, 'applied_confirmed'), null, receipt('applied_confirmed')); assert.deepEqual(p.project(), []);
});

test('Each terminal receipt projection rechecks permission and rejects non-true decisions', () => {
    let allowed = true;
    const s = createTaskStateStore({ canCarryReceipt: auth => { assert.deepEqual(auth.sources, ['source:memoryConfig']); return allowed; } }), p = s.begin(identity), a = artifact();
    s.observeAction(action(a, 'applied_unconfirmed'), a, receipt());
    assert.equal(frame(p).actionEvidence.operations.length, 1);
    allowed = false; assert.deepEqual(frame(p).actionEvidence.operations, []);
    allowed = Promise.resolve(true); assert.deepEqual(frame(p).actionEvidence.operations, []);
});

test('Actual bundle step identity comes from receipt position, remains separate from proposed steps, and keeps save uncertainty', () => {
    const s = createTaskStateStore({ canCarryReceipt: () => true }), p = s.begin(identity), a = { ...artifact(), kind: 'task-bundle' };
    const r = { version: 4, operationId: 'op', artifactId: 'a', revision: 1, at: 100, status: 'partial', steps: [
        { kind: 'variable', id: 'coins', status: 'applied_confirmed', chatSave: 'confirmed', settingsSave: 'not_started', saveError: false, changed: false, diff: [] },
        { kind: 'settings', id: 'global-settings', status: 'outcome_unknown', chatSave: 'not_started', settingsSave: 'error', saveError: true, changed: false, diff: [] },
    ] };
    s.observeAction(action(a, 'partial'), a, r);
    const op = frame(p).actionEvidence.operations[0];
    assert.equal(op.executionResult, 'partial'); assert.equal(op.executedSteps[0].id, 'op:step:1');
    assert.equal(op.executedSteps[1].settingsSave, 'error'); assert.equal(op.stepMapping, 'unmapped');
    assert.doesNotMatch(p.project()[0].content, /coins|global-settings/);
});

test('Operation capture is bounded and new Task does not inherit history', () => {
    const s = createTaskStateStore(), p = s.begin(identity), a = artifact();
    for (let i = 0; i < 40; i++) s.observeAction(action(a, 'pending', 'op' + i), a);
    assert.equal(frame(p).actionEvidence.operations.length, 32); assert.equal(frame(p).actionEvidence.omittedOperations, 8);
    const fresh = s.begin({ ...identity, id: 'r2', taskId: 'new' }); assert.deepEqual(frame(fresh).actionEvidence.operations, []);
});

test('Capacity eviction cannot discard a dispatched action even after its model segment ended', () => {
    const s = createTaskStateStore({ capacity: 1, canCarryReceipt: () => true }), p = s.begin(identity), a = artifact();
    s.observeAction(action(a, 'applying'), a); s.settle(identity, 'succeeded');
    const next = { ...identity, id: 'new-run', taskId: 'new' };
    assert.equal(s.begin(next), null);
    s.observeAction(action(a, 'outcome_unknown'), a, receipt('outcome_unknown'));
    assert.equal(frame(p).actionEvidence.operations[0].executionResult, 'unknown');
    assert.ok(s.begin(next)); assert.deepEqual(p.project(), []);
});

test('Production action coordinator notifications bind execution once, preserve unknown result after stop and never retry', async () => {
    const s = createTaskStateStore({ canCarryReceipt: () => true }), p = s.begin(identity), wait = deferred(); let writes = 0;
    const a = { ...artifact(), content: { module: 'memory-config', preview: { diff: [{ field: 'autoMemoryInterval', before: '10', after: '15' }] } } };
    let coordinator;
    coordinator = createApprovedActions({ getArtifact: () => a, getTarget: () => identity.target,
        contract: { idPrefix: 'apply:', validate() {}, matchesArtifact: () => true, notExecuted: () => false,
            execute: () => { writes++; return wait.promise; }, resultStatus: value => value.status },
        changed: () => { for (const row of coordinator.list()) s.observeAction(row, a, ['pending', 'applying'].includes(row.status) ? null : actionReceipt(row)); },
    });
    const prepared = coordinator.prepare(a.id, a.revision);
    assert.equal(frame(p).actionEvidence.operations[0].status, 'pending'); assert.equal(writes, 0);
    const running = coordinator.approve(prepared.id); await Promise.resolve();
    assert.equal(frame(p).actionEvidence.operations[0].status, 'applying');
    coordinator.invalidate(); s.settle(identity, 'cancelled');
    wait.resolve({ status: 'outcome_unknown' }); await running;
    assert.equal(frame(p).actionEvidence.operations[0].executionResult, 'unknown');
    assert.throws(() => coordinator.approve(prepared.id), /ACTION_STALE/);
    assert.equal(writes, 1);
});
