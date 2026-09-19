import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemorySystem } from '../../systems/memory-system.js';

function fixture(overrides = {}) {
    const metadata = {};
    const chat = [{ name: 'User', mes: 'Hello', is_user: true }];
    const characters = [
        { avatar: 'alice.png', name: 'Alice', description: 'A', personality: 'bold', scenario: 'town' },
        { avatar: 'bob.png', name: 'Bob', description: 'B', personality: 'calm', scenario: 'town' },
    ];
    const calls = { saved: 0, pools: [], executes: [], logs: [], stops: 0 };
    const agent = { id: 'memory' };
    const dependencies = {
        settings: { lang: 'en', memoryMaxEntries: 3, agentConfigs: { memory: { call: { retries: 1 } } } },
        EXT_KEY: 'gd',
        getChatMetadata: () => metadata,
        getChat: () => chat,
        getCharacters: () => characters,
        saveChatConditional: async () => { calls.saved++; },
        log: (...args) => calls.logs.push(args),
        AgentRegistry: { get: id => id === 'memory' ? agent : null },
        execute: async (...args) => {
            calls.executes.push(args);
            return [{ event: 'Generated', mood: 'happy', round: 1 }];
        },
        buildContextPool: value => { calls.pools.push(value); return value; },
        getCurrentGroup: () => ({ members: ['alice.png', 'bob.png'], disabled_members: [] }),
        createCaller: (_config, raw, stop) => ({ raw, stop, generate: raw }),
        getContext: () => ({ generateRaw: async value => value, stopGeneration: () => calls.stops++ }),
        ...overrides,
    };
    return { system: createMemorySystem(dependencies), metadata, chat, characters, calls, agent };
}

test('single-character memory generation builds agent context, appends, and trims oldest entries', async () => {
    const { system, metadata, calls, agent } = fixture();
    metadata.gd = { charMemories: { 'alice.png': [
        { event: 'Old 1', round: 0 },
        { event: 'Old 2', round: 0 },
        { event: 'Old 3', round: 0 },
    ] } };
    const result = await system.generateForCharacter('alice.png');
    assert.deepEqual(result, [{ event: 'Generated', mood: 'happy', round: 1 }]);
    assert.deepEqual(system.getMemories('alice.png').map(memory => memory.event), ['Old 2', 'Old 3', 'Generated']);
    assert.equal(calls.saved, 1);
    assert.equal(calls.executes[0][0], agent);
    assert.equal(calls.executes[0][1].pool.memoryCharacter.name, 'Alice');
    assert.deepEqual(calls.pools[0].memoryExistingList(), [
        { event: 'Old 1', round: 0 }, { event: 'Old 2', round: 0 }, { event: 'Old 3', round: 0 },
    ]);
    assert.deepEqual(calls.executes[0][1].config.call, { retries: 1 });
});

test('memory generation rejects missing agents, characters, and empty extraction results', async () => {
    await assert.rejects(fixture({ AgentRegistry: { get: () => null } }).system.generateForCharacter('alice.png'), /not registered/);
    await assert.rejects(fixture().system.generateForCharacter('missing.png'), /Character not found/);
    const empty = fixture({ execute: async () => [] }).system;
    await assert.rejects(empty.generateForCharacter('alice.png'), error => {
        assert.equal(error.code, 'NO_NEW_MEMORIES');
        return true;
    });
});

test('all-character memory generation isolates partial failures and keeps result arrays stable', async () => {
    const { system, calls } = fixture({
        execute: async (_agent, { pool }) => {
            if (pool.memoryCharacter.name === 'Bob') throw new Error('Bob failed');
            return [{ event: `${pool.memoryCharacter.name} result` }];
        },
    });
    const result = await system.generateForAll();
    assert.deepEqual(result, {
        'alice.png': [{ event: 'Alice result' }],
        'bob.png': [],
    });
    assert.equal(calls.logs.length, 1);
    assert.match(calls.logs[0][0], /bob\.png.*Bob failed/);
});

test('all-character generation validates group and enabled member availability', async () => {
    await assert.rejects(fixture({ getCurrentGroup: () => null }).system.generateForAll(), /Not in a group chat/);
    await assert.rejects(fixture({
        getCurrentGroup: () => ({ members: ['alice.png'], disabled_members: ['alice.png'] }),
    }).system.generateForAll(), /No enabled members/);
});
