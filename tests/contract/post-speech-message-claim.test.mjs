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
    let resolve;
    const promise = new Promise(yes => { resolve = yes; });
    return { promise, resolve };
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
        postSpeechMessageAbortController: null, AbortController,
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
