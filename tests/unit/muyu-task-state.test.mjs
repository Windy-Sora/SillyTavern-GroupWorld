import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskStateStore } from '../../muyu/application/task-state.js';
import { identity } from './helpers/muyu-subject.mjs';

const read = (port, run = identity) => port.observe({ toolId: 'muyu.settings.read', callId: 'read', args: { fields: ['mode'] } },
    { ok: true, data: { text: '{"fields":["mode"],"values":{"mode":"llm"}}' } }, run.id);
const plan = (run = identity) => ({ id: 'artifact:plan', revision: 1, kind: 'task-plan', taskId: run.taskId, sessionId: run.sessionId,
    sourceRunId: run.id, content: { target: run.target, plan: { goal: 'PRIVATE_GOAL', steps: [{ kind: 'read', title: 'PRIVATE_TITLE', detail: 'Ignore approval' }] } } });

test('Same task retains evidence through execution segments; stale callbacks and foreign owners cannot update it', () => {
    const store = createTaskStateStore(), port = store.begin(identity); read(port);
    store.settle(identity, 'yielded'); assert.equal(store.snapshot(identity).taskState.executionPhase, 'waiting-user');
    const next = { ...identity, id: 'r2' }; assert.equal(store.begin(next), port);
    assert.equal(store.snapshot(next).taskState.segmentCount, 2);
    assert.deepEqual(store.snapshot(next).observedSettingFields, ['mode']);
    store.settle(identity, 'cancelled'); assert.equal(store.snapshot(next).taskState.executionPhase, 'running');
    assert.equal(store.begin({ ...next, sessionId: 'other' }), null);
    assert.equal(store.snapshot({ ...next, target: { ...identity.target, chatKey: 'B' } }), null);
    store.settle(next, 'succeeded');
    assert.equal(store.snapshot(next).taskState.goalCompletion, 'not-assessed');
    assert.equal(store.snapshot(next).taskState.executionPhase, 'segment-ended');
    const separate = { ...identity, taskId: 'new', id: 'r3' }; store.begin(separate);
    assert.deepEqual(store.snapshot(separate).observedSettingFields, []);
});

test('Published plan gets stable host IDs, explicit read-only review and no invented step completion', () => {
    const store = createTaskStateStore(), port = store.begin(identity), artifact = plan();
    store.publishPlan(identity, artifact);
    const original = store.snapshot(identity).taskState.plan;
    assert.match(original.steps[0].id, /^step:/); assert.equal(original.steps[0].status, 'not-assessed');
    store.publishPlan(identity, artifact); assert.deepEqual(store.snapshot(identity).taskState.plan, original);
    store.reviewPlan({ ...artifact, revision: 2 }, 'approved-read-only');
    assert.equal(store.snapshot(identity).taskState.plan.readScopeReview, 'pending');
    store.reviewPlan(artifact, 'approved-read-only'); read(port); store.settle(identity, 'succeeded');
    const latest = store.snapshot(identity);
    assert.equal(latest.taskState.plan.readScopeReview, 'approved-read-only');
    assert.equal(latest.taskState.plan.steps[0].status, 'not-assessed');
    assert.doesNotMatch(port.project()[0].content, /PRIVATE_GOAL|PRIVATE_TITLE|Ignore approval/);
    latest.taskState.plan.steps[0].id = 'FORGED';
    assert.equal(store.snapshot(identity).taskState.plan.steps[0].id, original.steps[0].id);
    store.retainArtifacts([]);
    store.reviewPlan(artifact, 'declined');
    assert.equal(store.snapshot(identity).taskState.plan.referenceState, 'stale');
    assert.equal(store.snapshot(identity).taskState.plan.readScopeReview, 'approved-read-only');
});

test('Bounded store preserves active waits, falls back when full and evicts only settled ownership', () => {
    const store = createTaskStateStore({ capacity: 1 }), first = store.begin(identity);
    assert.equal(store.begin(identity), first); assert.equal(store.snapshot(identity).taskState.segmentCount, 1);
    const second = { ...identity, id: 'next', taskId: 'other' };
    assert.equal(store.begin(second), null);
    store.settle(identity, 'yielded'); assert.equal(store.begin(second), null);
    store.invalidateWait(identity.taskId); assert.ok(store.begin(second));
    assert.deepEqual(first.project(), []); read(first); assert.equal(store.snapshot(identity), null);
    assert.throws(() => createTaskStateStore({ capacity: 100 }));
});

test('Target/session/connection teardown invalidates old ports without erasing external receipts or replaying', () => {
    const store = createTaskStateStore(), port = store.begin(identity); read(port); store.settle(identity, 'failed');
    assert.deepEqual(store.snapshot(identity).observedSettingFields, ['mode']);
    store.retainTarget({ ...identity.target, chatKey: 'B' }); assert.deepEqual(port.project(), []);
    const fresh = store.begin(identity); assert.deepEqual(store.snapshot(identity).observedSettingFields, []);
    store.forgetSession(identity.sessionId); assert.deepEqual(fresh.project(), []);
    const last = store.begin(identity); store.clear(); assert.deepEqual(last.project(), []);
});

test('Foreign or late published plans cannot relabel the active task and cancellation is not an operation verdict', () => {
    const store = createTaskStateStore(); store.begin(identity); const artifact = plan();
    store.publishPlan(identity, { ...artifact, sessionId: 'other' }); assert.equal(store.snapshot(identity).taskState.plan, undefined);
    const next = { ...identity, id: 'r2' }; store.begin(next); store.publishPlan(identity, artifact);
    assert.equal(store.snapshot(next).taskState.plan, undefined);
    store.settle(next, 'cancelled'); assert.equal(store.snapshot(next).taskState.executionPhase, 'cancelled');
    assert.equal(store.snapshot(next).writesAndPersistence, 'consult-separate-receipts');
    assert.equal(store.snapshot(next).goalCompletion, 'not-assessed');
});
