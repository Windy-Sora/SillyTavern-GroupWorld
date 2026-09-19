import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryExportSystem } from '../../systems/memory-export-system.js';

function createSubject() {
    return createMemoryExportSystem({
        settings: {},
        EXT_KEY: 'gd',
        getChatMetadata: () => ({}),
        getCharacters: () => [{ avatar: 'alice.png', name: 'Alice' }],
        getCurrentGroup: () => ({ members: ['alice.png'], disabled_members: [] }),
        saveChatConditional: async () => {},
        saveSettings: () => {},
        log: () => {},
    });
}

function payload(memory) {
    return JSON.stringify({
        version: 1,
        type: 'memory-export',
        template: {},
        memories: { 'alice.png': memory },
    });
}

function createFixture(overrides = {}) {
    const metadata = {};
    const settings = { memoryMaxEntries: 3 };
    const characters = [
        { avatar: 'alice.png', name: 'Alice' },
        { avatar: 'bob-new.png', name: 'Bob' },
        { avatar: 'cara.png', name: 'Cara Stone' },
        { avatar: 'disabled.png', name: 'Disabled' },
    ];
    const calls = { chatSaved: 0, settingsSaved: 0 };
    const dependencies = {
        settings,
        EXT_KEY: 'gd',
        getChatMetadata: () => metadata,
        getCharacters: () => characters,
        getCurrentGroup: () => ({
            name: 'Party',
            members: characters.map(character => character.avatar),
            disabled_members: ['disabled.png'],
        }),
        saveChatConditional: async () => { calls.chatSaved++; },
        saveSettings: () => { calls.settingsSaved++; },
        defaultMemoryPrompt: 'prompt',
        defaultMemorySchema: 'schema',
        defaultMemoryRender: 'render',
        defaultMemoryCompressPrompt: 'compress',
        log: () => {},
        ...overrides,
    };
    return { system: createMemoryExportSystem(dependencies), metadata, settings, characters, calls };
}

function installDownloadDom() {
    const original = { document: globalThis.document, URL: globalThis.URL };
    const anchor = { clicked: 0, click() { this.clicked++; } };
    globalThis.document = { createElement: () => anchor, body: { appendChild() {}, removeChild() {} } };
    globalThis.URL = { createObjectURL: () => 'blob:memory', revokeObjectURL() {} };
    return { anchor, restore() { globalThis.document = original.document; globalThis.URL = original.URL; } };
}

test('memory import rejects malformed nested entries without throwing', () => {
    const subject = createSubject();
    const cases = [
        { value: null, error: 'Invalid memory entry for "alice.png"' },
        { value: [], error: 'Invalid memory entry for "alice.png"' },
        { value: { name: null, entries: [] }, error: 'Missing or invalid name for "alice.png"' },
        { value: { name: 'Alice', entries: null }, error: 'Missing or invalid entries for "alice.png"' },
        { value: { name: 'Alice', entries: [null] }, error: 'Invalid memory entry at index 0 for "alice.png"' },
        { value: { name: 'Alice', entries: [{ event: 'ok' }, []] }, error: 'Invalid memory entry at index 1 for "alice.png"' },
        { value: { name: 'Alice', entries: ['bad'] }, error: 'Invalid memory entry at index 0 for "alice.png"' },
    ];

    for (const { value, error } of cases) {
        let result;
        assert.doesNotThrow(() => { result = subject.parseImportFile(payload(value)); });
        assert.deepEqual(result, { ok: false, error });
    }
});

test('memory import accepts object entries and reports compressed counts', () => {
    const subject = createSubject();
    const result = subject.parseImportFile(payload({
        name: 'Alice',
        entries: [
            { event: 'Met Bob', compressed: false },
            { event: 'Visited town', compressed: true },
        ],
    }));

    assert.equal(result.ok, true);
    assert.deepEqual(result.data._matches['alice.png'], {
        importedName: 'Alice',
        importedAvatar: 'alice.png',
        entryCount: 2,
        compressedCount: 1,
        match: { avatar: 'alice.png', name: 'Alice', matchType: 'exact' },
    });
});

test('memory export lists enabled characters with stored entries and serializes selected memories', () => {
    const dom = installDownloadDom();
    try {
        const { system, metadata } = createFixture();
        metadata.gd = { charMemories: {
            'alice.png': [{ event: 'Met Bob', custom: 1 }],
            'bob-new.png': [],
            'disabled.png': [{ event: 'Hidden' }],
        } };
        assert.deepEqual(system.getExportableCharacters(), [{ avatar: 'alice.png', name: 'Alice', count: 1 }]);
        assert.equal(system.exportMemories(['bob-new.png'], 'empty'), null);

        const data = system.exportMemories(['alice.png', 'missing.png'], 'Session');
        assert.equal(data.type, 'memory-export');
        assert.equal(data.source.groupName, 'Party');
        assert.equal(data.template.memoryPrompt, 'prompt');
        assert.deepEqual(data.memories['alice.png'].entries, [{ event: 'Met Bob', custom: 1 }]);
        assert.match(dom.anchor.download, /^memories-1chars-Party-/);
        assert.equal(dom.anchor.clicked, 1);
    } finally { dom.restore(); }
});

test('memory import matches current characters by exact avatar, name, fuzzy name, or not at all', () => {
    const { system } = createFixture();
    const parsed = system.parseImportFile(JSON.stringify({
        version: 1,
        type: 'memory-export',
        template: { memoryPrompt: 'changed', memoryJsonSchema: 'schema', memoryRenderTemplate: 'render', memoryCompressPrompt: 'compress' },
        memories: {
            'alice.png': { name: 'Other', entries: [] },
            'old-bob.png': { name: 'bob', entries: [] },
            'old-cara.png': { name: 'Cara', entries: [] },
            'nobody.png': { name: 'Nobody', entries: [] },
        },
    }));
    assert.equal(parsed.ok, true);
    assert.deepEqual(Object.values(parsed.data._matches).map(item => item.match?.matchType || null), ['exact', 'name', 'fuzzy', null]);
    assert.equal(parsed.data._templateConsistent, false);
    assert.deepEqual(parsed.data._templateDiffs.map(diff => diff.key), ['memoryPrompt']);
    assert.deepEqual(system.buildDefaultDecisions(parsed.data._matches), {
        'alice.png': { enabled: true, targetAvatar: 'alice.png', mode: 'append', skipCompressed: false },
        'old-bob.png': { enabled: true, targetAvatar: 'bob-new.png', mode: 'append', skipCompressed: false },
        'old-cara.png': { enabled: true, targetAvatar: 'cara.png', mode: 'append', skipCompressed: false },
        'nobody.png': { enabled: false, targetAvatar: 'nobody.png', mode: 'append', skipCompressed: false },
    });
});

test('memory replace filters compressed entries, normalizes rounds, trims, and imports templates', async () => {
    const { system, metadata, settings, calls } = createFixture();
    metadata.gd = { charMemories: { 'alice.png': [{ event: 'Old' }] } };
    const data = {
        template: { memoryPrompt: 'new prompt', memoryJsonSchema: 'new schema', memoryRenderTemplate: 'new render', memoryCompressPrompt: 'new compress' },
        memories: {
            imported: { name: 'Alice', entries: [
                { event: 'A', timestamp: 10 },
                { event: 'B', compressed: true },
                { event: 'C' },
                { event: 'D' },
            ] },
        },
    };
    const result = await system.applyMemoryImport(data, {
        imported: { enabled: true, targetAvatar: 'alice.png', mode: 'replace', skipCompressed: true },
        disabled: { enabled: false, targetAvatar: 'bob-new.png', mode: 'append', skipCompressed: false },
    }, { importTemplate: true });
    assert.deepEqual(result, { applied: 3, skipped: 1, templateImported: true });
    assert.deepEqual(metadata.gd.charMemories['alice.png'].map(entry => entry.event), ['A', 'C', 'D']);
    assert.equal(metadata.gd.charMemories['alice.png'].every(entry => entry.round === -1), true);
    assert.equal(metadata.gd.charMemories['alice.png'][0].timestamp, 10);
    assert.equal(typeof metadata.gd.charMemories['alice.png'][1].timestamp, 'number');
    assert.equal(settings.memoryPrompt, 'new prompt');
    assert.equal(calls.chatSaved, 1);
    assert.equal(calls.settingsSaved, 1);
});

test('memory append deduplicates existing and repeated imported events case-insensitively', async () => {
    const { system, metadata } = createFixture();
    metadata.gd = { charMemories: { 'alice.png': [{ event: 'Met Bob', round: 2 }] } };
    const result = await system.applyMemoryImport({
        template: {},
        memories: { imported: { entries: [
            { event: ' met bob ' },
            { event: 'Visited Town' },
            { event: 'visited town' },
        ] } },
    }, { imported: { enabled: true, targetAvatar: 'alice.png', mode: 'append' } });
    assert.equal(result.applied, 1);
    assert.deepEqual(metadata.gd.charMemories['alice.png'].map(entry => entry.event), ['Met Bob', 'Visited Town']);
});

test('memory import rolls live memory state back when chat persistence fails', async () => {
    const metadata = { gd: { charMemories: { 'alice.png': [{ event: 'Original', round: 1 }] } } };
    const { system } = createFixture({
        getChatMetadata: () => metadata,
        saveChatConditional: async () => { throw new Error('save failed'); },
    });
    await assert.rejects(system.applyMemoryImport({
        template: {}, memories: { imported: { entries: [{ event: 'Replacement' }] } },
    }, { imported: { enabled: true, targetAvatar: 'alice.png', mode: 'replace' } }), /save failed/);
    assert.deepEqual(metadata.gd.charMemories['alice.png'], [{ event: 'Original', round: 1 }]);
});

test('memory import rollback preserves concurrent edits to unrelated characters', async () => {
    const metadata = { gd: { charMemories: {
        'alice.png': [{ event: 'Original Alice', round: 1 }],
        'bob-new.png': [{ event: 'Original Bob', round: 1 }],
    } } };
    let rejectSave;
    const { system } = createFixture({
        getChatMetadata: () => metadata,
        saveChatConditional: () => new Promise((_, reject) => { rejectSave = reject; }),
    });

    const importing = system.applyMemoryImport({
        template: {}, memories: { imported: { entries: [{ event: 'Replacement Alice' }] } },
    }, { imported: { enabled: true, targetAvatar: 'alice.png', mode: 'replace' } });
    metadata.gd.charMemories['bob-new.png'] = [{ event: 'Concurrent Bob edit', round: 2 }];
    rejectSave(new Error('save failed'));

    await assert.rejects(importing, /save failed/);
    assert.deepEqual(metadata.gd.charMemories['alice.png'], [{ event: 'Original Alice', round: 1 }]);
    assert.deepEqual(metadata.gd.charMemories['bob-new.png'], [{ event: 'Concurrent Bob edit', round: 2 }]);
});

test('memory import rollback removes imported entries while preserving same-character additions', async () => {
    const metadata = { gd: { charMemories: {
        'alice.png': [{ event: 'Original Alice', round: 1 }],
    } } };
    let rejectSave;
    const { system } = createFixture({
        getChatMetadata: () => metadata,
        saveChatConditional: () => new Promise((_, reject) => { rejectSave = reject; }),
    });

    const importing = system.applyMemoryImport({
        template: {}, memories: { imported: { entries: [{ event: 'Replacement Alice' }] } },
    }, { imported: { enabled: true, targetAvatar: 'alice.png', mode: 'replace' } });
    metadata.gd.charMemories['alice.png'] = [
        ...metadata.gd.charMemories['alice.png'],
        { event: 'Concurrent Alice addition', round: 2 },
    ];
    rejectSave(new Error('save failed'));

    await assert.rejects(importing, /save failed/);
    assert.deepEqual(metadata.gd.charMemories['alice.png'], [
        { event: 'Original Alice', round: 1 },
        { event: 'Concurrent Alice addition', round: 2 },
    ]);
});

test('memory import rollback replays same-character edits over the original entries', async () => {
    const metadata = { gd: { charMemories: {
        'alice.png': [
            { event: 'Original Alice', round: 1 },
            { event: 'Second memory', round: 2 },
        ],
    } } };
    let rejectSave;
    const { system } = createFixture({
        getChatMetadata: () => metadata,
        saveChatConditional: () => new Promise((_, reject) => { rejectSave = reject; }),
    });

    const importing = system.applyMemoryImport({
        template: {}, memories: { imported: { entries: [{ event: 'Imported memory' }] } },
    }, { imported: { enabled: true, targetAvatar: 'alice.png', mode: 'append' } });
    const concurrentlyEdited = structuredClone(metadata.gd.charMemories['alice.png']);
    concurrentlyEdited[0].event = 'Concurrent Alice edit';
    concurrentlyEdited.push({ event: 'Concurrent Alice addition', round: 3 });
    metadata.gd.charMemories['alice.png'] = concurrentlyEdited;
    rejectSave(new Error('save failed'));

    await assert.rejects(importing, /save failed/);
    assert.deepEqual(metadata.gd.charMemories['alice.png'], [
        { event: 'Concurrent Alice edit', round: 1 },
        { event: 'Second memory', round: 2 },
        { event: 'Concurrent Alice addition', round: 3 },
    ]);
});

test('memory import rejects malformed envelopes before matching', () => {
    const { system } = createFixture();
    for (const text of ['{', '{}', '{"type":"memory-export","version":0,"template":{},"memories":{}}']) {
        assert.equal(system.parseImportFile(text).ok, false);
    }
});
