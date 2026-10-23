import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatCompletionsModel } from '../../muyu/model/chat-completions.js';
import { createProcessStore } from '../../muyu/application/process-store.js';
import { createProcessView } from '../../muyu/ui/process-view.js';
import { startMuyuRun } from '../../muyu/composition.js';
import { ExecutionError } from '../../muyu/core/execution.js';
import { identity, registry, toolId, createClock } from './helpers/muyu-subject.mjs';

const connection = { endpoint: 'https://model.invalid/v1/chat/completions', apiKey: 'test-only-placeholder', model: 'fixture', supportsTools: true };
test('Per-call diagnostic observers remain isolated on a shared adapter and override constructor observer', async () => {
    const shared = [], a = [], b = [];
    const model = createChatCompletionsModel({ connection, onDiagnostic: value => shared.push(value), fetchImpl: async () => new Response('{"choices":[]}', { headers: { 'content-type': 'application/json' } }) });
    const input = { messages: [{ role: 'user', content: 'test' }], tools: [] };
    const invoke = onDiagnostic => Array.fromAsync(model.run(input, { signal: new AbortController().signal, context: {}, onDiagnostic }));
    const outcomes = await Promise.allSettled([invoke(value => a.push(value)), invoke(value => b.push(value))]);
    assert.ok(outcomes.every(outcome => outcome.status === 'rejected'));
    assert.deepEqual(a, [{ stage: 'decode', status: 'failed' }]); assert.deepEqual(b, a); assert.deepEqual(shared, []);
});
test('Malformed model batch reports decode failure through runtime/projection and never executes tools', async () => {
    let requests = 0, executed = 0; const events = [], store = createProcessStore(); store.create(identity.id);
    const model = createChatCompletionsModel({ connection, fetchImpl: async () => { requests++; return new Response(JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: 'PRIVATE_RESPONSE', tool_calls: [
        { id: 'valid', type: 'function', function: { name: 'muyu_tool_0', arguments: '{"n":1}' } },
        { id: 'invalid', type: 'function', function: { name: 'muyu_tool_0', arguments: 'PRIVATE_BAD_JSON' } },
    ] } }] }), { headers: { 'content-type': 'application/json' } }); } });
    const run = startMuyuRun({ identity, input: 'test', model, registry: registry(), handlers: { [toolId]: () => { executed++; return 1; } }, allowedTools: [toolId], policy: () => true, clock: createClock(), onEvent: e => { events.push(e); store.event(identity.id, e); } });
    const result = await run.completion; await run.drained;
    assert.equal(result.state.status, 'failed'); assert.equal(result.error, 'MODEL_PROTOCOL_ERROR');
    assert.equal(requests, 1); assert.equal(executed, 0);
    assert.equal(events.find(e => e.type === 'model.failed').payload.diagnosticStage, 'decode');
    assert.equal(store.snapshot(identity.id).rows.at(-1).diagnosticStage, 'decode');
    assert.doesNotMatch(JSON.stringify(store.snapshot(identity.id)), /PRIVATE|test-only|choices|arguments/);
});
test('Failure tags are closed, only failure rows retain them, and custom runtime protocol errors are identified', async () => {
    const store = createProcessStore(); store.create('r');
    for (const [i, stage] of ['decode', 'PRIVATE', '__proto__', { stage: 'decode', secret: 'PRIVATE' }].entries()) {
        store.event('r', { runId: 'r', seq: i + 1, type: 'model.failed', payload: { attemptId: i + 1, diagnosticStage: stage, error: 'MODEL_PROTOCOL_ERROR', secret: 'PRIVATE' } });
    }
    store.event('r', { runId: 'r', seq: 5, type: 'model.completed', payload: { attemptId: 5, diagnosticStage: 'decode' } });
    assert.equal(store.snapshot('r').rows[0].diagnosticStage, 'decode');
    assert.ok(store.snapshot('r').rows.slice(1).every(row => !Object.hasOwn(row, 'diagnosticStage')));
    assert.doesNotMatch(JSON.stringify(store.snapshot('r')), /PRIVATE|__proto__/);
    const events = [];
    const run = startMuyuRun({ identity, input: 'test', registry: registry(), model: { async *run() { yield { type: 'INVALID_PRIVATE' }; } }, clock: createClock(), onEvent: e => events.push(e) });
    await run.completion; await run.drained;
    assert.equal(events.find(e => e.type === 'model.failed').payload.diagnosticStage, 'runtime');
});
test('Late previous-call diagnostics cannot attach to a later failing model call', async () => {
    let n = 0, oldCallback; const events = [];
    const model = { async *run(input, options) {
        if (++n === 1) { oldCallback = options.onDiagnostic; yield { type: 'tool_call_complete', call: { callId: 'one', toolId, version: 1, args: { n: 1 } } }; yield { type: 'done' }; }
        else { oldCallback({ stage: 'decode', status: 'failed', secret: 'PRIVATE' }); throw new ExecutionError('MODEL_NETWORK_ERROR'); }
    } };
    const run = startMuyuRun({ identity, input: 'test', model, registry: registry(), handlers: { [toolId]: () => 1 }, allowedTools: [toolId], policy: () => true, clock: createClock(), onEvent: e => events.push(e) });
    await run.completion; await run.drained;
    assert.equal(events.find(e => e.type === 'model.failed').payload.diagnosticStage, undefined);
});
for (const lang of ['zh', 'en']) test(`Process view shows translated safe failure stage / ${lang}`, () => {
    const element = tag => ({ tag, textContent: '', children: [], attrs: {}, setAttribute(key, value) { this.attrs[key] = value; }, append(e) { this.children.push(e); }, replaceChildren() { this.children = []; }, scrollTop: 0 });
    const view = createProcessView({ doc: { createElement: element }, lang });
    const root = view.update({ id: 'r', process: { phase: 'failed', cleaned: true, terminal: 'failed', rows: [{ type: 'model.failed', attemptId: 1, tool: null, durationMs: 1, error: 'MODEL_PROTOCOL_ERROR', diagnosticStage: 'decode' }] } }, true);
    const walk = el => [el.textContent, ...el.children.flatMap(walk)];
    assert.match(walk(root).join(' '), lang === 'en' ? /Failure stage: Response protocol validation/ : /失败阶段：响应协议校验/);
});
