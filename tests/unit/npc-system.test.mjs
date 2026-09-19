import assert from 'node:assert/strict';
import test from 'node:test';
import { createNpcSystem } from '../../systems/npc-system.js';

function createSubject(getCharacters) {
    const metadata = {};
    return createNpcSystem({
        settings: { lang: 'en' },
        EXT_KEY: 'gd',
        getChatMetadata: () => metadata,
        saveChatConditional: async () => {},
        getCharacters,
        log: () => {},
    });
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function fixture(overrides = {}) {
    const metadata = { gd: { npcs: [] } };
    const chat = [];
    const settings = { lang: 'en', agentConfigs: {}, npcMaxCount: 10, npcBatchSize: 3 };
    let current = metadata;
    const deps = {
        settings, EXT_KEY: 'gd', getChatMetadata: () => current, getChat: () => chat,
        saveChatConditional: async () => {}, getCharacters: () => [], log: () => {},
        AgentRegistry: { get: () => ({ id: 'npc' }) },
        execute: async () => [], buildContextPool: () => ({}), getCurrentGroup: () => ({ members: [] }),
        createCaller: () => ({}), getContext: () => ({ generateRaw: async () => '', stopGeneration() {} }),
        ...overrides,
    };
    return {
        system: createNpcSystem(deps), metadata, settings,
        switchChat(next = {}) { current = next; return next; },
    };
}

test('NPC duplicate checks resolve the live character array at use time', () => {
    let characters = [{ avatar: 'alice.png', name: 'Alice' }];
    const subject = createSubject(() => characters);

    assert.equal(subject.nameExists('alice'), true);
    assert.equal(subject.nameExists('Bob'), false);

    characters = [{ avatar: 'bob.png', name: 'Bob' }];
    assert.equal(subject.nameExists('Alice'), false);
    assert.equal(subject.nameExists('bob'), true);
});

test('NPC duplicate checks include stored NPC names case-insensitively', () => {
    const subject = createSubject(() => []);
    subject.getNpcs().push({ name: 'Gatekeeper' });

    assert.equal(subject.nameExists('gatekeeper'), true);
    assert.equal(subject.nameExists('Merchant'), false);
});

test('failed NPC update restores its field while retaining other NPC and same-NPC edits', async () => {
    const save = deferred();
    const { system, metadata } = fixture({ saveChatConditional: () => save.promise });
    metadata.gd.npcs = [
        { name: 'Alice', description: 'before', personality: 'calm' },
        { name: 'Bob', description: 'before' },
    ];
    const pending = system.updateNpc(0, { description: 'imported' });
    metadata.gd.npcs[0].personality = 'concurrent';
    metadata.gd.npcs[1].description = 'concurrent';
    save.reject(new Error('chat save failed'));
    await assert.rejects(pending, /chat save failed/);
    assert.deepEqual(metadata.gd.npcs.map(npc => npc.description), ['before', 'concurrent']);
    assert.equal(metadata.gd.npcs[0].personality, 'concurrent');
});

test('failed NPC update preserves a later same-value edit to the same field', async () => {
    const firstSave = deferred();
    const secondSave = deferred();
    let saves = 0;
    const { system, metadata } = fixture({
        saveChatConditional: () => (++saves === 1 ? firstSave.promise : secondSave.promise),
    });
    metadata.gd.npcs = [{ name: 'Alice', description: 'before' }];
    const first = system.updateNpc(0, { description: 'shared' });
    const second = system.updateNpc(0, { description: 'shared' });
    secondSave.resolve();
    await second;
    firstSave.reject(new Error('first save failed'));
    await assert.rejects(first, /first save failed/);
    assert.equal(metadata.gd.npcs[0].description, 'shared');
});

test('failed NPC delete restores its entry beside surviving neighbors', async () => {
    const save = deferred();
    const { system, metadata } = fixture({ saveChatConditional: () => save.promise });
    metadata.gd.npcs = [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Carol' }];
    const pending = system.deleteNpc(1);
    metadata.gd.npcs.unshift({ name: 'New' });
    save.reject(new Error('chat save failed'));
    await assert.rejects(pending, /chat save failed/);
    assert.deepEqual(metadata.gd.npcs.map(npc => npc.name), ['New', 'Alice', 'Bob', 'Carol']);
});

test('failed NPC delete retains relative order after a concurrent list replacement', async () => {
    const save = deferred();
    const { system, metadata } = fixture({ saveChatConditional: () => save.promise });
    metadata.gd.npcs = [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Carol' }];
    const pending = system.deleteNpc(1);
    metadata.gd.npcs = [{ name: 'New' }, ...structuredClone(metadata.gd.npcs)];
    save.reject(new Error('chat save failed'));
    await assert.rejects(pending, /chat save failed/);
    assert.deepEqual(metadata.gd.npcs.map(npc => npc.name), ['New', 'Alice', 'Bob', 'Carol']);
});

test('NPC update and delete also compensate synchronous save throws', async () => {
    const { system, metadata } = fixture({ saveChatConditional: () => { throw new Error('sync save failed'); } });
    metadata.gd.npcs = [{ name: 'Alice', description: 'before' }, { name: 'Bob' }];
    await assert.rejects(system.updateNpc(0, { description: 'changed' }), /sync save failed/);
    assert.equal(metadata.gd.npcs[0].description, 'before');
    await assert.rejects(system.deleteNpc(1), /sync save failed/);
    assert.deepEqual(metadata.gd.npcs.map(npc => npc.name), ['Alice', 'Bob']);
});

test('NPC generation returns only persisted additions after duplicate and capacity filtering', async () => {
    const { system, metadata, settings } = fixture({
        execute: async () => [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Carol' }],
    });
    metadata.gd.npcs = [{ name: 'Alice' }];
    settings.npcMaxCount = 2;
    const added = await system.generateNpcs();
    assert.deepEqual(added.map(npc => npc.name), ['Bob']);
    assert.deepEqual(metadata.gd.npcs.map(npc => npc.name), ['Alice', 'Bob']);
});

test('failed NPC generation removes only its own additions', async () => {
    const save = deferred();
    const saveStarted = deferred();
    const { system, metadata } = fixture({
        saveChatConditional: () => { saveStarted.resolve(); return save.promise; },
        execute: async () => [{ name: 'Mage' }],
    });
    const pending = system.generateNpcs();
    await saveStarted.promise;
    metadata.gd.npcs.push({ name: 'Concurrent' });
    save.reject(new Error('chat save failed'));
    await assert.rejects(pending, /chat save failed/);
    assert.deepEqual(metadata.gd.npcs.map(npc => npc.name), ['Concurrent']);
});

test('failed NPC generation preserves an edited addition and reports incomplete rollback', async () => {
    const save = deferred();
    const saveStarted = deferred();
    const { system, metadata } = fixture({
        saveChatConditional: () => { saveStarted.resolve(); return save.promise; },
        execute: async () => [{ name: 'Mage', description: 'generated' }],
    });
    const pending = system.generateNpcs();
    await saveStarted.promise;
    metadata.gd.npcs[0].description = 'concurrent';
    save.reject(new Error('chat save failed'));
    await assert.rejects(pending, error => error.rollbackIncomplete === true && /chat save failed/.test(error.message));
    assert.equal(metadata.gd.npcs[0].description, 'concurrent');
});

test('NPC update reports a chat switch after successful save without touching the new chat', async () => {
    const save = deferred();
    const { system, metadata, switchChat } = fixture({ saveChatConditional: () => save.promise });
    metadata.gd.npcs = [{ name: 'Alice', description: 'before' }];
    const pending = system.updateNpc(0, { description: 'saved' });
    const next = switchChat({ gd: { npcs: [{ name: 'Bob' }] } });
    save.resolve();
    await assert.rejects(pending, /stale/i);
    assert.equal(metadata.gd.npcs[0].description, 'saved');
    assert.deepEqual(next.gd.npcs, [{ name: 'Bob' }]);
});

test('NPC generation reports a chat switch after successful save without undoing the old chat', async () => {
    const save = deferred();
    const saveStarted = deferred();
    const { system, metadata, switchChat } = fixture({
        saveChatConditional: () => { saveStarted.resolve(); return save.promise; },
        execute: async () => [{ name: 'Mage' }],
    });
    const pending = system.generateNpcs();
    await saveStarted.promise;
    const next = switchChat({ gd: { npcs: [] } });
    save.resolve();
    await assert.rejects(pending, { name: 'StaleExecutionError' });
    assert.deepEqual(metadata.gd.npcs.map(npc => npc.name), ['Mage']);
    assert.deepEqual(next.gd.npcs, []);
});
