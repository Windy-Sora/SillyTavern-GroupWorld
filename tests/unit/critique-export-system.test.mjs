import assert from 'node:assert/strict';
import test from 'node:test';
import { createCritiqueExportSystem } from '../../systems/critique-export-system.js';

function harness(saveChatConditional = async () => {}) {
    let metadata = {};
    const system = createCritiqueExportSystem({
        settings: { lang: 'en' },
        EXT_KEY: 'gd',
        getChatMetadata: () => metadata,
        saveChatConditional,
        log: () => {},
        getCurrentGroup: () => null,
        critiqueSystem: { getLatestActive: () => null },
    });
    return { system, get metadata() { return metadata; }, set metadata(value) { metadata = value; } };
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

const validExport = () => ({
    version: 1,
    type: 'critique-export',
    source: { groupName: 'Test' },
    template: {},
    critique: {
        content: '{"directorCritique":{},"characterCritiques":{}}',
        data: { directorCritique: { pacing: 'good' }, characterCritiques: {} },
    },
});

test('critique import rejects malformed nested data before mutation', async () => {
    const { system, metadata } = harness();
    const malformed = validExport();
    malformed.critique.data.characterCritiques.Alice = null;
    assert.equal(system.parseImportFile(JSON.stringify(malformed)).ok, false);
    await assert.rejects(system.addImportedCritique(malformed), /Alice must be an object/);
    assert.deepEqual(metadata, {});
});

test('critique import CRUD is transactional when persistence fails', async () => {
    let fail = false;
    const { system } = harness(async () => { if (fail) throw new Error('disk unavailable'); });
    const entry = await system.addImportedCritique(validExport(), 'Stable');
    fail = true;
    await assert.rejects(system.updateImportedCritique(entry.id, { name: 'Changed' }), /disk unavailable/);
    assert.equal(entry.name, 'Stable');
    await assert.rejects(system.deleteImportedCritique(entry.id), /disk unavailable/);
    assert.equal(system.getImportedCritiques()[0], entry);
});

test('critique provider ignores malformed legacy list entries', () => {
    const { system, metadata } = harness();
    metadata.gd = { importedCritiques: [null, { id: 'ok', name: 'Valid', content: 'x', enabled: true, data: { directorCritique: {}, characterCritiques: {} } }] };
    const rendered = system.renderEnabledCritiques();
    assert.equal(rendered.data.count, 1);
    assert.deepEqual(rendered.data.names, ['Valid']);
});

test('critique provider normalizes a malformed non-array legacy store', () => {
    const { system, metadata } = harness();
    metadata.gd = { importedCritiques: {} };
    assert.deepEqual(system.renderEnabledCritiques(), { content: '', data: { all: [], count: 0 } });
    assert.deepEqual(metadata.gd.importedCritiques, []);
});

test('failed import removes its own record without discarding a later import', async () => {
    const gate = deferred();
    let saves = 0;
    const { system } = harness(() => ++saves === 1 ? gate.promise : Promise.resolve());
    const pending = system.addImportedCritique(validExport(), 'failed');
    const later = await system.addImportedCritique(validExport(), 'later');
    gate.reject(new Error('disk unavailable'));
    await assert.rejects(pending, /disk unavailable/);
    assert.deepEqual(system.getImportedCritiques(), [later]);
});

test('failed update preserves a newer edit to the same field', async () => {
    const gate = deferred();
    let saves = 0;
    const { system } = harness(() => ++saves === 2 ? gate.promise : Promise.resolve());
    const entry = await system.addImportedCritique(validExport(), 'before');
    const pending = system.updateImportedCritique(entry.id, { name: 'failed' });
    await system.updateImportedCritique(entry.id, { name: 'newer' });
    gate.reject(new Error('disk unavailable'));
    await assert.rejects(pending, /disk unavailable/);
    assert.equal(entry.name, 'newer');
});

test('failed update preserves a newer same-value write', async () => {
    const gate = deferred();
    let saves = 0;
    const { system } = harness(() => ++saves === 2 ? gate.promise : Promise.resolve());
    const entry = await system.addImportedCritique(validExport(), 'before');
    const pending = system.updateImportedCritique(entry.id, { name: 'shared' });
    await system.updateImportedCritique(entry.id, { name: 'shared' });
    gate.reject(new Error('disk unavailable'));
    await assert.rejects(pending, /disk unavailable/);
    assert.equal(entry.name, 'shared');
});

test('failed update restores only its own field despite a newer edit to another field', async () => {
    const gate = deferred();
    let saves = 0;
    const { system } = harness(() => ++saves === 2 ? gate.promise : Promise.resolve());
    const entry = await system.addImportedCritique(validExport(), 'before');
    const pending = system.updateImportedCritique(entry.id, { name: 'failed' });
    await system.updateImportedCritique(entry.id, { enabled: false });
    gate.reject(new Error('disk unavailable'));
    await assert.rejects(pending, /disk unavailable/);
    assert.equal(entry.name, 'before');
    assert.equal(entry.enabled, false);
});

test('failed delete restores the record relative to surviving neighbors', async () => {
    const gate = deferred();
    let saves = 0;
    const { system } = harness(() => ++saves === 4 ? gate.promise : Promise.resolve());
    const first = await system.addImportedCritique(validExport(), 'first');
    const middle = await system.addImportedCritique(validExport(), 'middle');
    const last = await system.addImportedCritique(validExport(), 'last');
    const pending = system.deleteImportedCritique(middle.id);
    await system.deleteImportedCritique(first.id);
    gate.reject(new Error('disk unavailable'));
    await assert.rejects(pending, /disk unavailable/);
    assert.deepEqual(system.getImportedCritiques(), [middle, last]);
});

test('a chat switch during import save cannot report success in the new chat', async () => {
    const gate = deferred();
    const h = harness(() => gate.promise);
    const oldMetadata = h.metadata;
    const pending = h.system.addImportedCritique(validExport(), 'old chat');
    h.metadata = {};
    gate.resolve();
    await assert.rejects(pending, { name: 'StaleExecutionError' });
    assert.equal(oldMetadata.gd.importedCritiques.length, 1);
    assert.deepEqual(h.system.getImportedCritiques(), []);
});

test('update and delete also reject a save-time chat switch', async () => {
    for (const operation of ['update', 'delete']) {
        const gate = deferred();
        let saves = 0;
        const h = harness(() => ++saves === 2 ? gate.promise : Promise.resolve());
        const entry = await h.system.addImportedCritique(validExport(), 'old chat');
        const pending = operation === 'update'
            ? h.system.updateImportedCritique(entry.id, { name: 'changed' })
            : h.system.deleteImportedCritique(entry.id);
        h.metadata = {};
        gate.resolve();
        await assert.rejects(pending, { name: 'StaleExecutionError' });
        assert.deepEqual(h.system.getImportedCritiques(), []);
    }
});

test('a rejected save after chat switch compensates only the old chat', async () => {
    const gate = deferred();
    const h = harness(() => gate.promise);
    const oldMetadata = h.metadata;
    const pending = h.system.addImportedCritique(validExport(), 'old chat');
    h.metadata = {};
    gate.reject(new Error('disk unavailable'));
    await assert.rejects(pending, /disk unavailable/);
    assert.deepEqual(oldMetadata.gd.importedCritiques, []);
    assert.deepEqual(h.system.getImportedCritiques(), []);
});

test('export always releases its temporary node and URL when click throws', () => {
    const original = { document: globalThis.document, URL: globalThis.URL };
    const events = [];
    const anchor = { click() { throw new Error('click failed'); } };
    globalThis.document = {
        createElement: () => anchor,
        body: { appendChild() { events.push('append'); }, removeChild() { events.push('remove'); } },
    };
    globalThis.URL = { createObjectURL: () => 'blob:critique', revokeObjectURL() { events.push('revoke'); } };
    try {
        const system = createCritiqueExportSystem({
            settings: { lang: 'en' }, EXT_KEY: 'gd', getChatMetadata: () => ({}),
            saveChatConditional: async () => {}, log: () => {}, getCurrentGroup: () => null,
            critiqueSystem: { getLatestActive: () => ({ content: 'ready', data: { directorCritique: {}, characterCritiques: {} } }) },
        });
        assert.throws(() => system.exportActiveCritique('Test'), /click failed/);
        assert.deepEqual(events, ['append', 'remove', 'revoke']);
    } finally {
        globalThis.document = original.document;
        globalThis.URL = original.URL;
    }
});

test('export revokes its URL when creating the temporary node fails', () => {
    const original = { document: globalThis.document, URL: globalThis.URL };
    const events = [];
    globalThis.document = { createElement() { throw new Error('DOM unavailable'); } };
    globalThis.URL = { createObjectURL: () => 'blob:critique', revokeObjectURL() { events.push('revoke'); } };
    try {
        const system = createCritiqueExportSystem({
            settings: { lang: 'en' }, EXT_KEY: 'gd', getChatMetadata: () => ({}),
            saveChatConditional: async () => {}, log: () => {}, getCurrentGroup: () => null,
            critiqueSystem: { getLatestActive: () => ({ content: 'ready' }) },
        });
        assert.throws(() => system.exportActiveCritique(), /DOM unavailable/);
        assert.deepEqual(events, ['revoke']);
    } finally {
        globalThis.document = original.document;
        globalThis.URL = original.URL;
    }
});

test('export downloads the active critique and cleans up on success', () => {
    const original = { document: globalThis.document, URL: globalThis.URL };
    const events = [];
    const anchor = { click() { events.push('click'); } };
    globalThis.document = {
        createElement: () => anchor,
        body: { appendChild() { events.push('append'); }, removeChild() { events.push('remove'); } },
    };
    globalThis.URL = { createObjectURL: () => 'blob:critique', revokeObjectURL() { events.push('revoke'); } };
    try {
        const system = createCritiqueExportSystem({
            settings: { lang: 'en', critiquePrompt: 'prompt' }, EXT_KEY: 'gd', getChatMetadata: () => ({}),
            saveChatConditional: async () => {}, log: () => {}, getCurrentGroup: () => ({ name: 'Group' }),
            critiqueSystem: { getLatestActive: () => ({ content: 'ready', data: { directorCritique: {}, characterCritiques: {} } }) },
        });
        const exported = system.exportActiveCritique('Session 1');
        assert.equal(exported.critique.content, 'ready');
        assert.equal(exported.template.critiquePrompt, 'prompt');
        assert.match(anchor.download, /^critique-Session_1-/);
        assert.deepEqual(events, ['append', 'click', 'remove', 'revoke']);
    } finally {
        globalThis.document = original.document;
        globalThis.URL = original.URL;
    }
});
