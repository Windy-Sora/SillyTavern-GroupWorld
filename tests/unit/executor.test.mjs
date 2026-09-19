import assert from 'node:assert/strict';
import test from 'node:test';
import { createExecutor } from '../../systems/executor.js';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((ok, fail) => {
        resolve = ok;
        reject = fail;
    });
    return { promise, resolve, reject };
}

test('executor returns a settled empty receipt for absent or invalid intents', async () => {
    const executor = createExecutor();

    for (const policy of [
        undefined,
        {},
        { intents: null },
        { intents: 'invalid' },
        { intents: [null, {}, { type: 42 }, { type: {} }] },
    ]) {
        const result = await executor.run(policy, []);
        assert.deepEqual({
            resolved: result.resolved,
            scheduled: result.scheduled,
            executed: result.executed,
            roundEndQueued: result.roundEndQueued,
            results: result.results,
            deferred: result.deferred,
        }, {
            resolved: 0,
            scheduled: 0,
            executed: 0,
            roundEndQueued: 0,
            results: [],
            deferred: [],
        });
        assert.deepEqual(await result.completion, []);
    }
});

test('exact ids win before schema aliases and substring fallbacks', async () => {
    const calls = [];
    const executor = createExecutor();
    const capabilities = [
        { id: 'voice', executor: async () => calls.push('exact') },
        { id: 'tts', schema: { intents: ['voice'] }, executor: async () => calls.push('alias') },
        { id: 'voice-preview', executor: async () => calls.push('substring') },
        { id: 'disabled', schema: { intents: ['disabled-alias'] }, enabled: false, executor: async () => calls.push('disabled') },
    ];

    const exact = await executor.run({ intents: [{ type: ' VOICE ' }] }, capabilities);
    assert.equal(exact.resolved, 1);
    assert.deepEqual(calls, ['exact']);

    calls.length = 0;
    const alias = await executor.run({ intents: [{ type: 'voice' }] }, capabilities.slice(1));
    assert.equal(alias.resolved, 1);
    assert.deepEqual(calls, ['alias']);

    calls.length = 0;
    const substring = await executor.run({ intents: [{ type: 'preview' }] }, capabilities);
    assert.equal(substring.resolved, 1);
    assert.deepEqual(calls, ['substring']);

    calls.length = 0;
    const disabled = await executor.run({ intents: [{ type: 'disabled-alias' }] }, capabilities);
    assert.equal(disabled.resolved, 0);
    assert.deepEqual(calls, []);
});

test('parameter schemas coerce, clamp, default, and reject invalid numbers', async () => {
    const received = [];
    const logs = [];
    const executor = createExecutor({ log: message => logs.push(message) });
    const capability = {
        id: 'tts',
        schema: {
            params: {
                required: { type: 'string', required: true },
                speed: { type: 'number', min: 0.5, max: 2, default: 1 },
                pitch: { type: 'number', min: 0.5, max: 2 },
                mood: { values: ['neutral', 'happy'], default: 'neutral' },
            },
        },
        executor: async params => received.push(params),
    };

    await executor.run({ intents: [{
        type: 'tts',
        params: { required: 'yes', speed: '9', pitch: '0.1', mood: 'unknown' },
    }] }, [capability]);

    assert.deepEqual(received, [{ required: 'yes', speed: 2, pitch: 0.5, mood: 'neutral' }]);
    assert.equal(logs.some(message => message.includes('above max=2')), true);
    assert.equal(logs.some(message => message.includes('below min=0.5')), true);
    assert.equal(logs.some(message => message.includes('not in allowed')), true);

    for (const invalid of [true, {}, null, Number.NaN, Number.POSITIVE_INFINITY, 'not-a-number', '']) {
        const result = await executor.run({ intents: [{
            type: 'tts',
            params: { required: 'yes', speed: invalid },
        }] }, [capability]);
        assert.equal(result.resolved, 0, `expected ${String(invalid)} to be rejected`);
    }

    const missing = await executor.run({ intents: [{ type: 'tts', params: {} }] }, [capability]);
    assert.equal(missing.resolved, 0);
});

test('capability mutations cannot alter source policy or shared schema defaults', async () => {
    const defaultConfig = { nested: { count: 0 } };
    const enumDefault = { nested: { count: 0 } };
    const policy = {
        intents: [{ type: 'mutate', params: { nested: { value: 'before' }, choice: 'invalid' } }],
    };
    const executor = createExecutor();
    const capability = {
        id: 'mutate',
        schema: { params: {
            config: { default: defaultConfig },
            choice: { values: [enumDefault], default: enumDefault },
        } },
        executor: async params => {
            params.nested.value = 'mutated';
            params.config.nested.count++;
            params.choice.nested.count++;
        },
    };

    await executor.run(policy, [capability]);

    assert.equal(policy.intents[0].params.nested.value, 'before');
    assert.equal(defaultConfig.nested.count, 0);
    assert.equal(enumDefault.nested.count, 0);

    let laterCount;
    capability.executor = async params => { laterCount = params.config.nested.count; };
    await executor.run({ intents: [{ type: 'mutate', params: { nested: { value: 'later' } } }] }, [capability]);
    assert.equal(laterCount, 0);
});

test('blocking execution preserves order, isolates failures, and reports every action', async () => {
    const order = [];
    const callbacks = [];
    const executor = createExecutor({
        blocking: true,
        onExecuted: async (id, result) => callbacks.push([id, result.success]),
    });

    const result = await executor.run({
        intents: [{ type: 'first' }, { type: 'second' }, { type: 'third' }],
    }, [
        { id: 'first', executor: async () => order.push('first') },
        { id: 'second', executor: async () => { order.push('second'); throw new Error('boom'); } },
        { id: 'third', executor: async () => order.push('third') },
    ]);

    assert.deepEqual(order, ['first', 'second', 'third']);
    assert.deepEqual(result.results.map(item => item.success), [true, false, true]);
    assert.equal(result.results[1].error, 'boom');
    assert.deepEqual(callbacks, [['first', true], ['second', false], ['third', true]]);
    assert.deepEqual(await result.completion, result.results);
});

test('unknown timing modes log and fall back to immediate execution', async () => {
    const logs = [];
    let calls = 0;
    const executor = createExecutor({ log: message => logs.push(message) });

    for (const mode of ['typo', '', false, 0]) {
        const result = await executor.run({
            intents: [{ type: 'test' }],
            timing: { mode },
        }, [{ id: 'test', executor: async () => { calls++; } }]);

        assert.equal(result.executed, 1);
        assert.equal(result.roundEndQueued, 0);
    }

    assert.equal(calls, 4);
    assert.equal(logs.filter(message => message.includes('Unknown timing mode')).length, 4);
});

test('deferred timing executes due work without creating a round-end queue', async () => {
    const calls = [];
    const executor = createExecutor();

    const result = await executor.run({
        intents: [{ type: 'later', params: { value: 1 } }],
        timing: { mode: 'deferred', delay: 0 },
    }, [{ id: 'later', executor: async params => calls.push(params.value) }]);

    assert.deepEqual(calls, [1]);
    assert.equal(result.executed, 1);
    assert.equal(result.roundEndQueued, 0);
    assert.deepEqual(result.deferred, []);
});

test('round-end scheduling exposes ordered plans without executing them early', async () => {
    const calls = [];
    const executor = createExecutor();
    const result = await executor.run({
        intents: [{ type: 'first' }, { type: 'second' }],
        timing: { mode: 'round_end', delay: 10 },
    }, [
        { id: 'first', executor: async () => calls.push('first') },
        { id: 'second', executor: async () => calls.push('second') },
    ]);

    assert.deepEqual(calls, []);
    assert.equal(result.executed, 0);
    assert.equal(result.roundEndQueued, 2);
    assert.deepEqual(result.deferred.map(plan => plan.delay), [10, 210]);
    assert.deepEqual(result.deferred.map(plan => plan.action.intentIndex), [0, 1]);

    const completed = await executor.executeDeferred([result.deferred[0]]);
    assert.deepEqual(calls, ['first']);
    assert.equal(completed.results[0].success, true);
});

test('non-blocking execution returns pending receipts and settles real outcomes', async () => {
    const gate = deferred();
    const callbacks = [];
    const executor = createExecutor({
        blocking: false,
        onExecuted: async (id, result) => {
            callbacks.push([id, result.success]);
            if (id === 'fails-callback') throw new Error('callback failed');
        },
        log: message => callbacks.push(['log', message]),
    });

    const result = await executor.run({
        intents: [{ type: 'slow' }, { type: 'fails-callback' }],
    }, [
        { id: 'slow', executor: async () => gate.promise },
        { id: 'fails-callback', executor: async () => { throw new Error('capability failed'); } },
    ]);

    assert.deepEqual(result.results.map(item => item.pending), [true, true]);
    assert.deepEqual(callbacks, []);

    gate.resolve();
    const completed = await result.completion;
    assert.deepEqual(completed.map(item => item.success), [true, false]);
    assert.equal(completed[1].error, 'capability failed');
    assert.equal(callbacks.some(entry => entry[0] === 'fails-callback'), true);
    assert.equal(callbacks.some(entry => entry[0] === 'log' && entry[1].includes('callback failed')), true);
});

test('deferred execution uses the current executor when the capability revision is unchanged', async () => {
    const calls = [];
    const original = { id: 'live', revision: 7, executor: async () => calls.push('old') };
    let current = original;
    const executor = createExecutor({
        resolveCapability: () => current,
    });
    const queued = await executor.run({
        intents: [{ type: 'live' }],
        timing: { mode: 'round_end' },
    }, [original]);

    current = { ...original, executor: async () => calls.push('current') };
    const completed = await executor.executeDeferred(queued.deferred);

    assert.deepEqual(calls, ['current']);
    assert.equal(completed.results[0].success, true);
});

test('executeDeferred rejects non-arrays and returns a complete empty receipt', async () => {
    const executor = createExecutor();

    await assert.rejects(executor.executeDeferred({}), {
        name: 'TypeError',
        message: 'Deferred execution plans must be an array',
    });

    const empty = await executor.executeDeferred();
    assert.equal(empty.resolved, 0);
    assert.equal(empty.executed, 0);
    assert.deepEqual(empty.results, []);
    assert.deepEqual(await empty.completion, []);
});
