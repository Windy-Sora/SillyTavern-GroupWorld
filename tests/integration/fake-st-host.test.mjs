import assert from 'node:assert/strict';
import test from 'node:test';
import { getEventListeners } from 'node:events';
import { FakeEventSource } from '../harness/fake-event-source.mjs';
import { FakeSillyTavernHost, TEST_EVENT_TYPES } from '../harness/fake-st-host.mjs';

test('fake event source awaits listeners sequentially like SillyTavern', async () => {
    const events = new FakeEventSource();
    const order = [];
    events.on('event', async () => {
        order.push('first:start');
        await Promise.resolve();
        order.push('first:end');
    });
    events.on('event', () => order.push('second'));

    await events.emit('event');
    assert.deepEqual(order, ['first:start', 'first:end', 'second']);
});

test('global stop cancels all active native generateRaw requests', async t => {
    const host = new FakeSillyTavernHost();
    t.after(() => host.dispose());
    host.queueResponse({ type: 'pending' }).queueResponse({ type: 'pending' });

    const first = host.generateRaw({ prompt: 'first' });
    const second = host.generateRaw({ prompt: 'second' });
    assert.equal(host.activeRequestCount, 2);

    host.stopGeneration();
    await assert.rejects(first, error => error.name === 'AbortError');
    await assert.rejects(second, error => error.name === 'AbortError');
    assert.equal(host.activeRequestCount, 0);
    assert.equal(host.stopCalls, 1);
});

test('request-scoped abort leaves concurrent requests active', async t => {
    const host = new FakeSillyTavernHost({ requestScopedAbort: true });
    t.after(() => host.dispose());
    host.queueResponse({ type: 'pending' }).queueResponse({ type: 'pending' });
    const firstController = new AbortController();
    const secondController = new AbortController();

    const first = host.generateRaw({ prompt: 'first', signal: firstController.signal });
    const second = host.generateRaw({ prompt: 'second', signal: secondController.signal });
    firstController.abort();

    await assert.rejects(first, error => error.name === 'AbortError');
    assert.equal(host.activeRequestCount, 1);
    assert.equal(host.requests[1].status, 'active');

    await host.emit(TEST_EVENT_TYPES.GENERATION_STOPPED);
    await assert.rejects(second, error => error.name === 'AbortError');
});

test('disposing a fake host settles pending requests and clears timers and signal listeners', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const host = new FakeSillyTavernHost({ requestScopedAbort: true });
    const controller = new AbortController();
    host.queueResponse({ type: 'pending' }).queueResponse({ type: 'resolve', value: 'late', delayMs: 100 });
    const pending = host.generateRaw({ signal: controller.signal });
    const delayed = host.generateRaw();
    const results = Promise.allSettled([pending, delayed]);
    host.dispose();
    t.mock.timers.tick(200);
    for (const result of await results) {
        assert.equal(result.status, 'rejected');
        assert.equal(result.reason.name, 'AbortError');
    }
    assert.equal(host.activeRequestCount, 0);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    assert.equal(host.eventSource.listenerCount(TEST_EVENT_TYPES.GENERATION_STOPPED), 0);
    assert.ok(host.requests.every(request => request.status === 'aborted' && request.reason === 'disposed'));
    host.dispose();
});

test('an already aborted request never schedules a response timer', async t => {
    const timer = t.mock.method(globalThis, 'setTimeout', () => { throw new Error('unexpected timer'); });
    const host = new FakeSillyTavernHost({ requestScopedAbort: true });
    const controller = new AbortController();
    controller.abort();
    host.queueResponse({ type: 'resolve', delayMs: 1000 });
    await assert.rejects(host.generateRaw({ signal: controller.signal }), { name: 'AbortError' });
    assert.equal(timer.mock.callCount(), 0);
    assert.equal(host.activeRequestCount, 0);
    host.dispose();
});
