import test from 'node:test';
import assert from 'node:assert/strict';

import { createNpcLibrarySystem } from '../../systems/npc-library-system.js';

function fixture(overrides = {}) {
    const settings = {};
    const extension_settings = {};
    const calls = { saved: 0, applied: [] };
    const dependencies = {
        settings,
        extension_settings,
        EXT_KEY: 'gd',
        saveSettings: () => calls.saved++,
        getCurrentGroup: () => ({ name: 'Town' }),
        npcSystem: { getNpcs: () => [{ name: 'Guard', description: 'alert' }, { name: 'Mage', personality: 'quiet' }] },
        parseNpcImportFile: text => {
            const data = JSON.parse(text);
            return { ok: true, data: { ...data, npcs: data.npcs.map((npc, index) => ({ ...npc, _action: index ? 'overwrite' : 'new' })) } };
        },
        applyNpcImport: async (...args) => { calls.applied.push(args); return { applied: args[1].length }; },
        getDefaultNpcPrompt: () => 'npc prompt',
        log: () => {},
        ...overrides,
    };
    return { system: createNpcLibrarySystem(dependencies), settings, extension_settings, calls };
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
    return { promise, resolve, reject };
}

test('NPC library saves, previews, applies, and deletes entries', async () => {
    const { system, extension_settings, settings, calls } = fixture();
    await assert.rejects(system.saveCurrentAsLibrary(''), /name is required/i);
    const entry = await system.saveCurrentAsLibrary('Town NPCs', 'locals');
    assert.equal(entry.npcCount, 2);
    assert.equal(entry.exportData.template.npcPrompt, 'npc prompt');
    assert.equal(entry.exportData.npcs[0].scenario, '');
    assert.equal(extension_settings.gd, settings);
    assert.deepEqual(system.previewLibrary(entry.id), { total: 2, newCount: 1, overwriteCount: 1 });

    const result = await system.applyLibrary(entry.id, { importTemplate: true });
    assert.equal(result.applied, 2);
    assert.deepEqual(calls.applied[0][1], ['Guard', 'Mage']);
    assert.deepEqual(calls.applied[0][2], { importTemplate: true });
    await assert.rejects(system.applyLibrary('missing'), /not found/i);
    assert.equal(await system.deleteLibrary(entry.id), true);
    assert.equal(await system.deleteLibrary(entry.id), false);
});

test('NPC library imports files and surfaces parser failures', async () => {
    const { system } = fixture();
    const data = { type: 'npc-export', source: { groupName: 'Source' }, libraryMeta: { name: 'Pack' }, npcs: [{ name: 'One' }] };
    const entry = await system.importFileToLibrary({ name: 'source.json', text: async () => JSON.stringify(data) });
    assert.equal(entry.name, 'Pack');
    assert.equal(entry.npcCount, 1);

    const failed = fixture({ parseNpcImportFile: () => ({ ok: false, error: 'invalid NPCs' }) }).system;
    assert.deepEqual(failed.previewLibrary('missing'), { total: 0, newCount: 0, overwriteCount: 0 });
    await assert.rejects(failed.importFileToLibrary({ name: 'bad.json', text: async () => '{}' }), /invalid NPCs/);
});

test('NPC library rejects empty current state', async () => {
    const { system } = fixture({ npcSystem: { getNpcs: () => [] } });
    await assert.rejects(system.saveCurrentAsLibrary('Empty'), /No NPCs/i);
});

test('failed NPC library save removes only its own entry after a later save', async () => {
    const gate = deferred();
    let saves = 0;
    const { system } = fixture({ saveSettings: () => ++saves === 1 ? gate.promise : Promise.resolve() });
    const pending = system.saveCurrentAsLibrary('Failed');
    const later = await system.saveCurrentAsLibrary('Later');
    gate.reject(new Error('disk unavailable'));
    await assert.rejects(pending, /disk unavailable/);
    assert.deepEqual(system.getLibraries(), [later]);
});

test('failed NPC library delete restores relative to surviving entries', async () => {
    const gate = deferred();
    let saves = 0;
    const { system } = fixture({ saveSettings: () => ++saves === 4 ? gate.promise : Promise.resolve() });
    const first = await system.saveCurrentAsLibrary('First');
    const middle = await system.saveCurrentAsLibrary('Middle');
    const last = await system.saveCurrentAsLibrary('Last');
    const pending = system.deleteLibrary(middle.id);
    assert.equal(await system.deleteLibrary(first.id), true);
    gate.reject(new Error('disk unavailable'));
    await assert.rejects(pending, /disk unavailable/);
    assert.deepEqual(system.getLibraries(), [middle, last]);
});

test('failed NPC library file import removes only the imported entry', async () => {
    const gate = deferred();
    let saves = 0;
    const { system } = fixture({ saveSettings: () => ++saves === 1 ? gate.promise : Promise.resolve() });
    const data = { version: 1, type: 'npc-export', template: { npcPrompt: '' }, npcs: [{ name: 'Guard' }] };
    const pending = system.importFileToLibrary({ name: 'pack.json', text: async () => JSON.stringify(data) });
    await Promise.resolve();
    const later = await system.saveCurrentAsLibrary('Later');
    gate.reject(new Error('disk unavailable'));
    await assert.rejects(pending, /disk unavailable/);
    assert.deepEqual(system.getLibraries(), [later]);
});

test('NPC library lookup and preview tolerate malformed legacy entries', async () => {
    const { system, settings } = fixture();
    settings.npcLibraries = [null, 42, { id: 'ok', name: 'Good', exportData: { type: 'npc-export', npcs: [] } }];
    assert.equal(system.getLibrary('ok')?.name, 'Good');
    assert.deepEqual(system.previewLibrary('missing'), { total: 0, newCount: 0, overwriteCount: 0 });
    assert.equal(await system.deleteLibrary('missing'), false);
});

test('NPC library export cleans temporary resources when download fails', async () => {
    const original = { document: globalThis.document, URL: globalThis.URL };
    const events = [];
    globalThis.document = {
        createElement: () => ({ click() { throw new Error('click failed'); } }),
        body: { appendChild() { events.push('append'); }, removeChild() { events.push('remove'); } },
    };
    globalThis.URL = { createObjectURL: () => 'blob:npcs', revokeObjectURL() { events.push('revoke'); } };
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

test('NPC library export rejects invalid data before creating a download', () => {
    const { system, settings } = fixture();
    settings.npcLibraries = [{ id: 'bad', name: 'Bad', exportData: null }];
    assert.throws(() => system.exportLibrary('bad'), /Invalid NPC library data/);
});

test('NPC library export revokes its URL when creating the temporary node fails', async () => {
    const original = { document: globalThis.document, URL: globalThis.URL };
    const events = [];
    globalThis.document = { createElement() { throw new Error('DOM unavailable'); } };
    globalThis.URL = { createObjectURL: () => 'blob:npcs', revokeObjectURL() { events.push('revoke'); } };
    try {
        const { system } = fixture();
        const entry = await system.saveCurrentAsLibrary('Pack');
        assert.throws(() => system.exportLibrary(entry.id), /DOM unavailable/);
        assert.deepEqual(events, ['revoke']);
    } finally {
        globalThis.document = original.document;
        globalThis.URL = original.URL;
    }
});
