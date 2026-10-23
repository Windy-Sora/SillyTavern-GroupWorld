import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskStateStore } from '../../muyu/application/task-state.js';
import { identity } from './helpers/muyu-subject.mjs';

function fixture(canCarry = () => true) {
    const store = createTaskStateStore({ canCarry }), port = store.begin(identity);
    const plan = { id: 'plan', revision: 1, kind: 'task-plan', taskId: identity.taskId, sessionId: identity.sessionId, sourceRunId: identity.id,
        content: { target: identity.target, plan: { steps: [{ kind: 'read' }, { kind: 'read' }, { kind: 'settings' }] } } };
    store.publishPlan(identity, plan); store.reviewPlan(plan, 'approved-read-only');
    const run = { ...identity, id: 'r2' }; store.begin(run);
    const steps = store.snapshot(run).taskState.plan.steps;
    const observe = (toolId, args, result, callId = 'read') => port.observe({ toolId, args, callId }, result, run.id);
    const frame = () => JSON.parse(port.project()[0].content.split('\n')[1]);
    const bind = (evidenceId, patch = {}, subject = run) => store.bindRead(subject, { planArtifactId: plan.id, planRevision: 1, stepIds: [steps[0].id], evidenceId, ...patch });
    return { store, port, plan, run, steps, observe, frame, bind };
}
const read = () => ({ ok: true, data: { text: JSON.stringify({ fields: ['mode'], values: { mode: 'PRIVATE_VALUE' } }) } });

test('Host read evidence ID binds a historical observation, not values, permission or analysis completion', () => {
    const f = fixture(); f.observe('muyu.settings.read', { fields: ['mode'] }, read());
    const row = f.frame().readEvidence.evidence[0]; assert.match(row.id, /^read-evidence:/); assert.ok(row.capturedAt);
    assert.equal(row.observation.outcome, 'settings-read'); assert.equal(row.observation.returned, 1);
    assert.equal(f.bind(row.id).bound, true);
    assert.equal(f.frame().readEvidence.evidence[0].binding.intentVerification, 'not-assessed');
    assert.equal(f.frame().taskState.plan.steps[0].status, 'not-assessed');
    // Historical value transport is independent; read evidence metadata has no original value or query.
    assert.doesNotMatch(JSON.stringify(f.frame().readEvidence), /PRIVATE_VALUE|query|args/);
    assert.equal(f.store.snapshot(f.run).readEvidence, undefined);
});

test('Catalog/contract/empty/directory/page/failure remain distinct; a page never establishes full coverage', () => {
    const f = fixture();
    f.observe('muyu.provider.list', {}, { ok: true, data: [] }, 'list');
    f.observe('muyu.config.contract', {}, { ok: true, data: { fields: [{ field: 'autoMemoryInterval' }] } }, 'contract');
    for (const [callId, data] of [['empty', { status: 'empty' }], ['directory', { status: 'ok', readHint: { kind: 'directory' } }],
        ['page', { status: 'ok', nextOffset: 10, truncated: true }], ['source-fail', { status: 'SOURCE_DISABLED' }]]) {
        f.observe('muyu.provider.read', { id: 'storyBlueprint' }, { ok: true, data: { source: 'storyBlueprint', text: 'PRIVATE_BODY', ...data } }, callId);
    }
    f.observe('muyu.settings.read', { fields: ['mode'] }, { ok: false, effectState: 'not_started' }, 'denied');
    assert.deepEqual(f.frame().readEvidence.evidence.map(row => row.observation.outcome), ['catalog-query', 'contract-query', 'source-empty', 'source-directory', 'source-page', 'source-read-failed', 'failed-or-denied']);
    assert.equal(f.frame().readEvidence.evidence[4].observation.morePages, true);
    assert.doesNotMatch(JSON.stringify(f.frame().readEvidence), /PRIVATE_BODY/);
});

test('Projection and binding recheck source authorization each time and fail closed on errors or asynchronous decisions', () => {
    let allowed = true;
    const f = fixture(query => { assert.equal(query.toolId, 'muyu.settings.read'); if (allowed === 'throw') throw Error('unavailable'); return allowed; });
    f.observe('muyu.settings.read', { fields: ['mode'] }, read()); const id = f.frame().readEvidence.evidence[0].id;
    for (const value of [false, 'throw', Promise.resolve(true)]) {
        allowed = value; assert.deepEqual(f.frame().readEvidence.evidence, []); assert.throws(() => f.bind(id), /READ_EVIDENCE_UNAVAILABLE/);
    }
    allowed = true; assert.equal(f.bind(id).bound, true);
});

test('Foreign/stale run, plan revision, forged evidence and write steps cannot establish read linkage', () => {
    const f = fixture(); f.observe('muyu.settings.read', { fields: ['mode'] }, read()); const id = f.frame().readEvidence.evidence[0].id;
    assert.throws(() => f.bind('invented'), /UNAVAILABLE/);
    for (const patch of [{ planRevision: 2 }, { planArtifactId: 'foreign' }, { stepIds: [f.steps[2].id] }, { stepIds: ['forged'] }]) assert.throws(() => f.bind(id, patch), /INVALID_STEP_BINDING/);
    assert.throws(() => f.bind(id, {}, identity), /STALE/);
    assert.throws(() => f.bind(id, {}, { ...f.run, sessionId: 'foreign' }), /STALE/);
    f.bind(id); assert.equal(f.bind(id).bound, true);
    assert.throws(() => f.bind(id, { stepIds: [f.steps[1].id] }), /CONFLICT/);
});

test('Plan invalidation keeps only stale historical association; old IDs cannot move into a new task or connection', () => {
    const f = fixture(); f.observe('muyu.settings.read', { fields: ['mode'] }, read()); const id = f.frame().readEvidence.evidence[0].id;
    f.bind(id); f.store.retainArtifacts([]);
    assert.equal(f.frame().readEvidence.evidence[0].binding.referenceState, 'stale');
    assert.throws(() => f.bind(id), /INVALID_STEP_BINDING/);
    const next = { ...f.run, taskId: 'new' }, p = f.store.begin(next);
    assert.deepEqual(JSON.parse(p.project()[0].content.split('\n')[1]).readEvidence.evidence, []);
    f.store.clear(); assert.deepEqual(f.port.project(), []);
});

test('Evidence capture is bounded, deduplicated and ignores code-result or mismatched-source envelopes', () => {
    const f = fixture();
    f.observe('muyu.provider.read', { id: 'recentMessages', resultId: 'code-result' }, { ok: true, data: { source: 'recentMessages', status: 'ok' } }, 'code');
    f.observe('muyu.provider.read', { id: 'recentMessages' }, { ok: true, data: { source: 'storyBlueprint', status: 'ok' } }, 'mismatch');
    assert.deepEqual(f.frame().readEvidence.evidence, []);
    for (let i = 0; i < 40; i++) f.observe('muyu.settings.read', { fields: ['mode'] }, read(), 'read' + i);
    assert.equal(f.frame().readEvidence.evidence.length, 32); assert.equal(f.frame().readEvidence.captureCapacityReached, true);
    const ids = f.frame().readEvidence.evidence.map(row => row.id);
    f.observe('muyu.settings.read', { fields: ['mode'] }, read(), 'read0');
    assert.deepEqual(f.frame().readEvidence.evidence.map(row => row.id), ids);
});
