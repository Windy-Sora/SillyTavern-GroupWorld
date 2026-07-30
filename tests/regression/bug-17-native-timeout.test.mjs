import assert from 'node:assert/strict';
import test from 'node:test';
import { managedCall } from '../../systems/agent-runtime.js';
import { createCaller } from '../../utils/custom-api.js';
import { FakeSillyTavernHost, TEST_EVENT_TYPES } from '../harness/fake-st-host.mjs';

test('BUG-17: native timeout does not broadcast user stop or cancel concurrent requests', async t => {
    const host = new FakeSillyTavernHost();
    t.after(() => host.dispose());
    host.queueResponse({ type: 'pending' }).queueResponse({ type: 'pending' });

    const outer = new AbortController();
    host.eventSource.on(TEST_EVENT_TYPES.GENERATION_STOPPED, () => outer.abort());
    const concurrent = host.generateRaw({ prompt: 'unrelated request' });
    void concurrent.catch(() => {});

    const caller = createCaller(
        { useCustom: false },
        options => host.generateRaw(options),
        () => host.stopGeneration(),
    );

    let caught;
    try {
        await managedCall(caller, 'timed request', {
            retries: 2,
            timeout: 15,
            signal: outer.signal,
        });
    } catch (error) {
        caught = error;
    }

    await Promise.resolve();
    assert.equal(caught?.name, 'TimeoutError');
    assert.equal(caller.supportsAbort, false);
    assert.equal(host.stopCalls, 0);
    assert.equal(outer.signal.aborted, false);
    assert.equal(host.requests.length, 2);
    assert.equal(host.requests[0].status, 'active');
});
