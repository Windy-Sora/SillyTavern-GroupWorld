import test from 'node:test';
import assert from 'node:assert/strict';

import { createProfileSystem } from '../../systems/profile-system.js';

function fixture(overrides = {}) {
    const metadata = {};
    const chat = [];
    const characters = [
        { avatar: 'alice.png', name: 'Alice', description: 'Desc A', personality: 'Bold', scenario: 'Castle' },
        { avatar: 'bob.png', name: 'Bob', description: 'Desc B', personality: 'Calm', scenario: 'Forest' },
        { avatar: 'cara.png', name: 'Cara', description: 'Desc C', personality: 'Quick', scenario: 'Town' },
    ];
    const calls = { raw: [], prompts: [], quiet: [], saved: 0 };
    const settings = {
        profileEnabled: true,
        profileGeneratorPrompt: '{{charName}}|{{charDescription}}|{{charPersonality}}|{{charScenario}}|{{provider}}',
        profileJsonSchema: JSON.stringify({ type: 'object' }),
        profileConcurrency: 0,
        agentConfigs: { profile: { provider: 'native' } },
    };
    const dependencies = {
        settings,
        EXT_KEY: 'gd',
        getChatMetadata: () => metadata,
        getChat: () => chat,
        getCharacters: () => characters,
        saveChatConditional: async () => { calls.saved++; },
        getContext: () => ({
            generateRaw: async options => {
                calls.raw.push(options);
                return JSON.stringify({ summary: 'Generated', tags: ['tag'], motivation: 'Goal', relationships: 'Team' });
            },
        }),
        setExtensionPrompt: (...args) => calls.quiet.push(args),
        inject_ids: { QUIET_PROMPT: 'quiet' },
        extension_prompt_types: { IN_PROMPT: 7 },
        djb2Hash: value => String(value).length,
        hashChar: (description, personality, scenario) => `${description}|${personality}|${scenario}`,
        extractJsonObject: () => null,
        sanitizeJson: value => value,
        matchCharacterByName: () => null,
        getCurrentGroup: () => ({ members: characters.map(character => character.avatar), disabled_members: [] }),
        log: () => {},
        getLlmPickedSet: () => new Set(),
        getLlmPickedAvatars: () => [],
        getRoundSpeakerCount: () => 0,
        isRoundActive: () => false,
        saveSettings: () => {},
        renderPrompt: async prompt => {
            const rendered = prompt.replace('{{provider}}', 'resolved');
            calls.prompts.push(rendered);
            return rendered;
        },
        createCaller: (_config, generateRaw) => ({ generate: prompt => generateRaw({ prompt }) }),
        ...overrides,
    };
    return { system: createProfileSystem(dependencies), settings, metadata, chat, characters, calls };
}

test('single profile generation renders character fields and forwards a strict JSON schema', async () => {
    const { system, calls } = fixture();
    const result = await system.generateSingleProfile('alice.png');
    assert.deepEqual(result, {
        summary: 'Generated', tags: ['tag'], motivation: 'Goal', relationships: 'Team',
    });
    assert.equal(calls.prompts[0], 'Alice|Desc A|Bold|Castle|resolved');
    assert.deepEqual(calls.raw[0].jsonSchema, {
        name: 'character_profile', value: { type: 'object' }, strict: true,
    });
    assert.deepEqual(calls.quiet.at(-1), ['quiet', '', 7, 0, true]);
});

test('single profile generation supports extracted sanitized JSON and rejects unusable output', async () => {
    let sanitized = 0;
    const recovered = fixture({
        getContext: () => ({ generateRaw: async () => 'prose {broken}' }),
        extractJsonObject: () => '{"summary":"Recovered","tags":[]}',
        sanitizeJson: value => { sanitized++; return value; },
    });
    assert.equal((await recovered.system.generateSingleProfile('alice.png')).summary, 'Recovered');
    assert.equal(sanitized, 1);

    const invalid = fixture({
        getContext: () => ({ generateRaw: async () => 'not-json' }),
        extractJsonObject: () => null,
    });
    await assert.rejects(invalid.system.generateSingleProfile('alice.png'), /parse profile JSON/i);
    assert.equal(invalid.calls.quiet.length, 1);
});

test('single profile generation honors disabled, active-round, and missing-character guards', async () => {
    assert.equal(await fixture({ settings: { profileEnabled: false } }).system.generateSingleProfile('alice.png'), null);
    assert.equal(await fixture({ isRoundActive: () => true }).system.generateSingleProfile('alice.png'), null);
    await assert.rejects(fixture().system.generateSingleProfile('missing.png'), /Character not found/);
});

test('profile batches enforce the configured concurrency limit and persist ready results', async () => {
    const originalDollar = globalThis.$;
    globalThis.$ = () => ({ length: 0 });
    let active = 0;
    let maxActive = 0;
    try {
        const { system, settings, calls } = fixture({
            createCaller: () => ({
                generate: async () => {
                    active++;
                    maxActive = Math.max(maxActive, active);
                    await new Promise(resolve => setTimeout(resolve, 5));
                    active--;
                    return JSON.stringify({ summary: 'Batch', tags: [], motivation: '', relationships: '' });
                },
            }),
        });
        settings.profileConcurrency = 2;
        await system.generateProfilesBatch(['alice.png', 'bob.png', 'cara.png']);
        assert.equal(maxActive, 2);
        assert.equal(calls.saved, 3);
        assert.deepEqual(Object.values(system.getProfiles()).map(profile => profile.state), ['ready', 'ready', 'ready']);
        assert.equal(system.getProfiles()['alice.png'].hash, 'Desc A|Bold|Castle');
    } finally { globalThis.$ = originalDollar; }
});

test('profile batch failures preserve ready data and record failures for new characters', async () => {
    const originalDollar = globalThis.$;
    const originalError = console.error;
    const originalWarn = console.warn;
    globalThis.$ = () => ({ length: 0 });
    console.error = () => {};
    console.warn = () => {};
    try {
        const { system, calls } = fixture({
            createCaller: () => ({ generate: async () => { throw new Error('model offline'); } }),
        });
        const ready = {
            avatar: 'alice.png', name: 'Alice', hash: 'old', state: 'ready', manualEdited: true,
            profile: { summary: 'Keep me', tags: [], motivation: '', relationships: '' },
        };
        system.getProfiles()['alice.png'] = ready;
        await system.generateProfilesBatch(['alice.png', 'bob.png', 'missing.png']);
        assert.equal(system.getProfiles()['alice.png'], ready);
        assert.equal(system.getProfiles()['bob.png'].state, 'failed');
        assert.equal(system.getProfiles()['missing.png'], undefined);
        assert.equal(calls.saved, 1);
    } finally {
        globalThis.$ = originalDollar;
        console.error = originalError;
        console.warn = originalWarn;
    }
});

test('empty and disabled batches do not initialize profile state', async () => {
    const disabled = fixture({ settings: { profileEnabled: false } });
    await disabled.system.generateProfilesBatch(['alice.png']);
    assert.equal(disabled.metadata.gd, undefined);
    const empty = fixture();
    await empty.system.generateProfilesBatch([]);
    assert.equal(empty.metadata.gd, undefined);
});
