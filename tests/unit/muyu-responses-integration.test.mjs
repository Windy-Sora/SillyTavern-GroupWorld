import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createMuyuController } from '../../muyu/application/controller.js';
import { createHostBridge } from '../../muyu/host/bridge.js';
import { createCredentialStore } from '../../muyu/host/credentials.js';
import { createModel } from '../../muyu/model/factory.js';
import { probeConnection } from '../../muyu/model/connection-probe.js';
import { compactionRequest, collectSummary } from '../../muyu/context/compaction.js';
import { projectSelfConfig } from '../../muyu/self/config.js';
import { projectConnectionText } from '../../muyu/self/text.js';
import { startMuyuRun } from '../../muyu/composition.js';
import { CONTEXT_DEFAULTS } from '../../muyu/context/policy.js';
import { fingerprint } from '../../muyu/context/planner.js';
import { identity, registry } from './helpers/muyu-subject.mjs';

const config = { endpoint: 'https://fixture.invalid/v1/responses', apiKey: 'PRIVATE_KEY', model: 'synthetic-sol', profile: 'responses', supportsTools: true };
let id = 0;
const answer = (text = 'Done') => ({ status: 'completed', output: [{ type: 'message', id: 'msg_' + ++id, role: 'assistant', status: 'completed', phase: 'final_answer', content: [{ type: 'output_text', text, annotations: [] }] }] });
const json = data => Response.json(data);
const collect = (model, request, context = {}) => Array.fromAsync(model.run(request, { context, signal: new AbortController().signal }));
function hostFor(settings = {}, credentials) {
    const ctx = { chatId: 'A', groupId: 'g', chat: [], chatMetadata: {}, eventSource: new EventEmitter(), eventTypes: { CHAT_CHANGED: 'chat' } };
    return createHostBridge({ getContext: () => ctx, getSettings: () => settings, extensionKey: 'gd', pageId: 'synthetic', credentials });
}

test('Responses probes use the selected endpoint and sibling model catalog without enabling or sending history', async () => {
    const requests = [], fetchImpl = async (url, init) => { requests.push({ url, ...init, payload: init.body ? JSON.parse(init.body) : null }); return json(init.method === 'GET' ? { data: [{ id: 'sol' }, { id: 'sol' }, { id: 'other' }] } : answer('OK')); };
    assert.deepEqual(await probeConnection(config, { kind: 'models', fetchImpl }), ['other', 'sol']);
    assert.equal(requests[0].url, 'https://fixture.invalid/v1/models'); assert.equal(requests[0].method, 'GET'); assert.equal(requests[0].body, undefined);
    assert.deepEqual(await probeConnection({ ...config, reasoningEffort: 'max' }, { fetchImpl }), { ok: true });
    const p = requests[1].payload;
    assert.equal(requests[1].url, config.endpoint); assert.equal(p.store, false); assert.equal(p.max_output_tokens, 512);
    assert.deepEqual(p.reasoning, { effort: 'low' }); assert.equal(p.tools, undefined);
    assert.deepEqual(p.input, [{ role: 'user', content: 'Reply with OK.' }]);
    assert.equal(p.messages, undefined); assert.equal(requests[1].credentials, 'omit'); assert.equal(requests[1].redirect, 'error');
    const abort = new AbortController(); abort.abort();
    await assert.rejects(probeConnection(config, { fetchImpl, signal: abort.signal }), /CANCELLED/);
    assert.equal(requests.length, 2);
    await assert.rejects(probeConnection(config, { fetchImpl: async () => json({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] }) }), /MODEL_OUTPUT_TRUNCATED/);
});

test('Responses credentials preserve effort, opt-out, exact-endpoint binding and legacy DeepSeek defaults', async () => {
    const settings = {}; let fail = false;
    const store = createCredentialStore({ getSettings: () => settings, saveSettings: async () => { if (fail) throw Error('PRIVATE_SAVE_ERROR'); } });
    await store.save({ ...config, autoConnect: true });
    assert.equal(store.describe().reasoningEffort, 'medium'); assert.equal(store.describe().thinking, false);
    assert.equal(store.restoreAutoConnection().apiKey, 'PRIVATE_KEY');
    assert.equal(store.resolve({ endpoint: config.endpoint }), 'PRIVATE_KEY'); assert.equal(store.resolve({ endpoint: 'https://other.invalid/v1/responses' }), '');
    assert.doesNotMatch(JSON.stringify(store.describe()), /PRIVATE_KEY/);
    await store.save({ ...config, reasoningEffort: 'xhigh', autoConnect: true });
    assert.equal(store.restoreAutoConnection().reasoningEffort, 'xhigh');
    fail = true;
    await assert.rejects(store.save({ ...config, reasoningEffort: 'low' }), /CREDENTIAL_SAVE_FAILED/);
    assert.equal(store.describe().reasoningEffort, 'xhigh');
    fail = false; await store.setAutoConnect(false); assert.equal(store.restoreAutoConnection(), null);
    settings.agentConfigs['muyu-assistant'] = { endpoint: 'https://fixture.invalid/chat/completions', apiKey: 'LEGACY_KEY', model: 'legacy', autoConnect: true };
    assert.equal(store.restoreAutoConnection().profile, 'deepseek'); assert.equal(store.restoreAutoConnection().thinking, true); assert.equal(store.restoreAutoConnection().reasoningEffort, 'high');
});

test('Default controller creates and restores Responses without network on enable, secrets, grants or composer loss', async () => {
    const settings = {}, credentials = createCredentialStore({ getSettings: () => settings, saveSettings: async () => {} });
    const originalFetch = globalThis.fetch, requests = []; let first, restored, optedOut;
    globalThis.fetch = async (url, init) => { assert.equal(url, config.endpoint); requests.push(JSON.parse(init.body)); return json(answer()); };
    try {
        first = createMuyuController({ host: hostFor(settings, credentials) }); first.setInput('UNSENT_DRAFT');
        await first.configure({ ...config, rememberKey: true, autoConnect: true });
        assert.equal(requests.length, 0); assert.equal(first.snapshot().input, 'UNSENT_DRAFT');
        assert.equal(first.snapshot().connection.profile, 'responses'); assert.equal(first.snapshot().connection.reasoningEffort, 'medium');
        assert.equal(first.snapshot().connection.thinking, false);
        first.setFullAccess(true, { confirmed: true }); await first.dispose(); first = null;
        restored = createMuyuController({ host: hostFor(settings, credentials) });
        assert.equal(requests.length, 0); assert.equal(restored.snapshot().connection.profile, 'responses');
        assert.equal(restored.snapshot().connection.thinking, false); assert.equal(restored.snapshot().fullAccess, false);
        assert.doesNotMatch(JSON.stringify(restored.snapshot()), /PRIVATE_KEY/);
        restored.setInput('Hello'); await restored.send();
        for (let i = 0; restored.snapshot().busy && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 5));
        assert.equal(requests.length, 1); assert.equal(requests[0].store, false); assert.ok(requests[0].input); assert.equal(requests[0].messages, undefined);
        assert.equal(restored.snapshot().runs.at(-1).status, 'succeeded');
        await restored.dispose(); restored = null;
        await credentials.setAutoConnect(false);
        optedOut = createMuyuController({ host: hostFor(settings, credentials) });
        assert.equal(optedOut.snapshot().enabled, false); assert.equal(optedOut.snapshot().savedConnection.profile, 'responses'); assert.equal(requests.length, 1);
    } finally { await first?.dispose(); await restored?.dispose(); await optedOut?.dispose(); globalThis.fetch = originalFetch; }
});

test('Responses summaries lower effort locally, preserve original history and reject partial text', async () => {
    const sent = [], configWithEffort = { ...config, reasoningEffort: 'max' };
    const model = createModel({ connection: configWithEffort, fetchImpl: async (_url, init) => { sent.push(JSON.parse(init.body)); return json(answer('A valid summary')); } });
    const messages = [{ role: 'user', content: 'Original question '.repeat(200) }, { role: 'assistant', content: 'Original answer '.repeat(200) }], before = structuredClone(messages);
    const request = compactionRequest({ messages }, 50000, 2048), context = {};
    try {
        assert.equal(await collectSummary(model, request, { context, signal: new AbortController().signal, onUsage() {} }), 'A valid summary');
        assert.equal(sent[0].reasoning.effort, 'low'); assert.equal(sent[0].max_output_tokens, 2048); assert.equal(sent[0].tools, undefined);
        assert.equal(sent[0].store, false); assert.deepEqual(messages, before);
        await collect(model, { messages: [{ role: 'user', content: 'Continue normally' }], tools: [] });
        assert.equal(sent[1].reasoning.effort, 'max'); assert.equal(configWithEffort.reasoningEffort, 'max');
    } finally { model.releaseContext(context); }
    const truncated = createModel({ connection: config, fetchImpl: async () => json({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: answer('PARTIAL_SUMMARY').output }) });
    await assert.rejects(collectSummary(truncated, request, { context: {}, signal: new AbortController().signal, onUsage() {} }), /MODEL_OUTPUT_TRUNCATED/);
    assert.deepEqual(messages, before);
    await assert.rejects(collect(model, { ...request, tools: [{ id: 'test', version: 1, description: 'no', inputSchema: { type: 'object' } }] }), /UNSUPPORTED_CAPABILITY/);
});

test('Reduced summaries retain DeepSeek disabled thinking and leave generic profiles free of vendor fields', async () => {
    for (const profile of ['deepseek', 'chat-completions']) {
        let p;
        const model = createModel({ connection: { ...config, profile, endpoint: 'https://fixture.invalid/chat/completions' }, fetchImpl: async (_url, init) => { p = JSON.parse(init.body); return json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'summary' } }] }); } });
        await collect(model, compactionRequest({ messages: [{ role: 'user', content: 'source' }] }, 50000));
        if (profile === 'deepseek') assert.deepEqual(p.thinking, { type: 'disabled' });
        else assert.equal(p.thinking, undefined);
        assert.equal(p.reasoning_effort, undefined); assert.equal(p.reasoning, undefined);
    }
});

test('Runtime manual Responses summarization commits only complete summaries and clears private contexts', async () => {
    const messages = [{ role: 'user', content: 'Retain my task '.repeat(200) }, { role: 'assistant', content: 'Work completed '.repeat(200) }];
    const before = structuredClone(messages);
    for (const truncated of [false, true]) {
        const sent = [], saved = [], released = [];
        const adapter = createModel({ connection: config, fetchImpl: async (_url, init) => { sent.push(JSON.parse(init.body)); return json(truncated ? { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: answer('partial').output } : answer('Task handoff')); } });
        const model = { ...adapter, releaseContext(context) { released.push(context); adapter.releaseContext(context); } };
        const run = startMuyuRun({ identity, input: 'Summarize', model, registry: registry(), summaryOnly: true,
            compaction: { through: 2, fingerprint: fingerprint(messages), messages }, contextConfig: { ...CONTEXT_DEFAULTS },
            limits: { modelCalls: 1, toolCalls: 1 }, maxTokens: 8192, onSummary: value => saved.push(value) });
        const result = await run.completion; await run.drained;
        assert.equal(result.state.status, truncated ? 'failed' : 'succeeded'); assert.equal(saved.length, truncated ? 0 : 1);
        if (truncated) assert.equal(result.error, 'MODEL_OUTPUT_TRUNCATED');
        assert.equal(sent.length, 1); assert.equal(sent[0].reasoning.effort, 'low'); assert.ok(released.length >= 1);
        assert.deepEqual(messages, before);
    }
});

test('Self inspection distinguishes Responses effort from a DeepSeek toggle and never exposes a key', () => {
    const value = projectSelfConfig('connection', { configured: { connection: { ...config, source: 'independent', thinking: false, reasoningEffort: 'xhigh' } } });
    const fields = value.sections[0].fields;
    assert.equal(fields.find(f => f.key === 'connectionProtocol').configured.text, 'OpenAI Responses');
    assert.equal(fields.find(f => f.key === 'connectionThinking').configured.state, 'not_applicable');
    assert.match(fields.find(f => f.key === 'connectionReasoningEffort').configured.text, /Extra high/);
    assert.doesNotMatch(JSON.stringify(value), /PRIVATE_KEY|fixture.invalid|synthetic-sol/);
    const text = JSON.parse(projectConnectionText({ ...config, reasoningEffort: 'medium' }));
    assert.equal(text.profile, 'responses'); assert.equal(text.reasoningEffort, 'medium'); assert.equal(text.apiKey, undefined);
});
