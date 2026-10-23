import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHostModelConnection } from '../../muyu/host/model-connection.js';
import { createCredentialStore } from '../../muyu/host/credentials.js';

const response = (content = 'OK', tool_calls = []) => ({ choices: [{ finish_reason: tool_calls.length ? 'tool_calls' : 'stop', message: { role: 'assistant', content, ...(tool_calls.length ? { tool_calls } : {}) } }] });
const request = () => ({ messages: [{ role: 'user', content: 'question' }], tools: [{ id: 'example.read', version: 1, description: 'Read fixture', inputSchema: { type: 'object', properties: {} } }] });
const collect = async (model, value = request(), context = {}, signal = new AbortController().signal) => { const result = []; for await (const e of model.run(value, { signal, context })) result.push(e); return result; };
function fixture(source = 'custom') {
    const calls = [], events = new EventEmitter();
    const ctx = { mainApi: 'openai', chatCompletionSettings: { chat_completion_source: source, custom_url: 'http://localhost:1234/v1', custom_model: 'fixture', reverse_proxy: '', proxy_password: '', custom_include_headers: '', prompt: 'PRIVATE_RP_PROMPT' },
        getChatCompletionModel: s => s.custom_model, ChatCompletionService: { async sendRequest(...args) { calls.push(args); return response(); } },
        eventSource: events, eventTypes: { SETTINGS_UPDATED: 'settings', SECRET_ROTATED: 'secret', MAIN_API_CHANGED: 'api' } };
    return { ctx, calls, events, port: createHostModelConnection({ getContext: () => ctx }) };
}

test('ST reasoning models receive the frontend token contract without losing Muyu tools', async () => {
    for (const [source, model] of [['openai', 'o3'], ['openai', 'o4-mini'], ['openai', 'gpt-5'], ['openai', 'gpt-5.4'], ['openrouter', 'openai/o3'], ['openrouter', 'openai/gpt-5']]) {
        const f = fixture(source); f.ctx.chatCompletionSettings.custom_model = model;
        const bound = f.port.bind();
        await collect(bound.model, { ...request(), maxTokens: 8192 });
        const payload = f.calls[0][0];
        assert.equal(payload.max_completion_tokens, 8192, model);
        assert.equal(Object.hasOwn(payload, 'max_tokens'), false, model);
        assert.equal(payload.tools.length, 1); assert.equal(payload.messages[0].content, 'question');
        assert.ok(bound.model.inspect(request()).requestBytes > 0);
    }
    for (const [source, model] of [['openai', 'gpt-4o'], ['custom', 'o3'], ['deepseek', 'deepseek-chat']]) {
        const f = fixture(source); f.ctx.chatCompletionSettings.custom_model = model;
        await collect(f.port.bind().model, { ...request(), maxTokens: 8192 });
        assert.equal(f.calls[0][0].max_tokens, 8192);
        assert.equal(Object.hasOwn(f.calls[0][0], 'max_completion_tokens'), false);
    }
});

test('ST models whose frontend removes tools are rejected before requesting', () => {
    for (const [source, model] of [['openai', 'o1-mini'], ['openrouter', 'openai/o1'], ['openai', 'gpt-5-chat-latest'], ['openrouter', 'openai/gpt-5-chat-latest']]) {
        const f = fixture(source); f.ctx.chatCompletionSettings.custom_model = model;
        assert.equal(f.port.describe().available, false);
        assert.throws(() => f.port.bind(), /HOST_CONNECTION_UNSUPPORTED/);
        assert.equal(f.calls.length, 0);
    }
});
test('ST adapter delegates authentication, sends only Muyu messages/tools, and resumes tool pairs', async () => {
    const f = fixture(), context = {}, bound = f.port.bind(), r = request();
    f.ctx.ChatCompletionService.sendRequest = async (...args) => { f.calls.push(args); return response('', [{ id: 'c1', type: 'function', function: { name: 'muyu_tool_0', arguments: '{}' } }]); };
    const events = await collect(bound.model, r, context);
    assert.equal(events[0].call.toolId, 'example.read');
    const [payload, extract, signal] = f.calls[0]; assert.equal(extract, false); assert.ok(signal instanceof AbortSignal);
    assert.equal(payload.chat_completion_source, 'custom'); assert.equal(payload.custom_url, 'http://localhost:1234/v1');
    assert.equal(payload.custom_prompt_post_processing, ''); assert.equal(payload.n, 1); assert.equal(payload.stream, false);
    assert.doesNotMatch(JSON.stringify(payload), /PRIVATE_RP_PROMPT|apiKey|Authorization/);
    f.ctx.ChatCompletionService.sendRequest = async (...args) => { f.calls.push(args); return response('Read done'); };
    r.messages.push({ role: 'assistant', content: '', toolCalls: [events[0].call] }, { role: 'tool', callId: 'c1', result: { ok: true } });
    assert.equal((await collect(bound.model, r, context))[0].text, 'Read done');
    assert.equal(f.calls[1][0].messages.at(-1).tool_call_id, 'c1');
    assert.ok(bound.model.inspect(r, context).requestBytes > 0);
});
test('Changed route, model, headers or secret epoch blocks old authorization before transport', async () => {
    for (const field of ['custom_url', 'custom_model', 'custom_include_headers']) {
        const f = fixture(), bound = f.port.bind(); f.ctx.chatCompletionSettings[field] += 'changed';
        assert.throws(bound.current); await assert.rejects(collect(bound.model)); assert.equal(f.calls.length, 0);
    }
    const f = fixture(), bound = f.port.bind(); let updates = 0; const unsub = f.port.subscribe(() => updates++);
    f.events.emit('secret'); assert.equal(updates, 1); assert.throws(bound.current, /HOST_CONNECTION_CHANGED/); unsub(); assert.equal(f.events.listenerCount('secret'), 0);
});
test('ST cancellation propagates to official service; late replies and oversized input are rejected', async () => {
    const f = fixture(), bound = f.port.bind(), abort = new AbortController();
    f.ctx.ChatCompletionService.sendRequest = async (_payload, _extract, signal) => { assert.equal(signal, abort.signal); abort.abort(); return response(); };
    await assert.rejects(collect(bound.model, request(), {}, abort.signal));
    const large = request(); large.messages[0].content = 'x'.repeat(100000);
    await assert.rejects(collect(bound.model, { ...large, inputTokenLimit: 4096 }), /CONTEXT_LIMIT/);
});
test('ST rejects unsupported sources and unsafe custom body overrides without trying another provider', () => {
    for (const source of ['claude', 'makersuite', 'unknown']) { const f = fixture(source); assert.equal(f.port.describe().available, false); assert.throws(() => f.port.bind(), /HOST_CONNECTION_UNSUPPORTED/); assert.equal(f.calls.length, 0); }
    const f = fixture(); f.ctx.chatCompletionSettings.custom_include_body = 'tools: []'; assert.throws(() => f.port.bind(), /HOST_CONNECTION_UNSUPPORTED/);
    f.ctx.chatCompletionSettings.custom_include_body = ''; f.ctx.mainApi = 'textgenerationwebui'; assert.equal(f.port.describe().available, false);
});
test('Host errors are sanitized; response cap and OpenRouter routing do not weaken protocol', async () => {
    const f = fixture('openrouter'), bound = f.port.bind();
    f.ctx.ChatCompletionService.sendRequest = async () => { throw Error('PRIVATE_SECRET_RAW_ERROR'); };
    await assert.rejects(collect(bound.model), error => error.code === 'HOST_MODEL_REQUEST_FAILED' && !String(error).includes('PRIVATE_SECRET'));
    f.ctx.ChatCompletionService.sendRequest = async (...args) => { f.calls.push(args); return response('x'.repeat(270000)); };
    await assert.rejects(collect(bound.model), /MODEL_RESPONSE_TOO_LARGE/);
    assert.equal(f.calls[0][0].allow_fallbacks, false); assert.equal(f.calls[0][0].use_fallback, false);
});
test('Connection-source preference preserves independent credentials, opt-out and save rollback', async () => {
    const settings = {}; let failed = false;
    const store = createCredentialStore({ getSettings: () => settings, saveSettings: async () => { if (failed) throw Error(); } });
    assert.deepEqual(store.sourcePreference(), { source: 'st', autoConnect: true });
    await store.save({ endpoint: 'https://test.invalid/chat/completions', apiKey: 'PRIVATE_KEY', model: 'old', autoConnect: true });
    assert.equal(store.sourcePreference().source, 'independent');
    await store.saveSourcePreference('st'); assert.equal(store.resolve({}), ''); assert.equal(store.describe().model, 'old');
    assert.equal(settings.agentConfigs['muyu-assistant'].apiKey, 'PRIVATE_KEY');
    await store.saveSourcePreference('st', false); failed = true;
    await assert.rejects(store.saveSourcePreference('independent'), /CREDENTIAL_SAVE_FAILED/);
    assert.deepEqual(store.sourcePreference(), { source: 'st', autoConnect: false });
});
