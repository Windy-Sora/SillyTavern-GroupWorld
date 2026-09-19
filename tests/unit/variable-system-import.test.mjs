import test from 'node:test';
import assert from 'node:assert/strict';

import { createVariableSystem } from '../../systems/variable-system.js';
import { createConfigProfileSubject } from './helpers/config-profile-subject.mjs';

test('config profile import rejects a chat switch before settings commit without undoing a successful variable save', async () => {
    const values = phase => ({ defs: [], values: { global: { phase }, character: {} }, log: [] });
    const first = { gd: { variables: values('first-original') } };
    const second = { gd: { variables: values('imported') } };
    let metadata = first;
    let finishSave;
    const pending = new Promise(resolve => { finishSave = resolve; });
    const variableSystem = createVariableSystem({
        getChatMetadata: () => metadata, EXT_KEY: 'gd', saveChatConditional: () => pending,
    });
    const { subject, settings, calls } = createConfigProfileSubject({
        summaryPrompt: 'original',
        configProfiles: [{ id: 'p', name: 'p', drawers: { contextLedger: true },
            settings: { summaryPrompt: 'incoming' }, variables: values('imported') }],
    }, undefined, { variableSystem, saveError: new Error('settings save failed') });
    const operation = subject.applyProfile('p');
    metadata = second;
    finishSave();
    await assert.rejects(operation, { name: 'StaleExecutionError' });
    assert.equal(calls.saves, 0);
    assert.equal(settings.summaryPrompt, 'original');
    assert.equal(first.gd.variables.values.global.phase, 'imported');
    assert.equal(second.gd.variables.values.global.phase, 'imported');
});

test('variable import keeps memory consistent with a successful save after a chat switch', async () => {
    const values = phase => ({ defs: [], values: { global: { phase }, character: {} }, log: [] });
    const first = { gd: { variables: values('original') } };
    const second = { gd: { variables: values('second') } };
    let metadata = first;
    let persisted;
    let finishSave;
    const system = createVariableSystem({
        getChatMetadata: () => metadata, EXT_KEY: 'gd',
        saveChatConditional: () => new Promise(resolve => {
            finishSave = () => {
                persisted = structuredClone(first.gd.variables);
                metadata = second;
                resolve();
            };
        }),
    });
    const operation = system.applyImportData({ variables: values('imported') }, { mode: 'replace' });
    finishSave();
    await assert.rejects(operation, { name: 'StaleExecutionError' });
    assert.deepEqual(first.gd.variables, persisted);
    assert.equal(first.gd.variables.values.global.phase, 'imported');
    assert.equal(second.gd.variables.values.global.phase, 'second');
});

test('variable compensation keeps memory consistent with a successful save after a chat switch', async () => {
    const values = phase => ({ defs: [], values: { global: { phase }, character: {} }, log: [] });
    const first = { gd: { variables: values('original') } };
    const second = { gd: { variables: values('second') } };
    let metadata = first;
    let persisted;
    let saves = 0;
    const system = createVariableSystem({
        getChatMetadata: () => metadata, EXT_KEY: 'gd',
        saveChatConditional: async () => {
            persisted = structuredClone(first.gd.variables);
            if (++saves === 2) metadata = second;
        },
    });
    const { transaction } = await system.applyImportData(
        { variables: values('imported') }, { mode: 'replace', returnTransaction: true },
    );
    await assert.rejects(system.rollbackImportTransaction(transaction), { name: 'StaleExecutionError' });
    assert.deepEqual(first.gd.variables, persisted);
    assert.equal(first.gd.variables.values.global.phase, 'original');
    assert.equal(second.gd.variables.values.global.phase, 'second');
});

test('variable compensation refuses another chat or a replaced store', async () => {
    const values = phase => ({ defs: [], values: { global: { phase }, character: {} }, log: [] });
    const first = { gd: { variables: values('first-original') } };
    const second = { gd: { variables: values('imported') } };
    let metadata = first;
    let saves = 0;
    const system = createVariableSystem({
        getChatMetadata: () => metadata, EXT_KEY: 'gd', saveChatConditional: () => { saves++; },
    });
    const { transaction } = await system.applyImportData({ variables: values('imported') }, { mode: 'replace', returnTransaction: true });
    metadata = second;
    await assert.rejects(system.rollbackImportTransaction(transaction), { name: 'StaleExecutionError' });
    assert.equal(second.gd.variables.values.global.phase, 'imported');
    metadata = first;
    first.gd.variables = values('replacement');
    await assert.rejects(system.rollbackImportTransaction(transaction), { name: 'StaleExecutionError' });
    assert.equal(first.gd.variables.values.global.phase, 'replacement');
    assert.equal(saves, 1);
});

function fixture(overrides = {}) {
    const metadata = {};
    const characters = [
        { avatar: 'alice.png', name: 'Alice' },
        { avatar: 'bob.png', name: 'Bob' },
    ];
    const system = createVariableSystem({
        chat_metadata: metadata,
        getChatMetadata: () => metadata,
        EXT_KEY: 'gd',
        saveChatConditional: () => {},
        getCharacters: () => characters,
        getCurrentGroup: () => ({ members: ['alice.png', 'bob.png'], disabled_members: ['bob.png'] }),
        getChat: () => [{ mes: 'Current' }],
        getLang: () => 'en',
        log: () => {},
        ...overrides,
    });
    return { system, metadata, characters };
}

function seed(system) {
    system.upsertDefinition({ id: 'phase', label: 'Phase', type: 'string', value: 'start', dashboardOrder: 5, rule: 'Track phase' });
    system.upsertDefinition({ id: 'items', label: 'Items', type: 'array', value: ['key'], dashboardOrder: 1 });
    system.upsertDefinition({ id: 'trust', label: 'Trust', scope: 'character', type: 'number', value: 50, dashboardOrder: 10, rule: 'Track trust' });
    system.upsertDefinition({ id: 'manual', type: 'string', value: '', injectMode: 'manual' });
    system.upsertDefinition({ id: 'locked', type: 'string', value: '', locked: true });
    system.setValue('phase', 'middle');
    system.setValue('trust', 75, { target: 'Alice' });
}

function installDownloadDom() {
    const original = { document: globalThis.document, URL: globalThis.URL };
    const anchor = { clicked: 0, click() { this.clicked++; } };
    globalThis.document = { createElement: () => anchor, body: { appendChild() {}, removeChild() {} } };
    globalThis.URL = { createObjectURL: () => 'blob:variables', revokeObjectURL() {} };
    return { anchor, restore() { globalThis.document = original.document; globalThis.URL = original.URL; } };
}

test('variable snapshots include active-character values and resolve current context', () => {
    const { system } = fixture();
    seed(system);
    const snapshot = system.getSnapshot({ character: 'Alice' });
    assert.equal(snapshot.global.phase.value, 'middle');
    assert.deepEqual(snapshot.character.trust.values, { 'alice.png': 75 });
    assert.deepEqual(snapshot.character.trust.names, { 'alice.png': 'Alice' });
    assert.equal(snapshot.currentCharacter, 'alice.png');
    assert.ok(snapshot.log.length >= 2);
});

test('variable renderers format global, character, object, and maintenance views', () => {
    const { system } = fixture();
    seed(system);
    system.upsertDefinition({ id: 'state', label: 'State', type: 'object', value: { open: true } });
    assert.match(system.renderGlobalVars(), /Phase \(phase\): middle/);
    assert.match(system.renderGlobalVars(), /State \(state\): \{"open":true\}/);
    assert.equal(system.renderCharVars({ avatar: 'alice.png' }), '[Alice]\n- Trust (trust): 75');
    assert.doesNotMatch(system.renderCharVars(), /Bob/);
    const maintenance = system.renderMaintenance();
    assert.match(maintenance, /Valid character names: "Alice"/);
    assert.match(maintenance, /character\.\*\.trust/);
    assert.doesNotMatch(maintenance, /global\.manual/);
    assert.doesNotMatch(maintenance, /global\.locked/);
});

test('variable merge import combines definitions, values, character buckets, and optional logs', async () => {
    const { system } = fixture();
    system.upsertDefinition({ id: 'phase', type: 'string', value: 'old' });
    system.setValue('phase', 'current');
    const incoming = {
        type: 'group-director-variables',
        variables: {
            defs: [{ id: 'phase', label: 'Imported Phase', type: 'string' }, { id: 'trust', scope: 'character', type: 'number' }],
            values: { global: { phase: 'imported' }, character: { trust: { 'alice.png': 80 } } },
            log: [{ id: 'phase', newValue: 'imported', source: 'import' }],
        },
    };
    assert.deepEqual(await system.applyImportData(incoming, { mode: 'merge', includeLog: true }), { ok: true, count: 2 });
    assert.equal(system.getDefinition('phase').label, 'Imported Phase');
    assert.equal(system.getValue('phase'), 'imported');
    assert.equal(system.getValue('trust', 'Alice'), 80);
    assert.equal(system.getLog().at(-1).source, 'import');
});

test('variable replace import replaces state and defaults missing logs to the existing history', async () => {
    const { system } = fixture();
    system.upsertDefinition({ id: 'old', type: 'string', value: 'old' });
    system.setValue('old', 'logged');
    const previousLog = system.getLog();
    const result = await system.applyImportData({
        defs: [{ id: 'new', type: 'boolean', value: false }],
        values: { global: { new: true }, character: {} },
    }, { mode: 'replace' });
    assert.deepEqual(result, { ok: true, count: 1 });
    assert.equal(system.getDefinition('old'), null);
    assert.equal(system.getValue('new'), true);
    assert.deepEqual(system.getLog(), previousLog);
});

test('variable import validates envelopes and rolls back persistence failures', async () => {
    const { system } = fixture();
    for (const invalid of [null, [], { type: 'wrong' }, { defs: [], values: null }]) {
        assert.equal((await system.applyImportData(invalid)).ok, false);
    }

    const metadata = {};
    const failed = fixture({
        getChatMetadata: () => metadata,
        chat_metadata: metadata,
        saveChatConditional: async () => { throw new Error('save failed'); },
    }).system;
    await assert.rejects(failed.applyImportData({
        defs: [{ id: 'new', type: 'string' }],
        values: { global: { new: 'value' }, character: {} },
    }, { mode: 'replace' }), /save failed/);
    assert.deepEqual(metadata.gd.variables, { defs: [], values: { global: {}, character: {} }, log: [] });
});

test('variable import rollback removes imported paths while preserving concurrent updates', async () => {
    let deferNextSave = false;
    let rejectImport;
    const { system } = fixture({
        saveChatConditional: () => {
            if (!deferNextSave) return Promise.resolve();
            deferNextSave = false;
            return new Promise((_, reject) => { rejectImport = reject; });
        },
    });
    system.upsertDefinition({ id: 'phase', label: 'Original Phase', type: 'string', value: 'start' });
    system.upsertDefinition({ id: 'other', label: 'Other', type: 'string', value: 'old' });
    system.setValue('phase', 'before import');
    const previousLog = system.getLog();

    deferNextSave = true;
    const importing = system.applyImportData({
        defs: [
            { id: 'phase', label: 'Imported Phase', type: 'string', value: 'imported' },
            { id: 'other', label: 'Other', type: 'string', value: 'old' },
        ],
        values: { global: { phase: 'imported', other: 'old' }, character: {} },
        log: [{ id: 'phase', newValue: 'imported', source: 'import' }],
    }, { mode: 'replace', includeLog: true });
    system.setValue('other', 'concurrent');
    const concurrentLog = system.getLog().at(-1);
    rejectImport(new Error('save failed'));

    await assert.rejects(importing, /save failed/);
    assert.equal(system.getDefinition('phase').label, 'Original Phase');
    assert.equal(system.getValue('phase'), 'before import');
    assert.equal(system.getValue('other'), 'concurrent');
    assert.deepEqual(system.getLog(), [...previousLog, concurrentLog]);
    assert.equal(system.getLog().some(entry => entry.source === 'import'), false);
});

test('variable import rollback removes imported array entries while preserving a concurrent append', async () => {
    let deferNextSave = false;
    let rejectImport;
    const { system } = fixture({
        saveChatConditional: () => {
            if (!deferNextSave) return Promise.resolve();
            deferNextSave = false;
            return new Promise((_, reject) => { rejectImport = reject; });
        },
    });
    system.upsertDefinition({ id: 'items', type: 'array', value: ['before'], updateMode: 'append' });

    deferNextSave = true;
    const importing = system.applyImportData({
        defs: [{ id: 'items', type: 'array', value: ['imported'], updateMode: 'append' }],
        values: { global: { items: ['imported'] }, character: {} },
    }, { mode: 'replace' });
    system.setValue('items', 'concurrent');
    rejectImport(new Error('save failed'));

    await assert.rejects(importing, /save failed/);
    assert.deepEqual(system.getValue('items'), ['before', 'concurrent']);
});

test('explicit import compensation preserves array updates made after a successful import', async () => {
    const { system } = fixture();
    system.upsertDefinition({ id: 'items', type: 'array', value: ['before'] });
    system.setValue('items', ['before']);

    const result = await system.applyImportData({
        defs: [{ id: 'items', type: 'array', value: ['imported'] }],
        values: { global: { items: ['imported'] }, character: {} },
    }, { mode: 'replace', returnTransaction: true });
    system.setValue('items', ['imported', 'concurrent']);

    await system.rollbackImportTransaction(result.transaction);

    assert.deepEqual(system.getValue('items'), ['before', 'concurrent']);
});

test('variable file export and import preserve JSON contracts', async () => {
    const dom = installDownloadDom();
    try {
        const { system } = fixture();
        seed(system);
        const exported = system.exportToFile({ includeLog: false });
        assert.equal(exported.type, 'group-director-variables');
        assert.equal(exported.variables.log, undefined);
        assert.match(dom.anchor.download, /^group-director-variables-/);
        assert.equal(dom.anchor.clicked, 1);

        const target = fixture().system;
        assert.equal((await target.importFromFile({ text: async () => JSON.stringify(exported) }, { mode: 'replace' })).ok, true);
        assert.equal(target.getValue('phase'), 'middle');
        assert.match((await target.importFromFile({ text: async () => '{' })).error, /Invalid JSON/);
    } finally { dom.restore(); }
});
