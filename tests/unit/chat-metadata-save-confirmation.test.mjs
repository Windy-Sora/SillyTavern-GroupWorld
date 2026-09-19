import assert from 'node:assert/strict';
import test from 'node:test';

import { createConfirmedChatMetadataSave } from '../../systems/chat-metadata-save-confirmation.js';

function fixture(overrides = {}) {
    const metadata = { gd: { summaries: [{ content: 'before' }] } };
    let stored = structuredClone(metadata.gd.summaries);
    let chatId = 'chat-1';
    let group = { id: 'group-1' };
    const requests = [];
    const save = createConfirmedChatMetadataSave({
        saveChatConditional: async () => { stored = structuredClone(metadata.gd.summaries); },
        getCurrentChatId: () => chatId,
        getCurrentGroup: () => group,
        getContext: () => ({ characterId: 0, characters: [{ name: 'Hero', avatar: 'hero.png' }] }),
        getChatMetadata: () => metadata,
        getRequestHeaders: () => ({ 'X-CSRF-Token': 'token' }),
        selectValue: value => value.gd?.summaries ?? [],
        label: 'Chat Summary',
        fetchChat: async (url, options) => {
            requests.push([url, options]);
            return { ok: true, json: async () => [{ chat_metadata: { gd: { summaries: stored } } }] };
        },
        ...overrides,
    });
    return {
        metadata,
        requests,
        save,
        set stored(value) { stored = value; },
        set chatId(value) { chatId = value; },
        set group(value) { group = value; },
    };
}

test('generic chat metadata save confirms group persistence before success', async () => {
    const subject = fixture();
    subject.metadata.gd.summaries[0].content = 'saved';
    await subject.save();
    assert.equal(subject.requests[0][0], '/api/chats/group/get');
    assert.deepEqual(JSON.parse(subject.requests[0][1].body), { id: 'chat-1' });
});

test('generic chat metadata save detects a swallowed host save failure', async () => {
    const subject = fixture({ saveChatConditional: async () => {} });
    subject.stored = [{ content: 'before' }];
    subject.metadata.gd.summaries[0].content = 'unsaved';
    await assert.rejects(subject.save(), /Chat Summary persistence could not be confirmed/);
});

test('generic chat metadata save marks failed readback as persistence unknown', async () => {
    const subject = fixture({ fetchChat: async () => ({ ok: false, status: 503 }) });
    await assert.rejects(subject.save(), error =>
        error.persistenceUnknown === true && /HTTP 503/.test(error.message));
});

test('generic chat metadata save reads the captured character chat identity', async () => {
    const subject = fixture({
        getCurrentGroup: () => null,
        saveChatConditional: async () => {},
        fetchChat: async (url, options) => {
            subject.requests.push([url, options]);
            return { ok: true, json: async () => [{ chat_metadata: subject.metadata }] };
        },
    });
    await subject.save();
    assert.equal(subject.requests[0][0], '/api/chats/get');
    assert.deepEqual(JSON.parse(subject.requests[0][1].body), {
        ch_name: 'Hero', file_name: 'chat-1', avatar_url: 'hero.png',
    });
});

test('generic chat metadata save accepts a concurrent state stored by the same host save', async () => {
    let subject;
    subject = fixture({
        saveChatConditional: async () => {
            subject.metadata.gd.summaries.push({ content: 'concurrent' });
            subject.stored = structuredClone(subject.metadata.gd.summaries);
        },
    });
    await subject.save();
    assert.deepEqual(subject.metadata.gd.summaries.map(entry => entry.content), ['before', 'concurrent']);
});
