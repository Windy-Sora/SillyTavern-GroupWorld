import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemorySystem } from '../../systems/memory-system.js';

function fixture(overrides = {}) {
    const metadata = {};
    const chat = [{ mes: 'one' }, { mes: 'two' }];
    const characters = [{ avatar: 'alice.png', name: 'Alice', description: 'Desc', personality: 'Bold' }];
    const calls = { saved: 0, prompts: [], logs: [] };
    const dependencies = {
        settings: { lang: 'en', memoryMaxEntries: 10, agentConfigs: { memory: {} } },
        EXT_KEY: 'gd',
        getChatMetadata: () => metadata,
        getChat: () => chat,
        getCharacters: () => characters,
        saveChatConditional: async () => { calls.saved++; },
        log: (...args) => calls.logs.push(args),
        AgentRegistry: { get: () => ({}) },
        execute: async () => [],
        buildContextPool: value => value,
        getCurrentGroup: () => ({ members: ['alice.png'], disabled_members: [] }),
        createCaller: () => ({ generate: async prompt => { calls.prompts.push(prompt); return 'Condensed arc'; } }),
        getContext: () => ({ generateRaw: async () => '', stopGeneration() {} }),
        ...overrides,
    };
    return { system: createMemorySystem(dependencies), metadata, chat, characters, calls };
}

function memories() {
    return [
        { event: 'Met Bob', mood: 'happy', round: 1 },
        { event: 'Lost key', mood: 'sad', round: 2 },
        { event: 'Found key', mood: 'relieved', round: 3 },
        { event: 'Went home', mood: 'calm', round: 4 },
    ];
}

test('memory compression replaces old entries with one LLM summary and preserves recent entries', async () => {
    const { system, metadata, calls } = fixture();
    metadata.gd = { charMemories: { 'alice.png': memories() } };
    const result = await system.compressOldMemories('alice.png', 2);
    assert.deepEqual(result, { removed: 2, kept: 2, compressed: 1 });
    const stored = system.getMemories('alice.png');
    assert.equal(stored[0].event, 'Condensed arc');
    assert.equal(stored[0].compressed, true);
    assert.equal(stored[0].originalCount, 2);
    assert.deepEqual(stored.slice(1).map(memory => memory.event), ['Found key', 'Went home']);
    assert.match(calls.prompts[0], /Alice/);
    assert.match(calls.prompts[0], /1\. Met Bob \[happy\]/);
    assert.equal(calls.saved, 1);
});

test('memory compression falls back to a local join after model or empty-response failures', async () => {
    const failed = fixture({
        createCaller: () => ({ generate: async () => { throw new Error('offline'); } }),
    });
    failed.metadata.gd = { charMemories: { 'alice.png': memories() } };
    await failed.system.compressOldMemories('alice.png', 2);
    assert.equal(failed.system.getMemories('alice.png')[0].event, 'Met Bob; Lost key');
    assert.match(failed.calls.logs[0][0], /falling back/);

    const empty = fixture({ createCaller: () => ({ generate: async () => '   ' }) });
    empty.metadata.gd = { charMemories: { 'alice.png': memories() } };
    await empty.system.compressOldMemories('alice.png', 3);
    assert.equal(empty.system.getMemories('alice.png')[0].event, 'Met Bob');
});

test('memory compression handles keep and character guards without saving', async () => {
    const { system, metadata, calls } = fixture();
    metadata.gd = { charMemories: { 'alice.png': memories() } };
    assert.equal(await system.compressOldMemories('alice.png', 0), null);
    assert.equal(await system.compressOldMemories('alice.png', 4), null);
    assert.equal(calls.saved, 0);
    metadata.gd.charMemories['missing.png'] = memories();
    await assert.rejects(system.compressOldMemories('missing.png', 1), /Character not found/);
});

test('memory queries report counts, latest rounds, orphaned entries, and unknown characters', () => {
    const { system, metadata } = fixture();
    metadata.gd = { charMemories: {
        'alice.png': [{ event: 'A', round: 1 }, { event: 'Future', round: 4 }],
        'ghost.png': [{ event: 'Ghost', round: 3 }],
    } };
    assert.deepEqual(system.getStats(), {
        'alice.png': { name: 'Alice', count: 2, latestRound: 4 },
        'ghost.png': { name: 'ghost.png', count: 1, latestRound: 3 },
    });
    assert.deepEqual(system.detectOrphans(), [
        { avatar: 'alice.png', name: 'Alice', staleCount: 1 },
        { avatar: 'ghost.png', name: 'ghost.png', staleCount: 1 },
    ]);
    assert.equal(system.totalCount(), 3);
});
