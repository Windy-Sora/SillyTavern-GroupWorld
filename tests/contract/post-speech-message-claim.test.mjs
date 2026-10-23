import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createPostSpeechSystem } from '../../systems/post-speech-system.js';

const source = await readFile(new URL('../../index.js', import.meta.url), 'utf8');
const needle = 'eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED';
const first = source.indexOf(needle);
const second = source.indexOf(needle, first + needle.length);
const next = source.indexOf('eventSource.on(event_types.', second + needle.length);
const listenerSource = source.slice(second, next);

function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

test('overlapping rerender analyses claim the intent before either capability can execute twice', async () => {
    const execution = deferred();
    const started = deferred();
    const metadata = {};
    let saves = 0;
    let starts = 0;
    let listener;
    const postSpeechSystem = createPostSpeechSystem({
        settings: {}, EXT_KEY: 'test', getChatMetadata: () => metadata,
        getChat: () => [], saveChatConditional: async () => { saves++; }, log: () => {},
    });
    vm.runInNewContext(listenerSource, {
        eventSource: { on(_event, callback) { listener = callback; } },
        event_types: { CHARACTER_MESSAGE_RENDERED: 'rendered' },
        settings: { postSpeechMessageEnabled: true, postSpeechTiming: 'message', agentConfigs: {} },
        chat: [{ name: 'A', mes: 'Hello' }], characters: [{ name: 'A', description: '' }],
        roundGenerateType: 'swipe', postSpeechLastMsgIndex: -1,
        postSpeechMessageAbortController: null, postSpeechMessageControllers: new Set(), AbortController,
        postSpeechRoundQueueEpoch: 0, chat_metadata: metadata,
        getCurrentGroup: () => ({ id: 'group' }),
        AgentRegistry: { get: () => ({ parseResponse: () => ({
            intents: [{ type: 'image', params: {} }],
        }) }) },
        CapabilityRegistry: {
            listForMode: () => [{ id: 'image' }],
            listExecutableForMode: () => [{ id: 'image' }],
        },
        postSpeechSystem,
        postSpeechExecutor: {
            run() { starts++; started.resolve(); return execution.promise; },
        },
        getContext: () => ({ generateRaw() {}, stopGeneration() {} }),
        createCaller: () => ({}), buildContextPool: () => ({}),
        execute: async () => 'policy',
        isPostSpeechIntentQueued: () => false,
        log: () => {}, toastr: { info() {}, success() {} },
    });

    const firstRender = listener(0, 'swipe');
    await started.promise;
    assert.equal(starts, 1);
    assert.equal(postSpeechSystem.isPending(0, 'image'), true);
    const secondRender = listener(0, 'swipe');
    await secondRender;
    assert.equal(starts, 1);

    execution.resolve({ blocking: true, deferred: [], results: [{ intentIndex: 0, success: true }] });
    await firstRender;
    assert.equal(postSpeechSystem.isPending(0, 'image'), false);
    assert.equal(postSpeechSystem.wasExecuted(0, 'image'), true);
    assert.equal(saves, 1);
});

function lifecycleFixture(timing = 'round') {
    const listeners = new Map(), responses = [], executions = [];
    const started = deferred();
    let capabilityStarts = 0, queued = 0, saved = 0;
    const sandbox = {
        eventSource: { on(event, callback) { listeners.set(event, callback); } },
        event_types: { CHARACTER_MESSAGE_RENDERED: 'render', GENERATION_STOPPED: 'stop', MESSAGE_DELETED: 'delete', CHAT_CHANGED: 'chat' },
        settings: { mode: 'off', postSpeechMessageEnabled: true, postSpeechTiming: timing, agentConfigs: {} }, MODE_OFF: 'off',
        chat: [{ name: 'A', mes: 'Hello' }], chat_metadata: {}, EXT_KEY: 'test', characters: [{ name: 'A' }],
        roundGenerateType: 'swipe', postSpeechLastMsgIndex: -1, postSpeechRoundQueueEpoch: 0,
        postSpeechMessageAbortController: null, postSpeechMessageControllers: new Set(), AbortController,
        postSpeechAbortController: null, directorAbortController: null,
        takeoverOwner: null, takeoverWrapperPending: false, directorRoundEpoch: 0,
        getCurrentGroup: () => ({ id: 'group' }),
        AgentRegistry: { get: () => ({ parseResponse: () => ({ intents: [{ type: 'image', params: {} }] }) }) },
        CapabilityRegistry: { listForMode: () => [{ id: 'image' }], listExecutableForMode: () => [{ id: 'image' }] },
        postSpeechSystem: {
            wasExecuted: () => false, isPending: () => false,
            reserveExecution: contexts => ({ contexts, release() {} }),
            trackExecution: async () => { saved++; }, pruneAfter: async () => {}, resetPending() {},
        },
        postSpeechExecutor: { run() { capabilityStarts++; const pending = deferred(); executions.push(pending); started.resolve(); return pending.promise; } },
        getContext: () => ({ generateRaw() {}, stopGeneration() {} }), createCaller: () => ({}), buildContextPool: () => ({}),
        execute(_agent, { config }) { const pending = deferred(); responses.push({ ...pending, signal: config.call.signal }); return pending.promise; },
        isPostSpeechIntentQueued: () => false, enqueuePostSpeechRoundJob: () => { queued++; },
        invalidatePostSpeechRoundQueue: () => { sandbox.postSpeechRoundQueueEpoch++; queued = 0; },
        customAgentSystem: { invalidateExecutions() {} }, roundOrchestrator: { reset() {}, clearTakeover() {} },
        roundTriggeredAvatars: new Set(), scriptCounterSnapshots: new Map(), wiState: {},
        pruneDirectorHistory: async () => {}, chatSummarySystem: { pruneSummaries: async () => {} },
        critiqueSystem: { pruneCritiques: async () => {} }, profileLibrarySystem: {}, window: {},
        log() {}, toastr: { info() {}, success() {} },
    };
    vm.runInNewContext(listenerSource, sandbox);
    for (const type of ['GENERATION_STOPPED', 'MESSAGE_DELETED']) {
        const start = source.indexOf(`eventSource.on(event_types.${type}`);
        vm.runInNewContext(source.slice(start, source.indexOf('eventSource.on(event_types.', start + 10)), sandbox);
    }
    const chatStart = source.indexOf('eventSource.on(event_types.CHAT_CHANGED');
    vm.runInNewContext(source.slice(chatStart, source.indexOf('// ─── Manual Ordered Generation', chatStart)), sandbox);
    return { sandbox, listeners, responses, executions, started: started.promise, get queued() { return queued; }, get saved() { return saved; }, get starts() { return capabilityStarts; } };
}

for (const change of ['delete', 'chat', 'stop', 'replace', 'edit']) {
    test(`late PostSpeech policy after ${change} cannot execute or requeue`, async () => {
        const f = lifecycleFixture();
        const task = f.listeners.get('render')(0, 'swipe');
        assert.equal(f.responses.length, 1);
        if (change === 'delete') { f.sandbox.chat.length = 0; await f.listeners.get('delete')(0); }
        else if (change === 'chat') { f.sandbox.chat_metadata = {}; await f.listeners.get('chat')(); }
        else if (change === 'stop') f.listeners.get('stop')();
        else if (change === 'replace') f.sandbox.chat[0] = { name: 'A', mes: 'New timeline' };
        else f.sandbox.chat[0].mes = 'Edited';
        f.responses[0].resolve('policy'); // Deliberately ignores AbortSignal.
        await task;
        assert.equal(f.starts, 0); assert.equal(f.queued, 0); assert.equal(f.saved, 0);
        assert.equal(f.sandbox.postSpeechMessageControllers.size, 0);
    });
}

test('overlapping PostSpeech completion cannot clear another request; Stop aborts all remaining requests', async () => {
    const f = lifecycleFixture();
    const firstTask = f.listeners.get('render')(0, 'swipe');
    const secondTask = f.listeners.get('render')(0, 'swipe');
    const thirdTask = f.listeners.get('render')(0, 'swipe');
    const secondController = f.sandbox.postSpeechMessageAbortController;
    assert.equal(f.sandbox.postSpeechMessageControllers.size, 3);
    f.responses[0].resolve('policy'); await firstTask;
    assert.equal(f.sandbox.postSpeechMessageAbortController, secondController);
    assert.equal(f.sandbox.postSpeechMessageControllers.size, 2);
    f.listeners.get('stop')();
    assert.equal(f.responses[1].signal.aborted, true);
    assert.equal(f.responses[2].signal.aborted, true);
    f.responses[1].resolve('policy'); await secondTask;
    f.responses[2].resolve('policy'); await thirdTask;
    assert.equal(f.queued, 1); // Only the first, pre-Stop policy was queued.
    assert.equal(f.sandbox.postSpeechMessageAbortController, null);
});

test('failed older PostSpeech request does not clear the latest active controller', async () => {
    const f = lifecycleFixture();
    const first = f.listeners.get('render')(0, 'swipe');
    const second = f.listeners.get('render')(0, 'swipe');
    const current = f.sandbox.postSpeechMessageAbortController;
    f.responses[0].reject(new Error('network failed')); await first;
    assert.equal(f.sandbox.postSpeechMessageAbortController, current);
    assert.equal(f.sandbox.postSpeechMessageControllers.size, 1);
    f.listeners.get('stop')(); f.responses[1].resolve('late policy'); await second;
    assert.equal(f.queued, 0);
});

test('late capability planning after message deletion cannot requeue or save its result', async () => {
    const f = lifecycleFixture('message');
    const task = f.listeners.get('render')(0, 'swipe');
    f.responses[0].resolve('policy');
    await f.started;
    assert.equal(f.starts, 1);
    f.sandbox.chat.length = 0; await f.listeners.get('delete')(0);
    f.executions[0].resolve({ deferred: [{ action: { intentIndex: 0 } }], results: [] });
    await task;
    assert.equal(f.queued, 0); assert.equal(f.saved, 0);
});
