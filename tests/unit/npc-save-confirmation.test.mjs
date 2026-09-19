import assert from 'node:assert/strict';
import test from 'node:test';
import { createConfirmedNpcChatSave } from '../../systems/npc-save-confirmation.js';
import { createNpcExportSystem } from '../../systems/npc-export-system.js';
import { createNpcSystem } from '../../systems/npc-system.js';

function fixture(overrides = {}) {
    const metadata = { gd: { npcs: [{ name: 'Alice', description: 'before' }] } };
    let storedNpcs = structuredClone(metadata.gd.npcs);
    let saved = 0;
    const requests = [];
    const save = createConfirmedNpcChatSave({
        saveChatConditional: async () => { saved++; storedNpcs = structuredClone(metadata.gd.npcs); },
        getCurrentChatId: () => 'chat-1',
        getCurrentGroup: () => ({ id: 'group-1' }),
        getContext: () => ({}),
        getChatMetadata: () => metadata,
        getRequestHeaders: () => ({ 'X-CSRF-Token': 'token' }),
        EXT_KEY: 'gd',
        fetchChat: async (url, options) => {
            requests.push([url, options]);
            return { ok: true, json: async () => [{ chat_metadata: { gd: { npcs: storedNpcs } } }] };
        },
        ...overrides,
    });
    const system = createNpcSystem({
        settings: { lang: 'en' }, EXT_KEY: 'gd', getChatMetadata: () => metadata,
        saveChatConditional: save,
    });
    return { metadata, requests, system, get saved() { return saved; } };
}

test('NPC save confirms persisted group metadata before reporting update success', async () => {
    const subject = fixture();
    await subject.system.updateNpc(0, { description: 'saved' });
    assert.equal(subject.metadata.gd.npcs[0].description, 'saved');
    assert.equal(subject.saved, 1);
    assert.equal(subject.requests[0][0], '/api/chats/group/get');
    assert.deepEqual(JSON.parse(subject.requests[0][1].body), { id: 'chat-1' });
});

test('NPC update rolls back when host save resolves after swallowing an HTTP failure', async () => {
    const subject = fixture({
        saveChatConditional: async () => {}, // Host also resolves after a failed save.
        fetchChat: async () => ({
            ok: true,
            json: async () => [{ chat_metadata: { gd: { npcs: [{ name: 'Alice', description: 'before' }] } } }],
        }),
    });
    await assert.rejects(subject.system.updateNpc(0, { description: 'unsaved' }), /could not be confirmed/);
    assert.equal(subject.metadata.gd.npcs[0].description, 'before');
});

test('NPC update preserves memory when a successful write cannot be read back', async () => {
    let stored;
    let subject;
    subject = fixture({
        saveChatConditional: () => { stored = structuredClone(subject.metadata.gd.npcs); },
        fetchChat: async () => ({ ok: false, status: 503 }),
    });
    await assert.rejects(subject.system.updateNpc(0, { description: 'saved' }), error =>
        error.persistenceUnknown === true && /HTTP 503/.test(error.message));
    assert.equal(subject.metadata.gd.npcs[0].description, 'saved');
    assert.deepEqual(subject.metadata.gd.npcs, stored);
});

test('NPC import preserves memory when verification transport fails after the write', async () => {
    const metadata = { gd: { npcs: [{ name: 'Alice', description: 'before' }] } };
    let stored;
    const confirmedSave = createConfirmedNpcChatSave({
        saveChatConditional: () => { stored = structuredClone(metadata.gd.npcs); },
        getCurrentChatId: () => 'chat-1', getCurrentGroup: () => ({ id: 'group-1' }),
        getContext: () => ({}), getChatMetadata: () => metadata,
        getRequestHeaders: () => ({}), EXT_KEY: 'gd',
        fetchChat: async () => { throw new Error('network unavailable'); },
    });
    const system = createNpcExportSystem({
        settings: {}, EXT_KEY: 'gd', getChatMetadata: () => metadata,
        getCurrentGroup: () => ({ id: 'group-1' }),
        saveChatConditional: confirmedSave, saveSettings() {}, log() {},
    });
    await assert.rejects(system.applyImport({
        template: {}, npcs: [{ name: 'Alice', description: 'saved' }],
    }, ['Alice']), error => error.persistenceUnknown === true);
    assert.equal(metadata.gd.npcs[0].description, 'saved');
    assert.deepEqual(metadata.gd.npcs, stored);
});

test('NPC save reads the selected character chat when no group is active', async () => {
    const subject = fixture({
        getCurrentGroup: () => null,
        getContext: () => ({ characterId: 0, characters: [{ name: 'Hero', avatar: 'hero.png' }] }),
    });
    await subject.system.updateNpc(0, { description: 'saved' });
    assert.equal(subject.requests[0][0], '/api/chats/get');
    assert.deepEqual(JSON.parse(subject.requests[0][1].body), {
        ch_name: 'Hero', file_name: 'chat-1', avatar_url: 'hero.png',
    });
});

test('NPC confirmation accepts the submitted state when a later edit is not yet stored', async () => {
    let finish;
    const pendingSave = new Promise(resolve => { finish = resolve; });
    let persisted;
    let subject;
    subject = fixture({
        saveChatConditional: () => {
            persisted = structuredClone(subject.metadata.gd.npcs);
            return pendingSave;
        },
        fetchChat: async () => ({
            ok: true,
            json: async () => [{ chat_metadata: { gd: { npcs: persisted } } }],
        }),
    });
    const update = subject.system.updateNpc(0, { description: 'saved' });
    subject.metadata.gd.npcs.push({ name: 'Later' });
    finish();
    await update;
    assert.deepEqual(subject.metadata.gd.npcs.map(npc => npc.name), ['Alice', 'Later']);
});
