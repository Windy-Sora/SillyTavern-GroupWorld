import test from 'node:test';
import assert from 'node:assert/strict';

import { createVariableSystem } from '../../systems/variable-system.js';

function fixture(overrides = {}) {
    const metadata = {};
    const characters = [
        { avatar: 'alice.png', name: 'Alice' },
        { avatar: 'bob.png', name: 'Bob' },
        { avatar: 'eve.png', name: 'Eve' },
    ];
    const calls = { saved: 0, logs: [] };
    const dependencies = {
        chat_metadata: metadata,
        getChatMetadata: () => metadata,
        EXT_KEY: 'gd',
        saveChatConditional: () => { calls.saved++; },
        getCharacters: () => characters,
        getCurrentGroup: () => ({ members: ['alice.png', 'bob.png'], disabled_members: ['bob.png'] }),
        getChat: () => [{ name: 'Alice', mes: 'Message' }],
        getLang: () => 'en',
        log: (...args) => calls.logs.push(args),
        ...overrides,
    };
    return { system: createVariableSystem(dependencies), metadata, characters, calls };
}

test('variable definitions normalize ids, fields, defaults, and duplicate saves', () => {
    const { system } = fixture();
    system.saveDefs([
        { label: 'Danger Level!', type: 'number', min: '0', max: '100', dashboardOrder: '5' },
        { id: 'danger_level', type: 'boolean' },
        { id: 'bad type', type: 'unsupported', scope: 'bad', updateMode: 'bad' },
    ]);
    const defs = system.getDefs();
    assert.equal(defs.length, 2);
    assert.deepEqual(defs[0], {
        id: 'danger_level', label: 'Danger Level!', labelZh: '', scope: 'global', type: 'number',
        defaultValue: 0, rule: '', ruleZh: '', autoUpdate: true, injectMode: 'always', updateMode: 'replace',
        min: 0, max: 100, enumValues: [], showInDashboard: true, locked: false, dashboardOrder: 5,
    });
    assert.equal(defs[1].id, 'bad_type');
    assert.equal(defs[1].type, 'string');
});

test('upsert initializes globals, migrates scope storage, and delete removes values and logs', () => {
    const { system, metadata } = fixture();
    system.upsertDefinition({ id: 'State', type: 'string', value: 'initial' });
    assert.equal(system.getValue('state'), 'initial');
    system.setValue('state', 'changed');
    system.upsertDefinition({ id: 'state', scope: 'character', type: 'string', value: 'character default' });
    assert.equal(metadata.gd.variables.values.global.state, undefined);
    assert.equal(system.getValue('state', 'Alice'), 'character default');
    system.setValue('state', 'personal', { target: 'Alice' });
    system.deleteDefinition('state');
    assert.equal(system.getDefinition('state'), null);
    assert.equal(metadata.gd.variables.values.character.state, undefined);
    assert.equal(system.getLog().length, 0);
});

test('built-in templates support localization and reject unknown ids', () => {
    const zh = fixture({ getLang: () => 'zh' }).system;
    const definition = zh.addTemplate('party_funds');
    assert.equal(definition.id, 'party_funds');
    assert.equal(definition.type, 'number');
    assert.notEqual(definition.label, 'Party Funds');
    assert.equal(zh.addTemplate('missing'), null);
    assert.ok(zh.getTemplates().length >= 20);
});

test('variable values coerce numeric, boolean, enum, array, object, and string modes', () => {
    const { system } = fixture();
    system.upsertDefinition({ id: 'score', type: 'number', value: 10, updateMode: 'delta', min: 0, max: 20 });
    assert.deepEqual(system.setValue('score', '+ 15'), { ok: true, value: 20 });
    assert.equal(system.setValue('score', 'NaN').ok, false);

    system.upsertDefinition({ id: 'flag', type: 'boolean' });
    assert.deepEqual(system.setValue('flag', 'yes'), { ok: true, value: true });
    assert.deepEqual(system.setValue('flag', 0), { ok: true, value: false });
    assert.equal(system.setValue('flag', 'maybe').ok, false);

    system.upsertDefinition({ id: 'phase', type: 'enum', enumValues: 'start, middle, end' });
    assert.deepEqual(system.setValue('phase', 'middle'), { ok: true, value: 'middle' });
    assert.match(system.setValue('phase', 'other').error, /not in enum/);

    system.upsertDefinition({ id: 'items', type: 'array', value: [], updateMode: 'append' });
    system.setValue('items', 'key');
    assert.deepEqual(system.setValue('items', ['map']).value, ['key', 'map']);
    assert.deepEqual(system.setValue('items', '["reset"]', { updateMode: 'replace' }).value, ['reset']);
    assert.equal(system.setValue('items', '{}', { updateMode: 'replace' }).ok, false);

    system.upsertDefinition({ id: 'stats', type: 'object', value: { hp: 1 }, updateMode: 'merge' });
    assert.deepEqual(system.setValue('stats', '{"mp":2}').value, { hp: 1, mp: 2 });
    assert.equal(system.setValue('stats', '[]').ok, false);

    system.upsertDefinition({ id: 'notes', type: 'string', value: 'one', updateMode: 'append' });
    assert.equal(system.setValue('notes', 'two').value, 'one\ntwo');
});

test('character variables resolve enabled targets by avatar and case-insensitive name only', () => {
    const { system } = fixture();
    system.upsertDefinition({ id: 'trust', scope: 'character', type: 'number', value: 50 });
    assert.equal(system.resolveAvatar('alice.png'), 'alice.png');
    assert.equal(system.resolveAvatar('alice'), 'alice.png');
    assert.equal(system.resolveAvatar('Bob'), null);
    assert.equal(system.resolveAvatar('Eve'), null);
    assert.deepEqual(system.setValue('trust', 80, { target: 'ALICE' }), { ok: true, value: 80 });
    assert.equal(system.getValue('trust', 'Alice'), 80);
    assert.equal(system.setValue('trust', 60, { target: 'Bob' }).ok, false);
    assert.equal(system.setValue('missing', 1).error, 'unknown variable');
});
