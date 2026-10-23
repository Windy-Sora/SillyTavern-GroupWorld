import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../../muyu/application/service.js';
import { createWorkspace } from '../../muyu/workspace/store.js';
import { startMuyuRun } from '../../muyu/composition.js';
import { createClock, flush, deferred, registry, done, text, scriptedModel } from './helpers/muyu-subject.mjs';

const A = { kind: 'chat', userKey: 'u', chatKey: 'A' }, B = { ...A, chatKey: 'B' }, G = { kind: 'global', userKey: 'u' };
function fake(options = {}) {
    const started = [];
    const app = createApplication({ currentTarget: A, startRun: input => {
        const completion = deferred(), drained = deferred();
        const item = { input, completion, drained, cancelled: false }; started.push(item);
        return { completion: completion.promise, drained: drained.promise, cancel: () => { item.cancelled = true; } };
    }, ...options });
    return { app, started };
}
async function finish(item, status = 'succeeded') { item.completion.resolve({ state: { status }, answer: 'answer' }); item.drained.resolve(); await flush(); }

test('Answer completion records display time on the live run, not the persisted message contract', async () => {
    const { app, started } = fake(), sessionId = app.createSession(A), before = Date.now();
    const submission = app.submit(sessionId, 'question'); await flush();
    assert.equal(app.snapshot().runs[0].answeredAt, undefined);
    await finish(started[0]); const snapshot = app.snapshot(), run = snapshot.runs.find(row => row.id === submission.runId);
    assert.ok(Number.isSafeInteger(run.answeredAt)); assert.ok(run.answeredAt >= before && run.answeredAt <= Date.now());
    assert.deepEqual(Object.keys(snapshot.sessions[0].messages.at(-1)).sort(), ['content', 'role', 'runId']); app.dispose();
});

test('Application serializes sessions and does not automatically complete tasks', async () => {
    const { app, started } = fake(); const a = app.createSession(A), g = app.createSession(G);
    const first = app.submit(a, 'goal', ['do not write']); app.submit(g, 'next');
    assert.throws(() => app.submit(a, 'duplicate'), /SESSION_BUSY/); assert.equal(started.length, 0);
    await flush(); assert.equal(started.length, 1); await finish(started[0]); assert.equal(started.length, 2);
    assert.equal(app.snapshot().tasks.find(t => t.id === first.taskId).status, 'awaiting_acceptance');
    app.completeTask(first.taskId); assert.throws(() => app.continueTask(first.taskId, 'again'), /TASK_COMPLETED/);
    await finish(started[1]); app.dispose();
});
test('Application rejects full queues without leaking tasks and cancels queued runs', async () => {
    const { app, started } = fake({ maxQueue: 1 }); const a = app.createSession(A), g = app.createSession(G), h = app.createSession(G);
    app.submit(a, 'a'); await flush(); const queued = app.submit(g, 'g');
    assert.throws(() => app.submit(h, 'h'), /QUEUE_FULL/); assert.equal(app.snapshot().tasks.length, 2);
    app.cancel(queued.runId); await finish(started[0]); assert.equal(started.length, 1); app.dispose();
});
test('Application holds physical lease after logical cancellation until drained', async () => {
    const { app, started } = fake(); const a = app.createSession(A), g = app.createSession(G);
    const r = app.submit(a, 'a'); app.submit(g, 'g'); await flush(); app.cancel(r.runId);
    started[0].completion.resolve({ state: { status: 'cancelled' }, answer: null }); await flush();
    assert.equal(app.snapshot().draining, true); assert.equal(started.length, 1);
    assert.throws(() => app.submit(a, 'retry'), /SESSION_BUSY/);
    started[0].drained.resolve(); await flush(); assert.equal(started.length, 2); await finish(started[1]); app.dispose();
});
test('Chat switch cancels old queued/active tasks but preserves global targets', async () => {
    const { app, started } = fake(); const a = app.createSession(A), a2 = app.createSession(A), global = app.createSession(G), b = app.createSession(B);
    app.submit(a, 'a'); app.submit(a2, 'queued A'); app.submit(global, 'global'); await flush();
    app.changeTarget(B); assert.equal(started[0].cancelled, true); app.submit(b, 'B');
    await finish(started[0]); assert.equal(started[1].input.identity.target.kind, 'global');
    assert.equal(app.snapshot().sessions.find(s => s.id === a).messages.length, 1);
    await finish(started[1]); assert.deepEqual(started[2].input.identity.target, B); await finish(started[2]); app.dispose();
});
test('Invalid queued target does not start and factory failure advances queue', async () => {
    let calls = 0; const { app } = fake({ startRun: () => { calls++; throw new Error('secret'); } });
    app.submit(app.createSession(B), 'invalid'); app.submit(app.createSession(G), 'throws'); await flush();
    assert.equal(calls, 1); assert.equal(app.snapshot().runs[0].error, 'TARGET_UNAVAILABLE'); assert.equal(app.snapshot().runs[1].error, 'START_FAILED'); app.dispose();
});
test('Snapshot subscription has no gap, isolates listeners and supports unmount/remount', async () => {
    const { app, started } = fake(); const a = app.createSession(A), seen = [];
    const sub = app.subscribe(e => seen.push(e.cursor)); app.subscribe(() => { throw new Error('view'); });
    app.submit(a, 'a'); await flush(); assert.ok(seen.every(c => c > sub.cursor)); assert.equal(new Set(seen).size, seen.length);
    sub.unsubscribe(); const count = seen.length; await finish(started[0]); assert.equal(count, seen.length);
    const remount = app.subscribe(() => {}); assert.equal(remount.snapshot.runs[0].status, 'succeeded'); remount.snapshot.sessions[0].target.chatKey = 'tamper';
    assert.equal(app.snapshot().sessions[0].target.chatKey, 'A'); remount.unsubscribe(); app.dispose();
});
test('Continue retains constraints and conversation; new Run does not close task', async () => {
    const { app, started } = fake(); const sid = app.createSession(A); const { taskId } = app.submit(sid, 'original', ['read only']); await flush(); await finish(started[0]);
    app.continueTask(taskId, 'followup'); await flush();
    assert.deepEqual(started[1].input.taskContext, { goal: 'original', constraints: ['read only'] });
    assert.deepEqual(started[1].input.previousMessages.map(m => m.content), ['original', 'answer']); await finish(started[1]); app.dispose();
});
test('Artifact versions invalidate validation and reject stale edits/cross-task sources', async () => {
    const { app, started } = fake(); const sid = app.createSession(A); const { taskId, runId } = app.submit(sid, 'draft'); await flush(); await finish(started[0]);
    const a = app.createArtifact({ taskId, sourceRunId: runId, kind: 'config-draft', content: { enabled: true } });
    app.validateArtifact(a.id, 1, { ok: true }); const changed = app.updateArtifact(a.id, 1, { enabled: false });
    assert.equal(changed.revision, 2); assert.equal(changed.validation, null); assert.equal(app.getArtifact(a.id, 1).validation.ok, true);
    assert.throws(() => app.validateArtifact(a.id, 1, { ok: true }), /STALE/);
    changed.content.enabled = true; assert.equal(app.getArtifact(a.id).content.enabled, false);
    assert.throws(() => app.createArtifact({ taskId, sourceRunId: 'wrong', kind: 'report', content: 'x' }), /SOURCE/);
    app.deleteArtifact(a.id); assert.throws(() => app.getArtifact(a.id)); app.dispose();
});
test('Workspace count/version/byte limits fail atomically and deletion frees capacity', () => {
    const w = createWorkspace({ maxArtifacts: 1, maxVersions: 2, maxBytes: 600 });
    const a = { id: 'a', sessionId: 's', taskId: 't', kind: 'report', content: 'short' }; w.create(a);
    assert.throws(() => w.create({ ...a, id: 'b' }), /FULL/); assert.throws(() => w.update('a', 1, 'x'.repeat(600)), /FULL/); assert.equal(w.get('a').revision, 1);
    w.update('a', 1, 'next'); assert.throws(() => w.update('a', 2, 'third'), /FULL/); w.delete('a'); w.create({ ...a, id: 'b' }); assert.equal(w.list().length, 1);
});
test('Session close and application disposal reject late updates and are safe to clean up', async () => {
    const { app, started } = fake(); const sid = app.createSession(A); const { taskId } = app.submit(sid, 'a'); await flush(); app.closeSession(sid);
    assert.throws(() => app.createArtifact({ taskId, kind: 'report', content: 'late' }), /CLOSED/);
    await finish(started[0]); assert.equal(app.snapshot().sessions[0].messages.length, 1);
    app.dispose(); app.dispose(); assert.throws(() => app.createSession(A), /DISPOSED/);
});
test('Real runtime drain blocks queued work until non-cooperative iterator settles', async () => {
    const clock = createClock(), wait = deferred(); let starts = 0;
    const model = scriptedModel([() => wait.promise, [text('second'), done]]);
    const app = createApplication({ currentTarget: A, startRun: input => { starts++; return startMuyuRun({ ...input, model, registry: registry(), clock }); } });
    const a = app.createSession(A), g = app.createSession(G); const r = app.submit(a, 'a'); app.submit(g, 'g'); await flush();
    app.cancel(r.runId); await flush(); assert.equal(starts, 1); assert.equal(app.snapshot().draining, true);
    wait.resolve([text('late'), done]); await flush(); await flush(); assert.equal(starts, 2); assert.equal(app.snapshot().runs[1].status, 'succeeded'); assert.equal(clock.pending, 0); app.dispose();
});

test('Rejected drain cannot release the queue even after completion', async () => {
    const { app, started } = fake(); app.submit(app.createSession(A), 'a'); app.submit(app.createSession(G), 'g'); await flush();
    started[0].completion.resolve({ state: { status: 'succeeded' }, answer: 'done' }); started[0].drained.reject(new Error('unknown'));
    await flush(); assert.equal(started.length, 1); assert.equal(app.snapshot().draining, true); app.dispose();
});

test('Disposal removes subscribers and queued work without admitting late results', async () => {
    const { app, started } = fake(); app.submit(app.createSession(A), 'a'); app.submit(app.createSession(G), 'g'); await flush();
    let updates = 0; app.subscribe(() => updates++); app.dispose(); await finish(started[0]);
    assert.equal(updates, 0); assert.equal(started.length, 1); assert.ok(app.snapshot().sessions.every(s => s.messages.length === 1));
});

test('Closed sessions keep artifacts readable but reject edits', async () => {
    const { app, started } = fake(); const sid = app.createSession(A), { taskId } = app.submit(sid, 'a'); await flush(); await finish(started[0]);
    const a = app.createArtifact({ taskId, kind: 'report', content: 'saved' }); app.closeSession(sid);
    assert.equal(app.getArtifact(a.id).content, 'saved'); assert.throws(() => app.updateArtifact(a.id, 1, 'late'), /CLOSED/); app.dispose();
});
