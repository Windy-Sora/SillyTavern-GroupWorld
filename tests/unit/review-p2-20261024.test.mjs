import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { renderPrompt } from '../../prompt-renderer.js';
import { registerProvider, unregisterProvider } from '../../provider-registry.js';
import { createMemoryAgent } from '../../agents/memory.js';
import { createCaller } from '../../utils/custom-api.js';
import { normalizeApiBase } from '../../utils/api-endpoint.js';
import { createCritiqueExecution } from '../../systems/critique-execution.js';
import { createMemoryExportSystem } from '../../systems/memory-export-system.js';
import { createProfileExportSystem } from '../../systems/profile-export-system.js';
import { parseJsonArgument } from '../../muyu/core/json-argument.js';
import { createTaskBundleModule } from '../../muyu/modules/task-bundle/index.js';
import { createToolBroker } from '../../muyu/tools/broker.js';

const source = async file => (await readFile(new URL('../../' + file, import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test('P2-2: an unclosed path query cannot swallow later valid queries', async t => {
    registerProvider({ id: 'p2Probe', placeholder: '{{p2Probe}}', render: () => ({ content: '', data: { value: 'OK', field: 'value' } }) });
    t.after(() => unregisterProvider('p2Probe'));
    const text = await renderPrompt('{{?bad:unclosed -> {{?p2Probe:value}} / {{?p2Probe:missing|fallback}}', {}, { recursive: false });
    assert.equal(text, '{{?bad:unclosed -> OK / fallback');
    assert.equal(await renderPrompt('{{?p2Probe:{{?p2Probe:field}}}}', {}), 'OK');
    assert.equal(await renderPrompt('unclosed {{?bad:path', {}), 'unclosed {{?bad:path');
    assert.equal(await renderPrompt('{{{?p2Probe:value}}', {}, { recursive: false }), '{OK');
    const malformed = '{{?bad:path '.repeat(10000);
    assert.equal(await renderPrompt(malformed + '{{?p2Probe:value}}', {}, { recursive: false }), malformed + 'OK');
});

test('P2-7: chat changes clear only old in-memory snapshots before any asynchronous pruning', async () => {
    const text = await source('index.js'), start = text.indexOf('eventSource.on(event_types.CHAT_CHANGED');
    const gate = deferred(), snapshots = new Map([['a.png', 7]]); let listener;
    const metadata = { gd: { _counterSnapshots: { 'a.png': 99 } } };
    const context = { eventSource: { on: (_type, callback) => { listener = callback; } }, event_types: { CHAT_CHANGED: 'changed' },
        scriptCounterSnapshots: snapshots, directorRoundEpoch: 0, takeoverOwner: null, postSpeechMessageControllers: new Set(),
        roundOrchestrator: { clearTakeover() {} }, invalidatePostSpeechRoundQueue() {}, postSpeechSystem: { resetPending() {} },
        customAgentSystem: { invalidateExecutions() {} }, profileLibrarySystem: {}, pruneDirectorHistory: () => gate.promise,
        chatSummarySystem: { pruneSummaries: async () => {} }, critiqueSystem: { pruneCritiques: async () => {} },
        settings: {}, EXT_KEY: 'gd', chat_metadata: metadata, window: {}, log() {} };
    vm.runInNewContext(text.slice(start, text.indexOf('// ─── Manual Ordered Generation', start)), context);
    const task = listener();
    assert.equal(snapshots.size, 0); assert.equal(metadata.gd._counterSnapshots['a.png'], 99);
    gate.resolve(); await task;
});

for (const protocol of ['openai', 'anthropic']) for (const suffix of ['', '/', '/v1', '/v1///']) {
    test('P2-16: ' + protocol + ' accepts endpoint suffix ' + JSON.stringify(suffix), async t => {
        const requests = [];
        t.mock.method(globalThis, 'fetch', async url => { requests.push(url); return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }], content: [{ text: 'ok' }] }) }; });
        const caller = createCaller({ useCustom: true, protocol, endpoint: 'https://model.invalid' + suffix });
        await caller.generate('hello'); await caller.test();
        assert.deepEqual(requests, Array(2).fill('https://model.invalid/v1/' + (protocol === 'anthropic' ? 'messages' : 'chat/completions')));
    });
}

test('P2-16: the model list uses the same normalization as generation', async t => {
    const requests = []; t.mock.method(globalThis, 'fetch', async url => { requests.push(url); return { ok: true, json: async () => ({ data: [{ id: 'model' }] }) }; });
    const text = await source('ui/sections/agents.js'), start = text.indexOf('async function fetchModels(');
    const fetchModels = vm.runInNewContext(text.slice(start, text.indexOf("registerSection('agents'", start)) + ';fetchModels', { fetch, normalizeApiBase });
    await fetchModels(' https://proxy.invalid/prefix/v1/// ', 'test', 'openai');
    assert.equal(requests[0], 'https://proxy.invalid/prefix/v1/models');
});

test('P2-17: direct native generation has a default deadline, ignores late results and never globally stops ST', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const pending = deferred(); let stops = 0;
    const caller = createCaller({}, () => pending.promise, () => { stops++; });
    const work = caller.generate('quiet'); const failed = assert.rejects(work, error => error.name === 'TimeoutError');
    t.mock.timers.tick(30000); await failed;
    pending.resolve('late'); await Promise.resolve(); assert.equal(stops, 0); assert.equal(caller.supportsAbort, false);
});

test('P2-17: a configured deadline aborts transport even when it ignores cancellation', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const pending = deferred(); let signal;
    t.mock.method(globalThis, 'fetch', (_url, options) => { signal = options.signal; return pending.promise; });
    const caller = createCaller({ useCustom: true, endpoint: 'https://model.invalid', call: { timeout: 37 } });
    const failed = assert.rejects(caller.generate('quiet'), error => error.name === 'TimeoutError');
    t.mock.timers.tick(37); await failed; assert.equal(signal.aborted, true);
    pending.reject(Error('late failure')); await Promise.resolve();
});

test('P2-17: external abort reaches transport and successful calls remove abort listeners', async t => {
    const parent = new AbortController(), pending = deferred(); let signal;
    t.mock.method(globalThis, 'fetch', (_url, options) => { signal = options.signal; return pending.promise; });
    const add = t.mock.method(parent.signal, 'addEventListener'), remove = t.mock.method(parent.signal, 'removeEventListener');
    const caller = createCaller({ useCustom: true, endpoint: 'https://model.invalid' });
    const failed = assert.rejects(caller.generate('quiet', { signal: parent.signal }), error => error.name === 'AbortError');
    parent.abort(); await failed; assert.equal(signal.aborted, true);
    assert.equal(add.mock.callCount(), 1); assert.equal(remove.mock.callCount(), 1);
    pending.reject(Error('late')); await Promise.resolve();
});

test('P2-17: stalled critique generation releases its business lock at the configured deadline', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const pending = deferred(); let clears = 0;
    const execution = createCritiqueExecution({ createCaller: () => createCaller({ call: { timeout: 19 } }, () => pending.promise), setExtensionPrompt() { clears++; } });
    const failed = assert.rejects(execution.execute('inspect'), error => error.name === 'TimeoutError');
    await Promise.resolve(); await Promise.resolve(); t.mock.timers.tick(19); await failed;
    assert.equal(execution.isRunning(), false); assert.equal(clears, 2); pending.resolve('late');
});

function importer(kind, saveSettings) {
    const settings = kind === 'memory' ? { memoryPrompt: 'before' } : { profileGeneratorPrompt: 'before' };
    const metadata = {}, profiles = {};
    const dependencies = { settings, EXT_KEY: 'gd', getChatMetadata: () => metadata, getProfiles: () => profiles, getCharacters: () => [],
        getCurrentGroup: () => null, saveChatConditional: async () => {}, saveSettings, log() {} };
    const system = kind === 'memory' ? createMemoryExportSystem(dependencies) : createProfileExportSystem(dependencies);
    const key = kind === 'memory' ? 'memoryPrompt' : 'profileGeneratorPrompt';
    const run = () => kind === 'memory'
        ? system.applyMemoryImport({ memories: { a: { entries: [{ event: 'saved event' }] } }, template: { memoryPrompt: 'imported' } }, { a: { enabled: true, targetAvatar: 'a', mode: 'replace' } }, { importTemplate: true })
        : system.applyImport({ profiles: [{ avatar: 'a', profile: { summary: 'saved profile' } }], template: { generatorPrompt: 'imported' } }, ['a'], { importTemplate: true });
    return { settings, metadata, profiles, key, run };
}
for (const kind of ['memory', 'profile']) {
    test('P2-20: ' + kind + ' import awaits template saving and compensates an asynchronous failure', async () => {
        const gate = deferred(); let saves = 0;
        const f = importer(kind, () => ++saves === 1 ? gate.promise : Promise.resolve());
        const work = f.run(), failed = assert.rejects(work, /Template settings save failed.*not rolled back/);
        await Promise.resolve(); await Promise.resolve();
        assert.equal(f.settings[f.key], 'imported');
        gate.reject(Error('async disk failure')); await failed;
        assert.equal(f.settings[f.key], 'before'); assert.equal(saves, 2);
        if (kind === 'memory') assert.equal(f.metadata.gd.charMemories.a[0].event, 'saved event');
        else assert.equal(f.profiles.a.profile.summary, 'saved profile');
    });
    test('P2-20: ' + kind + ' import preserves concurrent template edits on failure', async () => {
        const gate = deferred(); let saves = 0;
        const f = importer(kind, () => ++saves === 1 ? gate.promise : Promise.resolve());
        const work = f.run(), failed = assert.rejects(work, /concurrent template edit preserved/);
        await Promise.resolve(); await Promise.resolve(); f.settings[f.key] = 'concurrent';
        gate.reject(Error('save failed')); await failed;
        assert.equal(f.settings[f.key], 'concurrent');
    });
    test('P2-20: ' + kind + ' import reports a synchronous failure, not success', async () => {
        let saves = 0; const f = importer(kind, () => { if (++saves === 1) throw Error('sync save failure'); });
        await assert.rejects(f.run(), /sync save failure/); assert.equal(f.settings[f.key], 'before');
    });
}

test('P2-19: invalid model JSON is a safe, field-specific error before a bundle reaches its port', async () => {
    const target = { kind: 'chat', userKey: 'test', chatKey: 'test' }; let previews = 0;
    const module = createTaskBundleModule({ port: { forget() {}, prepare() { previews++; return {}; } } });
    module.bindRun({ id: 'r', taskId: 't', target });
    const broker = createToolBroker({ registry: module.registry, handlers: module.handlers, runId: 'r', target,
        allowedTools: ['muyu.task.preview'], policy: () => true, signal: new AbortController().signal });
    const result = await broker.call({ callId: 'bad', toolId: 'muyu.task.preview', version: 1, args: { settingsJson: '{PRIVATE_PAYLOAD' } });
    assert.equal(result.error.code, 'INVALID_ARGUMENT'); assert.equal(result.effectState, 'not_started');
    assert.match(result.error.message, /settingsJson/); assert.doesNotMatch(JSON.stringify(result), /PRIVATE_PAYLOAD|SyntaxError|Unexpected/);
    assert.equal(previews, 0); module.dispose();
});

test('P2-19: the JSON argument classifier does not expose unmarked handler exceptions', async () => {
    const target = { kind: 'chat', userKey: 'test', chatKey: 'test' };
    const module = createTaskBundleModule({ port: { forget() {}, prepare() { throw new SyntaxError('PRIVATE_HOST_JSON'); } } });
    module.bindRun({ id: 'r', taskId: 't', target });
    const broker = createToolBroker({ registry: module.registry, handlers: module.handlers, runId: 'r', target,
        allowedTools: ['muyu.task.preview'], policy: () => true, signal: new AbortController().signal });
    const result = await broker.call({ callId: 'host', toolId: 'muyu.task.preview', version: 1, args: { settingsJson: '{}' } });
    assert.equal(result.error.code, 'TOOL_FAILED'); assert.doesNotMatch(JSON.stringify(result), /PRIVATE_HOST_JSON/); module.dispose();
    for (const field of ['changesJson', 'settingsJson', 'requestsJson', 'exportJson', 'requestJson']) {
        assert.deepEqual(parseJsonArgument('{"valid":true}', field), { valid: true });
        assert.throws(() => parseJsonArgument('{private', field), /INVALID_ARGUMENT/);
    }
});

test('P2-25: memory normalization rejects non-string moods and de-duplicates within a batch', () => {
    const agent = createMemoryAgent({ log() {}, extractJsonObject: () => null });
    const rows = agent.pipeline.parse(JSON.stringify({ memories: [null, { event: ' New ', mood: {} }, { event: 'new', mood: 1 }, { event: 'custom', mood: 'relieved' }, { event: 'Old' }] }), {}, { chat: () => [] });
    assert.equal(rows[0].mood, 'neutral'); assert.equal(rows[1].mood, 'neutral'); assert.equal(rows[2].mood, 'relieved');
    assert.deepEqual(agent.pipeline.validate(rows, { existingMemories: [{ event: 'old' }] }).map(x => x.event), ['New', 'custom']);
});
