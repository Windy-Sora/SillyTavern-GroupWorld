import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatSummarySystem } from '../../systems/chat-summary-system.js';
import { createMemorySystem } from '../../systems/memory-system.js';
import { createNpcSystem } from '../../systems/npc-system.js';
import { createProfileSystem } from '../../systems/profile-system.js';
import { createStoryBlueprintSystem } from '../../systems/story-blueprint-system.js';

function deferred() {
    let resolve;
    const promise = new Promise(ok => { resolve = ok; });
    return { promise, resolve };
}

async function settle() {
    await new Promise(resolve => setTimeout(resolve, 0));
}

function summaryHarness() {
    const settings = { summaryPrompt: '', lang: 'en', summaryReusePrevious: false };
    const metadata = {};
    const chat = [{ name: 'User', mes: 'one' }];
    const sent = [];
    let response = 'summary';
    const system = createChatSummarySystem({
        settings,
        getChatMetadata: () => metadata,
        getChat: () => chat,
        EXT_KEY: 'gd',
        saveChatConditional: async () => {},
        generateRaw: async () => '',
        inject_ids: { QUIET_PROMPT: 'quiet' },
        extension_prompt_types: { IN_PROMPT: 0 },
        setExtensionPrompt: () => {},
        createCaller: () => ({
            generate: prompt => {
                sent.push(prompt);
                return typeof response === 'string' ? response : response.promise;
            },
        }),
    });
    return { system, settings, metadata, chat, sent, set response(value) { response = value; } };
}

test('summary generation stores the resolved prompt and rejects false appended coverage', async () => {
    const promptCase = summaryHarness();
    const promptGate = deferred();
    promptCase.response = promptGate;
    const promptRequest = promptCase.system.generateSummary();
    await settle();
    promptCase.settings.summaryPrompt = 'new prompt';
    promptGate.resolve('done');
    const entry = await promptRequest;
    assert.match(entry.promptUsed, /^Summarize the following content concisely\./);

    const coverageCase = summaryHarness();
    const coverageGate = deferred();
    coverageCase.response = coverageGate;
    const coverageRequest = coverageCase.system.generateSummary();
    await settle();
    coverageCase.chat.push({ name: 'User', mes: 'not sent' });
    coverageGate.resolve('stale');
    await assert.rejects(coverageRequest, { name: 'StaleExecutionError' });
    assert.equal(coverageCase.system.getSummaries().length, 0);
});

test('summary regeneration preserves a newer manual edit and original prompt provenance', async () => {
    const h = summaryHarness();
    h.metadata.gd = { summaries: [{
        rangeEnd: 1,
        content: 'old',
        active: true,
        basedOn: null,
        promptUsed: 'original prompt',
    }] };
    const gate = deferred();
    h.response = gate;
    const request = h.system.regenerateLastSummary();
    await settle();
    h.metadata.gd.summaries[0].content = 'manual edit';
    gate.resolve('stale regeneration');
    await assert.rejects(request, { name: 'StaleExecutionError' });
    assert.equal(h.metadata.gd.summaries[0].content, 'manual edit');
    assert.equal(h.metadata.gd.summaries[0].promptUsed, 'original prompt');
});

test('summary regeneration targets the latest active predecessor after revert', async () => {
    const h = summaryHarness();
    h.metadata.gd = { summaries: [
        { rangeEnd: 1, content: 'first', active: false, basedOn: null, promptUsed: 'first prompt' },
        { rangeEnd: 1, content: 'second', active: true, basedOn: 0, promptUsed: 'second prompt' },
    ] };
    await h.system.revertLastSummary();
    h.response = 'regenerated first';
    const result = await h.system.regenerateLastSummary();
    assert.equal(result, h.metadata.gd.summaries[0]);
    assert.equal(result.content, 'regenerated first');
    assert.equal(h.metadata.gd.summaries[1].content, 'second');
});

test('memory generation rejects a response after the active chat changes', async () => {
    const gate = deferred();
    let metadata = {};
    const firstMetadata = metadata;
    const chatA = [];
    let chat = chatA;
    const system = createMemorySystem({
        settings: { agentConfigs: {}, memoryMaxEntries: 200, lang: 'en' },
        EXT_KEY: 'gd',
        getChatMetadata: () => metadata,
        getChat: () => chat,
        getCharacters: () => [{ avatar: 'alice.png', name: 'Alice' }],
        saveChatConditional: async () => {},
        log: () => {},
        AgentRegistry: { get: () => ({ id: 'memory' }) },
        execute: () => gate.promise,
        buildContextPool: () => ({}),
        getCurrentGroup: () => ({ members: ['alice.png'] }),
        createCaller: () => ({}),
        getContext: () => ({ generateRaw: async () => '', stopGeneration: () => {} }),
    });
    const request = system.generateForCharacter('alice.png');
    await settle();
    metadata = {};
    chat = [];
    const secondMetadata = metadata;
    gate.resolve([{ event: 'old chat', mood: 'ok', round: 1 }]);
    await assert.rejects(request, { name: 'StaleExecutionError' });
    assert.equal(firstMetadata.gd?.charMemories?.['alice.png']?.length || 0, 0);
    assert.equal(secondMetadata.gd?.charMemories?.['alice.png']?.length || 0, 0);
});

test('memory compression preserves edits saved while the LLM is pending', async () => {
    const gate = deferred();
    const metadata = { gd: { charMemories: { 'alice.png': [
        { event: 'one', mood: 'ok', round: 1 },
        { event: 'two', mood: 'ok', round: 2 },
        { event: 'recent', mood: 'ok', round: 3 },
    ] } } };
    const chat = [];
    const system = createMemorySystem({
        settings: { agentConfigs: {}, lang: 'en' },
        EXT_KEY: 'gd',
        getChatMetadata: () => metadata,
        getChat: () => chat,
        getCharacters: () => [{ avatar: 'alice.png', name: 'Alice' }],
        saveChatConditional: async () => {},
        log: () => {},
        AgentRegistry: { get: () => ({ id: 'memory' }) },
        execute: async () => [],
        buildContextPool: () => ({}),
        getCurrentGroup: () => ({ members: ['alice.png'] }),
        createCaller: () => ({ generate: () => gate.promise }),
        getContext: () => ({ generateRaw: async () => '', stopGeneration: () => {} }),
    });
    const request = system.compressOldMemories('alice.png', 1);
    await settle();
    await system.updateEntry('alice.png', 0, { event: 'manual edit' });
    gate.resolve('stale compression');
    await assert.rejects(request, { name: 'StaleExecutionError' });
    assert.equal(system.getMemories('alice.png')[0].event, 'manual edit');
});

test('NPC generation rejects a response after the active chat changes', async () => {
    const gate = deferred();
    let metadata = {};
    const system = createNpcSystem({
        settings: { agentConfigs: {}, npcMaxCount: 10, npcBatchSize: 1, lang: 'en' },
        EXT_KEY: 'gd',
        getChatMetadata: () => metadata,
        saveChatConditional: async () => {},
        getCharacters: () => [],
        log: () => {},
        AgentRegistry: { get: () => ({ id: 'npc' }) },
        execute: () => gate.promise,
        buildContextPool: () => ({}),
        getCurrentGroup: () => ({ members: [] }),
        createCaller: () => ({}),
        getContext: () => ({ generateRaw: async () => '', stopGeneration: () => {} }),
    });
    const request = system.generateNpcs();
    await settle();
    metadata = {};
    const secondMetadata = metadata;
    gate.resolve([{ name: 'Old Chat NPC' }]);
    await assert.rejects(request, { name: 'StaleExecutionError' });
    assert.equal(secondMetadata.gd?.npcs?.length || 0, 0);
});

test('NPC generation preserves edits saved while the LLM is pending', async () => {
    const gate = deferred();
    const metadata = { gd: { npcs: [{ name: 'Existing', description: 'old' }] } };
    const system = createNpcSystem({
        settings: { agentConfigs: {}, npcMaxCount: 10, npcBatchSize: 1, lang: 'en' },
        EXT_KEY: 'gd',
        getChatMetadata: () => metadata,
        saveChatConditional: async () => {},
        getCharacters: () => [],
        log: () => {},
        AgentRegistry: { get: () => ({ id: 'npc' }) },
        execute: () => gate.promise,
        buildContextPool: () => ({}),
        getCurrentGroup: () => ({ members: [] }),
        createCaller: () => ({}),
        getContext: () => ({ generateRaw: async () => '', stopGeneration: () => {} }),
    });
    const request = system.generateNpcs();
    await settle();
    await system.updateNpc(0, { description: 'manual edit' });
    gate.resolve([{ name: 'Stale NPC' }]);
    await assert.rejects(request, { name: 'StaleExecutionError' });
    assert.equal(system.getNpcs()[0].description, 'manual edit');
    assert.equal(system.getNpcs().length, 1);
});

test('NPC generation rejects an in-place chat append while the LLM is pending', async () => {
    const gate = deferred();
    const metadata = {};
    const chat = [{ mes: 'old context' }];
    const system = createNpcSystem({
        settings: { agentConfigs: {}, npcMaxCount: 10, npcBatchSize: 1, lang: 'en' },
        EXT_KEY: 'gd',
        getChatMetadata: () => metadata,
        getChat: () => chat,
        saveChatConditional: async () => {},
        getCharacters: () => [],
        log: () => {},
        AgentRegistry: { get: () => ({ id: 'npc' }) },
        execute: () => gate.promise,
        buildContextPool: () => ({}),
        getCurrentGroup: () => ({ members: [] }),
        createCaller: () => ({}),
        getContext: () => ({ generateRaw: async () => '', stopGeneration: () => {} }),
    });
    const request = system.generateNpcs();
    await settle();
    chat.push({ mes: 'new context' });
    gate.resolve([{ name: 'Stale NPC' }]);
    await assert.rejects(request, { name: 'StaleExecutionError' });
    assert.equal(system.getNpcs().length, 0);
});

test('NPC import reconciles a renamed target when generated siblings share a timestamp', async () => {
    const gate = deferred();
    const metadata = { gd: { npcs: [
        { name: 'Alice', description: 'other', createdAt: 1 },
        { name: 'Bob', description: 'old', createdAt: 1 },
    ] } };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async url => {
        if (url === '/csrf-token') return { json: async () => ({ token: 'csrf' }) };
        await gate.promise;
        return { ok: true, text: async () => 'Bob.png' };
    };
    const system = createNpcSystem({
        settings: { lang: 'en' },
        EXT_KEY: 'gd',
        getChatMetadata: () => metadata,
        saveChatConditional: async () => {},
        getCharacters: () => [],
        log: () => {},
    });
    try {
        const request = system.importNpcAsCharacter(1);
        await settle();
        await system.updateNpc(1, { name: 'Robert', description: 'manual edit' });
        gate.resolve();
        assert.equal(await request, 'Bob.png');
        assert.equal(system.getNpcs()[0].imported, undefined);
        assert.equal(system.getNpcs()[1].name, 'Robert');
        assert.equal(system.getNpcs()[1].description, 'manual edit');
        assert.equal(system.getNpcs()[1].imported, true);
        assert.equal(system.getNpcs()[1].importedAvatar, 'Bob.png');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('NPC import reports partial success when tracking persistence fails', async () => {
    const metadata = { gd: { npcs: [{ name: 'Alice', createdAt: 1 }] } };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async url => url === '/csrf-token'
        ? { json: async () => ({ token: 'csrf' }) }
        : { ok: true, text: async () => 'Alice.png' };
    const system = createNpcSystem({
        settings: { lang: 'en' },
        EXT_KEY: 'gd',
        getChatMetadata: () => metadata,
        saveChatConditional: async () => { throw new Error('disk unavailable'); },
        getCharacters: () => [],
        log: () => {},
    });
    try {
        await assert.rejects(system.importNpcAsCharacter(0), error => (
            error.name === 'NpcImportTrackingError'
            && error.avatarName === 'Alice.png'
            && error.remoteCreated === true
        ));
        assert.equal(system.getNpcs()[0].imported, true);
        assert.equal(system.getNpcs()[0].importedAvatar, 'Alice.png');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('NPC import checks staleness before creating a remote character', async () => {
    const csrfGate = deferred();
    const metadata = { gd: { npcs: [{ name: 'Alice', description: 'old', createdAt: 1 }] } };
    let createCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async url => {
        if (url === '/csrf-token') {
            await csrfGate.promise;
            return { json: async () => ({ token: 'csrf' }) };
        }
        createCalls++;
        return { ok: true, text: async () => 'Alice.png' };
    };
    const system = createNpcSystem({
        settings: { lang: 'en' },
        EXT_KEY: 'gd',
        getChatMetadata: () => metadata,
        saveChatConditional: async () => {},
        getCharacters: () => [],
        log: () => {},
    });
    try {
        const request = system.importNpcAsCharacter(0);
        await settle();
        await system.updateNpc(0, { description: 'manual edit' });
        csrfGate.resolve();
        await assert.rejects(request, { name: 'StaleExecutionError' });
        assert.equal(createCalls, 0);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('profile generation preserves a newer manually saved profile', async () => {
    globalThis.$ = () => ({ length: 0 });
    const gate = deferred();
    const metadata = { gd: { characterProfiles: {
        'alice.png': {
            avatar: 'alice.png', name: 'Alice', hash: 'old', state: 'ready', manualEdited: false,
            profile: { summary: 'old', tags: [], motivation: '', relationships: '' },
        },
    }, archivedProfiles: {}, profileVersion: 1, profileSchemaHash: '' } };
    const chat = [];
    const chars = [{ avatar: 'alice.png', name: 'Alice', description: 'd', personality: 'p', scenario: 's' }];
    const system = createProfileSystem({
        settings: { profileEnabled: true, profileGeneratorPrompt: 'Profile {{charName}}', agentConfigs: {}, profileConcurrency: 1 },
        EXT_KEY: 'gd',
        getChatMetadata: () => metadata,
        getChat: () => chat,
        getCharacters: () => chars,
        saveChatConditional: async () => {},
        getContext: () => ({ generateRaw: async () => '' }),
        setExtensionPrompt: () => {},
        inject_ids: { QUIET_PROMPT: 'quiet' },
        extension_prompt_types: { IN_PROMPT: 0 },
        djb2Hash: value => String(value).length,
        hashChar: () => 'current',
        extractJsonObject: () => null,
        sanitizeJson: value => value,
        isRoundActive: () => false,
        renderPrompt: async prompt => prompt,
        createCaller: () => ({ generate: () => gate.promise }),
        getCurrentGroup: () => ({ members: ['alice.png'] }),
    });
    const request = system.generateProfilesBatch(['alice.png']);
    await settle();
    await system.saveProfile('alice.png', {
        avatar: 'alice.png', name: 'Alice', hash: 'manual', state: 'ready', manualEdited: true,
        profile: { summary: 'manual edit', tags: [], motivation: '', relationships: '' },
    });
    gate.resolve(JSON.stringify({ summary: 'stale', tags: [], motivation: '', relationships: '' }));
    await assert.rejects(request, { name: 'StaleExecutionError' });
    assert.equal(system.getProfiles()['alice.png'].profile.summary, 'manual edit');
});

test('a round-active profile skip does not leave a new profile permanently pending', async () => {
    globalThis.$ = () => ({ length: 0 });
    const metadata = {};
    const chat = [];
    let saves = 0;
    const system = createProfileSystem({
        settings: { profileEnabled: true, agentConfigs: {}, profileConcurrency: 1 },
        EXT_KEY: 'gd',
        getChatMetadata: () => metadata,
        getChat: () => chat,
        getCharacters: () => [{ avatar: 'alice.png', name: 'Alice' }],
        saveChatConditional: async () => { saves++; },
        isRoundActive: () => true,
        djb2Hash: () => 0,
        hashChar: () => 'current',
    });
    await system.generateProfilesBatch(['alice.png']);
    assert.equal(system.getProfiles()['alice.png'], undefined);
    assert.equal(saves, 0);
});

test('Story Blueprint generation cannot overwrite a new chat blueprint', async () => {
    const gate = deferred();
    let metadata = {};
    const chatA = [];
    let chat = chatA;
    const system = createStoryBlueprintSystem({
        settings: { lang: 'en', agentConfigs: {}, storyBlueprintMaxNodes: 8 },
        getChatMetadata: () => metadata,
        getChat: () => chat,
        EXT_KEY: 'gd',
        saveChatConditional: async () => {},
        renderPrompt: async prompt => prompt,
        generateRaw: async () => '',
        createCaller: () => ({ generate: () => gate.promise }),
        parseJson: value => value,
        variableSystem: {},
        getCurrentGroup: () => ({ members: [] }),
    });
    const request = system.generateBlueprint('new');
    await settle();
    metadata = {};
    chat = [];
    system.setBlueprint({ nodes: [{ id: 'manual', title: 'Manual', content: {} }] });
    gate.resolve({ nodes: [{ id: 'stale', title: 'Stale', content: {} }] });
    await assert.rejects(request, { name: 'StaleExecutionError' });
    assert.equal(system.getBlueprint().nodes[0].id, 'manual');
});

test('Story Blueprint generation preserves a same-chat manual replacement', async () => {
    const gate = deferred();
    const metadata = {};
    const chat = [];
    const system = createStoryBlueprintSystem({
        settings: { lang: 'en', agentConfigs: {}, storyBlueprintMaxNodes: 8 },
        getChatMetadata: () => metadata,
        getChat: () => chat,
        EXT_KEY: 'gd',
        saveChatConditional: async () => {},
        renderPrompt: async prompt => prompt,
        generateRaw: async () => '',
        createCaller: () => ({ generate: () => gate.promise }),
        parseJson: value => value,
        variableSystem: {},
        getCurrentGroup: () => ({ members: [] }),
    });
    const request = system.generateBlueprint('new');
    await settle();
    system.setBlueprint({ nodes: [{ id: 'manual', title: 'Manual', content: {} }] });
    gate.resolve({ nodes: [{ id: 'stale', title: 'Stale', content: {} }] });
    await assert.rejects(request, { name: 'StaleExecutionError' });
    assert.equal(system.getBlueprint().nodes[0].id, 'manual');
});

test('Story Blueprint generation rejects an in-place chat append', async () => {
    const gate = deferred();
    const metadata = {};
    const chat = [{ is_user: true, mes: 'old direction' }];
    const system = createStoryBlueprintSystem({
        settings: { lang: 'en', agentConfigs: {}, storyBlueprintMaxNodes: 8 },
        getChatMetadata: () => metadata,
        getChat: () => chat,
        EXT_KEY: 'gd',
        saveChatConditional: async () => {},
        renderPrompt: async prompt => prompt,
        generateRaw: async () => '',
        createCaller: () => ({ generate: () => gate.promise }),
        parseJson: value => value,
        variableSystem: {},
        getCurrentGroup: () => ({ members: [] }),
    });
    const request = system.generateBlueprint('new');
    await settle();
    chat.push({ is_user: true, mes: 'new direction' });
    gate.resolve({ nodes: [{ id: 'stale', title: 'Stale', content: {} }] });
    await assert.rejects(request, { name: 'StaleExecutionError' });
    assert.equal(system.getBlueprint(), null);
});
