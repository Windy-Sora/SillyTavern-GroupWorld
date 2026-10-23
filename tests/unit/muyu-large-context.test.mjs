import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTEXT_DEFAULTS, MAX_MESSAGE_BYTES, MAX_REQUEST_BYTES, measurePayload } from '../../muyu/context/policy.js';
import { planContext } from '../../muyu/context/planner.js';
import { copyModelMessage, copyModelText } from '../../muyu/core/model-message.js';
import { copyJson, validateJson } from '../../muyu/core/json-contract.js';
import { createChatCompletionsModel } from '../../muyu/model/chat-completions.js';
import { startMuyuRun } from '../../muyu/composition.js';
import { validateRecord, HISTORY_LIMITS } from '../../muyu/sessions/contract.js';
import { createHistoryModule } from '../../muyu/modules/history/index.js';
import { identity, registry, scriptedModel, text, done } from './helpers/muyu-subject.mjs';

const history = () => Array.from({ length: 400 }, (_, n) => ({ role: n % 2 ? 'assistant' : 'user', runId: String(Math.floor(n / 2)), content: `${n}:` + 'x'.repeat(1990) }));

test('1M-model default retains about 400k estimated tokens across 200 turns without unnecessary summarization', async () => {
    const source = history(), plan = planContext(source, null, { ...CONTEXT_DEFAULTS, recentTurns: 1, autoSummary: true });
    assert.equal(CONTEXT_DEFAULTS.inputTokens, 900000);
    assert.equal(plan.messages.length, 400); assert.equal(plan.omitted, 0); assert.equal(plan.turns, 200);
    assert.ok(plan.estimatedTokens > 390000 && plan.estimatedTokens < 450000);
    const model = scriptedModel([[text('answer'), done]]);
    const run = startMuyuRun({ identity, input: 'Continue', previousMessages: plan.messages, historyCoverage: plan.coverage, contextConfig: CONTEXT_DEFAULTS, model, registry: registry(), allowedTools: [], policy: () => false });
    assert.equal((await run.completion).answer, 'answer'); await run.drained;
    assert.equal(model.requests[0].messages.length, 401);
    assert.equal(model.requests[0].messages[0].content, source[0].content);
    assert.equal(model.requests[0].inputTokenLimit, 900000);
});

test('Large model text is isolated without relaxing small tool DTOs or executing accessors', () => {
    const content = '资料😀'.repeat(40000);
    assert.equal(copyModelMessage({ role: 'user', content }).content, content);
    assert.throws(() => copyJson({ content }));
    assert.throws(() => copyModelText('x'.repeat(MAX_MESSAGE_BYTES)));
    assert.throws(() => copyModelMessage({ role: 'assistant', content: '', toolCalls: [{ args: { content } }] }));
    let invoked = false;
    const malicious = { role: 'user', get content() { invoked = true; return 'no'; } };
    assert.throws(() => copyModelMessage(malicious)); assert.equal(invoked, false);
    assert.throws(() => copyModelMessage({ role: 'user', content: 'x', grant: true }));
});

test('Adapter and transport accept a request above the former 1MiB cap and preserve a long response', async () => {
    let sent; const answer = '回答😀'.repeat(4000);
    const model = createChatCompletionsModel({ connection: { endpoint: 'https://example.test/chat/completions', apiKey: 'test-only', model: 'test', profile: 'chat-completions', supportsTools: true, thinking: false, reasoningEffort: 'high', maxTokens: 8192 },
        fetchImpl: async (_url, options) => {
            sent = JSON.parse(options.body);
            return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: answer }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } });
        } });
    const request = { messages: [{ role: 'user', content: 'x'.repeat(1200000) }], tools: [], inputTokenLimit: 1000000, maxTokens: 8192 };
    const measurement = model.inspect(request, {});
    assert.ok(measurement.requestBytes > 1048576 && measurement.requestBytes < MAX_REQUEST_BYTES);
    let received = '';
    for await (const event of model.run(request, { signal: new AbortController().signal, context: {} })) if (event.type === 'text_delta') { copyJson(event); received += event.text; }
    assert.equal(sent.messages[0].content, request.messages[0].content); assert.equal(received, answer);
});

test('900k preflight rejects a larger request before network access instead of shrinking live input', async () => {
    let calls = 0;
    const model = { inspect: request => measurePayload(request), async *run() { calls++; yield text('unexpected'); yield done; } };
    const run = startMuyuRun({ identity, input: 'x'.repeat(1900000), contextConfig: CONTEXT_DEFAULTS, model, registry: registry(), allowedTools: [], policy: () => false });
    assert.equal((await run.completion).error, 'CONTEXT_LIMIT'); await run.drained; assert.equal(calls, 0);
});

test('Archive and authorized original-history pages support more than 256 messages and long-message offsets', () => {
    const messages = history(); messages[300].content = 'x'.repeat(70000);
    const record = validateRecord({ version: 7, id: crypto.randomUUID(), revision: 0, scope: JSON.stringify(['assistant', 'chat', 'A']), title: '', createdAt: 1, updatedAt: 1, messages, required: [], status: 'idle', archived: false, imported: false, contextSummary: null, receipts: [], scopeChanges: [] });
    assert.equal(record.messages.length, 400); assert.ok(HISTORY_LIMITS.recordBytes >= 32 * 1024 * 1024);
    let allowed = true;
    const module = createHistoryModule({ access: () => allowed ? record.messages : null, budget: () => 6000 });
    const ctx = { runId: 'r', target: identity.target };
    const list = module.handlers['muyu.history.list']({ offset: 300 }, ctx);
    validateJson(module.registry.get('muyu.history.list').outputSchema, list);
    const page = module.handlers['muyu.history.read']({ index: 300, fingerprint: list.items[0].fingerprint, start: 65000, maxChars: 4000 }, ctx);
    validateJson(module.registry.get('muyu.history.read').outputSchema, page);
    assert.equal(page.text.length, 4000); assert.ok(page.remainingBytes < 6000);
    allowed = false; assert.throws(() => module.handlers['muyu.history.read']({ index: 300, fingerprint: list.items[0].fingerprint, start: 0 }, ctx), /HISTORY_UNAVAILABLE/);
});
