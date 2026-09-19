import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemorySystem } from '../../systems/memory-system.js';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function fixture(overrides = {}) {
    const metadata = {};
    const chat = [{ mes: 'one' }, { mes: 'two' }];
    const characters = [
        { avatar: 'alice.png', name: 'Alice' },
        { avatar: 'bob.png', name: 'Bob' },
    ];
    const calls = { saved: 0, logs: [] };
    const dependencies = {
        settings: { lang: 'en', memoryMaxEntries: 3, agentConfigs: {} },
        EXT_KEY: 'gd',
        getChatMetadata: () => metadata,
        getChat: () => chat,
        getCharacters: () => characters,
        saveChatConditional: async () => { calls.saved++; },
        log: (...args) => calls.logs.push(args),
        AgentRegistry: { get: () => null },
        execute: async () => [],
        buildContextPool: value => value,
        getCurrentGroup: () => ({ members: ['alice.png', 'bob.png'], disabled_members: [] }),
        createCaller: () => ({ generate: async () => '' }),
        getContext: () => ({ generateRaw: async () => '', stopGeneration() {} }),
        ...overrides,
    };
    return { system: createMemorySystem(dependencies), metadata, chat, characters, calls };
}

test('memory storage initializes lazily and exposes isolated character lists', async () => {
    const { system, metadata, calls } = fixture();
    assert.deepEqual(system.getMemories('alice.png'), []);
    assert.deepEqual(metadata.gd.charMemories, {});
    await system._setMemories('alice.png', [{ event: 'One' }]);
    assert.deepEqual(system.listMemories('alice.png'), [{ event: 'One' }]);
    assert.deepEqual(system.getMemories('bob.png'), []);
    assert.equal(calls.saved, 1);
});

test('memory replace and delete roll back when persistence fails', async () => {
    const metadata = { gd: { charMemories: { 'alice.png': [{ event: 'Original' }] } } };
    const { system } = fixture({
        getChatMetadata: () => metadata,
        saveChatConditional: async () => { throw new Error('save failed'); },
    });
    await assert.rejects(system._setMemories('alice.png', [{ event: 'New' }]), /save failed/);
    assert.deepEqual(metadata.gd.charMemories['alice.png'], [{ event: 'Original' }]);
    await assert.rejects(system._deleteKey('alice.png'), /save failed/);
    assert.deepEqual(metadata.gd.charMemories['alice.png'], [{ event: 'Original' }]);
    await system._deleteKey('missing.png');
});

test('memory CRUD edits clones, validates indices, deletes, and reverts the tail', async () => {
    const { system, metadata, calls } = fixture();
    metadata.gd = { charMemories: { 'alice.png': [
        { event: 'One', nested: { kept: true } },
        { event: 'Two' },
        { event: 'Three' },
    ] } };
    const original = metadata.gd.charMemories['alice.png'];
    await system.updateEntry('alice.png', 0, { event: 'Edited' });
    assert.notEqual(metadata.gd.charMemories['alice.png'], original);
    assert.equal(original[0].event, 'One');
    assert.equal(system.listMemories('alice.png')[0].event, 'Edited');
    await assert.rejects(system.updateEntry('alice.png', -1, {}), /Invalid index/);
    await system.deleteEntry('alice.png', 1);
    assert.deepEqual(system.listMemories('alice.png').map(entry => entry.event), ['Edited', 'Three']);
    assert.deepEqual((await system.revertLast('alice.png', 1)).map(entry => entry.event), ['Three']);
    assert.deepEqual(system.listMemories('alice.png').map(entry => entry.event), ['Edited']);
    await system.deleteCharacterMemories('alice.png');
    assert.deepEqual(metadata.gd.charMemories, {});
    assert.equal(calls.saved, 4);
});

test('resetAll clears every character and rolls back a failed save', async () => {
    const success = fixture();
    success.metadata.gd = { charMemories: { 'alice.png': [{ event: 'A' }], 'bob.png': [{ event: 'B' }] } };
    await success.system.resetAll();
    assert.deepEqual(success.metadata.gd.charMemories, {});

    const metadata = { gd: { charMemories: { 'alice.png': [{ event: 'Keep' }] } } };
    const failed = fixture({
        getChatMetadata: () => metadata,
        saveChatConditional: async () => { throw new Error('reset save failed'); },
    });
    await assert.rejects(failed.system.resetAll(), /reset save failed/);
    assert.deepEqual(metadata.gd.charMemories, { 'alice.png': [{ event: 'Keep' }] });
});

test('pruneAfter trims to the configured maximum and serializes concurrent calls', async () => {
    const gate = deferred();
    const metadata = { gd: { charMemories: {
        'alice.png': [{ event: '1' }, { event: '2' }, { event: '3' }, { event: '4' }],
    } } };
    let saves = 0;
    const { system } = fixture({
        getChatMetadata: () => metadata,
        saveChatConditional: async () => { saves++; await gate.promise; },
    });
    const first = system.pruneAfter();
    const second = system.pruneAfter();
    assert.equal(await second, undefined);
    assert.equal(saves, 1);
    gate.resolve();
    await first;
    assert.deepEqual(metadata.gd.charMemories['alice.png'].map(entry => entry.event), ['2', '3', '4']);
});

test('pruneAfter restores trimmed entries when persistence fails', async () => {
    const metadata = { gd: { charMemories: {
        'alice.png': [{ event: '1' }, { event: '2' }, { event: '3' }, { event: '4' }],
    } } };
    const { system } = fixture({
        getChatMetadata: () => metadata,
        saveChatConditional: async () => { throw new Error('prune save failed'); },
    });
    await assert.rejects(system.pruneAfter(), /prune save failed/);
    assert.deepEqual(metadata.gd.charMemories['alice.png'].map(entry => entry.event), ['1', '2', '3', '4']);
});
