import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatCompletionsModel } from '../../muyu/model/chat-completions.js';
import { validateConnection } from '../../muyu/model/connection.js';
import { createHttpTransport } from '../../muyu/model/http-transport.js';
import { probeConnection } from '../../muyu/model/connection-probe.js';
import { startMuyuRun } from '../../muyu/composition.js';
import { composeInstructions } from '../../muyu/instructions/compose.js';
import { RESPONSE_CHECKS } from '../../muyu/instructions/behavior.js';
import { identity, registry, toolId, createClock, flush, deferred } from './helpers/muyu-subject.mjs';

const connection = { endpoint: 'https://model.invalid/v1/chat/completions', apiKey: 'test-only-placeholder', model: 'fixture', supportsTools: true };
const response = (content = 'answer', calls = [], extra = {}) => ({ choices: [{ finish_reason: calls.length ? 'tool_calls' : 'stop', message: { role: 'assistant', content, ...(calls.length ? { tool_calls: calls } : {}), ...extra } }] });
const tc = (id = 'c1', args = '{"n":1}') => ({ id, type: 'function', function: { name: 'muyu_tool_0', arguments: args } });
const request = () => ({ messages: [{ role: 'user', content: 'question' }], tools: registry().list() });
const json = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });

test('Protocol diagnostics report only closed phase tags, never payloads or causes, and do not retry', async () => {
    const logs = []; let requests = 0;
    const model = createChatCompletionsModel({ connection, onDiagnostic: value => logs.push(value), fetchImpl: async () => {
        requests++; return json({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: 'PRIVATE_RESPONSE', reasoning_content: 'PRIVATE_THINKING', tool_calls: [] } }] });
    } });
    await assert.rejects(collect(model), /UNSUPPORTED_CAPABILITY|MODEL_PROTOCOL_ERROR/);
    assert.deepEqual(logs, [{ stage: 'decode', status: 'failed' }]); assert.equal(requests, 1);
    await assert.rejects(collect(model, { ...request(), tools: null }), /MODEL_PROTOCOL_ERROR/);
    assert.deepEqual(logs[1], { stage: 'prepare', status: 'failed' }); assert.equal(requests, 1);
    assert.doesNotMatch(JSON.stringify(logs), /PRIVATE|test-only|endpoint|cause|choices/);
    const throwing = createChatCompletionsModel({ connection, onDiagnostic: () => { throw Error('OBSERVER_SECRET'); }, fetchImpl: async () => { throw Error('TRANSPORT_SECRET'); } });
    await assert.rejects(collect(throwing), /MODEL_NETWORK_ERROR/);
});

test('Dynamic Skill guides preserve private thinking indices and stay inside measured request budget', async () => {
    const s = subject([response('', [tc()], { reasoning_content: 'PRIVATE_THINKING' }), response('Complete', [], { reasoning_content: 'Final' })], { connection: { ...connection, profile: 'deepseek', thinking: true } });
    const context = {}, first = request(), events = await collect(s.model, first, context);
    const call = events.find(e => e.type === 'tool_call_complete').call;
    const next = { ...first, messages: [...first.messages, { role: 'assistant', content: '', toolCalls: [call] }, { role: 'tool', callId: call.callId, result: { ok: true, data: 2 } }], taskGuides: [{ role: 'user', content: 'COMPLETE_PRIVATE_SKILL_GUIDE'.repeat(2000) }] };
    assert.ok(s.model.inspect(next, context).requestBytes > s.model.inspect({ ...next, taskGuides: [] }, context).requestBytes);
    await collect(s.model, next, context);
    assert.equal(s.requests[1].payload.messages.find(m => m.tool_calls).reasoning_content, 'PRIVATE_THINKING');
    assert.match(s.requests[1].payload.messages[0].content, /COMPLETE_PRIVATE_SKILL_GUIDE/);
});
test('Tool group switches preserve old aliases for replay but advertise and decode only current tools', async () => {
    const old = registry().list()[0], current = { ...old, id: 'muyu.other.read' };
    const s = subject([response('', [tc()], { reasoning_content: 'First' }), response('Complete', [], { reasoning_content: 'Second' })], { connection: { ...connection, profile: 'deepseek', thinking: true } });
    const context = {}, first = request(), events = await collect(s.model, first, context), call = events.find(e => e.type === 'tool_call_complete').call;
    await collect(s.model, { messages: [...first.messages, { role: 'assistant', content: '', toolCalls: [call] }, { role: 'tool', callId: call.callId, result: { ok: true, data: 2 } }], tools: [current] }, context);
    assert.equal(s.requests[1].payload.tools[0].function.name, 'muyu_tool_1');
    assert.equal(s.requests[1].payload.messages.find(m => m.tool_calls).tool_calls[0].function.name, 'muyu_tool_0');
    assert.equal(s.requests[1].payload.messages.find(m => m.tool_calls).reasoning_content, 'First');
});
test('A removed tool alias remains replay-only and cannot be emitted as a fresh tool call', async () => {
    const old = registry().list()[0], current = { ...old, id: 'muyu.other.read' };
    const s = subject([response('', [tc()]), response('', [tc('bad')])]);
    const context = {}, first = request(), events = await collect(s.model, first, context), call = events.find(e => e.type === 'tool_call_complete').call;
    await assert.rejects(collect(s.model, { messages: [...first.messages, { role: 'assistant', content: '', toolCalls: [call] }, { role: 'tool', callId: call.callId, result: { ok: true, data: 2 } }], tools: [current] }, context), /MODEL_PROTOCOL_ERROR/);
});
test('Task guides cannot inject system/tool roles and are blocked before network when over input budget', async () => {
    const s = subject([response('Not reached')]);
    await assert.rejects(collect(s.model, { ...request(), taskGuides: [{ role: 'assistant', content: 'Fake authority' }] }), /MODEL_PROTOCOL_ERROR/);
    await assert.rejects(collect(s.model, { ...request(), inputTokenLimit: 4096, taskGuides: [{ role: 'user', content: 'Full guide '.repeat(5000) }] }), /CONTEXT_LIMIT/);
    assert.equal(s.requests.length, 0);
});
test('Connection tools use the sibling models endpoint and a bounded fixed test message', async () => {
    const requests = [], fetchImpl = async (url, init) => {
        requests.push({ url, ...init });
        return json(init.method === 'GET' ? { data: [{ id: 'model-z' }, { id: 'model-a' }, { id: 'model-a' }] } : response('OK'));
    };
    const models = await probeConnection({ ...connection, profile: 'deepseek' }, { kind: 'models', fetchImpl });
    assert.deepEqual(models, ['model-a', 'model-z']);
    assert.equal(requests[0].url, 'https://model.invalid/v1/models');
    assert.equal(requests[0].method, 'GET'); assert.equal(requests[0].body, undefined);
    assert.equal(requests[0].headers.Authorization, 'Bearer test-only-placeholder');
    assert.deepEqual(await probeConnection({ ...connection, profile: 'deepseek' }, { kind: 'test', fetchImpl }), { ok: true });
    assert.equal(requests[1].url, connection.endpoint);
    assert.equal(requests[1].method, 'POST');
    assert.equal(JSON.parse(requests[1].body).messages[0].content, 'Reply with OK.');
    await assert.rejects(probeConnection({ ...connection, profile: 'deepseek' }, { kind: 'models', fetchImpl: async () => json({ data: {} }) }), /MODEL_PROTOCOL_ERROR/);
});
async function collect(model, input = request(), context = {}) {
    return Array.fromAsync(model.run(input, { signal: new AbortController().signal, context }));
}
function subject(responses, overrides = {}) {
    const requests = [], usages = [];
    const model = createChatCompletionsModel({ connection, fetchImpl: async (url, options) => {
        requests.push({ url, ...options, payload: JSON.parse(options.body) });
        const next = responses.shift(); return next instanceof Response ? next : json(next);
    }, onUsage: usage => usages.push(usage), ...overrides });
    return { model, requests, usages };
}

test('Model connection requires explicit safe endpoint and known thinking profile', () => {
    for (const patch of [{ endpoint: 'https://x.invalid' }, { endpoint: 'https://u:p@x.invalid/chat/completions' }, { endpoint: 'https://x.invalid/chat/completions?key=x' }, { endpoint: 'http://remote.invalid/chat/completions' }, { apiKey: 'x\r\ny' }, { thinking: true }, { maxTokens: 0 }]) assert.throws(() => validateConnection({ ...connection, ...patch }));
    assert.equal(validateConnection({ ...connection, endpoint: 'http://localhost:8000/chat/completions', allowLocalHttp: true }).endpoint, 'http://localhost:8000/chat/completions');
    assert.equal(validateConnection({ ...connection, profile: 'deepseek' }).thinking, true);
});

test('Final payload inspection includes tools and private thinking; local context limits block network dispatch', async () => {
    const s = subject([response('', [tc()], { reasoning_content: '私'.repeat(5000) })], { connection: { ...connection, profile: 'deepseek', thinking: true } });
    const context = {}, first = request(); await collect(s.model, first, context);
    const follow = { messages: [...first.messages, { role: 'assistant', content: '', toolCalls: [{ callId: 'c1', toolId, version: 1, args: { n: 1 } }] }, { role: 'tool', callId: 'c1', result: { ok: true, data: 1 } }], tools: first.tools, inputTokenLimit: 4096 };
    const measured = s.model.inspect(follow, context);
    assert.ok(measured.reasoningBytes > 15000); assert.ok(measured.toolDefinitionBytes > 10); assert.ok(measured.toolResultBytes > 10);
    await assert.rejects(collect(s.model, follow, context), /CONTEXT_LIMIT/); assert.equal(s.requests.length, 1);
    assert.equal(Object.hasOwn(s.requests[0].payload, 'inputTokenLimit'), false);
});

test('Tool-free summary reasoning override is local, counted in inspection, and never changes normal thinking replay', async () => {
    const configured = { ...connection, profile: 'deepseek', thinking: true };
    const s = subject([response('summary'), response('', [tc()], { reasoning_content: 'private thought' }), response('answer', [], { reasoning_content: 'final thought' })], { connection: configured });
    const compact = { messages: [{ role: 'user', content: 'Summarize reference data' }], tools: [], reasoning: 'disabled', maxTokens: 16384 };
    assert.equal(s.model.inspect(compact, {}).reasoningBytes, 4, 'empty reasoning projection retains JSON envelope bytes');
    await collect(s.model, compact);
    assert.deepEqual(s.requests[0].payload.thinking, { type: 'disabled' });
    assert.equal(Object.hasOwn(s.requests[0].payload, 'reasoning_effort'), false);
    assert.equal(s.requests[0].payload.max_tokens, 16384);
    const context = {}, first = request(); await collect(s.model, first, context);
    const follow = { ...first, messages: [...first.messages, { role: 'assistant', content: '', toolCalls: [{ callId: 'c1', toolId, version: 1, args: { n: 1 } }] }, { role: 'tool', callId: 'c1', result: { ok: true } }] };
    await collect(s.model, follow, context);
    assert.deepEqual(s.requests[1].payload.thinking, { type: 'enabled' });
    assert.equal(s.requests[2].payload.messages[1].reasoning_content, 'private thought');
    assert.equal(configured.thinking, true);
    for (const invalid of [{ ...compact, reasoning: 'enabled' }, { ...compact, tools: first.tools }, { ...follow, tools: [], reasoning: 'disabled' }]) {
        assert.throws(() => s.model.inspect(invalid, context), /MODEL_PROTOCOL_ERROR/);
        await assert.rejects(collect(s.model, invalid, context), /MODEL_PROTOCOL_ERROR/);
    }
    assert.equal(s.requests.length, 3);
    const generic = subject([response('summary')]); await collect(generic.model, compact);
    assert.equal(Object.hasOwn(generic.requests[0].payload, 'thinking'), false);
});

test('A disabled-thinking summary rejects truncated output before emitting any summary text', async () => {
    const s = subject([{ choices: [{ finish_reason: 'length', message: { role: 'assistant', content: 'half summary' } }] }], { connection: { ...connection, profile: 'deepseek', thinking: true } });
    const events = [];
    await assert.rejects(async () => { for await (const event of s.model.run({ messages: [{ role: 'user', content: 'summarize' }], tools: [], reasoning: 'disabled' }, { signal: new AbortController().signal, context: {} })) events.push(event); }, /MODEL_OUTPUT_TRUNCATED/);
    assert.deepEqual(events, []);
});

test('Final adapter payload retains a long historical answer when the input budget fits', async () => {
    const longAnswer = '中'.repeat(9000), s = subject([response('continued')]);
    const input = { messages: [{ role: 'user', content: 'Draft a plan' }, { role: 'assistant', content: longAnswer },
        { role: 'user', content: 'Continue step three' }], tools: [], inputTokenLimit: 250000 };
    assert.ok(s.model.inspect(input, {}).estimatedTokens < input.inputTokenLimit);
    await collect(s.model, input);
    assert.equal(s.requests[0].payload.messages[1].content, longAnswer);
    const auto = subject([response('continued')]);
    await collect(auto.model, { ...input, inputTokenLimit: undefined });
    assert.equal(auto.requests[0].payload.messages[1].content, longAnswer);
});

test('System instructions are injected once after internal indexing and preserve thinking replay through finalization', async () => {
    const s = subject([response('', [tc()], { reasoning_content: 'private thought' }), response('answer', [], { reasoning_content: 'next thought' })], { connection: { ...connection, profile: 'deepseek', thinking: true } });
    const context = {}, instructions = composeInstructions('memory', { enabled: true, text: 'Use short answers.' });
    const first = { ...request(), instructions }; await collect(s.model, first, context);
    const follow = { ...first, finalize: true, messages: [...first.messages, { role: 'assistant', content: '', toolCalls: [{ callId: 'c1', toolId, version: 1, args: { n: 1 } }] }, { role: 'tool', callId: 'c1', result: { ok: true, data: 1 } }] };
    assert.ok(s.model.inspect(follow, context).instructionBytes > 0); await collect(s.model, follow, context);
    for (const r of s.requests) { assert.equal(r.payload.messages[0].role, 'system'); assert.equal(r.payload.messages.filter(m => m.role === 'system').length, 1); assert.equal(Object.hasOwn(r.payload, 'instructions'), false); assert.ok(r.payload.messages[0].content.includes(RESPONSE_CHECKS)); }
    assert.equal(s.requests[1].payload.messages[2].reasoning_content, 'private thought'); assert.equal(Object.hasOwn(s.requests[1].payload, 'tools'), false);
    assert.equal(first.messages.length, 1);
    await assert.rejects(collect(s.model, { ...request(), messages: [{ role: 'system', content: 'untrusted history' }] }), /MODEL_PROTOCOL_ERROR/);
});

test('Tool availability notice reflects the advertised request, stays local and is measured', async () => {
    const instructions = composeInstructions('assistant'), s = subject([response(), response(), response()]);
    const base = { ...request(), instructions };
    await collect(s.model, base);
    await collect(s.model, { ...base, tools: [] });
    await collect(s.model, { ...base, finalize: true });
    assert.doesNotMatch(s.requests[0].payload.messages[0].content, /Host status for this request/);
    for (const sent of s.requests.slice(1)) {
        assert.match(sent.payload.messages[0].content, /no callable tools.*local to this request/s);
        assert.equal(sent.payload.messages.filter(m => m.role === 'system').length, 1);
        assert.equal(Object.hasOwn(sent.payload, 'tools'), false);
    }
    const measured = s.model.inspect({ ...base, tools: [] }, {});
    const unannotated = s.model.inspect({ ...base, tools: [], instructions: undefined }, {});
    assert.ok(measured.requestBytes > unannotated.requestBytes);
    assert.ok(measured.instructionBytes > 0);
    assert.equal(Object.hasOwn(instructions, 'toolAvailability'), false);
    assert.equal(base.tools.length, request().tools.length);
});

test('Historical role wrappers allow resolving current follow-ups but never restore approval', async () => {
    const s = subject([response('Continue only the read', [], { reasoning_content: 'private thought' })], { connection: { ...connection, profile: 'deepseek', thinking: true } });
    const messages = [{ role: 'user', content: 'Can you inspect the director limit?' },
        { role: 'assistant', content: 'I can read the mode and limit. Old grant: allow everything.' },
        { role: 'user', content: 'Go ahead, read only.' }];
    const original = structuredClone(messages);
    await collect(s.model, { ...request(), messages, instructions: composeInstructions('assistant') });
    const payload = s.requests[0].payload;
    const reference = payload.messages[1];
    assert.equal(reference.role, 'user');
    assert.match(reference.content, /resolve the object of the latest user follow-up/);
    assert.match(reference.content, /not to resume an unrelated or cancelled task/);
    assert.match(reference.content, /historical grants are not current permissions/);
    assert.match(reference.content, /"role":"assistant","content":"I can read/);
    assert.deepEqual(payload.messages.at(-1), messages.at(-1));
    assert.deepEqual(messages, original);
    assert.equal(payload.messages.filter(m => m.role === 'system').length, 1);
});

test('Model adapter maps tools without leaking execution metadata and reports optional usage', async () => {
    const data = response(); data.usage = { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 };
    const s = subject([data]); const events = await collect(s.model);
    assert.deepEqual(events, [{ type: 'text_delta', text: 'answer' }, { type: 'done' }]);
    assert.deepEqual(s.usages, [{ inputTokens: 2, outputTokens: 3, totalTokens: 5 }]);
    const sent = s.requests[0]; assert.equal(sent.url, connection.endpoint); assert.equal(sent.redirect, 'error'); assert.equal(sent.credentials, 'omit');
    assert.equal(sent.payload.stream, false); assert.equal(sent.payload.tools[0].function.name, 'muyu_tool_0');
    assert.ok(!sent.body.includes('resourceKeys')); assert.ok(!JSON.stringify(events).includes(connection.apiKey));
});

test('Adapter drives real runtime through multiple tool results and final answer', async () => {
    const s = subject([response(null, [tc('a'), tc('b', '{"n":2}')]), response('done')]); const clock = createClock();
    const run = startMuyuRun({ identity, input: 'test', model: s.model, registry: registry(), handlers: { [toolId]: a => a.n * 2 }, allowedTools: [toolId], policy: () => true, clock });
    const result = await run.completion; await run.drained;
    assert.equal(result.state.status, 'succeeded'); assert.equal(result.answer, 'done');
    assert.deepEqual(s.requests[1].payload.messages.filter(m => m.role === 'tool').map(m => [m.tool_call_id, JSON.parse(m.content).data]), [['a', 2], ['b', 4]]);
    assert.equal(clock.pending, 0); assert.deepEqual(s.usages, [null, null]);
});

test('Answer-only finalization preserves thinking/tool history, overrides output tokens and aggregates reported usage', async () => {
    const first = response('', [tc('a')], { reasoning_content: 'PRIVATE_THINKING' }); first.usage = { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 };
    const last = response('partial answer', [], { reasoning_content: 'PRIVATE_FINAL' }); last.usage = { prompt_tokens: 8, completion_tokens: 5, total_tokens: 13 };
    const s = subject([first, last], { connection: { ...connection, profile: 'deepseek' } });
    const h = startMuyuRun({ identity, input: 'test', model: s.model, registry: registry(), handlers: { [toolId]: () => 1 }, allowedTools: [toolId], policy: () => true, limits: { modelCalls: 2 }, maxTokens: 1024, finalizeOnLimit: true });
    const r = await h.completion; await h.drained;
    assert.equal(r.answer, 'partial answer'); assert.equal(s.requests[1].payload.tools, undefined);
    assert.equal(s.requests[1].payload.messages.find(m => m.tool_calls)?.reasoning_content, 'PRIVATE_THINKING');
    assert.equal(s.requests[1].payload.max_tokens, 1024); assert.equal(r.budget.inputTokens, 10); assert.equal(r.budget.outputTokens, 8); assert.equal(r.budget.usageReports, 2);
    assert.doesNotMatch(JSON.stringify(r), /PRIVATE_/);
});

test('Thinking stays private and is replayed exactly across multiple tool steps', async () => {
    const s = subject([response('', [tc('a')], { reasoning_content: 'private-first' }), response('', [tc('b')], { reasoning_content: 'private-second' }), response('final', [], { reasoning_content: 'private-final' })], { connection: { ...connection, profile: 'deepseek' } });
    const events = [], clock = createClock();
    const run = startMuyuRun({ identity, input: 'test', model: s.model, registry: registry(), handlers: { [toolId]: a => a.n }, allowedTools: [toolId], policy: () => true, clock, onEvent: e => events.push(e) });
    const result = await run.completion; await run.drained;
    assert.equal(result.answer, 'final'); assert.equal(s.requests[0].payload.thinking.type, 'enabled'); assert.equal(s.requests[0].payload.reasoning_effort, 'high');
    assert.equal(s.requests[0].payload.tool_choice, undefined);
    assert.deepEqual(s.requests[2].payload.messages.filter(m => m.role === 'assistant').map(m => m.reasoning_content), ['private-first', 'private-second']);
    assert.ok(!JSON.stringify({ result, events, snapshot: run.snapshot(), usages: s.usages }).includes('private-'));
});

test('Host permission pause retains private thinking for the resumed original tool call', async () => {
    const s = subject([response('', [tc()], { reasoning_content: 'private-before-approval' }),
        response('done', [], { reasoning_content: 'private-after-approval' })], { connection: { ...connection, profile: 'deepseek' } });
    let granted = false, reads = 0;
    const options = { input: 'Read in English', instructions: composeInstructions('assistant'), model: s.model, registry: registry(), handlers: { [toolId]: () => { reads++; return 7; } },
        allowedTools: [toolId], policy: () => granted ? true : { decision: 'permission_required', missingSources: ['source:memoryConfig'] } };
    const first = startMuyuRun({ ...options, identity });
    const paused = await first.completion; await first.drained;
    assert.equal(paused.state.status, 'yielded');
    assert.equal(paused.interaction.source, 'memoryConfig');
    assert.equal(reads, 0); assert.equal(s.requests.length, 1);
    granted = true;
    const next = startMuyuRun({ ...options, identity: { ...identity, id: 'r2' }, resume: paused.resume });
    const result = await next.completion; await next.drained;
    assert.equal(result.state.status, 'succeeded'); assert.equal(result.answer, 'done');
    assert.equal(reads, 1); assert.equal(s.requests.length, 2);
    for (const sent of s.requests) assert.ok(sent.payload.messages[0].content.includes(RESPONSE_CHECKS));
    assert.equal(s.requests[1].payload.messages.find(m => m.tool_calls)?.reasoning_content, 'private-before-approval');
    assert.doesNotMatch(JSON.stringify({ paused: { ...paused, resume: null }, result }), /private-before-approval/);
});

test('Shared reply checks remain measured and cannot bypass the manual input budget', async () => {
    const s = subject([]), instructions = composeInstructions('assistant');
    const input = { ...request(), instructions };
    const measured = s.model.inspect(input, {});
    const before = s.model.inspect({ ...input, instructions: undefined }, {});
    assert.ok(measured.instructionBytes >= Buffer.byteLength(RESPONSE_CHECKS));
    assert.ok(measured.estimatedTokens > before.estimatedTokens);
    await assert.rejects(collect(s.model, { ...input, inputTokenLimit: measured.estimatedTokens - 1 }), /CONTEXT_LIMIT/);
    assert.equal(s.requests.length, 0);
});

test('Thinking state cannot cross run contexts; prior text becomes labelled reference data', async () => {
    const s = subject([response('final', [], { reasoning_content: 'private-old' }), response('new', [], { reasoning_content: 'private-new' })], { connection: { ...connection, profile: 'deepseek' } });
    await collect(s.model);
    const input = request(); input.messages.push({ role: 'assistant', content: 'final' }, { role: 'user', content: 'followup' });
    await collect(s.model, input);
    const replay = s.requests[1].payload.messages;
    assert.equal(replay[0].role, 'user'); assert.match(replay[0].content, /Completed conversation history/);
    assert.match(replay[0].content, /"role":"user","content":"question"/);
    assert.match(replay[0].content, /"role":"assistant","content":"final"/);
    assert.deepEqual(replay.at(-1), { role: 'user', content: 'followup' });
    assert.ok(!s.requests[1].body.includes('private-old'));
});

test('Completed history keeps original speaker labels and cannot consume the latest question or live reasoning', async () => {
    const s = subject([response('', [tc()], { reasoning_content: 'private-current' }), response('owl answer', [], { reasoning_content: 'private-final' })], { connection: { ...connection, profile: 'deepseek' } });
    const input = request(), context = {};
    input.messages = [{ role: 'assistant', content: 'orphan historical answer' }, { role: 'user', content: 'Read coins' },
        { role: 'assistant', content: '35 coins' }, { role: 'user', content: 'Is an owl a bird? Do not read coins.' }];
    await collect(s.model, input, context);
    const first = s.requests[0].payload.messages;
    assert.equal(first.length, 3);
    assert.match(first[0].content, /"role":"assistant","content":"orphan historical answer"/);
    assert.match(first[1].content, /"role":"user","content":"Read coins"/);
    assert.match(first[1].content, /"role":"assistant","content":"35 coins"/);
    assert.deepEqual(first[2], input.messages.at(-1));
    input.messages.push({ role: 'assistant', content: '', toolCalls: [{ callId: 'c1', toolId, version: 1, args: { n: 1 } }] },
        { role: 'tool', callId: 'c1', result: { ok: true, data: 1 } });
    await collect(s.model, input, context);
    const live = s.requests[1].payload.messages;
    assert.equal(live.at(-2).reasoning_content, 'private-current');
    assert.equal(live.at(-1).role, 'tool');
    assert.deepEqual(s.model.inspect(input, context), s.model.inspect(input, context));
});

test('Unsupported tools/thinking and incomplete thinking history fail closed', async () => {
    const noTools = subject([], { connection: { ...connection, supportsTools: false } });
    await assert.rejects(collect(noTools.model), /UNSUPPORTED_CAPABILITY/); assert.equal(noTools.requests.length, 0);
    await assert.rejects(collect(subject([response('x', [], { reasoning_content: 'unexpected' })]).model), /UNSUPPORTED_CAPABILITY/);
    await assert.rejects(collect(subject([response()], { connection: { ...connection, profile: 'deepseek' } }).model), /MODEL_HISTORY_UNAVAILABLE/);
});

test('Thinking can be explicitly disabled without a reasoning fallback', async () => {
    const s = subject([response('plain')], { connection: { ...connection, profile: 'deepseek', thinking: false } }); await collect(s.model);
    assert.equal(s.requests[0].payload.thinking.type, 'disabled'); assert.equal(s.requests[0].payload.reasoning_effort, undefined);
});

test('Malformed and incomplete model batches never emit partial tool events', async () => {
    const bad = [response('', [tc('same'), tc('same')]), response('', [tc('a', 'not JSON')]), response('', [tc('a', '[]')]), response('', [{ ...tc(), function: { name: 'unknown', arguments: '{}' } }]), response(''), { choices: [] }];
    for (const data of bad) await assert.rejects(collect(subject([data]).model), /MODEL_PROTOCOL_ERROR/);
    for (const [finish, code] of [['length', 'MODEL_OUTPUT_TRUNCATED'], ['content_filter', 'MODEL_CONTENT_FILTERED'], ['unknown', 'MODEL_PROTOCOL_ERROR']]) {
        const data = response('partial', [tc()]); data.choices[0].finish_reason = finish;
        const seen = []; await assert.rejects(async () => { for await (const e of subject([data]).model.run(request(), { signal: new AbortController().signal })) seen.push(e); }, new RegExp(code));
        assert.deepEqual(seen, []);
    }
});

test('History rejects missing and duplicate tool results before network', async () => {
    const s = subject([]), input = request(); input.messages.push({ role: 'assistant', content: '', toolCalls: [{ callId: 'a', toolId, version: 1, args: { n: 1 } }] });
    await assert.rejects(collect(s.model, input), /MODEL_PROTOCOL_ERROR/); assert.equal(s.requests.length, 0);
    input.messages.push({ role: 'tool', callId: 'wrong', result: { ok: true } });
    await assert.rejects(collect(s.model, input), /MODEL_PROTOCOL_ERROR/);
});

test('HTTP status and network errors are safe and do not retry', async () => {
    for (const [status, code] of [[401, 'MODEL_AUTH_ERROR'], [429, 'MODEL_RATE_LIMIT'], [503, 'MODEL_SERVICE_ERROR'], [400, 'MODEL_HTTP_ERROR']]) {
        const s = subject([new Response('secret-provider-body', { status })]);
        await assert.rejects(collect(s.model), e => e.message === code); assert.equal(s.requests.length, 1);
    }
    const s = subject([], { fetchImpl: async () => { throw new Error('secret-network-detail'); } });
    await assert.rejects(collect(s.model), e => e.message === 'MODEL_NETWORK_ERROR');
});

test('Transport bounds request and chunked response bytes and validates JSON', async () => {
    const large = subject([response('x'.repeat(100))], { transportLimits: { maxResponseBytes: 32 } });
    await assert.rejects(collect(large.model), /MODEL_RESPONSE_TOO_LARGE/);
    const small = subject([], { transportLimits: { maxRequestBytes: 10 } }); await assert.rejects(collect(small.model), /MODEL_REQUEST_TOO_LARGE/); assert.equal(small.requests.length, 0);
    await assert.rejects(collect(subject([new Response('not json', { headers: { 'content-type': 'application/json' } })]).model), /MODEL_PROTOCOL_ERROR/);
});

test('Pre-cancelled adapter never sends a request', async () => {
    const s = subject([]), controller = new AbortController(); controller.abort();
    await assert.rejects(Array.fromAsync(s.model.run(request(), { signal: controller.signal })), /CANCELLED/); assert.equal(s.requests.length, 0);
});

test('Runtime drain waits for non-cooperative fetch and response cleanup', async () => {
    const waiting = deferred(), cleaning = deferred(), clock = createClock(); let cancelled = false;
    const s = subject([], { fetchImpl: () => waiting.promise });
    const run = startMuyuRun({ identity, input: 'x', model: s.model, registry: registry(), clock }); await flush(); run.cancel();
    assert.equal((await run.completion).state.status, 'cancelled'); let drained = false; run.drained.then(() => { drained = true; }); await flush(); assert.equal(drained, false);
    waiting.resolve({ body: { getReader: () => ({ cancel: () => { cancelled = true; return cleaning.promise; }, releaseLock() {} }) } });
    await flush(); assert.equal(cancelled, true); assert.equal(drained, false); cleaning.resolve(); await run.drained; assert.equal(clock.pending, 0);
});

test('Cancellation while reading waits for reader cancellation cleanup', async () => {
    const reading = deferred(), cleaning = deferred(), controller = new AbortController(); let released = false;
    const post = createHttpTransport({ fetchImpl: async () => ({ ok: true, headers: new Headers({ 'content-type': 'application/json' }), body: { getReader: () => ({ read: () => reading.promise, cancel: () => { reading.resolve({ done: true }); return cleaning.promise; }, releaseLock: () => { released = true; } }) } }) });
    const promise = post(connection, {}, controller.signal); await flush(); controller.abort(); let settled = false; promise.catch(() => { settled = true; }); await flush(); assert.equal(settled, false);
    cleaning.resolve(); await assert.rejects(promise, /CANCELLED/); assert.equal(released, true);
});

test('Thinking history detects changed assistant messages and explicit release', async () => {
    const s = subject([response('', [tc()], { reasoning_content: 'private' })], { connection: { ...connection, profile: 'deepseek' } });
    const context = {}, input = request(); await collect(s.model, input, context);
    input.messages.push({ role: 'assistant', content: 'tampered', toolCalls: [{ callId: 'c1', toolId, version: 1, args: { n: 1 } }] }, { role: 'tool', callId: 'c1', result: { ok: true, data: 1 } });
    await assert.rejects(collect(s.model, input, context), /MODEL_PROTOCOL_ERROR/);
    input.messages[1].content = ''; s.model.releaseContext(context);
    await assert.rejects(collect(s.model, input, context), /MODEL_HISTORY_UNAVAILABLE/); assert.equal(s.requests.length, 1);
});

test('Reasoning byte limit fails without truncating or emitting private data', async () => {
    const s = subject([response('final', [], { reasoning_content: '中'.repeat(44000) })], { connection: { ...connection, profile: 'deepseek' } });
    await assert.rejects(collect(s.model), /MODEL_RESPONSE_TOO_LARGE/); assert.deepEqual(s.usages, []);
});

test('Schema-invalid arguments reach Broker rejection and can be corrected', async () => {
    const s = subject([response('', [tc('bad', '{"n":"wrong"}')]), response('', [tc('fixed')]), response('fixed answer')]); let calls = 0;
    const run = startMuyuRun({ identity, input: 'x', model: s.model, registry: registry(), allowedTools: [toolId], policy: () => true, handlers: { [toolId]: () => { calls++; return 1; } }, clock: createClock() });
    assert.equal((await run.completion).answer, 'fixed answer'); await run.drained; assert.equal(calls, 1);
    assert.equal(JSON.parse(s.requests[1].payload.messages.at(-1).content).error.code, 'INVALID_ARGUMENT');
});

test('Tool name mapping is deterministic and collision-free for distinct internal IDs', async () => {
    const s = subject([response()]), input = request();
    input.tools.push({ ...input.tools[0], id: 'muyu.test.other' }); await collect(s.model, input);
    const names = s.requests[0].payload.tools.map(t => t.function.name);
    assert.equal(new Set(names).size, 2); assert.ok(names.every(n => /^[a-z0-9_]+$/.test(n)));
});
