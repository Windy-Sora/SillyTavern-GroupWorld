import test from 'node:test';
import assert from 'node:assert/strict';
import { createInteractionModule } from '../../muyu/modules/interaction/index.js';
import { createInteractionStore } from '../../muyu/interactions/store.js';
import { validateQuestion, validateAnswer, CLARIFICATION_TOOL } from '../../muyu/interactions/contract.js';
import { startMuyuRun } from '../../muyu/composition.js';
import { createApplication } from '../../muyu/application/service.js';
import { identity, scriptedModel, request, text, done, createClock, flush, deferred } from './helpers/muyu-subject.mjs';

const question = { question: '你想调整哪个部分？', options: ['频率', '内容'] };
const call = args => request({ toolId: CLARIFICATION_TOOL, version: 1, callId: 'ask', args: args || question });
const settle = async () => { for (let n = 0; n < 12; n++) await flush(); };
function run(steps, extra = {}) {
    const module = createInteractionModule(), model = scriptedModel(steps), clock = createClock();
    const handle = startMuyuRun({ identity, input: '调整一下', model, clock, registry: module.registry, handlers: module.handlers, allowedTools: [CLARIFICATION_TOOL], policy: () => true, ...extra });
    return { handle, model, clock };
}
test('Clarification contracts reject empty, duplicate, oversized and extra authority fields', () => {
    assert.deepEqual(validateQuestion(question), question);
    for (const bad of [{ ...question, question: ' ' }, { ...question, options: ['x', 'x'] }, { ...question, options: [' '] }, { ...question, options: Array(4).fill('a') }, { ...question, grant: true }, { ...question, question: 'a'.repeat(601) }]) assert.throws(() => validateQuestion(bad));
    assert.throws(() => validateQuestion(JSON.parse('{"question":"x","options":[],"__proto__":{}}')));
    assert.throws(() => validateAnswer('')); assert.throws(() => validateAnswer('a'.repeat(2001)));
    assert.equal(validateAnswer('', true), '');
});
test('Requests are copied, consume once, preserve drafts and expire without restoring grants', () => {
    const store = createInteractionStore(), r = store.create(identity, question);
    r.options.push('tamper'); assert.equal(store.get(r.id).options.length, 2);
    store.draft(r.id, '内容'); assert.equal(store.get(r.id).draft, '内容');
    assert.throws(() => store.create(identity, question), /PENDING/);
    store.resolve(r.id, 'answered'); assert.throws(() => store.resolve(r.id, 'answered'), /STALE/);
    const next = store.create(identity, question); store.invalidate(() => true); assert.throws(() => store.get(next.id), /STALE/);
    store.forget(identity.sessionId); assert.equal(store.list().length, 0);
});
test('A validated solo control tool yields and drains, without waiting timers or extra model calls', async () => {
    const f = run([[call(), done]]); const result = await f.handle.completion; await f.handle.drained;
    assert.equal(result.state.status, 'yielded'); assert.deepEqual(result.interaction, question);
    assert.match(result.answer, /频率/); assert.equal(f.model.requests.length, 1); assert.equal(f.clock.pending, 0);
    f.clock.advance(1000000); assert.equal(f.handle.snapshot().status, 'yielded');
});
test('Mixed clarification batches dispatch nothing and ask the model to correct within its budget', async () => {
    let calls = 0;
    const f = run([[call(), request({ toolId: CLARIFICATION_TOOL, version: 1, callId: 'ask2', args: question }), done], [text('done'), done]], { handlers: { [CLARIFICATION_TOOL]: () => { calls++; return question; } } });
    const result = await f.handle.completion; await f.handle.drained;
    assert.equal(calls, 0); assert.equal(result.state.status, 'succeeded'); assert.equal(result.interaction, null);
    assert.equal(f.model.requests[1].messages.filter(m => m.role === 'tool' && m.result.error.code === 'INVALID_ARGUMENT').length, 2);
});
test('Denied tools and plain model text cannot create a pending request', async () => {
    const denied = run([[call(), done], [text('not permitted'), done]], { policy: () => false });
    assert.equal((await denied.handle.completion).interaction, null); await denied.handle.drained;
    const plain = run([[text(JSON.stringify(question)), done]]); assert.equal((await plain.handle.completion).interaction, null); await plain.handle.drained;
});
test('Application waits for physical drain, consumes the answer once and continues the same task', async () => {
    const drain = deferred(); let starts = 0; const options = [];
    const app = createApplication({ currentTarget: identity.target, startRun: input => {
        starts++; options.push(input);
        return starts === 1 ? { completion: Promise.resolve({ state: { status: 'yielded' }, answer: question.question, interaction: question }), drained: drain.promise, cancel() {} }
            : { completion: Promise.resolve({ state: { status: 'succeeded' }, answer: 'answered' }), drained: Promise.resolve(), cancel() {} };
    } });
    const session = app.createSession(identity.target), first = app.submit(session, 'goal'); await settle();
    const r = app.snapshot().interactions[0]; assert.equal(r.status, 'pending');
    assert.throws(() => app.answerInteraction(r.id, 'answer'), /SESSION_BUSY/);
    assert.equal(app.snapshot().interactions[0].status, 'pending');
    drain.resolve(); await settle(); assert.equal(app.snapshot().activeRunId, null);
    assert.throws(() => app.submit(session, 'bypass'), /PENDING/);
    const resumed = app.answerInteraction(r.id, '内容'); assert.equal(resumed.taskId, first.taskId);
    assert.throws(() => app.answerInteraction(r.id, 'double'), /STALE/); await settle();
    assert.equal(starts, 2); assert.equal(options[1].taskContext.goal, 'goal'); assert.match(options[1].taskContext.constraints[0], /内容/);
    app.dispose();
});
test('Chat changes expire pending requests; malformed handoffs fail closed', async () => {
    const app = createApplication({ currentTarget: identity.target, startRun: () => ({ completion: Promise.resolve({ state: { status: 'yielded' }, answer: question.question, interaction: question }), drained: Promise.resolve(), cancel() {} }) });
    const session = app.createSession(identity.target); app.submit(session, 'goal'); await settle();
    const r = app.snapshot().interactions[0]; app.changeTarget({ ...identity.target, chatKey: 'B' });
    assert.throws(() => app.answerInteraction(r.id, 'a'), /STALE/); assert.equal(app.snapshot().interactions[0].status, 'expired'); app.dispose();
    const bad = createApplication({ currentTarget: identity.target, startRun: () => ({ completion: Promise.resolve({ state: { status: 'yielded' }, answer: 'invalid', interaction: { question: 'x', options: [], permissions: true } }), drained: Promise.resolve(), cancel() {} }) });
    bad.submit(bad.createSession(identity.target), 'goal'); await settle(); assert.equal(bad.snapshot().runs[0].status, 'failed'); assert.equal(bad.snapshot().interactions.length, 0); bad.dispose();
});

test('A cancelled or old-target late model response cannot publish a pending question', async () => {
    const gate = deferred(), f = run([() => gate.promise]); await flush(); f.handle.cancel(); gate.resolve([call(), done]);
    const result = await f.handle.completion; await f.handle.drained;
    assert.equal(result.state.status, 'cancelled'); assert.equal(result.interaction, null);
    const late = deferred(), app = createApplication({ currentTarget: identity.target, startRun: () => ({ completion: late.promise, drained: Promise.resolve(), cancel() {} }) });
    app.submit(app.createSession({ kind: 'global', userKey: 'u1' }), 'global'); await settle();
    app.changeTarget({ ...identity.target, chatKey: 'B' });
    late.resolve({ state: { status: 'yielded' }, answer: question.question, interaction: question }); await settle();
    assert.equal(app.snapshot().interactions.length, 0); assert.equal(app.snapshot().runs[0].status, 'failed'); app.dispose();
});
