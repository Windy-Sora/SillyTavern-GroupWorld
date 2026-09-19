import test from 'node:test';
import assert from 'node:assert/strict';

import { createProfileSystem } from '../../systems/profile-system.js';

function fixture(overrides = {}) {
    const metadata = {};
    const chat = [];
    const characters = [
        { avatar: 'alice.png', name: 'Alice', description: 'a', personality: 'p', scenario: 's' },
        { avatar: 'bob.png', name: 'Bob', description: 'b', personality: 'p', scenario: 's' },
        { avatar: 'cara.png', name: 'Cara', description: 'c', personality: 'p', scenario: 's' },
        { avatar: 'dan.png', name: 'Dan', description: 'd', personality: 'p', scenario: 's' },
    ];
    const settings = {
        profileEnabled: true,
        profileJsonSchema: '{}',
        profileRenderTemplate: '{{name}}={{summary}} [{{tags}}] {{motivation}} {{relationships}}',
        profileTokenBudget: 1000,
        lang: 'en',
    };
    const dependencies = {
        settings,
        EXT_KEY: 'gd',
        getChatMetadata: () => metadata,
        getChat: () => chat,
        getCharacters: () => characters,
        saveChatConditional: async () => {},
        getContext: () => ({ generateRaw: async () => '' }),
        setExtensionPrompt: () => {},
        inject_ids: { QUIET_PROMPT: 'quiet' },
        extension_prompt_types: { IN_PROMPT: 0 },
        djb2Hash: value => String(value).length,
        hashChar: (description, personality, scenario) => `${description}|${personality}|${scenario}`,
        extractJsonObject: () => null,
        sanitizeJson: value => value,
        matchCharacterByName: () => null,
        getCurrentGroup: () => ({ members: characters.map(character => character.avatar), disabled_members: [] }),
        log: () => {},
        getLlmPickedSet: () => new Set(['bob.png']),
        getLlmPickedAvatars: () => ['alice.png'],
        getRoundSpeakerCount: () => 0,
        isRoundActive: () => false,
        saveSettings: () => {},
        renderPrompt: async prompt => prompt,
        createCaller: () => ({ generate: async () => '{}' }),
        ...overrides,
    };
    return { system: createProfileSystem(dependencies), settings, metadata, chat, characters };
}

function ready(avatar, name, summary, updatedAt = 0) {
    return {
        avatar, name, state: 'ready', updatedAt,
        profile: { summary, tags: ['tag'], motivation: 'goal', relationships: 'team' },
    };
}

test('rendered profiles prioritize current, selected, recent, and remaining characters', () => {
    const originalLog = console.log;
    console.log = () => {};
    try {
        const { system, chat } = fixture();
        Object.assign(system.getProfiles(), {
            'dan.png': ready('dan.png', 'Dan', 'D', 100),
            'cara.png': ready('cara.png', 'Cara', 'C', 1),
            'bob.png': ready('bob.png', 'Bob', 'B', 1),
            'alice.png': ready('alice.png', 'Alice', 'A', 1),
        });
        chat.push({ name: 'Cara', avatar: 'cara.png', mes: 'recent' });
        const text = system.buildCharacterProfilesText();
        assert.deepEqual(text.split('\n').map(line => line.split('=')[0]), ['Alice', 'Bob', 'Cara', 'Dan']);
    } finally { console.log = originalLog; }
});

test('profile rendering degrades later entries to summaries when the token budget is exhausted', () => {
    const originalLog = console.log;
    console.log = () => {};
    try {
        const { system, settings } = fixture({
            getLlmPickedSet: () => new Set(),
            getLlmPickedAvatars: () => [],
        });
        settings.profileTokenBudget = 1;
        Object.assign(system.getProfiles(), {
            'alice.png': ready('alice.png', 'Alice', 'A'.repeat(20), 2),
            'bob.png': ready('bob.png', 'Bob', 'B'.repeat(20), 1),
        });
        const text = system.buildCharacterProfilesText();
        assert.match(text, /^Alice=/);
        assert.match(text, /\nBob: BBB/);
        assert.doesNotMatch(text.split('\n').at(-1), /\[tag\]/);
    } finally { console.log = originalLog; }
});

test('profile rendering returns empty output for disabled, pending, and failed stores', () => {
    const original = { log: console.log, warn: console.warn };
    console.log = () => {};
    console.warn = () => {};
    try {
        assert.equal(fixture({ settings: { profileEnabled: false } }).system.buildCharacterProfilesText(), '');
        const pending = fixture().system;
        pending.getProfiles()['alice.png'] = { state: 'pending' };
        assert.equal(pending.buildCharacterProfilesText(), '');
        const failed = fixture().system;
        failed.getProfiles()['alice.png'] = { state: 'failed' };
        assert.equal(failed.buildCharacterProfilesText(), '');
    } finally {
        console.log = original.log;
        console.warn = original.warn;
    }
});

test('profile placeholder validation reports unknown generator and render tokens', () => {
    const originalDollar = globalThis.$;
    const warning = {
        value: '', visible: false,
        text(value) { this.value = value; return this; },
        show() { this.visible = true; return this; },
        hide() { this.visible = false; return this; },
    };
    const values = {
        '#gd-profile-generator-prompt': 'Generate {{charName}} and {{mystery}}',
        '#gd-profile-render-template': '{{name}} {{unknown}} {{unknown}}',
    };
    globalThis.$ = selector => selector === '#gd-profile-template-warning'
        ? warning
        : { val: () => values[selector] || '' };
    try {
        const { system } = fixture();
        system.validateAndWarnProfilePlaceholders('generator');
        assert.equal(warning.visible, true);
        assert.match(warning.value, /\{\{mystery\}\}/);
        system.validateAndWarnProfilePlaceholders('render');
        assert.match(warning.value, /\{\{unknown\}\}/);
        assert.equal(warning.value.match(/\{\{unknown\}\}/g).length, 1);

        values['#gd-profile-render-template'] = '{{name}} {{summary}}';
        system.validateAndWarnProfilePlaceholders('render');
        assert.equal(warning.visible, false);
    } finally { globalThis.$ = originalDollar; }
});

test('profile sync is a no-op when disabled', async () => {
    const { system, metadata } = fixture({ settings: { profileEnabled: false } });
    await system.syncProfiles(['alice.png']);
    assert.equal(metadata.gd, undefined);
});
