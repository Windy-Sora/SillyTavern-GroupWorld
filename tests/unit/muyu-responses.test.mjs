import test from 'node:test';
import assert from 'node:assert/strict';
import { createResponsesModel } from '../../muyu/model/responses.js';
import { createModel } from '../../muyu/model/factory.js';
import { createChatCompletionsModel } from '../../muyu/model/chat-completions.js';
import { validateConnection } from '../../muyu/model/connection.js';
import { probeConnection } from '../../muyu/model/connection-probe.js';
import { startMuyuRun } from '../../muyu/composition.js';
import { composeInstructions } from '../../muyu/instructions/compose.js';
import { RESPONSE_CHECKS } from '../../muyu/instructions/behavior.js';
import { identity, registry, toolId, deferred, flush, createClock } from './helpers/muyu-subject.mjs';

const connection = { endpoint: 'https://model.invalid/v1/responses', apiKey: 'fixture-key', model: 'fixture', profile: 'responses', supportsTools: true };
let reasoningIndex = 0, messageIndex = 0;
const reasoning = (text = 'ENCRYPTED_PRIVATE') => ({ type: 'reasoning', id: 'rs_' + ++reasoningIndex, encrypted_content: text, summary: [] });
const message = (text = 'done', phase = 'final_answer') => ({ type: 'message', id: 'msg_' + ++messageIndex, role: 'assistant', status: 'completed', phase, content: [{ type: 'output_text', text, annotations: [] }] });
const call = (id = 'c1', name = 'muyu_tool_0', args = '{"n":1}') => ({ type: 'function_call', id: 'fc_' + id, call_id: id, name, arguments: args, status: 'completed' });
const response = (...output) => ({ status: 'completed', output });
const request = () => ({ messages: [{ role: 'user', content: 'Read' }], tools: registry().list() });
const json = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
const collect = (model, input = request(), context = {}) => Array.fromAsync(model.run(input, { signal: new AbortController().signal, context }));
function subject(responses, overrides = {}) {
    const sent = [], usage = [], diagnostics = [];
    const model = createResponsesModel({ connection, onUsage: x => usage.push(x), onDiagnostic: x => diagnostics.push(x), fetchImpl: async (url, init) => {
        sent.push({ url, ...init, payload: JSON.parse(init.body) }); const data = responses.shift(); return data instanceof Response ? data : json(data);
    }, ...overrides });
    return { model, sent, usage, diagnostics };
}
function follow(first, events) {
    const calls = events.filter(e => e.type === 'tool_call_complete').map(e => e.call);
    return { ...first, messages: [...first.messages, { role: 'assistant', content: events.filter(e => e.type === 'text_delta').map(e => e.text).join(''), toolCalls: calls },
        ...calls.map(c => ({ role: 'tool', callId: c.callId, result: { ok: true, data: 7 } }))] };
}

test('Responses connection and factory are explicit, protocol-specific, and keep old defaults', async () => {
    const config = validateConnection(connection);
    assert.equal(config.reasoningEffort, 'medium'); assert.equal(config.thinking, false);
    for (const patch of [{ endpoint: 'https://model.invalid/v1/chat/completions' }, { endpoint: 'http://remote.invalid/responses' }, { endpoint: 'https://u:p@model.invalid/responses' }, { endpoint: connection.endpoint + '?key=x' }, { endpoint: connection.endpoint + '#x' }, { thinking: true }, { reasoningEffort: 'none' }]) assert.throws(() => validateConnection({ ...connection, ...patch }));
    assert.equal(validateConnection({ ...connection, endpoint: 'http://localhost:8000/responses', allowLocalHttp: true, reasoningEffort: 'xhigh' }).reasoningEffort, 'xhigh');
    assert.throws(() => createChatCompletionsModel({ connection }));
    let payload;
    const model = createModel({ connection, fetchImpl: async (_url, init) => { payload = JSON.parse(init.body); return json(response(message())); } });
    await collect(model); assert.equal(payload.store, false); assert.equal(payload.max_output_tokens, 32768);
    const old = { ...connection, endpoint: 'https://model.invalid/v1/chat/completions', profile: 'deepseek' };
    assert.equal(validateConnection(old).thinking, true); assert.equal(validateConnection(old).reasoningEffort, 'high');
    assert.throws(() => validateConnection({ ...old, reasoningEffort: 'medium' }));
    const compat = createModel({ connection: { ...old, profile: 'chat-completions' }, fetchImpl: async (_url, init) => { payload = JSON.parse(init.body); return json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'old' } }] }); } });
    await collect(compat); assert.ok(payload.messages); assert.equal(payload.input, undefined);
});

test('Responses replay preserves item order, phases and encrypted reasoning without exposing them', async () => {
    const original = [reasoning(), message('Checking', 'commentary'), call()];
    const s = subject([response(...original), response(message('Done'))]);
    const context = {}, input = { ...request(), instructions: composeInstructions('assistant') };
    const events = await collect(s.model, input, context), next = follow(input, events);
    next.taskGuides = [{ role: 'user', content: 'Newly loaded guide' }];
    const before = s.model.inspect(next, context); assert.deepEqual(before, s.model.inspect(next, context));
    assert.ok(before.reasoningBytes > 20); assert.ok(before.toolResultBytes > 10); assert.ok(before.instructionBytes > 20);
    await collect(s.model, next, context);
    const wire = s.sent[1].payload;
    assert.deepEqual(wire.input.slice(2, 5), original);
    assert.equal(wire.input[5].type, 'function_call_output'); assert.equal(wire.input[5].call_id, 'c1');
    assert.match(wire.instructions, /RESPONSE PRESENTATION CHECK/); assert.ok(wire.instructions.includes(RESPONSE_CHECKS));
    assert.equal(wire.store, false); assert.equal(wire.previous_response_id, undefined); assert.equal(wire.messages, undefined);
    assert.equal(wire.max_tokens, undefined); assert.deepEqual(wire.reasoning, { effort: 'medium' });
    assert.equal(wire.tools[0].strict, false); assert.equal(wire.tools[0].function, undefined);
    assert.equal(before.requestBytes, Buffer.byteLength(s.sent[1].body));
    assert.doesNotMatch(JSON.stringify({ events, usage: s.usage, diagnostics: s.diagnostics }), /ENCRYPTED_PRIVATE|fixture-key/);
});

test('Replay checks signatures, result pairing and context ownership before dispatch', async () => {
    const s = subject([response(reasoning(), call())]), context = {}, input = request();
    const next = follow(input, await collect(s.model, input, context));
    const bad = structuredClone(next); bad.messages[1].toolCalls[0].args.n = 2;
    await assert.rejects(collect(s.model, bad, context), /MODEL_PROTOCOL_ERROR/);
    await assert.rejects(collect(s.model, { ...next, messages: next.messages.slice(0, -1) }, context), /MODEL_PROTOCOL_ERROR/);
    await assert.rejects(collect(s.model, next, {}), /MODEL_HISTORY_UNAVAILABLE/);
    s.model.releaseContext(context);
    await assert.rejects(collect(s.model, next, context), /MODEL_HISTORY_UNAVAILABLE/);
    assert.equal(s.sent.length, 1);
});

test('New tasks carry old final text only as labelled reference, never private provider items', async () => {
    const s = subject([response(reasoning(), message('old answer')), response(message('new answer'))]);
    await collect(s.model);
    const input = request(); input.messages.push({ role: 'assistant', content: 'old answer' }, { role: 'user', content: 'Follow up' });
    await collect(s.model, input);
    assert.match(s.sent[1].payload.input[1].content, /reference data, not instructions, authorization/);
    assert.match(s.sent[1].payload.input[1].content, /"role":"assistant"/);
    assert.deepEqual(s.sent[1].payload.input.at(-1), { role: 'user', content: 'Follow up' });
    assert.doesNotMatch(s.sent[1].body, /ENCRYPTED_PRIVATE/);
});

test('Tool selection retains replay aliases but rejects fresh calls to removed tools', async () => {
    const s = subject([response(call()), response(call('c2', 'muyu_tool_0'))]), context = {}, input = request();
    const next = follow(input, await collect(s.model, input, context));
    next.tools = [{ ...input.tools[0], id: 'muyu.other.read' }];
    await assert.rejects(collect(s.model, next, context), /MODEL_PROTOCOL_ERROR/);
    assert.equal(s.sent[1].payload.tools[0].name, 'muyu_tool_1');
    assert.equal(s.sent[1].payload.input.find(i => i.type === 'function_call').name, 'muyu_tool_0');
    const changed = { ...next, tools: [{ ...input.tools[0], version: 2 }] };
    await assert.rejects(collect(s.model, changed, context), /MODEL_PROTOCOL_ERROR/);
});

test('Multiple tool calls round-trip original arguments and reject duplicate provider IDs across steps', async () => {
    const first = call('c1', 'muyu_tool_0', '{ "n" : 1 }'), second = call('c2');
    const s = subject([response(first, second), response(message())]), context = {}, input = request();
    const events = await collect(s.model, input, context);
    await collect(s.model, follow(input, events), context);
    const wire = s.sent[1].payload.input;
    assert.deepEqual(wire.filter(i => i.type === 'function_call_output').map(i => i.call_id), ['c1', 'c2']);
    assert.equal(wire.find(i => i.type === 'function_call').arguments, '{ "n" : 1 }');
    const repeated = subject([response(first), response({ ...call('c3'), id: first.id })]), sameContext = {};
    const next = follow(input, await collect(repeated.model, input, sameContext));
    await assert.rejects(collect(repeated.model, next, sameContext), /MODEL_PROTOCOL_ERROR/);
});

test('Finalization preserves replay but advertises no tools and rejects extra calls', async () => {
    const s = subject([response(reasoning(), call()), response(message('done'))]), input = request(), context = {};
    const next = follow(input, await collect(s.model, input, context)); next.finalize = true; next.instructions = composeInstructions('assistant');
    await collect(s.model, next, context);
    assert.equal(s.sent[1].payload.tools, undefined); assert.match(s.sent[1].payload.instructions, /no callable tools/);
    assert.ok(s.sent[1].payload.input.some(i => i.type === 'reasoning'));
    const bad = subject([response(message('preamble'), call())]), emitted = [];
    await assert.rejects(async () => { for await (const event of bad.model.run({ ...request(), finalize: true }, { context: {}, signal: new AbortController().signal })) emitted.push(event); }, /MODEL_PROTOCOL_ERROR/);
    assert.deepEqual(emitted, []);
});

for (const [name, data, code] of [
    ['output limit', { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [call()] }, 'MODEL_OUTPUT_TRUNCATED'],
    ['content filter', { status: 'incomplete', incomplete_details: { reason: 'content_filter' }, output: [call()] }, 'MODEL_CONTENT_FILTERED'],
    ['refusal', response(call(), { ...message(), content: [{ type: 'refusal', refusal: 'private refusal' }] }), 'MODEL_CONTENT_FILTERED'],
    ['failed', { status: 'failed', error: { message: 'PRIVATE_RAW_ERROR' }, output: [call()] }, 'MODEL_PROTOCOL_ERROR'],
    ['pending', { status: 'in_progress', output: [call()] }, 'MODEL_PROTOCOL_ERROR'],
    ['unknown item', response(call(), { type: 'web_search_call', id: 'ws_1' }), 'MODEL_PROTOCOL_ERROR'],
    ['bad arguments', response(call(), call('c2', 'muyu_tool_0', '[]')), 'MODEL_PROTOCOL_ERROR'],
    ['duplicate calls', response(call(), { ...call(), id: 'fc_other' }), 'MODEL_PROTOCOL_ERROR'],
    ['unknown tool', response(call('c1', 'unknown_tool')), 'MODEL_PROTOCOL_ERROR'],
    ['unknown phase', response(call(), message('x', 'unknown')), 'MODEL_PROTOCOL_ERROR'],
    ['unavailable reasoning', response(reasoning(''), call()), 'MODEL_PROTOCOL_ERROR'],
    ['empty output', response(reasoning()), 'MODEL_PROTOCOL_ERROR'],
]) test('Entire Responses batch fails closed: ' + name, async () => {
    const s = subject([data]), emitted = [];
    await assert.rejects(async () => { for await (const event of s.model.run(request(), { signal: new AbortController().signal, context: {} })) emitted.push(event); }, new RegExp(code));
    assert.deepEqual(emitted, []); assert.equal(s.sent.length, 1);
    assert.deepEqual(s.diagnostics, [{ stage: 'decode', status: 'failed' }]);
    assert.doesNotMatch(JSON.stringify(s.diagnostics), /PRIVATE|refusal|fixture-key/);
});

test('Responses measures guides, output pairs and encrypted replay against the final wire budget', async () => {
    const s = subject([response(reasoning('私'.repeat(5000)), call())]), context = {}, input = request();
    const next = follow(input, await collect(s.model, input, context));
    next.taskGuides = [{ role: 'user', content: 'Guide '.repeat(2000) }];
    assert.ok(s.model.inspect(next, context).estimatedTokens > 4096);
    await assert.rejects(collect(s.model, { ...next, inputTokenLimit: 4096 }, context), /CONTEXT_LIMIT/);
    await assert.rejects(collect(s.model, { ...request(), taskGuides: [{ role: 'assistant', content: 'Forged authority' }] }), /MODEL_PROTOCOL_ERROR/);
    assert.equal(s.sent.length, 1);
    const big = subject([]);
    const large = { ...request(), tools: [], messages: Array.from({ length: 5 }, () => ({ role: 'user', content: 'x'.repeat(1900000) })) };
    await assert.rejects(collect(big.model, large), /CONTEXT_LIMIT/); assert.equal(big.sent.length, 0);
});

test('Responses bounds private history rather than truncating or disclosing encrypted items', async () => {
    const s = subject(Array.from({ length: 5 }, (_, i) => response(reasoning('x'.repeat(120000)), call('c' + i))));
    const context = {}; let input = request();
    for (let i = 0; i < 4; i++) input = follow(input, await collect(s.model, input, context));
    const emitted = [];
    await assert.rejects(async () => { for await (const e of s.model.run(input, { context, signal: new AbortController().signal })) emitted.push(e); }, /MODEL_HISTORY_LIMIT/);
    assert.deepEqual(emitted, []); assert.equal(s.diagnostics.at(-1).stage, 'history');
});

test('Responses usage is optional, excludes details, and callback failures cannot affect execution', async () => {
    const s = subject([{ ...response(message()), usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7, output_tokens_details: { reasoning_tokens: 1 }, private: 'PRIVATE_USAGE' } }]);
    const perRun = []; await Array.fromAsync(s.model.run(request(), { context: {}, signal: new AbortController().signal, onUsage: x => perRun.push(x) }));
    assert.deepEqual(s.usage, [{ inputTokens: 5, outputTokens: 2, totalTokens: 7 }]); assert.deepEqual(perRun, s.usage);
    const invalid = subject([{ ...response(message()), usage: { input_tokens: 1, output_tokens: 2, total_tokens: 99 } }]);
    await collect(invalid.model); assert.deepEqual(invalid.usage, [null]);
    await collect(subject([response(message())], { onUsage() { throw Error('PRIVATE_OBSERVER'); } }).model);
});

test('Unsupported tool capability and summary reasoning overrides stop before networking', async () => {
    const s = subject([], { connection: { ...connection, supportsTools: false } });
    await assert.rejects(collect(s.model), /UNSUPPORTED_CAPABILITY/);
    await assert.rejects(collect(s.model, { ...request(), tools: [], reasoning: 'disabled' }), /UNSUPPORTED_CAPABILITY/);
    assert.equal(s.sent.length, 0);
});

test('Responses permission handoff keeps original private state; successful completion clears it', async () => {
    const s = subject([response(reasoning('PRIVATE_BEFORE_APPROVAL'), call()), response(message('done'))]);
    let granted = false, reads = 0;
    const options = { input: 'Read', model: s.model, registry: registry(), allowedTools: [toolId], instructions: composeInstructions('assistant'),
        handlers: { [toolId]: () => { reads++; return 7; } }, policy: () => granted ? true : { decision: 'permission_required', missingSources: ['source:memoryConfig'] } };
    const first = startMuyuRun({ ...options, identity }), paused = await first.completion; await first.drained;
    assert.equal(paused.state.status, 'yielded'); assert.equal(reads, 0); assert.equal(s.sent.length, 1);
    granted = true;
    const second = startMuyuRun({ ...options, identity: { ...identity, id: 'r2' }, resume: paused.resume });
    const result = await second.completion; await second.drained;
    assert.equal(result.state.status, 'succeeded'); assert.equal(result.answer, 'done'); assert.equal(reads, 1);
    assert.match(s.sent[1].body, /PRIVATE_BEFORE_APPROVAL/);
    assert.doesNotMatch(JSON.stringify({ paused: { ...paused, resume: null }, result, snapshot: second.snapshot() }), /PRIVATE_BEFORE_APPROVAL|fixture-key/);
    const replay = follow(request(), [{ type: 'tool_call_complete', call: { callId: 'c1', toolId, version: 1, args: { n: 1 } } }]);
    await assert.rejects(collect(s.model, replay, paused.resume.modelContext), /MODEL_HISTORY_UNAVAILABLE/);
});

test('Responses cancellation drains non-cooperative transport and cannot emit or restore late state', async () => {
    const wait = deferred(), clean = deferred(), clock = createClock(); let cancelled = false;
    const s = subject([], { fetchImpl: () => wait.promise });
    const run = startMuyuRun({ identity, input: 'Read', model: s.model, registry: registry(), clock }); await flush(); run.cancel();
    assert.equal((await run.completion).state.status, 'cancelled'); let drained = false; run.drained.then(() => { drained = true; }); await flush(); assert.equal(drained, false);
    wait.resolve({ body: { getReader: () => ({ cancel: () => { cancelled = true; return clean.promise; }, releaseLock() {} }) } });
    await flush(); assert.equal(cancelled, true); assert.equal(drained, false); clean.resolve(); await run.drained; assert.equal(clock.pending, 0);
    const ready = deferred(), context = {}, releasing = subject([], { fetchImpl: () => ready.promise });
    const pending = collect(releasing.model, request(), context); await flush(); releasing.model.releaseContext(context);
    ready.resolve(json(response(reasoning(), call())));
    await assert.rejects(pending, /MODEL_HISTORY_UNAVAILABLE/);
    await assert.rejects(collect(releasing.model, follow(request(), [{ type: 'tool_call_complete', call: { callId: 'c1', toolId, version: 1, args: { n: 1 } } }]), context), /MODEL_HISTORY_UNAVAILABLE/);
});

test('Responses rejects overlapping requests within one execution without disrupting the owner', async () => {
    const waiting = deferred(), s = subject([], { fetchImpl: () => waiting.promise }), context = {};
    const first = collect(s.model, request(), context); await flush();
    await assert.rejects(collect(s.model, request(), context), /MODEL_HISTORY_UNAVAILABLE/);
    waiting.resolve(json(response(message('owner answer'))));
    assert.equal((await first)[0].text, 'owner answer');
});

test('Responses pre-abort, HTTP failures and response limits use existing safe transport contracts', async () => {
    const s = subject([]), abort = new AbortController(); abort.abort();
    await assert.rejects(Array.fromAsync(s.model.run(request(), { context: {}, signal: abort.signal })), /CANCELLED/); assert.equal(s.sent.length, 0);
    for (const [status, code] of [[401, 'MODEL_AUTH_ERROR'], [429, 'MODEL_RATE_LIMIT'], [503, 'MODEL_SERVICE_ERROR']]) {
        const f = subject([new Response('PRIVATE_RAW_ERROR', { status })]);
        await assert.rejects(collect(f.model), new RegExp(code)); assert.equal(f.sent.length, 1); assert.deepEqual(f.diagnostics, [{ stage: 'transport', status: 'failed' }]);
    }
    const f = subject([response(message('x'.repeat(1000)))], { transportLimits: { maxResponseBytes: 100 } });
    await assert.rejects(collect(f.model), /MODEL_RESPONSE_TOO_LARGE/);
});
