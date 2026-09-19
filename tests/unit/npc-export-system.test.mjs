import test from 'node:test';
import assert from 'node:assert/strict';

import { createNpcExportSystem } from '../../systems/npc-export-system.js';

function installDownloadDom() {
    const original = { document: globalThis.document, URL: globalThis.URL };
    const anchor = { click() {} };
    globalThis.document = { createElement: () => anchor, body: { appendChild() {}, removeChild() {} } };
    globalThis.URL = { createObjectURL: () => 'blob:npc', revokeObjectURL() {} };
    return { anchor, restore() { globalThis.document = original.document; globalThis.URL = original.URL; } };
}

function fixture(overrides = {}) {
    const settings = {};
    const metadata = {};
    const calls = { settings: 0, chat: 0 };
    const dependencies = {
        settings,
        EXT_KEY: 'gd',
        saveSettings: () => calls.settings++,
        getCurrentGroup: () => ({ name: 'NPC Group' }),
        getChatMetadata: () => metadata,
        saveChatConditional: async () => calls.chat++,
        defaultNpcPrompt: 'default npc prompt',
        log: () => {},
        ...overrides,
    };
    return { system: createNpcExportSystem(dependencies), settings, metadata, calls };
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

test('NPC export normalizes fields and uses the current prompt', () => {
    const dom = installDownloadDom();
    try {
        const { system } = fixture();
        const data = system.exportNpcs([{ name: 'Guard', description: 'alert' }], 'note');
        assert.equal(data.type, 'npc-export');
        assert.equal(data.npcs[0].personality, '');
        assert.equal(data.template.npcPrompt, 'default npc prompt');
        assert.match(dom.anchor.download, /^npcs-NPC_Group-/);
    } finally { dom.restore(); }
});

test('NPC import validates, filters invalid entries, and classifies names case-insensitively', () => {
    const { system, metadata } = fixture();
    metadata.gd = { npcs: [{ name: 'Guard' }] };
    assert.equal(system.parseImportFile('{').ok, false);
    assert.equal(system.parseImportFile('{}').ok, false);
    const parsed = system.parseImportFile(JSON.stringify({
        version: 1,
        type: 'npc-export',
        template: { npcPrompt: 'different' },
        npcs: [{ name: 'guard' }, { name: 'Mage' }, null, { name: 42 }],
    }));
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.data.npcs.map(npc => npc._action), ['overwrite', 'new']);
    assert.equal(parsed.data._templateConsistent, false);
});

test('NPC import overwrites content while preserving import tracking', async () => {
    const { system, settings, metadata, calls } = fixture();
    metadata.gd = { npcs: [{ name: 'Guard', imported: true, importedAvatar: 'guard.png' }] };
    const data = {
        template: { npcPrompt: 'new prompt' },
        npcs: [{ name: 'guard', description: 'new' }, { name: 'Mage', personality: 'quiet' }],
    };
    const result = await system.applyImport(data, ['GUARD', 'Mage', 'Missing'], { importTemplate: true });
    assert.deepEqual(result, { applied: 2, skipped: 1, templateImported: true });
    assert.equal(metadata.gd.npcs[0].imported, true);
    assert.equal(metadata.gd.npcs[0].importedAvatar, 'guard.png');
    assert.equal(metadata.gd.npcs[1].name, 'Mage');
    assert.equal(settings.npcPrompt, 'new prompt');
    assert.equal(calls.settings, 1);
    assert.equal(calls.chat, 1);
    assert.deepEqual(await system.applyImport(data, [], {}), { applied: 0, skipped: 0, templateImported: false });
});

test('NPC import rolls back only its entries after an asynchronous chat save failure', async () => {
    const save = deferred();
    const { system, metadata } = fixture({ saveChatConditional: () => save.promise });
    metadata.gd = { npcs: [
        { name: 'Guard', description: 'before', personality: 'steady' },
        { name: 'Bob', description: 'before' },
    ] };
    const pending = system.applyImport({ npcs: [
        { name: 'Guard', description: 'imported' },
        { name: 'Mage', description: 'imported' },
    ] }, ['Guard', 'Mage']);
    metadata.gd.npcs = metadata.gd.npcs.map(npc => npc.name === 'Bob'
        ? { ...npc, description: 'concurrent' } : npc);
    save.reject(new Error('chat save failed'));
    await assert.rejects(pending, /chat save failed/);
    assert.deepEqual(metadata.gd.npcs.map(npc => [npc.name, npc.description]), [
        ['Guard', 'before'], ['Bob', 'concurrent'],
    ]);
});

test('NPC rollback preserves a concurrent edit to another field of an imported NPC', async () => {
    const save = deferred();
    const { system, metadata } = fixture({ saveChatConditional: () => save.promise });
    metadata.gd = { npcs: [{ name: 'Guard', description: 'before', personality: 'calm' }] };
    const pending = system.applyImport({ npcs: [{ name: 'Guard', description: 'imported' }] }, ['Guard']);
    metadata.gd.npcs = metadata.gd.npcs.map(npc => ({ ...npc, personality: 'concurrent' }));
    save.reject(new Error('chat save failed'));
    await assert.rejects(pending, /chat save failed/);
    assert.equal(metadata.gd.npcs[0].description, 'before');
    assert.equal(metadata.gd.npcs[0].personality, 'concurrent');
});

test('NPC prompt is untouched when chat save fails', async () => {
    const { system, settings, metadata } = fixture({
        saveChatConditional: async () => { throw new Error('chat save failed'); },
    });
    settings.npcPrompt = 'before';
    await assert.rejects(system.applyImport({
        npcs: [{ name: 'Mage' }], template: { npcPrompt: 'imported' },
    }, ['Mage'], { importTemplate: true }), /chat save failed/);
    assert.deepEqual(metadata.gd.npcs, []);
    assert.equal(settings.npcPrompt, 'before');
});

test('NPC import rolls back a synchronous chat save failure too', async () => {
    const { system, metadata } = fixture({ saveChatConditional: () => { throw new Error('sync save failed'); } });
    await assert.rejects(system.applyImport({ npcs: [{ name: 'Mage' }] }, ['Mage']), /sync save failed/);
    assert.deepEqual(metadata.gd.npcs, []);
});

test('NPC import compensates chat and prompt on observable settings save failure', async () => {
    let chatSaves = 0;
    let settingsSaves = 0;
    const { system, settings, metadata } = fixture({
        saveChatConditional: async () => { chatSaves++; },
        saveSettings: async () => { settingsSaves++; if (settingsSaves === 1) throw new Error('settings save failed'); },
    });
    settings.npcPrompt = 'before';
    metadata.gd = { npcs: [{ name: 'Guard', description: 'before' }] };
    await assert.rejects(system.applyImport({
        npcs: [{ name: 'Guard', description: 'imported' }], template: { npcPrompt: 'imported' },
    }, ['Guard'], { importTemplate: true }), /settings save failed/);
    assert.equal(metadata.gd.npcs[0].description, 'before');
    assert.equal(settings.npcPrompt, 'before');
    assert.equal(chatSaves, 2);
    assert.equal(settingsSaves, 2);
});

test('prompt-only import awaits settings save and does not create NPC chat metadata', async () => {
    const save = deferred();
    const { system, settings, metadata, calls } = fixture({ saveSettings: () => save.promise });
    const pending = system.applyImport({ npcs: [], template: { npcPrompt: 'imported' } }, [], { importTemplate: true });
    assert.equal(settings.npcPrompt, 'imported');
    assert.deepEqual(metadata, {});
    assert.equal(calls.chat, 0);
    save.resolve();
    assert.deepEqual(await pending, { applied: 0, skipped: 0, templateImported: true });
});

test('prompt save failure preserves a concurrent prompt edit and unrelated NPC update', async () => {
    const save = deferred();
    const settings = { npcPrompt: 'before' };
    const metadata = { gd: { npcs: [{ name: 'Bob', description: 'before' }] } };
    let chatSaves = 0;
    const { system } = fixture({
        settings,
        getChatMetadata: () => metadata,
        saveChatConditional: async () => { chatSaves++; },
        saveSettings: () => save.promise,
    });
    const pending = system.applyImport({
        npcs: [{ name: 'Mage' }], template: { npcPrompt: 'imported' },
    }, ['Mage'], { importTemplate: true });
    await Promise.resolve();
    metadata.gd.npcs[0].description = 'concurrent';
    settings.npcPrompt = 'concurrent';
    save.reject(new Error('settings save failed'));
    await assert.rejects(pending, error => error.rollbackIncomplete === true && /settings save failed/.test(error.message));
    assert.equal(settings.npcPrompt, 'concurrent');
    assert.deepEqual(metadata.gd.npcs.map(npc => npc.name), ['Bob']);
    assert.equal(metadata.gd.npcs[0].description, 'concurrent');
    assert.equal(chatSaves, 2);
});

test('NPC import exposes a failed compensation save instead of claiming atomic rollback', async () => {
    let chatSaves = 0;
    const { system, metadata } = fixture({
        saveChatConditional: async () => { if (++chatSaves === 2) throw new Error('rollback save failed'); },
        saveSettings: async () => { throw new Error('settings save failed'); },
    });
    await assert.rejects(system.applyImport({
        npcs: [{ name: 'Mage' }], template: { npcPrompt: 'imported' },
    }, ['Mage'], { importTemplate: true }), error =>
        error.rollbackIncomplete === true && /rollback save failed/.test(error.message));
    assert.deepEqual(metadata.gd.npcs, []);
});

test('NPC rollback preserves an edited newly imported NPC and reports incomplete compensation', async () => {
    const save = deferred();
    const { system, metadata } = fixture({ saveChatConditional: () => save.promise });
    const pending = system.applyImport({ npcs: [{ name: 'Mage', description: 'imported' }] }, ['Mage']);
    metadata.gd.npcs = metadata.gd.npcs.map(npc => ({ ...npc, personality: 'concurrent' }));
    save.reject(new Error('chat save failed'));
    await assert.rejects(pending, error => error.rollbackIncomplete === true && /chat save failed/.test(error.message));
    assert.equal(metadata.gd.npcs[0].personality, 'concurrent');
});

test('NPC import does not apply its prompt after a chat switch during save', async () => {
    const save = deferred();
    let current = {};
    const original = current;
    const settings = {};
    const { system } = fixture({ settings, getChatMetadata: () => current, saveChatConditional: () => save.promise });
    const pending = system.applyImport({
        npcs: [{ name: 'Mage' }], template: { npcPrompt: 'imported' },
    }, ['Mage'], { importTemplate: true });
    current = {};
    save.resolve();
    await assert.rejects(pending, /stale/i);
    assert.equal(original.gd.npcs[0].name, 'Mage');
    assert.equal(settings.npcPrompt, undefined);
});

test('NPC import reports a stale chat after successful save without writing into the new chat', async () => {
    const save = deferred();
    const original = {};
    let current = original;
    const { system } = fixture({
        getChatMetadata: () => current,
        saveChatConditional: () => save.promise,
    });
    const pending = system.applyImport({ npcs: [{ name: 'Mage' }] }, ['Mage']);
    current = {};
    save.resolve();
    await assert.rejects(pending, /stale/i);
    assert.equal(original.gd.npcs[0].name, 'Mage');
    assert.equal(current.gd, undefined);
});

test('NPC preset loading returns parsed data or a stable error', async () => {
    const originalFetch = globalThis.fetch;
    try {
        const valid = { version: 1, type: 'npc-export', template: { npcPrompt: 'default npc prompt' }, npcs: [] };
        globalThis.fetch = async () => ({ ok: true, text: async () => JSON.stringify(valid) });
        const { system } = fixture();
        assert.equal((await system.loadPreset('starter')).ok, true);
        globalThis.fetch = async () => { throw new Error('offline'); };
        assert.match((await system.loadPreset('starter')).error, /offline/);
        assert.ok(Array.isArray(system.getPresetNames()));
    } finally { globalThis.fetch = originalFetch; }
});
