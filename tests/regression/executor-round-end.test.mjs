import assert from 'node:assert/strict';
import test from 'node:test';
import { createExecutor } from '../../systems/executor.js';

test('BUG-5: round_end plans do not execute before the boundary', async () => {
    let calls = 0;
    const executor = createExecutor({ blocking: true });
    const policy = {
        intents: [{ type: 'test.round-end', params: { value: 7 } }],
        timing: { mode: 'round_end' },
    };
    const capabilities = [{
        id: 'test.round-end',
        executor: async params => {
            assert.equal(params.value, 7);
            calls++;
        },
    }];

    const queued = await executor.run(policy, capabilities);
    assert.equal(calls, 0);
    assert.equal(queued.executed, 0);
    assert.equal(queued.roundEndQueued, 1);

    const completed = await executor.executeDeferred(queued.deferred);
    assert.equal(calls, 1);
    assert.equal(completed.results[0].success, true);
});

test('invalid capability params remain unresolved and unexecuted', async () => {
    let calls = 0;
    const executor = createExecutor({ blocking: true });
    const result = await executor.run({
        intents: [{ type: 'test.required', params: {} }],
    }, [{
        id: 'test.required',
        schema: { params: { prompt: { type: 'string', required: true } } },
        executor: async () => { calls++; },
    }]);

    assert.equal(result.resolved, 0);
    assert.equal(result.executed, 0);
    assert.equal(calls, 0);
});
