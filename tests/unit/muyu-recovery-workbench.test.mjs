import test from 'node:test';
import assert from 'node:assert/strict';
import { historyIDB } from './helpers/history-idb.mjs';
import { openRecoveryStore } from '../../muyu/recovery/indexeddb-store.js';
import { createRecoveryJournal } from '../../muyu/recovery/journal.js';
import { createRecoveryWorkbench } from '../../muyu/recovery/workbench.js';
import { createVariableDraftPort } from '../../muyu/host/variable-draft.js';
import { createVariableWriter } from '../../muyu/host/variable-write.js';
import { createTaskBundleDraftPort } from '../../muyu/host/task-bundle-draft.js';
import { createTaskBundleWriter } from '../../muyu/host/task-bundle-write.js';
import { createTaskBundleActions } from '../../muyu/actions/task-bundle-apply.js';
import { createConfigWriter } from '../../muyu/host/config-write.js';
import { createConfigActions } from '../../muyu/actions/config-apply.js';
import { previewSettings } from '../../muyu/config/registry.js';

async function undoFixture({ confirmed = true } = {}) {
    const f = await fixture();
    const baseline = { autoMemoryInterval: 10, autoMemoryEnabled: true, memoryEnabled: true }, changes = { autoMemoryInterval: 20 };
    const artifact = { id: 'undo-original', revision: 1, sessionId: 'session', kind: 'config-draft', content: {
        module: 'settings-config', baseline, requestedChanges: changes, preview: previewSettings({ baseline, changes }) } };
    const writer = confirmed ? f.host.configWriter : createConfigWriter({ getSettings: () => f.settings, saveSettings: async () => undefined });
    const actions = createConfigActions({ getTarget: () => f.host.globalTarget, getArtifact: () => artifact, validate() {}, writer,
        checkpoint: record => f.journal.checkpoint(record) });
    const action = actions.prepare(artifact.id, 1), result = await actions.approve(action.id);
    return { ...f, undoId: action.id, originalResult: result };
}

test('Confirmed ordinary settings undo uses full baseline, a fresh preview and explicit approval; unrelated edits survive', async () => {
    const f = await undoFixture();
    f.settings.unrelated = 'later edit';
    const journal = createRecoveryJournal({ port: f.port }), w = createRecoveryWorkbench({ host: f.host, journal });
    const p = await w.prepare(f.undoId, 'undo');
    assert.equal(p.mode, 'undo'); assert.equal(p.state, 'ready');
    assert.equal(p.diff[0].field, 'autoMemoryInterval'); assert.equal(f.settings.autoMemoryInterval, 20);
    const before = f.counts(), result = await w.approve(f.undoId);
    assert.equal(result.status, 'applied_confirmed'); assert.equal(f.settings.autoMemoryInterval, 10);
    assert.equal(f.settings.unrelated, 'later edit'); assert.deepEqual(f.counts(), [before[0], before[1] + 1]);
    const child = await journal.get(result.id); assert.equal(child.parentId, f.undoId);
    assert.equal(child.intent.settings.baseline.autoMemoryInterval, 20); assert.equal(child.intent.settings.changes.autoMemoryInterval, 10);
    await assert.rejects(w.prepare(f.undoId, 'undo'), /RECOVERY_CONSUMED/);
    await assert.rejects(w.approve(f.undoId), /RECOVERY_STALE/);
});

test('Undo refuses concurrent changes before review and after review, including dependency changes', async () => {
    const f = await undoFixture(); f.settings.autoMemoryInterval = 25;
    await assert.rejects(f.workbench.prepare(f.undoId, 'undo'), /RECOVERY_CONFLICT/);
    assert.equal(f.settings.autoMemoryInterval, 25);
    f.settings.autoMemoryInterval = 20; await f.workbench.prepare(f.undoId, 'undo');
    f.settings.autoMemoryEnabled = false;
    await assert.rejects(f.workbench.approve(f.undoId), /STALE|CONFLICT/);
    assert.equal(f.settings.autoMemoryEnabled, false); assert.equal(f.settings.autoMemoryInterval, 20);
});

test('Unknown persistence, unsupported bundles and missing before-values cannot be reversed', async () => {
    const f = await undoFixture({ confirmed: false });
    await assert.rejects(f.workbench.prepare(f.undoId, 'undo'), /RECOVERY_UNCERTAIN/);
    await assert.rejects(f.workbench.prepare(f.id, 'undo'), /RECOVERY_UNDO_UNSUPPORTED/);
    assert.equal(f.settings.autoMemoryInterval, 20);
    const row = await f.journal.get(f.undoId), store = await f.port.openRecovery();
    const next = { ...row, status: 'applied_confirmed', receipt: { ...row.receipt, status: 'applied_confirmed' },
        intent: { ...row.intent, settings: { ...row.intent.settings, baseline: { memoryEnabled: true, autoMemoryEnabled: true } } } };
    await store.write(next, row.revision);
    await assert.rejects(f.workbench.prepare(f.undoId, 'undo'), /RECOVERY_UNDO_UNSUPPORTED/);
});

test('Durable undo claim prevents two tabs from executing the same reversal', async () => {
    const f = await undoFixture(), journal = createRecoveryJournal({ port: f.port });
    const other = createRecoveryWorkbench({ host: f.host, journal });
    await f.workbench.prepare(f.undoId, 'undo'); await other.prepare(f.undoId, 'undo');
    const before = f.counts();
    const results = await Promise.all([f.workbench.approve(f.undoId), other.approve(f.undoId)]);
    assert.equal(results.filter(r => r.status === 'applied_confirmed').length, 1);
    assert.deepEqual(f.counts(), [before[0], before[1] + 1]); assert.equal(f.settings.autoMemoryInterval, 10);
    const loser = results.find(r => r.status !== 'applied_confirmed');
    await assert.rejects(createRecoveryWorkbench({ host: f.host, journal }).prepare(loser.id), /RECOVERY_CONSUMED/);
});

test('Undo marker failure does not write, and failed undo saving preserves the actual memory change without retry', async () => {
    const f = await undoFixture(); await f.workbench.prepare(f.undoId, 'undo');
    const before = f.counts(); f.indexedDB.failNextPut('checkpoints');
    const stopped = await f.workbench.approve(f.undoId);
    assert.equal(stopped.status, 'not_executed'); assert.equal(f.settings.autoMemoryInterval, 20); assert.deepEqual(f.counts(), before);
    f.host.configWriter = createConfigWriter({ getSettings: () => f.settings, saveSettings: async () => { throw Error('offline'); } });
    const w = createRecoveryWorkbench({ host: f.host, journal: f.journal }); await w.prepare(f.undoId, 'undo');
    const result = await w.approve(f.undoId); assert.equal(result.status, 'applied_unconfirmed'); assert.equal(f.settings.autoMemoryInterval, 10);
    await assert.rejects(w.prepare(result.id), /RECOVERY_CONFLICT|RECOVERY_UNCERTAIN/);
    await assert.rejects(w.prepare(f.undoId, 'undo'), /RECOVERY_CONSUMED/);
});

async function fixture({ unknown = false } = {}) {
    const indexedDB = historyIDB(); let enabled = true, chatSaves = 0, settingsSaves = 0, rejectChat = unknown;
    let target = { kind: 'chat', userKey: 'page:A', chatKey: 'group:A' };
    const metadata = {}, settings = { memoryEnabled: true, autoMemoryEnabled: true, autoMemorySpeakers: false, autoMemoryInterval: 10 };
    const port = { enabled: () => enabled, openRecovery: () => openRecoveryStore({ namespace: 'workbench', indexedDB }) };
    const journal = createRecoveryJournal({ port, owner: () => 'conversation' });
    const getTarget = () => target, getSettings = () => settings;
    const variableDraftPort = createVariableDraftPort({ getTarget, getMetadata: () => metadata, extensionKey: 'gd' });
    const variableWriter = createVariableWriter({ draftPort: variableDraftPort, getTarget, getMetadata: () => metadata, extensionKey: 'gd',
        saveChatConfirmed: async () => { chatSaves++; if (rejectChat) throw Error('offline'); } });
    const configWriter = createConfigWriter({ getSettings, isBusy: () => false, saveSettings: async () => { settingsSaves++; return { confirmed: true }; } });
    const bundleDraftPort = createTaskBundleDraftPort({ getTarget, getSettings, variableDraftPort });
    const bundleWriter = createTaskBundleWriter({ draftPort: bundleDraftPort, getTarget, variableWriter, configWriter });
    const host = { globalTarget: { kind: 'global', userKey: 'page:A' }, currentTarget: getTarget, getSettings, variableDraftPort, configWriter, bundleDraftPort, bundleWriter };
    const request = { variables: ['gold', 'debt'].map(id => ({ action: 'create', id, label: id, initialValue: 0, rule: 'Explicit changes only', autoUpdate: true, injectMode: 'always', updateMode: 'delta' })), settings: { autoMemoryInterval: 15 } };
    const content = bundleDraftPort.prepare(target, request), artifact = { id: 'draft', revision: 1, kind: 'task-bundle', sessionId: 'runtime', content };
    let checkpoints = 0;
    const actions = createTaskBundleActions({ getTarget, getArtifact: () => artifact, validate: () => bundleDraftPort.assertFresh(content), writer: bundleWriter,
        checkpoint: async (record, steps) => { if (++checkpoints === 4 && !unknown) throw Error('RECOVERY_SAVE_FAILED'); await journal.checkpoint(record, steps); } });
    const action = actions.prepare('draft', 1); await actions.approve(action.id);
    const workbench = createRecoveryWorkbench({ host, journal });
    return { host, port, indexedDB, journal, workbench, id: action.id, metadata, settings,
        counts: () => [chatSaves, settingsSaves], setTarget: value => { target = value; }, disable: () => { enabled = false; }, online: () => { rejectChat = false; } };
}

async function interruptedVariableUpdate(legacy) {
    const f = await fixture(), gold = f.metadata.gd.variables.defs.find(v => v.id === 'gold');
    if (legacy) {
        for (const field of ['dashboardOrder', 'labelZh', 'ruleZh', 'enumValues', 'min', 'max', 'showInDashboard']) delete gold[field];
        gold.autoUpdate = 1; // Supported old storage need not equal its normalized projection.
        gold.injectMode = 'legacy';
    }
    const before = structuredClone(gold), counts = f.counts();
    const content = f.host.bundleDraftPort.prepare(f.host.currentTarget(), {
        variables: [{ action: 'update', id: 'gold', label: 'Updated gold', showInDashboard: true, autoUpdate: true, injectMode: 'always' }],
        settings: { autoMemoryInterval: 15 },
    });
    assert.deepEqual(content.variables[0].preview.diff.map(row => row.field), ['label']);
    const artifact = { id: 'update-draft', revision: 1, kind: 'task-bundle', sessionId: 'runtime', content };
    let n = 0;
    const actions = createTaskBundleActions({ getTarget: f.host.currentTarget, getArtifact: () => artifact,
        validate: () => f.host.bundleDraftPort.assertFresh(content), writer: f.host.bundleWriter,
        checkpoint: async (record, steps) => { if (++n === 4) throw Error('RECOVERY_SAVE_FAILED'); await f.journal.checkpoint(record, steps); } });
    const action = actions.prepare(artifact.id, 1), result = await actions.approve(action.id);
    assert.equal(result.status, 'partial'); assert.equal(result.result.steps[0].status, 'applied_confirmed');
    assert.deepEqual(gold, { ...before, label: 'Updated gold' });
    assert.deepEqual(f.counts(), [counts[0] + 1, counts[1]]); assert.equal(f.settings.autoMemoryInterval, 10);
    return { ...f, id: action.id, gold };
}

for (const legacy of [false, true]) test('Completed variable update resumes only remaining settings without normalizing stored fields / legacy=' + legacy, async () => {
    const f = await interruptedVariableUpdate(legacy), before = structuredClone(f.gold), counts = f.counts();
    const journal = createRecoveryJournal({ port: f.port }), w = createRecoveryWorkbench({ host: f.host, journal });
    const preview = await w.prepare(f.id);
    assert.equal(preview.state, 'ready'); assert.deepEqual(preview.steps, []); assert.equal(preview.settingsDiff.length, 1);
    assert.deepEqual(f.counts(), counts);
    const result = await w.approve(f.id);
    assert.equal(result.status, 'applied_confirmed'); assert.equal(f.settings.autoMemoryInterval, 15);
    assert.deepEqual(f.counts(), [counts[0], counts[1] + 1]); assert.deepEqual(f.gold, before);
});

for (const field of ['label', 'rule', 'dashboardOrder', 'value']) test('Legacy completed update still rejects concurrent edits to ' + field, async () => {
    const f = await interruptedVariableUpdate(true), counts = f.counts();
    if (field === 'value') f.metadata.gd.variables.values.global.gold = 9;
    else f.gold[field] = field === 'dashboardOrder' ? 100 : 'Concurrent edit';
    await assert.rejects(f.workbench.prepare(f.id), /RECOVERY_CONFLICT/);
    assert.deepEqual(f.counts(), counts); assert.equal(f.settings.autoMemoryInterval, 10);
});

test('Legacy completed update is rechecked after review before remaining settings are written', async () => {
    const f = await interruptedVariableUpdate(true), counts = f.counts();
    await f.workbench.prepare(f.id); f.gold.dashboardOrder = 100;
    await assert.rejects(f.workbench.approve(f.id), /RECOVERY_CONFLICT/);
    assert.deepEqual(f.counts(), counts); assert.equal(f.settings.autoMemoryInterval, 10);
});

test('Undo cancelled while its prewrite marker is flushing never dispatches a settings write', async () => {
    const f = await undoFixture(); let finish, marked = false;
    const port = { ...f.port, openRecovery: async () => {
        const store = await f.port.openRecovery();
        return { ...store, write: async (row, revision) => {
            const result = await store.write(row, revision);
            if (!marked && row.status === 'applying') { marked = true; await new Promise(resolve => { finish = resolve; }); }
            return result;
        } };
    } };
    const journal = createRecoveryJournal({ port }), w = createRecoveryWorkbench({ host: f.host, journal });
    await w.prepare(f.undoId, 'undo'); const before = f.counts(), pending = w.approve(f.undoId);
    while (!finish) await new Promise(resolve => setImmediate(resolve));
    w.invalidate(); finish();
    const result = await pending; assert.equal(result.status, 'not_executed');
    assert.equal(f.settings.autoMemoryInterval, 20); assert.deepEqual(f.counts(), before); await w.drain();
});

test('Undo restores complete Prompt text, not the truncated display diff', async () => {
    const f = await fixture(), before = 'original '.repeat(300), after = 'replacement '.repeat(200);
    f.settings.llmPrompt = before;
    const baseline = { llmPrompt: before }, changes = { llmPrompt: after };
    const content = { module: 'settings-config', baseline, requestedChanges: changes, preview: previewSettings({ baseline, changes }) };
    const artifact = { id: 'prompt', revision: 1, kind: 'config-draft', sessionId: 'conversation', content };
    const actions = createConfigActions({ getTarget: () => f.host.globalTarget, getArtifact: () => artifact, validate() {},
        writer: f.host.configWriter, checkpoint: record => f.journal.checkpoint(record) });
    const action = actions.prepare('prompt', 1); const applied = await actions.approve(action.id);
    assert.equal(applied.status, 'applied_confirmed', JSON.stringify(applied.result));
    const row = await f.journal.get(action.id), store = await f.port.openRecovery();
    await store.write({ ...row, receipt: { ...row.receipt, diff: [{ ...row.receipt.diff[0], before: '[omitted display text]' }] } }, row.revision);
    await f.workbench.prepare(action.id, 'undo'); await f.workbench.approve(action.id);
    assert.equal(f.settings.llmPrompt, before);
});

test('A confirmed save with a post-save conflict warning is not considered safely undoable', async () => {
    const f = await undoFixture(), row = await f.journal.get(f.undoId), store = await f.port.openRecovery();
    await store.write({ ...row, receipt: { ...row.receipt, changed: true } }, row.revision);
    await assert.rejects(f.workbench.prepare(f.undoId, 'undo'), /RECOVERY_UNCERTAIN/);
    assert.equal(f.settings.autoMemoryInterval, 20);
});

test('Reloaded recovery verifies original completed step and previews only the unexecuted suffix; fresh approval writes once', async () => {
    const f = await fixture(); assert.deepEqual(f.counts(), [1, 0]);
    const journal = createRecoveryJournal({ port: f.port }); await journal.refresh();
    const w = createRecoveryWorkbench({ host: f.host, journal });
    const preview = await w.prepare(f.id); assert.equal(preview.state, 'ready'); assert.deepEqual(preview.steps.map(s => s.id), ['debt']);
    assert.deepEqual(f.counts(), [1, 0]); assert.equal(f.settings.autoMemoryInterval, 10);
    const result = await w.approve(f.id); assert.equal(result.status, 'applied_confirmed'); assert.deepEqual(f.counts(), [2, 1]);
    assert.deepEqual(f.metadata.gd.variables.defs.map(d => d.id), ['gold', 'debt']); assert.equal(f.settings.autoMemoryInterval, 15);
    const source = await journal.get(f.id); assert.equal(source.continuedBy, result.id);
    const child = await journal.get(result.id); assert.equal(child.conversationId, 'conversation'); assert.equal(child.receipt.steps.length, 2);
    await assert.rejects(w.approve(f.id), /RECOVERY_STALE/);
    const second = createRecoveryWorkbench({ host: f.host, journal }); await assert.rejects(second.prepare(f.id), /RECOVERY_CONSUMED/);
});

test('Unknown save cannot be inferred successful from matching current data or retried on reconnect', async () => {
    const f = await fixture({ unknown: true }); f.online();
    await assert.rejects(f.workbench.prepare(f.id), /RECOVERY_UNCERTAIN/); assert.deepEqual(f.counts(), [1, 0]);
});

test('Changed completed value, pending baseline or current chat blocks recovery without overwriting later edits', async () => {
    const a = await fixture(); a.metadata.gd.variables.values.global.gold = 99;
    await assert.rejects(a.workbench.prepare(a.id), /RECOVERY_CONFLICT/); assert.equal(a.metadata.gd.variables.values.global.gold, 99);
    const b = await fixture(); b.settings.autoMemoryEnabled = false;
    await assert.rejects(b.workbench.prepare(b.id), /RECOVERY_CONFLICT/); assert.deepEqual(b.counts(), [1, 0]);
    const c = await fixture(); c.setTarget({ kind: 'chat', userKey: 'page:A', chatKey: 'group:B' });
    await assert.rejects(c.workbench.prepare(c.id), /RECOVERY_WRONG_TARGET/); assert.deepEqual(c.counts(), [1, 0]);
});

test('Changes after review are rechecked before dispatch; disabled persistence cannot be bypassed', async () => {
    const f = await fixture(); await f.workbench.prepare(f.id); f.settings.autoMemoryInterval = 17;
    await assert.rejects(f.workbench.approve(f.id), /STALE/); assert.deepEqual(f.counts(), [1, 0]);
    const other = await fixture(); await other.workbench.prepare(other.id); other.disable();
    const result = await other.workbench.approve(other.id); assert.equal(result.status, 'not_executed'); assert.deepEqual(other.counts(), [1, 0]);
});

test('Two tabs may review, but durable source CAS lets only one dispatch the remaining steps', async () => {
    const f = await fixture(); const journal = createRecoveryJournal({ port: f.port }); await journal.refresh();
    const other = createRecoveryWorkbench({ host: f.host, journal });
    await f.workbench.prepare(f.id); await other.prepare(f.id);
    const results = await Promise.all([f.workbench.approve(f.id), other.approve(f.id)]);
    assert.equal(results.filter(r => r.status === 'applied_confirmed').length, 1); assert.deepEqual(f.counts(), [2, 1]);
    const loser = results.find(r => r.status !== 'applied_confirmed');
    const third = createRecoveryWorkbench({ host: f.host, journal }); await assert.rejects(third.prepare(loser.id), /RECOVERY_CONSUMED/);
});

test('Cancelling during a resumed save stops remaining settings, retaining the actual completed change', async () => {
    const f = await fixture(); let finish;
    f.host.bundleWriter = createTaskBundleWriter({ draftPort: f.host.bundleDraftPort, getTarget: f.host.currentTarget,
        variableWriter: { apply: () => new Promise(resolve => { finish = resolve; }) }, configWriter: f.host.configWriter });
    const w = createRecoveryWorkbench({ host: f.host, journal: f.journal }); await w.prepare(f.id);
    const pending = w.approve(f.id);
    while (!finish) await new Promise(resolve => setImmediate(resolve));
    w.invalidate(); finish({ status: 'applied_confirmed' });
    const result = await pending; assert.equal(result.status, 'partial'); assert.equal(f.settings.autoMemoryInterval, 10);
    assert.equal(result.result.steps[1].status, 'not_started');
});

test('A definitely not-executed ordinary config requires a fresh preview and second explicit approval', async () => {
    const f = await fixture(); const artifact = { id: 'single', revision: 1, sessionId: 'session', kind: 'config-draft', content: { module: 'settings-config',
        baseline: { autoMemoryInterval: 10, autoMemoryEnabled: true, memoryEnabled: true }, requestedChanges: { autoMemoryInterval: 20 },
        preview: { contractVersion: 2, diff: [{ field: 'autoMemoryInterval', before: '10', after: '20' }] } } };
    let n = 0;
    const actions = createConfigActions({ getTarget: () => f.host.globalTarget, getArtifact: () => artifact, validate() {}, writer: f.host.configWriter,
        checkpoint: async record => { if (++n === 1) throw Error('RECOVERY_SAVE_FAILED'); await f.journal.checkpoint(record); } });
    const action = actions.prepare('single', 1); assert.equal((await actions.approve(action.id)).status, 'not_executed');
    await f.workbench.prepare(action.id); assert.equal(f.settings.autoMemoryInterval, 10);
    const result = await f.workbench.approve(action.id); assert.equal(result.status, 'applied_confirmed'); assert.equal(f.settings.autoMemoryInterval, 20);
});

test('Legacy v1 remains readable but cannot reconstruct execution from a truncated receipt', async () => {
    const f = await fixture(), row = await f.journal.get(f.id), store = await f.port.openRecovery();
    const { intent, continuedBy, parentId, ...legacy } = row;
    await store.write({ ...legacy, version: 1 }, row.revision);
    await assert.rejects(f.workbench.prepare(f.id), /RECOVERY_NO_INTENT/); assert.deepEqual(f.counts(), [1, 0]);
});

test('Deleting a source after review prevents dispatch even when its old baseline still matches', async () => {
    const f = await fixture(); await f.workbench.prepare(f.id); await f.journal.remove(f.id);
    const result = await f.workbench.approve(f.id); assert.equal(result.status, 'not_executed'); assert.deepEqual(f.counts(), [1, 0]);
    await assert.rejects(f.workbench.prepare(result.id), /RECOVERY_STALE/);
});

test('A second recovery still guards completed steps in its ancestor, including changes during its review', async () => {
    const f = await fixture(), writer = f.host.bundleWriter;
    f.host.bundleWriter = { apply: (content, execution) => writer.apply(content, { checkpoint: steps => {
        if (steps[1]?.status === 'applying') throw Error('RECOVERY_SAVE_FAILED');
        return execution.checkpoint(steps);
    } }) };
    const w = createRecoveryWorkbench({ host: f.host, journal: f.journal }); await w.prepare(f.id);
    const child = await w.approve(f.id); assert.equal(child.status, 'partial'); assert.deepEqual(f.counts(), [2, 0]);
    const next = createRecoveryWorkbench({ host: f.host, journal: f.journal }); await next.prepare(child.id);
    assert.deepEqual(next.snapshot().steps, []); assert.equal(next.snapshot().settingsDiff.length, 1);
    f.metadata.gd.variables.values.global.gold = 99;
    await assert.rejects(next.approve(child.id), /RECOVERY_CONFLICT/);
    await assert.rejects(next.prepare(child.id), /RECOVERY_CONFLICT/);
    assert.deepEqual(f.counts(), [2, 0]); assert.equal(f.settings.autoMemoryInterval, 10);
});
