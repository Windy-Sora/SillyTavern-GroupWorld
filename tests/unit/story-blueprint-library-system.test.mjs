import test from 'node:test';
import assert from 'node:assert/strict';

import { createStoryBlueprintLibrarySystem } from '../../systems/story-blueprint-library-system.js';

function fixture(overrides = {}) {
    const settings = {};
    const extension_settings = {};
    const calls = { saved: 0, chatSaved: 0, imports: [] };
    const blueprint = { title: 'Quest', nodes: [{ title: 'Act 1', children: [{ title: 'Scene 1' }] }] };
    const storyBlueprintSystem = {
        buildExportFile: includeProgress => ({
            version: 1,
            type: 'group-director-story-blueprint',
            storyBlueprint: { blueprint, doneSignals: includeProgress ? ['done'] : [] },
        }),
        getSteps: () => [{}, {}],
        applyImportTextAndSave: async (text, options) => { calls.imports.push([JSON.parse(text), options]); calls.chatSaved++; return { ok: true, applied: true }; },
        validateBlueprintInput: data => ({ ok: true, blueprint: data.blueprint || data.storyBlueprint?.blueprint }),
    };
    const dependencies = {
        settings,
        extension_settings,
        EXT_KEY: 'gd',
        saveSettings: () => calls.saved++,
        saveChatConditional: async () => calls.chatSaved++,
        getCurrentGroup: () => ({ name: 'Campaign' }),
        storyBlueprintSystem,
        log: () => {},
        ...overrides,
    };
    return { system: createStoryBlueprintLibrarySystem(dependencies), settings, extension_settings, calls };
}

test('Story Blueprint library saves nested blueprints and applies progress options', async () => {
    const { system, settings, extension_settings, calls } = fixture();
    await assert.rejects(system.saveCurrentAsLibrary(' '), /name is required/i);
    const entry = await system.saveCurrentAsLibrary('Quest Pack', 'main arc', { includeProgress: false });
    assert.equal(entry.nodeCount, 2);
    assert.equal(entry.stepCount, 2);
    assert.equal(entry.includeProgress, false);
    assert.equal(extension_settings.gd, settings);

    const result = await system.applyLibrary(entry.id, { includeProgress: false });
    assert.equal(result.applied, true);
    assert.deepEqual(calls.imports[0][1], { includeProgress: false });
    assert.equal(calls.chatSaved, 1);
    await assert.rejects(system.applyLibrary('missing'), /not found/i);
    assert.equal(await system.deleteLibrary(entry.id), true);
    assert.equal(await system.deleteLibrary(entry.id), false);
});

test('Story Blueprint library imports wrapped and raw blueprints', async () => {
    const { system } = fixture();
    const wrapped = {
        type: 'group-director-story-blueprint',
        source: { groupName: 'Old Campaign' },
        libraryMeta: { name: 'Wrapped', description: 'archive' },
        storyBlueprint: { blueprint: { title: 'Wrapped Quest', nodes: [] }, doneSignals: [] },
    };
    const first = await system.importFileToLibrary({ name: 'wrapped.json', text: async () => JSON.stringify(wrapped) });
    assert.equal(first.name, 'Wrapped');
    assert.equal(first.includeProgress, true);

    const raw = { blueprint: { title: 'Raw Quest', nodes: [{ children: [] }] } };
    const second = await system.importFileToLibrary({ name: 'raw.json', text: async () => JSON.stringify(raw) });
    assert.equal(second.name, 'Raw Quest');
    assert.equal(second.exportData.type, 'group-director-story-blueprint');
    assert.equal(second.nodeCount, 1);
});

test('Story Blueprint library surfaces invalid data and import failures', async () => {
    const noBlueprint = fixture({
        storyBlueprintSystem: {
            buildExportFile: () => ({ type: 'group-director-story-blueprint', storyBlueprint: {} }),
            getSteps: () => [],
            validateBlueprintInput: () => ({ ok: false, error: 'invalid blueprint' }),
            applyImportTextAndSave: async () => ({ ok: false, error: 'apply failed' }),
        },
    }).system;
    await assert.rejects(noBlueprint.saveCurrentAsLibrary('Empty'), /No Story Blueprint/i);
    await assert.rejects(noBlueprint.importFileToLibrary({ name: 'broken.json', text: async () => '{' }), /Invalid JSON/i);
    await assert.rejects(noBlueprint.importFileToLibrary({ name: 'bad.json', text: async () => '{}' }), /invalid blueprint/);
});

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
    return { promise, resolve, reject };
}

test('Story Blueprint library serializes saves and removes only a failed addition', async () => {
    const gate = deferred();
    let saves = 0;
    const { system } = fixture({ saveSettings: () => ++saves === 1 ? gate.promise : Promise.resolve() });
    const failed = system.saveCurrentAsLibrary('Failed');
    const later = system.saveCurrentAsLibrary('Later');
    gate.reject(new Error('settings save failed'));
    await assert.rejects(failed, /settings save failed/);
    assert.equal((await later).name, 'Later');
    assert.deepEqual(system.getLibraries().map(entry => entry.name), ['Later']);
});

test('Story Blueprint library captures the source chat before a queued save waits', async () => {
    const gate = deferred();
    let saves = 0;
    let group = 'A';
    const { system } = fixture({
        saveSettings: () => ++saves === 1 ? gate.promise : Promise.resolve(),
        getCurrentGroup: () => ({ name: group }),
        storyBlueprintSystem: {
            buildExportFile: () => ({ storyBlueprint: { blueprint: { title: group, nodes: [] } } }),
            getSteps: () => [],
        },
    });
    const blocking = system.saveCurrentAsLibrary('Blocking');
    await Promise.resolve();
    const pending = system.saveCurrentAsLibrary('Save A');
    group = 'B';
    gate.resolve();
    await blocking;
    const entry = await pending;
    assert.equal(entry.sourceGroupName, 'A');
    assert.equal(entry.exportData.storyBlueprint.blueprint.title, 'A');
});

test('Story Blueprint library restores a failed deletion relative to concurrent neighbors', async () => {
    const gate = deferred();
    let saves = 0;
    const { system } = fixture({ saveSettings: () => ++saves === 4 ? gate.promise : Promise.resolve() });
    const first = await system.saveCurrentAsLibrary('First');
    const middle = await system.saveCurrentAsLibrary('Middle');
    const last = await system.saveCurrentAsLibrary('Last');
    const pending = system.deleteLibrary(middle.id);
    await Promise.resolve();
    system.getLibraries().push({ id: 'concurrent', name: 'Concurrent' });
    gate.reject(new Error('settings save failed'));
    await assert.rejects(pending, /settings save failed/);
    assert.deepEqual(system.getLibraries().map(entry => entry.id), [first.id, middle.id, last.id, 'concurrent']);
});

test('Story Blueprint library import save failure rolls back its entry', async () => {
    const { system } = fixture({ saveSettings: async () => { throw new Error('settings save failed'); } });
    const raw = { blueprint: { title: 'Raw Quest', nodes: [{ children: [] }] } };
    await assert.rejects(
        system.importFileToLibrary({ name: 'raw.json', text: async () => JSON.stringify(raw) }),
        /settings save failed/,
    );
    assert.deepEqual(system.getLibraries(), []);
});

test('Story Blueprint library export cleans temporary resources when download fails', async () => {
    const original = { document: globalThis.document, URL: globalThis.URL };
    const events = [];
    globalThis.document = {
        createElement: () => ({ click() { throw new Error('click failed'); } }),
        body: { appendChild() { events.push('append'); }, removeChild() { events.push('remove'); } },
    };
    globalThis.URL = { createObjectURL: () => 'blob:blueprint', revokeObjectURL() { events.push('revoke'); } };
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
