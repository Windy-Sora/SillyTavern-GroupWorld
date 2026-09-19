import test from 'node:test';
import assert from 'node:assert/strict';

import { createProfileLibrarySystem } from '../../systems/profile-library-system.js';

function fixture(overrides = {}) {
    const settings = {};
    const extension_settings = {};
    const calls = { saved: 0, chatSaved: 0, applied: [], refreshed: 0 };
    const characters = [
        { avatar: 'alice.png', name: 'Alice', description: 'a', personality: 'p', scenario: 's' },
        { avatar: 'bob.png', name: 'Bob', description: 'b', personality: 'p', scenario: 's' },
    ];
    const dependencies = {
        settings,
        extension_settings,
        EXT_KEY: 'group-director',
        saveSettings: () => calls.saved++,
        saveChatConditional: async () => calls.chatSaved++,
        getProfiles: () => ({
            'alice.png': { state: 'ready', hash: 'a|p|s', profile: { role: 'lead' } },
            'bob.png': { state: 'ready', hash: 'b|p|s', profile: { role: 'support' } },
        }),
        getCurrentGroup: () => ({ id: 'g1', name: 'Party', members: ['alice.png', 'bob.png'], disabled_members: [] }),
        getCharacters: () => characters,
        getDefaultProfileGeneratorPrompt: () => 'default prompt',
        getDefaultProfileSchema: () => ({ type: 'object' }),
        getDefaultProfileRenderTemplate: () => '{{role}}',
        parseImportFile: text => ({ ok: true, data: JSON.parse(text) }),
        applyImport: async (...args) => { calls.applied.push(args); return { applied: args[1].length }; },
        refreshProfileManagementUI: () => calls.refreshed++,
        hashChar: (description, personality, scenario) => `${description}|${personality}|${scenario}`,
        log: () => {},
        ...overrides,
    };
    return { system: createProfileLibrarySystem(dependencies), settings, extension_settings, calls, characters };
}

test('profile library saves ready profiles and maintains auto-load settings', async () => {
    const { system, settings, extension_settings, calls } = fixture();
    await assert.rejects(system.saveCurrentAsLibrary('  '), /name is required/i);

    const entry = await system.saveCurrentAsLibrary('Main / Cast', 'campaign');
    assert.equal(entry.profileCount, 2);
    assert.equal(entry.exportData.source.groupName, 'Party');
    assert.equal(entry.exportData.template.generatorPrompt, 'default prompt');
    assert.equal(entry.exportData.profiles[0].name, 'Alice');
    assert.equal(extension_settings['group-director'], settings);
    assert.equal(calls.saved, 1);

    assert.equal(system.getAutoLoadSettings().mode, 'best');
    await system.updateAutoLoadSettings({ enabled: true, mode: 'fixed', fixedId: entry.id });
    assert.equal(await system.deleteLibrary(entry.id), true);
    assert.equal(system.getAutoLoadSettings().enabled, false);
    assert.equal(system.getAutoLoadSettings().fixedId, '');
    assert.equal(await system.deleteLibrary('missing'), false);
});

test('profile library matches without reusing profiles and applies translated avatars', async () => {
    const { system, settings, calls } = fixture();
    const entry = await system.saveCurrentAsLibrary('Cast');
    settings.profileLibraries[0].exportData.profiles[0].avatar = 'old-alice.png';

    const preview = system.matchLibraryProfiles(entry, { overwriteExisting: false });
    assert.deepEqual(preview.matches.map(match => match.matchType), ['hash', 'hash']);
    assert.equal(preview.matches.every(match => match.skipped), true);

    const skipped = await system.applyLibrary(entry.id);
    assert.equal(skipped.applied, 0);
    assert.equal(skipped.skipped, 2);

    const result = await system.applyLibrary(entry.id, { overwriteExisting: true, importTemplate: true });
    assert.equal(result.applied, 2);
    assert.deepEqual(calls.applied[0][1], ['alice.png', 'bob.png']);
    assert.deepEqual(calls.applied[0][2], { importTemplate: true });
    assert.equal(calls.applied[0][0].profiles[0].avatar, 'alice.png');
    assert.equal(calls.refreshed, 1);
    assert.equal(calls.chatSaved, 0);
    await assert.rejects(system.applyLibrary('missing'), /not found/i);
});

test('profile library imports, ranks matches, and deduplicates automatic loading', async () => {
    const { system, settings, calls } = fixture({ getProfiles: () => ({}) });
    const data = {
        version: 1,
        type: 'profile-export',
        source: { groupName: 'Imported Group', groupNote: 'notes' },
        libraryMeta: { name: 'Imported', description: 'desc' },
        profiles: [
            { avatar: 'alice.png', name: 'Alice', hash: 'a|p|s', profile: { role: 'lead' } },
            { avatar: 'bob.png', name: 'Bob', hash: 'b|p|s', profile: { role: 'support' } },
        ],
    };
    const entry = await system.importFileToLibrary({ name: 'fallback.json', text: async () => JSON.stringify(data) });
    assert.equal(entry.name, 'Imported');
    assert.equal(entry.profileCount, 2);
    assert.equal(system.findBestLibrary()?.entry.id, entry.id);

    await system.updateAutoLoadSettings({ enabled: true, mode: 'best', overwriteExisting: true });
    const first = await system.autoLoadForCurrentGroup('chat');
    assert.equal(first.applied, 2);
    assert.equal((await system.autoLoadForCurrentGroup('chat')).reason, 'deduped');
    system.resetAutoLoadDedup();
    assert.equal((await system.autoLoadForCurrentGroup('chat')).applied, 2);
    assert.equal(calls.applied.length, 2);

    settings.profileLibraryAutoLoad.enabled = false;
    assert.equal((await system.autoLoadForCurrentGroup()).reason, 'disabled');
});

test('profile library reports invalid imports and empty sources', async () => {
    const empty = fixture({ getProfiles: () => ({}) }).system;
    await assert.rejects(empty.saveCurrentAsLibrary('Empty'), /No ready/i);

    const invalid = fixture({ parseImportFile: () => ({ ok: false, error: 'bad profile data' }) }).system;
    await assert.rejects(
        invalid.importFileToLibrary({ name: 'bad.json', text: async () => '{}' }),
        /bad profile data/,
    );
});

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
    return { promise, resolve, reject };
}

test('profile library rolls back failed saves without removing a later queued entry', async () => {
    const firstSave = deferred();
    let saves = 0;
    const { system } = fixture({
        saveSettings: () => ++saves === 1 ? firstSave.promise : Promise.resolve(),
    });
    const failed = system.saveCurrentAsLibrary('Failed');
    const later = system.saveCurrentAsLibrary('Later');
    firstSave.reject(new Error('settings save failed'));
    await assert.rejects(failed, /settings save failed/);
    assert.equal((await later).name, 'Later');
    assert.deepEqual(system.getLibraries().map(entry => entry.name), ['Later']);
});

test('profile library captures the source chat before a queued save waits', async () => {
    const gate = deferred();
    let saves = 0;
    let group = 'A';
    const { system } = fixture({
        saveSettings: () => ++saves === 1 ? gate.promise : Promise.resolve(),
        getProfiles: () => ({
            'alice.png': { state: 'ready', hash: 'a|p|s', profile: { from: group } },
        }),
        getCurrentGroup: () => ({ name: group, members: ['alice.png'], disabled_members: [] }),
    });
    const blocking = system.saveCurrentAsLibrary('Blocking');
    await Promise.resolve();
    const pending = system.saveCurrentAsLibrary('Save A');
    group = 'B';
    gate.resolve();
    await blocking;
    const entry = await pending;
    assert.equal(entry.sourceGroupName, 'A');
    assert.equal(entry.exportData.profiles[0].profile.from, 'A');
});

test('profile library restores a failed deletion while preserving concurrent neighbors and settings', async () => {
    const gate = deferred();
    let saves = 0;
    const { system, settings } = fixture({ saveSettings: () => ++saves === 4 ? gate.promise : Promise.resolve() });
    const first = await system.saveCurrentAsLibrary('First');
    const middle = await system.saveCurrentAsLibrary('Middle');
    const last = await system.saveCurrentAsLibrary('Last');
    system.getAutoLoadSettings();
    Object.assign(settings.profileLibraryAutoLoad, { enabled: true, mode: 'fixed', fixedId: middle.id });
    const pending = system.deleteLibrary(middle.id);
    await Promise.resolve();
    system.getLibraries().unshift({ id: 'concurrent', name: 'Concurrent' });
    settings.profileLibraryAutoLoad.enabled = true;
    gate.reject(new Error('settings save failed'));
    await assert.rejects(pending, /settings save failed/);
    assert.deepEqual(system.getLibraries().map(entry => entry.id), ['concurrent', first.id, middle.id, last.id]);
    assert.equal(system.getAutoLoadSettings().enabled, true);
    assert.equal(system.getAutoLoadSettings().fixedId, middle.id);
});

test('profile auto-load rollback preserves a newer concurrent field value', async () => {
    const gate = deferred();
    const { system, settings } = fixture({ saveSettings: () => gate.promise });
    const pending = system.updateAutoLoadSettings({ enabled: true, mode: 'fixed' });
    await Promise.resolve();
    settings.profileLibraryAutoLoad.enabled = false;
    settings.profileLibraryAutoLoad.fixedId = 'newer';
    gate.reject(new Error('settings save failed'));
    await assert.rejects(pending, /settings save failed/);
    assert.equal(system.getAutoLoadSettings().enabled, false);
    assert.equal(system.getAutoLoadSettings().mode, 'best');
    assert.equal(system.getAutoLoadSettings().fixedId, 'newer');
});

test('profile library import save failure removes only its own entry', async () => {
    const { system } = fixture({ saveSettings: async () => { throw new Error('settings save failed'); } });
    const data = { type: 'profile-export', profiles: [], source: {}, libraryMeta: { name: 'Failed' } };
    await assert.rejects(
        system.importFileToLibrary({ name: 'failed.json', text: async () => JSON.stringify(data) }),
        /settings save failed/,
    );
    assert.deepEqual(system.getLibraries(), []);
});

test('profile library export cleans temporary resources when download fails', async () => {
    const original = { document: globalThis.document, URL: globalThis.URL };
    const events = [];
    globalThis.document = {
        createElement: () => ({ click() { throw new Error('click failed'); } }),
        body: { appendChild() { events.push('append'); }, removeChild() { events.push('remove'); } },
    };
    globalThis.URL = { createObjectURL: () => 'blob:profiles', revokeObjectURL() { events.push('revoke'); } };
    try {
        const { system } = fixture();
        const entry = await system.saveCurrentAsLibrary('Pack');
        assert.throws(() => system.exportLibrary(entry.id), /click failed/);
        assert.deepEqual(events, ['append', 'remove', 'revoke']);
    } finally {
        globalThis.document = original.document;
        globalThis.URL = original.URL;
    }
});
