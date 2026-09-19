import test from 'node:test';
import assert from 'node:assert/strict';

import { createProfileExportSystem } from '../../systems/profile-export-system.js';

function installDownloadDom() {
    const original = { document: globalThis.document, URL: globalThis.URL };
    const anchor = { clickCount: 0, click() { this.clickCount++; } };
    globalThis.document = {
        createElement: () => anchor,
        body: { appendChild() {}, removeChild() {} },
    };
    globalThis.URL = { createObjectURL: () => 'blob:test', revokeObjectURL() {} };
    return { anchor, restore() { globalThis.document = original.document; globalThis.URL = original.URL; } };
}

function fixture(overrides = {}) {
    const settings = {};
    const profiles = { 'alice.png': { hash: 'h1', profile: { role: 'lead' }, manualEdited: true } };
    const calls = { settings: 0, chat: 0, refresh: 0 };
    const dependencies = {
        settings,
        getProfiles: () => profiles,
        saveSettings: () => calls.settings++,
        getDefaultProfileGeneratorPrompt: () => 'gen',
        getDefaultProfileSchema: () => 'schema',
        getDefaultProfileRenderTemplate: () => 'render',
        getCurrentGroup: () => ({ name: 'Main Group' }),
        getCharacters: () => [{ avatar: 'alice.png', name: 'Alice' }, { avatar: 'empty.png', name: 'Empty' }],
        saveChatConditional: async () => calls.chat++,
        refreshProfileManagementUI: () => calls.refresh++,
        log: () => {},
        ...overrides,
    };
    return { system: createProfileExportSystem(dependencies), settings, profiles, calls };
}

test('profile export serializes selected non-empty profiles and templates', () => {
    const dom = installDownloadDom();
    try {
        const { system } = fixture();
        const data = system.exportProfiles(['alice.png', 'empty.png'], 'note');
        assert.equal(data.type, 'profile-export');
        assert.equal(data.profiles.length, 1);
        assert.equal(data.profiles[0].name, 'Alice');
        assert.equal(data.template.generatorPrompt, 'gen');
        assert.match(dom.anchor.download, /^profiles-Main_Group-/);
        assert.equal(dom.anchor.clickCount, 1);
    } finally { dom.restore(); }
});

test('profile import validates, classifies, and reports template differences', () => {
    const { system } = fixture();
    assert.match(system.parseImportFile('{').error, /Invalid JSON/);
    assert.equal(system.parseImportFile('{}').ok, false);
    const parsed = system.parseImportFile(JSON.stringify({
        version: 1,
        type: 'profile-export',
        template: { generatorPrompt: 'different', jsonSchema: 'schema', renderTemplate: 'render' },
        profiles: [{ avatar: 'alice.png' }, { avatar: 'bob.png' }],
    }));
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.data.profiles.map(profile => profile._action), ['overwrite', 'new']);
    assert.equal(parsed.data._templateConsistent, false);
    assert.deepEqual(parsed.data._templateDiffs.map(diff => diff.key), ['generatorPrompt']);
});

test('profile import applies safe selections, templates, and preserves manual edit state', async () => {
    const { system, settings, profiles, calls } = fixture();
    const data = {
        template: { generatorPrompt: 'new gen', jsonSchema: 'new schema', renderTemplate: 'new render' },
        profiles: [
            { avatar: 'alice.png', name: 'Alice 2', profile: { role: 'new' } },
            { avatar: 'bob.png', name: 'Bob', hash: 'h2', profile: { role: 'support' } },
            { avatar: '__proto__', name: 'Unsafe', profile: {} },
        ],
    };
    const result = await system.applyImport(data, ['alice.png', 'bob.png', '__proto__'], { importTemplate: true });
    assert.deepEqual(result, { applied: 2, skipped: 1, templateImported: true });
    assert.equal(profiles['alice.png'].manualEdited, true);
    assert.equal(profiles['bob.png'].state, 'ready');
    assert.equal(settings.profileGeneratorPrompt, 'new gen');
    assert.equal(calls.settings, 1);
    assert.equal(calls.chat, 1);
    assert.deepEqual(await system.applyImport(data, [], {}), { applied: 0, skipped: 0, templateImported: false });
});

test('profile preset loading handles success and HTTP failure', async () => {
    const originalFetch = globalThis.fetch;
    try {
        const valid = { version: 1, type: 'profile-export', template: { generatorPrompt: 'gen', jsonSchema: 'schema', renderTemplate: 'render' }, profiles: [] };
        globalThis.fetch = async () => ({ ok: true, text: async () => JSON.stringify(valid) });
        const { system } = fixture();
        assert.equal((await system.loadPreset('default')).ok, true);
        globalThis.fetch = async () => ({ ok: false, status: 404 });
        assert.match((await system.loadPreset('missing')).error, /HTTP 404/);
        assert.ok(Array.isArray(system.getPresetNames()));
    } finally { globalThis.fetch = originalFetch; }
});
