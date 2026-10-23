import test from 'node:test';
import assert from 'node:assert/strict';
import { createToolBroker } from '../../muyu/tools/broker.js';
import { startMuyuRun } from '../../muyu/composition.js';
import { createClock, flush, deferred, identity, toolId, registry, call, request, done, text, scriptedModel } from './helpers/muyu-subject.mjs';

function subject(steps, options = {}) {
    const clock = createClock(), events = [], model = scriptedModel(steps);
    const handle = startMuyuRun({ identity, input: 'synthetic task', registry: registry(), handlers: { [toolId]: args => args.n * 2 }, allowedTools: [toolId], policy: () => true, model, clock, onEvent: e => events.push(e), ...options });
    return { handle, clock, events, model };
}
function broker(options = {}) {
    const controller = new AbortController(), clock = createClock();
    return { controller, clock, value: createToolBroker({ registry: registry(), handlers: { [toolId]: a => a.n }, runId: 'r1', target: identity.target, allowedTools: [toolId], signal: controller.signal, policy: () => true, clock, ...options }) };
}

test('Tool visibility removes unavailable definitions between model calls without granting execution', async () => {
    let visible = true, calls = 0;
    const s = subject([[request(call('a')), done], [text('complete'), done]], {
        toolVisibility: () => visible,
        handlers: { [toolId]: args => { calls++; visible = false; return args.n; } },
    });
    assert.equal((await s.handle.completion).state.status, 'succeeded');
    assert.equal(calls, 1); assert.equal(s.model.requests[0].tools.length, 1); assert.equal(s.model.requests[1].tools.length, 0);
    for (const visibility of [() => false, () => { throw Error('PRIVATE'); }]) {
        const hidden = subject([[text('normal conversation'), done]], { toolVisibility: visibility });
        assert.equal((await hidden.handle.completion).state.status, 'succeeded'); assert.equal(hidden.model.requests[0].tools.length, 0);
    }
    const denied = subject([[request(call('a')), done], [text('denied'), done]], { toolVisibility: () => true, policy: () => false,
        handlers: { [toolId]: () => { throw Error('must not execute'); } } });
    await denied.handle.completion; assert.equal(denied.model.requests[1].messages.find(m => m.role === 'tool').result.error.code, 'PERMISSION_DENIED');
});
test('Muyu offline loop pairs multiple serial calls and final response', async () => {
    const order = [];
    const s = subject([[request(call('a')), request(call('b', { n: 3 })), done], [text('complete'), done]], { handlers: { [toolId]: async a => { order.push(a.n); return a.n * 2; } } });
    const result = await s.handle.completion;
    assert.equal(result.state.status, 'succeeded'); assert.equal(result.answer, 'complete');
    assert.deepEqual(order, [1, 3]);
    assert.deepEqual(s.model.requests[1].messages.filter(m => m.role === 'tool').map(m => [m.callId, m.result.data]), [['a', 2], ['b', 6]]);
    assert.deepEqual(s.events.filter(e => e.type.startsWith('tool.')).map(e => e.type), ['tool.requested', 'tool.started', 'tool.completed', 'tool.requested', 'tool.started', 'tool.completed']);
    assert.equal(s.clock.pending, 0);
});
test('Muyu broker denies absent policy, absent allowlist, invalid scope/version and writes', async () => {
    for (const options of [{ policy: undefined }, { allowedTools: [] }, { target: { kind: 'global', userKey: 'u1' } }, { registry: registry({ effect: 'write' }) }]) {
        let n = 0; const s = broker({ ...options, handlers: { [toolId]: () => { n++; return 1; } } });
        assert.equal((await s.value.call(call())).ok, false); assert.equal(n, 0);
    }
    assert.equal((await broker().value.call({ ...call(), version: 2 })).error.code, 'UNSUPPORTED_CAPABILITY');
    assert.equal((await broker().value.call({ ...call(), toolId: 'muyu.test.unknown' })).error.code, 'PERMISSION_DENIED');
});
test('Muyu broker never exposes raw exceptions and validates inputs/outputs', async () => {
    assert.equal((await broker().value.call(call('x', { n: '1' }))).error.code, 'INVALID_ARGUMENT');
    assert.equal((await broker({ handlers: { [toolId]: () => 'not integer' } }).value.call(call())).error.code, 'OUTPUT_INVALID');
    const result = await broker({ handlers: { [toolId]: () => { throw new Error('secret-token'); } } }).value.call(call());
    assert.equal(result.error.code, 'TOOL_FAILED'); assert.ok(!JSON.stringify(result).includes('secret'));
});
test('Muyu broker serializes concurrent requests, deduplicates and rejects conflicting IDs', async () => {
    const wait = deferred(); let n = 0;
    const s = broker({ handlers: { [toolId]: async () => { n++; return wait.promise; } } });
    const a = s.value.call(call()), b = s.value.call(call()); await flush(); assert.equal(n, 1);
    wait.resolve(7); assert.equal((await a).data, 7); assert.equal((await b).data, 7); assert.equal(n, 1);
    assert.equal((await s.value.call(call('c1', { n: 2 }))).error.code, 'CALL_ID_CONFLICT');
});
test('Muyu run scope and policy input cannot be changed through handlers or original objects', async () => {
    const target = structuredClone(identity.target); const seen = [];
    const s = broker({ target, policy: p => { p.target.chatKey = 'B'; return true; }, handlers: { [toolId]: (a, c) => { seen.push(c.target.chatKey); c.target.chatKey = 'C'; return 1; } } });
    target.chatKey = 'D'; await s.value.call(call()); await s.value.call(call('c2'));
    assert.deepEqual(seen, ['A', 'A']);
});
test('Muyu pre-cancelled run never calls the model or tools', async () => {
    const s = subject([[text('not reached'), done]]); s.handle.cancel();
    assert.equal((await s.handle.completion).state.status, 'cancelled'); assert.equal(s.model.requests.length, 0); assert.equal(s.clock.pending, 0);
});
test('Muyu model wait cancellation ignores late output and cleans timers', async () => {
    const wait = deferred(); const s = subject([() => wait.promise]); await flush(); s.handle.cancel();
    const result = await s.handle.completion; assert.equal(result.error, 'CANCELLED'); const count = s.events.length;
    wait.resolve([text('late'), done]); await flush(); assert.equal(s.events.length, count); assert.equal(s.clock.pending, 0);
});
test('Muyu tool wait cancellation pairs skipped calls and never starts the next tool', async () => {
    const wait = deferred(); let n = 0;
    const s = subject([[request(call('a')), request(call('b')), done]], { handlers: { [toolId]: () => { n++; return wait.promise; } } });
    await flush(); assert.equal(n, 1); s.handle.cancel();
    const result = await s.handle.completion; assert.equal(result.state.status, 'cancelled'); assert.equal(n, 1);
    assert.deepEqual(result.messages.filter(m => m.role === 'tool').map(m => m.callId), ['a', 'b']);
    wait.resolve(1); await flush(); assert.equal(s.events.at(-1).type, 'run.finished'); assert.equal(s.clock.pending, 0);
});
test('Muyu tool timeout is bounded and late success cannot replace its failure', async () => {
    const wait = deferred(); const s = broker({ handlers: { [toolId]: () => wait.promise } });
    const result = s.value.call(call()); await flush(); s.clock.advance(50);
    assert.equal((await result).error.code, 'TIMEOUT'); wait.resolve(10); await flush();
    assert.equal((await s.value.call(call())).error.code, 'TIMEOUT'); assert.equal(s.clock.pending, 0);
});
test('Muyu total timeout bounds non-cooperative model requests', async () => {
    const s = subject([() => new Promise(() => {})], { limits: { timeMs: 100 } }); await flush(); s.clock.advance(100);
    const result = await s.handle.completion; assert.equal(result.error, 'TIMEOUT'); assert.equal(result.state.status, 'failed'); assert.equal(s.clock.pending, 0);
});

test('Muyu timed-out handler blocks subsequent handlers until physically settled', async () => {
    const wait = deferred(); let calls = 0;
    const s = broker({ handlers: { [toolId]: () => { calls++; return wait.promise; } } });
    const first = s.value.call(call('first')); await flush(); s.clock.advance(50);
    assert.equal((await first).error.code, 'TIMEOUT');
    assert.equal((await s.value.call(call('blocked'))).error.code, 'UPSTREAM_PENDING'); assert.equal(calls, 1);
    wait.resolve(1); await flush(); assert.equal((await s.value.call(call('next'))).ok, true); assert.equal(calls, 2);
});
test('Muyu model, tool and argument correction budgets stop loops', async () => {
    for (const [limits, calls] of [[{ modelCalls: 1 }, [call()]], [{ toolCalls: 1 }, [call('a'), call('b')]], [{ corrections: 0 }, [call('a', {})]]]) {
        const s = subject([[...calls.map(request), done], [text('should not finish'), done]], { limits });
        assert.equal((await s.handle.completion).error, 'BUDGET_EXCEEDED'); assert.equal(s.clock.pending, 0);
    }
});
test('Muyu malformed streams and unsupported interaction fail without tools', async () => {
    for (const events of [[text('no done')], [done], [done, text('late')], [{ type: 'tool_call_delta', text: '{}' }], [{ type: 'approval_required' }], [request(call()), request(call()), done]]) {
        let n = 0; const s = subject([events], { handlers: { [toolId]: () => { n++; return 1; } } });
        assert.equal((await s.handle.completion).state.status, 'failed'); assert.equal(n, 0);
    }
});
test('Muyu observers cannot break execution, and independent runs do not share dedupe state', async () => {
    let n = 0;
    const options = { handlers: { [toolId]: () => ++n }, onEvent: () => { throw new Error('UI failed'); } };
    const a = subject([[request(call()), done], [text('a'), done]], options);
    const b = subject([[request(call()), done], [text('b'), done]], options);
    assert.equal((await a.handle.completion).answer, 'a'); assert.equal((await b.handle.completion).answer, 'b'); assert.equal(n, 2);
});

test('Muyu repeated IDs across steps still get paired results when later batch is cancelled', async () => {
    let handle;
    const s = subject([[request(call()), done], [request(call()), request(call('later')), done]], { onEvent: e => {
        if (e.type === 'tool.requested' && e.payload.attemptId === 2) handle.cancel();
    } });
    handle = s.handle;
    const result = await handle.completion;
    assert.equal(result.state.status, 'cancelled');
    assert.deepEqual(result.messages.filter(m => m.role === 'tool').map(m => m.callId), ['c1', 'c1', 'later']);
    assert.equal(result.messages.at(-1).result.effectState, 'not_started');
});

test('Muyu invalid arguments can be corrected with a new ID and bounded outputs cannot leak', async () => {
    const s = subject([[request(call('bad', {})), done], [request(call('good')), done], [text('fixed'), done]]);
    assert.equal((await s.handle.completion).answer, 'fixed');
    assert.equal(s.model.requests[1].messages.at(-1).result.error.code, 'INVALID_ARGUMENT');
    const t = broker({ handlers: { [toolId]: () => ({ secret: '羽'.repeat(12000) }) } });
    assert.equal((await t.value.call(call())).error.code, 'OUTPUT_INVALID');
});

test('Muyu asynchronous policy cannot authorize or create an unhandled rejection', async () => {
    for (const policy of [async () => true, async () => { throw new Error('policy failure'); }]) {
        const s = broker({ policy }); assert.equal((await s.value.call(call())).error.code, 'PERMISSION_DENIED');
        await flush(); assert.equal(s.clock.pending, 0);
    }
});

test('Muyu cancellation on final text wins over successful completion', async () => {
    let handle; const s = subject([[text('finished?'), done]], { onEvent: e => { if (e.type === 'model.delta') handle.cancel(); } });
    handle = s.handle; const result = await handle.completion;
    assert.equal(result.answer, null); assert.equal(result.state.status, 'cancelled');
});
