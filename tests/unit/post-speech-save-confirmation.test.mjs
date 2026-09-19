import assert from 'node:assert/strict';
import test from 'node:test';
import { createConfirmedPostSpeechChatSave } from '../../systems/post-speech-save-confirmation.js';
import { createPostSpeechSystem } from '../../systems/post-speech-system.js';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

function fixture(overrides = {}) {
    let metadata = { gd: { postSpeechDecisions: [] } };
    let chatId = 'chat-1';
    let stored = [];
    let saves = 0;
    const requests = [];
    const save = createConfirmedPostSpeechChatSave({
        saveChatConditional: async () => {
            saves++;
            stored = structuredClone(metadata.gd.postSpeechDecisions);
        },
        getCurrentChatId: () => chatId,
        getCurrentGroup: () => ({ id: 'group-1' }),
        getContext: () => ({}),
        getChatMetadata: () => metadata,
        getRequestHeaders: () => ({ 'X-CSRF-Token': 'token' }),
        EXT_KEY: 'gd',
        fetchChat: async (url, options) => {
            requests.push([url, options]);
            return { ok: true, json: async () => [{ chat_metadata: { gd: { postSpeechDecisions: stored } } }] };
        },
        ...overrides,
    });
    const system = createPostSpeechSystem({
        settings: {}, EXT_KEY: 'gd', getChatMetadata: () => metadata,
        getChat: () => [], saveChatConditional: save, log: () => {},
    });
    return {
        system, requests,
        get metadata() { return metadata; },
        get saves() { return saves; },
        switchTo(nextId, nextMetadata) { chatId = nextId; metadata = nextMetadata; },
    };
}

test('PostSpeech confirms group decision storage before reporting success', async () => {
    const f = fixture();
    await f.system.record(1, 'A', 'image', {}, null);
    assert.equal(f.system.wasExecuted(1, 'image'), true);
    assert.equal(f.saves, 1);
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0][0], '/api/chats/group/get');
    assert.deepEqual(JSON.parse(f.requests[0][1].body), { id: 'chat-1' });
});

test('a swallowed host save failure does not leave a phantom executed decision', async () => {
    const f = fixture({ saveChatConditional: async () => {} });
    await assert.rejects(f.system.record(1, 'A', 'image', {}, null), /could not be confirmed/);
    assert.equal(f.system.wasExecuted(1, 'image'), false);
});

test('unreadable storage is unknown, so a possibly persisted decision stays in memory', async () => {
    const f = fixture({ fetchChat: async () => ({ ok: false, status: 503 }) });
    await assert.rejects(f.system.record(1, 'A', 'image', {}, null), error =>
        error.persistenceUnknown === true && /HTTP 503/.test(error.message));
    assert.equal(f.system.wasExecuted(1, 'image'), true);
});

test('PostSpeech confirmation reads the selected character chat', async () => {
    const requests = [];
    const f = fixture({
        getCurrentGroup: () => null,
        getContext: () => ({ characterId: 0, characters: [{ name: 'Hero', avatar: 'hero.png' }] }),
        fetchChat: async (url, options) => {
            requests.push([url, options]);
            return { ok: true, json: async () => [{ chat_metadata: { gd: {
                postSpeechDecisions: structuredClone(f.metadata.gd.postSpeechDecisions),
            } } }] };
        },
    });
    await f.system.record(1, 'A', 'image', {}, null);
    assert.equal(requests[0][0], '/api/chats/get');
    assert.deepEqual(JSON.parse(requests[0][1].body), {
        ch_name: 'Hero', file_name: 'chat-1', avatar_url: 'hero.png',
    });
});

test('confirmation reads the original chat after selection changes during save', async () => {
    const gate = deferred();
    const requests = [];
    let oldMetadata;
    const f = fixture({
        saveChatConditional: () => gate.promise,
        fetchChat: async (url, options) => {
            requests.push([url, options]);
            return { ok: true, json: async () => [{ chat_metadata: { gd: {
                postSpeechDecisions: structuredClone(oldMetadata.gd.postSpeechDecisions),
            } } }] };
        },
    });
    oldMetadata = f.metadata;
    const recording = f.system.record(1, 'A', 'image', {}, null);
    f.switchTo('chat-2', { gd: { postSpeechDecisions: [] } });
    gate.resolve();
    await recording;
    assert.deepEqual(JSON.parse(requests[0][1].body), { id: 'chat-1' });
    assert.equal(f.system.count(), 0);
    assert.equal(oldMetadata.gd.postSpeechDecisions.length, 1);
});

test('chat switch with a swallowed old-chat save failure rolls back only the old chat', async () => {
    const gate = deferred();
    const f = fixture({
        saveChatConditional: () => gate.promise,
        fetchChat: async () => ({ ok: true, json: async () => [{ chat_metadata: { gd: {
            postSpeechDecisions: [],
        } } }] }),
    });
    const oldMetadata = f.metadata;
    const recording = f.system.record(1, 'A', 'image', {}, null);
    const newMetadata = { gd: { postSpeechDecisions: [{ messageIndex: 2, capabilityId: 'audio' }] } };
    f.switchTo('chat-2', newMetadata);
    gate.resolve();
    await assert.rejects(recording, /could not be confirmed/);
    assert.deepEqual(oldMetadata.gd.postSpeechDecisions, []);
    assert.deepEqual(f.system.list(), newMetadata.gd.postSpeechDecisions);
});

test('confirmation accepts a submitted snapshot when a later decision is not yet stored', async () => {
    const gate = deferred();
    let submitted;
    const f = fixture({
        saveChatConditional: () => {
            submitted = structuredClone(f.metadata.gd.postSpeechDecisions);
            return gate.promise;
        },
        fetchChat: async () => ({ ok: true, json: async () => [{ chat_metadata: { gd: {
            postSpeechDecisions: submitted,
        } } }] }),
    });
    const recording = f.system.record(1, 'A', 'image', {}, null);
    f.metadata.gd.postSpeechDecisions.push({ messageIndex: 2, capabilityId: 'later' });
    gate.resolve();
    await recording;
    assert.equal(f.system.wasExecuted(1, 'image'), true);
    assert.equal(f.system.wasExecuted(2, 'later'), true);
});

test('unconfirmed prune rolls back but an unknown read leaves pruned memory intact', async () => {
    const before = [{ messageIndex: 1, capabilityId: 'keep' }, { messageIndex: 9, capabilityId: 'remove' }];
    const unconfirmed = fixture({
        saveChatConditional: async () => {},
        fetchChat: async () => ({ ok: true, json: async () => [{ chat_metadata: { gd: {
            postSpeechDecisions: before,
        } } }] }),
    });
    unconfirmed.metadata.gd.postSpeechDecisions = structuredClone(before);
    await assert.rejects(unconfirmed.system.pruneAfter(2), /could not be confirmed/);
    assert.deepEqual(unconfirmed.system.list(), before);

    const unknown = fixture({ fetchChat: async () => { throw new Error('offline'); } });
    unknown.metadata.gd.postSpeechDecisions = structuredClone(before);
    await assert.rejects(unknown.system.pruneAfter(2), error => error.persistenceUnknown === true);
    assert.deepEqual(unknown.system.list().map(r => r.capabilityId), ['keep']);
});

test('unconfirmed clear rolls back; unreadable storage leaves clearing status unknown', async () => {
    const before = [{ messageIndex: 1, capabilityId: 'image' }];
    const unconfirmed = fixture({
        saveChatConditional: async () => {},
        fetchChat: async () => ({ ok: true, json: async () => [{ chat_metadata: { gd: {
            postSpeechDecisions: before,
        } } }] }),
    });
    unconfirmed.metadata.gd.postSpeechDecisions = structuredClone(before);
    await assert.rejects(unconfirmed.system.clearAll(), /could not be confirmed/);
    assert.deepEqual(unconfirmed.system.list(), before);

    const unknown = fixture({ fetchChat: async () => ({ ok: false, status: 503 }) });
    unknown.metadata.gd.postSpeechDecisions = structuredClone(before);
    await assert.rejects(unknown.system.clearAll(), error => error.persistenceUnknown === true);
    assert.deepEqual(unknown.system.list(), []);
});
