import test from 'node:test';
import assert from 'node:assert/strict';
import { createVariableDraftPort } from '../../muyu/host/variable-draft.js';
import { createVariableWriter } from '../../muyu/host/variable-write.js';
import { createTaskBundleDraftPort } from '../../muyu/host/task-bundle-draft.js';
import { createTaskBundleWriter } from '../../muyu/host/task-bundle-write.js';
import { createConfigWriter } from '../../muyu/host/config-write.js';
import { createTaskBundleActions } from '../../muyu/actions/task-bundle-apply.js';
import { actionReceipt, receiptSources, receiptContext } from '../../muyu/actions/receipts.js';
import { createSessionLibrary } from '../../muyu/sessions/library.js';
import { createMemoryHistoryStore } from '../../muyu/sessions/memory-store.js';
import { importedRecord } from '../../muyu/sessions/exchange.js';
import { requiredSources } from '../../muyu/application/capabilities.js';
import { createRecoveryJournal } from '../../muyu/recovery/journal.js';
import { openRecoveryStore } from '../../muyu/recovery/indexeddb-store.js';
import { historyIDB } from './helpers/history-idb.mjs';

const originalTarget = { kind: 'chat', userKey: 'page:test', chatKey: 'group:A' };
const variable = id => ({ action: 'create', id, label: id, initialValue: 0, rule: 'Update only on explicit changes', autoUpdate: true,
    injectMode: 'always', updateMode: 'delta' });
const request = { variables: [variable('party_gold'), variable('party_debt')], settings: { memoryEnabled: false } };
function fixture(saveChat = async () => {}, saveSettings = async () => ({ confirmed: true }), checkpoint = null) {
    let target = originalTarget, metadata = {};
    const settings = { memoryEnabled: true };
    const getTarget = () => target, getMetadata = () => metadata, getSettings = () => settings;
    const variableDraftPort = createVariableDraftPort({ getTarget, getMetadata, extensionKey: 'gd' });
    const variableWriter = createVariableWriter({ draftPort: variableDraftPort, getTarget, getMetadata, extensionKey: 'gd', saveChatConfirmed: saveChat });
    const bundleDraftPort = createTaskBundleDraftPort({ getTarget, getSettings, variableDraftPort });
    const configWriter = createConfigWriter({ getSettings, saveSettings, isBusy: () => false });
    const bundleWriter = createTaskBundleWriter({ draftPort: bundleDraftPort, getTarget, variableWriter, configWriter });
    const content = bundleDraftPort.prepare(originalTarget, request);
    const artifact = { id: 'artifact', revision: 1, kind: 'task-bundle', sessionId: 'session', content };
    const actions = createTaskBundleActions({ getArtifact: () => artifact, validate: () => bundleDraftPort.assertFresh(content), getTarget, writer: bundleWriter, checkpoint });
    return { actions, content, bundleDraftPort, settings, get metadata() { return metadata; }, switchChat: () => { target = { ...originalTarget, chatKey: 'group:B' }; metadata = {}; } };
}

test('One exact approval executes two chat variables then global settings and records each save domain', async () => {
    let chats = 0, globals = 0;
    const f = fixture(async () => { chats++; }, async () => { globals++; return { confirmed: true }; });
    const action = f.actions.prepare('artifact', 1);
    assert.equal(chats, 0); assert.equal(globals, 0); assert.equal(f.metadata.gd, undefined);
    const result = await f.actions.approve(action.id);
    assert.equal(result.status, 'applied_confirmed'); assert.deepEqual(result.result.steps.map(step => step.status), ['applied_confirmed', 'applied_confirmed', 'applied_confirmed']);
    assert.equal(chats, 2); assert.equal(globals, 1); assert.equal(f.settings.memoryEnabled, false);
    assert.deepEqual(f.metadata.gd.variables.defs.map(row => row.id), ['party_gold', 'party_debt']);
    const receipt = actionReceipt(result);
    assert.equal(receipt.version, 4); assert.deepEqual(receiptSources(receipt), ['source:variables', 'source:memoryConfig']);
    assert.deepEqual(receipt.steps.map(step => [step.id, step.chatSave, step.settingsSave]),
        [['party_gold', 'confirmed', 'not_started'], ['party_debt', 'confirmed', 'not_started'], ['global-settings', 'not_started', 'confirmed']]);
    assert.match(receiptContext([receipt]), /Version 4/);
    assert.throws(() => f.actions.approve(action.id), /ACTION_STALE/);
});

test('Real bundle records dispatch and result of every step, but never persists its draft tokens', async () => {
    const indexedDB = historyIDB(), port = { enabled: () => true, openRecovery: () => openRecoveryStore({ namespace: 'test', indexedDB }) };
    const journal = createRecoveryJournal({ port, owner: () => 'conversation' }), snapshots = [];
    const f = fixture(undefined, undefined, async (record, steps) => { await journal.checkpoint(record, steps); snapshots.push(journal.snapshot('conversation').records[0]); });
    const action = f.actions.prepare('artifact', 1), result = await f.actions.approve(action.id);
    assert.equal(result.status, 'applied_confirmed'); assert.equal(result.checkpointFailed, undefined);
    assert.equal(snapshots.length, 8);
    assert.deepEqual(snapshots[1].steps.map(s => s.status), ['applying', 'not_started', 'not_started']);
    assert.deepEqual(snapshots[4].steps.map(s => s.status), ['applied_confirmed', 'applied_confirmed', 'not_started']);
    const restored = createRecoveryJournal({ port }); await restored.refresh();
    const row = restored.snapshot('conversation').records[0];
    assert.equal(row.status, 'applied_confirmed'); assert.equal(row.receipt.version, 4);
    assert.deepEqual(row.receipt.steps.map(s => s.status), ['applied_confirmed', 'applied_confirmed', 'applied_confirmed']);
    assert.doesNotMatch(JSON.stringify(row), /"token"|page:test|"apply"|"userKey"/);
});

test('Unknown first chat save stops the remaining steps without rollback or replay', async () => {
    let chats = 0, globals = 0;
    const f = fixture(async () => { chats++; throw Error('save failed'); }, async () => { globals++; return { confirmed: true }; });
    const action = f.actions.prepare('artifact', 1), result = await f.actions.approve(action.id);
    assert.equal(result.status, 'outcome_unknown'); assert.deepEqual(result.result.steps.map(step => step.status), ['outcome_unknown', 'not_started', 'not_started']);
    assert.equal(chats, 1); assert.equal(globals, 0); assert.deepEqual(f.metadata.gd.variables.defs.map(row => row.id), ['party_gold']);
    assert.equal(f.settings.memoryEnabled, true);
    const receipt = actionReceipt(result);
    assert.equal(receipt.steps[0].chatSave, 'unknown'); assert.equal(receipt.steps[1].status, 'not_started');
});

test('Changed later baseline stops after the last confirmed step; changed chat cannot receive late writes', async () => {
    let chats = 0;
    let f;
    f = fixture(async () => { if (++chats === 1) f.settings.memoryEnabled = false; });
    const result = await f.actions.approve(f.actions.prepare('artifact', 1).id);
    assert.equal(result.status, 'partial'); assert.deepEqual(result.result.steps.map(step => step.status), ['applied_confirmed', 'applied_confirmed', 'not_executed']);
    assert.equal(chats, 2);

    let g;
    g = fixture(async () => { g.switchChat(); });
    const switched = await g.actions.approve(g.actions.prepare('artifact', 1).id);
    assert.equal(switched.status, 'partial');
    assert.deepEqual(switched.result.steps.map(step => step.status), ['partial', 'not_started', 'not_started']);
    assert.equal(g.metadata.gd, undefined);
});

test('Stale or unsupported whole-bundle proposals cannot obtain a write approval', () => {
    const f = fixture();
    f.settings.memoryEnabled = false;
    assert.throws(() => f.actions.prepare('artifact', 1), /STALE_BASELINE|STALE_TASK_BUNDLE/);
    const g = fixture();
    assert.throws(() => g.bundleDraftPort.prepare(originalTarget, { settings: { memoryMaxEntries: 10 } }), /BUNDLE_SETTING_REQUIRES_SEPARATE_DRAFT/);
    assert.throws(() => g.bundleDraftPort.prepare(originalTarget, { variables: [variable('same'), variable('same')] }), /INVALID_TASK_BUNDLE/);
    assert.deepEqual(requiredSources('muyu.task.preview', { settingsJson: '{"memoryEnabled":false}', variables: [variable('one')] }),
        ['source:memoryConfig', 'source:variables']);
    assert.equal(requiredSources('muyu.task.preview', { settingsJson: '{"unknownField":1}' }), null);
});

test('Bundle receipt persists as inert chat history with all required read sources', async () => {
    const f = fixture(), result = await f.actions.approve(f.actions.prepare('artifact', 1).id);
    const store = createMemoryHistoryStore(), library = createSessionLibrary({ port: { enabled: () => true, open: async () => store } });
    await library.ready;
    const id = library.create(JSON.stringify(['assistant', 'chat', originalTarget.chatKey]));
    library.recordReceipt(id, actionReceipt(result)); await library.flush();
    const record = library.get(id);
    assert.deepEqual(record.required, ['source:variables', 'source:memoryConfig']);
    assert.equal(record.receipts[0].version, 4);
    const imported = importedRecord(record);
    assert.equal(imported.receipts[0].status, 'applied_confirmed');
    assert.equal(imported.imported, true);
    assert.equal(Object.hasOwn(imported, 'bundleActions'), false);
    await library.close();
});
