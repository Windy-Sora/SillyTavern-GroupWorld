import test from 'node:test';
import assert from 'node:assert/strict';

import { createProfileSystem } from '../../systems/profile-system.js';

function fixture(overrides = {}) {
    const metadata = {};
    const characters = [
        { avatar: 'alice.png', name: 'Alice', description: 'a', personality: 'p', scenario: 's' },
        { avatar: 'bob.png', name: 'Bob', description: 'b', personality: 'p', scenario: 's' },
    ];
    const calls = { saved: 0, logs: [] };
    const dependencies = {
        settings: { profileEnabled: true, profileJsonSchema: '{"version":1}' },
        EXT_KEY: 'gd',
        getChatMetadata: () => metadata,
        getChat: () => [],
        getCharacters: () => characters,
        saveChatConditional: async () => { calls.saved++; },
        getContext: () => ({ generateRaw: async () => '' }),
        setExtensionPrompt: () => {},
        inject_ids: { QUIET_PROMPT: 'quiet' },
        extension_prompt_types: { IN_PROMPT: 0 },
        djb2Hash: value => `hash:${value}`,
        hashChar: (description, personality, scenario) => `${description}|${personality}|${scenario}`,
        extractJsonObject: () => null,
        sanitizeJson: value => value,
        matchCharacterByName: () => null,
        getCurrentGroup: () => ({ members: characters.map(character => character.avatar), disabled_members: [] }),
        log: (...args) => calls.logs.push(args),
        getLlmPickedSet: () => new Set(),
        getLlmPickedAvatars: () => [],
        getRoundSpeakerCount: () => 0,
        isRoundActive: () => false,
        saveSettings: () => {},
        renderPrompt: async prompt => prompt,
        createCaller: () => ({ generate: async () => '{}' }),
        ...overrides,
    };
    return { system: createProfileSystem(dependencies), metadata, characters, calls };
}

test('profile container initializes storage and automatically records the active schema version', () => {
    const { system, metadata } = fixture();
    const container = system.getProfileContainer();
    assert.equal(container, metadata.gd);
    assert.deepEqual(container.characterProfiles, {});
    assert.deepEqual(container.archivedProfiles, {});
    assert.equal(container.profileVersion, 1);
    assert.equal(container.profileSchemaHash, 'hash:{"version":1}');
});

test('profile migration upgrades legacy data and warns once when the schema changes', () => {
    const originalWarn = console.warn;
    const warnings = [];
    console.warn = message => warnings.push(message);
    try {
        const { system, metadata } = fixture();
        metadata.gd = {
            characterProfiles: {},
            archivedProfiles: {},
            profileVersion: 0,
            profileSchemaHash: 'old-schema',
        };
        system.getProfiles();
        system.getProfiles();
        assert.equal(metadata.gd.profileVersion, 1);
        assert.equal(metadata.gd.profileSchemaHash, 'hash:{"version":1}');
        assert.equal(warnings.length, 1);
    } finally { console.warn = originalWarn; }
});

test('profile differences classify new, removed, existing, and changed characters', () => {
    const { system } = fixture();
    Object.assign(system.getProfiles(), {
        'alice.png': { hash: 'stale' },
        'removed.png': { hash: 'old' },
    });
    assert.deepEqual(system.diffProfiles(['alice.png', 'bob.png']), {
        newChars: ['bob.png'],
        removedChars: ['removed.png'],
        existingChars: ['alice.png'],
        hashMismatches: ['alice.png'],
    });
});

test('disabled profile mode returns an empty difference set without initializing storage', () => {
    const { system, metadata } = fixture({ settings: { profileEnabled: false } });
    assert.deepEqual(system.diffProfiles(['alice.png']), {
        newChars: [], removedChars: [], existingChars: [], hashMismatches: [],
    });
    assert.equal(metadata.gd, undefined);
});

test('profile saves commit atomically and roll back failed persistence', async () => {
    const { system, calls } = fixture();
    const original = { avatar: 'alice.png', state: 'ready', profile: { summary: 'old' } };
    system.getProfiles()['alice.png'] = original;

    const replacement = { avatar: 'alice.png', state: 'ready', profile: { summary: 'new' } };
    await system.saveProfile('alice.png', replacement);
    assert.equal(system.getProfiles()['alice.png'], replacement);
    assert.equal(calls.saved, 1);

    const failed = fixture({ saveChatConditional: async () => { throw new Error('disk failed'); } });
    failed.system.getProfiles()['alice.png'] = original;
    await assert.rejects(failed.system.saveProfile('alice.png', replacement), /disk failed/);
    assert.equal(failed.system.getProfiles()['alice.png'], original);

    await assert.rejects(failed.system.saveProfile('new.png', replacement), /disk failed/);
    assert.equal(failed.system.getProfiles()['new.png'], undefined);
});

test('profile archives commit atomically and restore both stores after failed persistence', async () => {
    const failed = fixture({ saveChatConditional: async () => { throw new Error('disk failed'); } });
    const active = { avatar: 'alice.png', state: 'ready', profile: { summary: 'active' } };
    const archived = { avatar: 'alice.png', state: 'ready', profile: { summary: 'older' } };
    failed.system.getProfiles()['alice.png'] = active;
    failed.system.getArchivedProfiles()['alice.png'] = archived;

    await assert.rejects(failed.system.archiveProfiles(['alice.png']), /disk failed/);

    assert.equal(failed.system.getProfiles()['alice.png'], active);
    assert.equal(failed.system.getArchivedProfiles()['alice.png'], archived);
});

test('failed profile archive preserves concurrent changes to the target and unrelated profiles', async () => {
    let rejectSave;
    const saveStarted = Promise.withResolvers();
    const failed = fixture({
        saveChatConditional: () => {
            saveStarted.resolve();
            return new Promise((_, reject) => { rejectSave = reject; });
        },
    });
    const active = { avatar: 'alice.png', state: 'ready', profile: { summary: 'active' } };
    const concurrentAlice = { avatar: 'alice.png', state: 'ready', profile: { summary: 'concurrent active' } };
    const concurrentArchive = { avatar: 'alice.png', state: 'ready', profile: { summary: 'concurrent archive' } };
    const concurrentBob = { avatar: 'bob.png', state: 'ready', profile: { summary: 'concurrent bob' } };
    failed.system.getProfiles()['alice.png'] = active;

    const archiving = failed.system.archiveProfiles(['alice.png']);
    await saveStarted.promise;
    failed.system.getProfiles()['alice.png'] = concurrentAlice;
    failed.system.getProfiles()['bob.png'] = concurrentBob;
    failed.system.getArchivedProfiles()['alice.png'] = concurrentArchive;
    rejectSave(new Error('disk failed'));

    await assert.rejects(archiving, /disk failed/);
    assert.equal(failed.system.getProfiles()['alice.png'], concurrentAlice);
    assert.equal(failed.system.getProfiles()['bob.png'], concurrentBob);
    assert.equal(failed.system.getArchivedProfiles()['alice.png'], concurrentArchive);
});

test('profile normalization preserves custom fields and repairs core field types', () => {
    const { system } = fixture();
    assert.deepEqual(system.normalizeProfileFields(null), {
        summary: '', tags: [], motivation: '', relationships: '',
    });
    assert.deepEqual(system.normalizeProfileFields({ summary: 'S', tags: 'bad', custom: 42 }), {
        summary: 'S', tags: [], motivation: '', relationships: '', custom: 42,
    });
});

test('profile synchronization archives removed members and reports hash mismatches', async () => {
    const { system, calls } = fixture();
    Object.assign(system.getProfiles(), {
        'alice.png': { avatar: 'alice.png', name: 'Alice', hash: 'stale', state: 'ready', profile: {} },
        'removed.png': { avatar: 'removed.png', name: 'Removed', hash: 'old', state: 'ready', profile: {} },
    });
    await system.syncProfiles(['alice.png']);
    assert.equal(system.getProfiles()['removed.png'], undefined);
    assert.equal(system.getArchivedProfiles()['removed.png'].name, 'Removed');
    assert.equal(calls.saved, 1);
    assert.match(calls.logs[0][0], /Alice/);
});

test('profile synchronization rolls back removed profiles when persistence fails', async () => {
    const failed = fixture({ saveChatConditional: async () => { throw new Error('disk failed'); } });
    const removed = { avatar: 'removed.png', name: 'Removed', hash: 'old', state: 'ready', profile: {} };
    failed.system.getProfiles()['removed.png'] = removed;

    await assert.rejects(failed.system.syncProfiles([]), /disk failed/);

    assert.equal(failed.system.getProfiles()['removed.png'], removed);
    assert.equal(failed.system.getArchivedProfiles()['removed.png'], undefined);
});
