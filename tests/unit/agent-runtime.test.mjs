import assert from 'node:assert/strict';
import test from 'node:test';
import {
    AgentTrace,
    createScopedPool,
    execute,
    managedCall,
    withTimeout,
} from '../../systems/agent-runtime.js';

function silenceConsole(t) {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const logs = [];
    const warnings = [];
    console.log = (...args) => logs.push(args);
    console.warn = (...args) => warnings.push(args);
    t.after(() => {
        console.log = originalLog;
        console.warn = originalWarn;
    });
    return { logs, warnings };
}

test('scoped context enforces declared reads, preserves method receivers, and blocks writes', t => {
    const { logs } = silenceConsole(t);
    const pool = {
        value: 7,
        readValue() { return this.value; },
        secret: 'hidden',
    };
    const scoped = createScopedPool(pool, ['value', 'readValue'], { id: 'probe' });

    assert.equal(scoped.proxy.value, 7);
    assert.equal(scoped.proxy.readValue(), 7);
    assert.equal(scoped.proxy.secret, undefined);
    scoped.proxy.value = 99;

    assert.equal(pool.value, 7);
    assert.deepEqual([...scoped.used], ['value', 'readValue', 'secret']);
    assert.match(scoped.report(true), /UNDECLARED: \[secret\]/);
    assert.match(scoped.report(true), /3 keys used/);
    assert.equal(logs.length, 2);
});

test('strict scoped context rejects undeclared reads', () => {
    const { proxy } = createScopedPool(
        { allowed: 1, secret: 2 },
        ['allowed'],
        { id: 'strict-probe' },
        { strictMode: true },
    );
    assert.throws(() => proxy.secret, /AgentAccessViolation.*strict-probe.*secret/);
});

test('execute runs the semantic pipeline in order through the managed caller', async t => {
    silenceConsole(t);
    const stages = [];
    const agent = {
        id: 'pipeline-probe',
        contextAccess: ['value'],
        pipelineOrder: ['context', 'prompt', 'call', 'parse', 'validate'],
        pipeline: {
            context(input, state, pool, config) {
                stages.push(['context', input, state, config.marker]);
                return { value: pool.value() };
            },
            prompt(input, state) {
                stages.push(['prompt', input, state]);
                return `value=${input.value}`;
            },
            call: null,
            parse(input, state) {
                stages.push(['parse', input, state]);
                return { answer: input };
            },
            validate(input, state) {
                stages.push(['validate', input, state]);
                return { ...input, valid: true };
            },
        },
    };
    const caller = {
        supportsAbort: true,
        async generate(prompt) {
            assert.equal(prompt, 'value=42');
            return 'model-result';
        },
    };

    const result = await execute(agent, {
        pool: { value: () => 42 },
        caller,
        config: { marker: 'configured', call: { retries: 0, timeout: 100 } },
    });

    assert.deepEqual(result, { answer: 'model-result', valid: true });
    assert.deepEqual(stages.map(([stage]) => stage), ['context', 'prompt', 'parse', 'validate']);
    assert.equal(stages[0][1], undefined);
    assert.equal(stages[1][1].value, 42);
    assert.equal(stages[2][1], 'model-result');
    assert.deepEqual(stages[3][1], { answer: 'model-result' });
});

test('execute supports custom calls and optional pipeline stages', async t => {
    silenceConsole(t);
    let defaultCalls = 0;
    const caller = { generate: async () => { defaultCalls++; return 'wrong'; } };
    const agent = {
        id: 'custom-call-probe',
        contextAccess: [],
        pipelineOrder: ['prompt', 'call', 'parse', 'missing'],
        pipeline: {
            prompt: () => 'custom prompt',
            call(receivedCaller, prompt, state) {
                assert.equal(receivedCaller, caller);
                assert.equal(prompt, 'custom prompt');
                assert.equal(state.prompt, 'custom prompt');
                return 'custom raw';
            },
            parse: raw => ({ raw }),
        },
    };
    assert.deepEqual(await execute(agent, { pool: {}, caller }), { raw: 'custom raw' });
    assert.equal(defaultCalls, 0);
});

test('execute skips the managed caller when an Agent intentionally returns no prompt', async t => {
    silenceConsole(t);
    let calls = 0;
    const result = await execute({
        id: 'empty-prompt-probe',
        contextAccess: [],
        pipelineOrder: ['prompt', 'call'],
        pipeline: { prompt: () => null, call: null },
    }, {
        pool: {},
        caller: { async generate() { calls++; return 'unexpected'; } },
        config: { enableTrace: true },
    });
    assert.equal(result, null);
    assert.equal(calls, 0);
    assert.equal(AgentTrace.recent().at(-1).stages.find(stage => stage.stage === 'call').skipped, 'empty-prompt');
    AgentTrace.clear();
});

test('execution traces record successful and failed pipelines without retaining raw payloads', async t => {
    silenceConsole(t);
    AgentTrace.clear();
    AgentTrace.setMax(2);
    t.after(() => {
        AgentTrace.clear();
        AgentTrace.setMax(50);
    });

    const success = {
        id: 'trace-success',
        contextAccess: [],
        pipelineOrder: ['prompt', 'parse'],
        pipeline: {
            prompt: () => 'sensitive prompt',
            parse: () => ({ public: true, _secret: 'omit' }),
        },
    };
    await execute(success, { pool: {}, caller: {}, config: { enableTrace: true } });
    const completed = AgentTrace.recent()[0];
    assert.deepEqual(completed.stages.map(stage => stage.stage), ['_start', 'prompt', 'parse', '_done']);
    assert.deepEqual(completed.stages.at(-1).result, { type: 'object', keys: ['public'] });
    assert.equal(JSON.stringify(completed).includes('sensitive prompt'), false);
    assert.equal(Object.isFrozen(completed.stages[0]), true);

    const failure = {
        id: 'trace-failure',
        contextAccess: [],
        pipelineOrder: ['context', 'prompt'],
        pipeline: {
            context: () => ({}),
            prompt: () => { throw new Error('prompt failed'); },
        },
    };
    await assert.rejects(
        execute(failure, { pool: {}, caller: {}, config: { enableTrace: true } }),
        /prompt failed/,
    );
    const failed = AgentTrace.recent().at(-1);
    assert.equal(failed.agentId, 'trace-failure');
    assert.deepEqual(failed.stages.map(stage => stage.stage), ['_start', 'context', 'prompt']);
    assert.equal(failed.stages.at(-1).error, 'prompt failed');
});

test('trace ring buffer clamps its size and tracing stays opt-in', async t => {
    silenceConsole(t);
    AgentTrace.clear();
    AgentTrace.setMax(1);
    t.after(() => {
        AgentTrace.clear();
        AgentTrace.setMax(50);
    });
    AgentTrace.push({ agentId: 'first' });
    AgentTrace.push({ agentId: 'second' });
    assert.deepEqual(AgentTrace.recent().map(item => item.agentId), ['second']);
    AgentTrace.clear();

    const agent = {
        id: 'no-trace',
        contextAccess: [],
        pipelineOrder: ['prompt'],
        pipeline: { prompt: () => 'done' },
    };
    assert.equal(await execute(agent, { pool: {}, caller: {} }), 'done');
    assert.deepEqual(AgentTrace.recent(), []);
});

test('withTimeout aborts the request-scoped signal with TimeoutError', async () => {
    let observedReason;
    await assert.rejects(
        withTimeout(signal => new Promise((_, reject) => {
            signal.addEventListener('abort', () => {
                observedReason = signal.reason;
                reject(new DOMException('aborted', 'AbortError'));
            }, { once: true });
        }), 10),
        error => error.name === 'TimeoutError',
    );
    assert.equal(observedReason?.name, 'TimeoutError');
});

test('managedCall does not retry an externally aborted request', async () => {
    let starts = 0;
    const controller = new AbortController();
    const caller = {
        supportsAbort: true,
        generate(_prompt, { signal }) {
            starts++;
            return new Promise((_, reject) => {
                signal.addEventListener('abort', () => {
                    reject(new DOMException('aborted', 'AbortError'));
                }, { once: true });
            });
        },
    };
    const request = managedCall(caller, 'probe', {
        retries: 3,
        timeout: 1000,
        signal: controller.signal,
    });
    controller.abort();
    await assert.rejects(request, error => error.name === 'AbortError');
    assert.equal(starts, 1);
});

test('managedCall refuses timeout retries for non-cancellable callers', async () => {
    let starts = 0;
    const caller = {
        supportsAbort: false,
        generate() {
            starts++;
            return new Promise(() => {});
        },
    };
    await assert.rejects(
        managedCall(caller, 'probe', { retries: 3, timeout: 10 }),
        error => error.name === 'TimeoutError',
    );
    assert.equal(starts, 1);
});
