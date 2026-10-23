import test from 'node:test';
import assert from 'node:assert/strict';
import { createVariableDraftPort } from '../../muyu/host/variable-draft.js';
import { variablePreviewSchema } from '../../muyu/modules/variables/index.js';
import { taskBundleSchema } from '../../muyu/host/task-bundle-draft.js';

const target = { kind: 'chat', userKey: 'page:test', chatKey: 'group:A' };
const create = { action: 'create', id: 'party_gold', label: '队伍金币', rule: '有明确收支依据时更新',
    initialValue: 0, min: 0, autoUpdate: true, injectMode: 'always', updateMode: 'delta', showInDashboard: true };

test('Numeric variable ID guidance is exposed in single and bundle schemas without permitting silent normalization', () => {
    assert.match(variablePreviewSchema.properties.id.description, /party_gold/);
    assert.equal(taskBundleSchema.properties.variables.items.properties.id.description, variablePreviewSchema.properties.id.description);
    const metadata = {}, port = createVariableDraftPort({ getTarget: () => target, getMetadata: () => metadata, extensionKey: 'gd' });
    for (const id of ['partyGold', 'party-gold', '金币', '__proto__', 'constructor', 'prototype']) assert.throws(() => port.prepare(target, { ...create, id }), /INVALID_VARIABLE_ID/);
    assert.deepEqual(metadata, {});
    assert.equal(port.prepare(target, create).definition.id, 'party_gold');
});

test('Variable draft previews one chat-local numeric definition without mutating metadata', () => {
    let current = target; const metadata = {};
    const port = createVariableDraftPort({ getTarget: () => current, getMetadata: () => metadata, extensionKey: 'gd' });
    const content = port.prepare(target, create);
    assert.equal(content.preview.scope, 'current-chat');
    assert.equal(content.definition.autoUpdate, true);
    assert.equal(content.definition.updateMode, 'delta');
    assert.equal(metadata.gd, undefined);
    assert.deepEqual(port.assertFresh(content), content);
    metadata.gd = { variables: { defs: [{ id: 'party_gold', scope: 'global', type: 'number', defaultValue: 10 }], values: { global: {}, character: {} }, log: [] } };
    assert.throws(() => port.assertFresh(content), /VARIABLE_ID_COLLISION/);
    current = { ...target, chatKey: 'group:B' };
    assert.throws(() => port.prepare(target, create), /TARGET_UNAVAILABLE/);
});

test('Variable draft updates only explicit definition fields, rejects conflicts and out-of-range values', () => {
    const metadata = { gd: { variables: { defs: [{ id: 'party_gold', label: 'Gold', scope: 'global', type: 'number', defaultValue: 0,
        rule: 'old', autoUpdate: false, injectMode: 'manual', updateMode: 'replace', min: 0, max: 100 }],
        values: { global: { party_gold: 25 }, character: {} }, log: [] } } };
    const port = createVariableDraftPort({ getTarget: () => target, getMetadata: () => metadata, extensionKey: 'gd' });
    const content = port.prepare(target, { action: 'update', id: 'party_gold', autoUpdate: true, injectMode: 'always', updateMode: 'delta' });
    assert.deepEqual(content.preview.diff.map(row => row.field), ['autoUpdate', 'injectMode', 'updateMode']);
    assert.equal(metadata.gd.variables.defs[0].autoUpdate, false);
    assert.throws(() => port.prepare(target, { action: 'update', id: 'party_gold', initialValue: 50 }), /INVALID_VARIABLE_CHANGE/);
    assert.throws(() => port.prepare(target, { action: 'update', id: 'party_gold', max: 20 }), /VARIABLE_VALUE_OUT_OF_RANGE/);
    metadata.gd.variables.values.global.party_gold = 26;
    assert.throws(() => port.assertFresh(content), /STALE_VARIABLE_DRAFT/);
    assert.throws(() => port.prepare(target, { ...create, action: 'create' }), /VARIABLE_ID_COLLISION/);
});
