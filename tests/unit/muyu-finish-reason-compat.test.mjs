import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatCompletionsModel } from '../../muyu/model/chat-completions.js';
import { startMuyuRun } from '../../muyu/composition.js';
import { identity, registry, toolId } from './helpers/muyu-subject.mjs';

const connection = { endpoint: 'https://fixture.invalid/chat/completions', apiKey: 'test-only-placeholder', model: 'fixture', supportsTools: true };
const call = (id = 'c1', args = '{"n":1}') => ({ id, type: 'function', function: { name: 'muyu_tool_0', arguments: args } });
const response = (finish_reason = 'stop', tool_calls = [call()], content = '') => ({ choices: [{ finish_reason, message: { role: 'assistant', content, tool_calls } }] });
const request = () => ({ messages: [{ role: 'user', content: 'read' }], tools: registry().list() });
function fixture(responses, thinking = false) {
    const requests = [], diagnostics = [];
    const model = createChatCompletionsModel({ connection: thinking ? { ...connection, profile: 'deepseek', thinking: true } : connection,
        fetchImpl: async (_url, options) => { requests.push(JSON.parse(options.body)); return new Response(JSON.stringify(responses.shift()), { headers: { 'content-type': 'application/json' } }); },
        onDiagnostic: value => diagnostics.push(value) });
    return { model, requests, diagnostics };
}
const collect = (model, input = request(), context = {}) => Array.fromAsync(model.run(input, { signal: new AbortController().signal, context }));

for (const content of ['', 'Let me check.']) test('stop with complete valid calls is decoded once, content=' + JSON.stringify(content), async () => {
    const data = response('stop', [call('a'), call('b', '{"n":2}')], content), original = structuredClone(data), f = fixture([data]);
    const events = await collect(f.model);
    assert.deepEqual(events.filter(e => e.type === 'tool_call_complete').map(e => e.call), [
        { callId: 'a', toolId, version: 1, args: { n: 1 } }, { callId: 'b', toolId, version: 1, args: { n: 2 } },
    ]);
    assert.equal(events.filter(e => e.type === 'done').length, 1);
    assert.equal(f.requests.length, 1); assert.deepEqual(f.diagnostics, []); assert.deepEqual(data, original);
});
test('stop compatibility retains private thinking for the next tool-result request', async () => {
    const first = response(); first.choices[0].message.reasoning_content = 'private reasoning';
    const final = response('stop', [], 'Done'); final.choices[0].message.reasoning_content = 'private final';
    const f = fixture([first, final], true), context = {}, input = request();
    const events = await collect(f.model, input, context), toolCall = events.find(e => e.type === 'tool_call_complete').call;
    await collect(f.model, { ...input, messages: [...input.messages, { role: 'assistant', content: '', toolCalls: [toolCall] }, { role: 'tool', callId: toolCall.callId, result: { ok: true, data: 1 } }] }, context);
    assert.equal(f.requests.length, 2);
    assert.equal(f.requests[1].messages.find(m => m.tool_calls).reasoning_content, 'private reasoning');
    assert.doesNotMatch(JSON.stringify(events), /private reasoning/);
});

const invalid = [
    ['unknown tool', [call('good'), { ...call('bad'), function: { name: 'not_advertised', arguments: '{}' } }]],
    ['duplicate IDs', [call(), call()]],
    ['invalid ID', [call('invalid id')]],
    ['invalid type', [{ ...call(), type: 'command' }]],
    ['malformed JSON', [call('good'), call('bad', '{')]],
    ['array arguments', [call('bad', '[]')]],
    ['null arguments', [call('bad', 'null')]],
    ['non-string arguments', [{ ...call(), function: { name: 'muyu_tool_0', arguments: {} } }]],
    ['non-array calls', {}],
    ['too many calls', Array.from({ length: 65 }, (_, i) => call('c' + i))],
];
for (const [name, calls] of invalid) test('stop does not relax batch validation: ' + name, async () => {
    const f = fixture([response('stop', calls, 'No partial text should escape')]), seen = [];
    await assert.rejects(async () => { for await (const event of f.model.run(request(), { signal: new AbortController().signal, context: {} })) seen.push(event); }, /MODEL_PROTOCOL_ERROR/);
    assert.deepEqual(seen, []); assert.equal(f.requests.length, 1); assert.deepEqual(f.diagnostics, [{ stage: 'decode', status: 'failed' }]);
});
for (const [finish, code] of [['length', 'MODEL_OUTPUT_TRUNCATED'], ['content_filter', 'MODEL_CONTENT_FILTERED'], ['unknown', 'MODEL_PROTOCOL_ERROR'], [null, 'MODEL_PROTOCOL_ERROR']]) {
    test('tool calls do not bypass finish rejection: ' + finish, async () => {
        const f = fixture([response(finish)]), seen = [];
        await assert.rejects(async () => { for await (const event of f.model.run(request(), { signal: new AbortController().signal, context: {} })) seen.push(event); }, new RegExp(code));
        assert.deepEqual(seen, []); assert.equal(f.requests.length, 1);
    });
}
test('tool_calls finish still requires calls, and stop without calls still requires text', async () => {
    for (const data of [response('tool_calls', [], 'not a tool call'), response('stop', [], '')]) {
        const f = fixture([data]); await assert.rejects(collect(f.model), /MODEL_PROTOCOL_ERROR/); assert.equal(f.requests.length, 1);
    }
    assert.deepEqual(await collect(fixture([response('stop', [], 'Answer')]).model), [{ type: 'text_delta', text: 'Answer' }, { type: 'done' }]);
});
test('stop cannot invent callable tools on a request with none advertised', async () => {
    const f = fixture([response()]); await assert.rejects(collect(f.model, { ...request(), tools: [] }), /MODEL_PROTOCOL_ERROR/); assert.equal(f.requests.length, 1);
});
test('compatibility does not bypass host authorization or replay the network request on handoff', async () => {
    const f = fixture([response()]); let calls = 0;
    const run = startMuyuRun({ identity, input: 'read', model: f.model, registry: registry(), allowedTools: [toolId], handlers: { [toolId]: () => { calls++; return 1; } },
        policy: () => ({ decision: 'permission_required', missingSources: ['source:memoryConfig'] }) });
    const result = await run.completion; await run.drained;
    assert.equal(result.state.status, 'yielded'); assert.equal(calls, 0); assert.equal(f.requests.length, 1);
});
test('compatibility preserves argument-schema rejection and explicit correction through the broker', async () => {
    const f = fixture([response('stop', [call('bad', '{"n":"wrong"}')]), response('stop', [call('fixed')]), response('stop', [], 'Done')]); let calls = 0;
    const run = startMuyuRun({ identity, input: 'read', model: f.model, registry: registry(), allowedTools: [toolId], handlers: { [toolId]: () => { calls++; return 1; } }, policy: () => true });
    assert.equal((await run.completion).answer, 'Done'); await run.drained;
    assert.equal(calls, 1); assert.equal(f.requests.length, 3);
    assert.equal(JSON.parse(f.requests[1].messages.at(-1).content).error.code, 'INVALID_ARGUMENT');
});
