import test from 'node:test';
import assert from 'node:assert/strict';
import { createStoryBlueprintTogglePort } from '../../muyu/host/story-blueprint-toggle.js';
import { createConfigWriter } from '../../muyu/host/config-write.js';
import { createSettingsModule } from '../../muyu/modules/settings/index.js';
import { dependencyFields, readSettingsFields, previewSettings } from '../../muyu/config/registry.js';
import { requiredSources } from '../../muyu/application/capabilities.js';
import { actionReceipt, receiptSources, receiptText, receiptContext, validateReceipt } from '../../muyu/actions/receipts.js';
import { createTaskBundleDraftPort } from '../../muyu/host/task-bundle-draft.js';

function fixture({ enabled = false, missing = false, chatSave = async () => {}, settingsSave = async () => ({ confirmed: true }) } = {}) {
    const settings = { storyBlueprintEnabled: enabled, storyBlueprintCompletionVariable: 'done', storyBlueprintAutoContinue: true };
    const metadata = { gd: { storyBlueprint: { nodes: ['preserve'], progress: 9 }, variables: { defs: missing ? [] : [
        { id: 'done', type: 'boolean', scope: 'global', autoUpdate: false, injectMode: 'always', rule: 'preserve rule' }],
        values: { global: missing ? {} : { done: true }, character: {} }, log: [] } } };
    let current = metadata, target = { kind: 'chat', userKey: 'test', chatKey: 'private-chat' }, chatSaves = 0, settingsSaves = 0, busy = false;
    const port = createStoryBlueprintTogglePort({ getTarget: () => target, getMetadata: () => current, getSettings: () => settings,
        extensionKey: 'gd', saveChatConfirmed: async m => { chatSaves++; await chatSave(m); } });
    const writer = createConfigWriter({ getSettings: () => settings, isBusy: () => busy, blueprintTogglePort: port,
        saveSettings: async () => { settingsSaves++; return settingsSave(); } });
    const changes = { storyBlueprintEnabled: !enabled }, baseline = readSettingsFields(settings, dependencyFields(Object.keys(changes)));
    const plan = () => port.plan(target, !enabled);
    return { settings, metadata, port, writer, changes, baseline, plan, target: () => target,
        apply: (p = plan()) => writer.apply({ baseline, changes, contractVersion: 2, blueprintTogglePlan: p }),
        switchChat: () => { current = {}; target = { ...target, chatKey: 'another' }; }, setBusy: () => { busy = true; },
        counts: () => [chatSaves, settingsSaves] };
}

test('blueprint preview reads only declared sources, describes side effects and does not mutate', () => {
    const f = fixture(), original = structuredClone(f.metadata);
    assert.deepEqual(requiredSources('muyu.settings.preview', { changes: f.changes }), ['source:configSettings', 'source:variables']);
    assert.deepEqual(requiredSources('muyu.settings.read', { fields: ['storyBlueprintEnabled'] }), ['source:configSettings']);
    const module = createSettingsModule({ getSettings: () => f.settings, getTarget: f.target, blueprintTogglePort: f.port });
    module.bindRun({ id: 'r', taskId: 't', target: f.target() });
    const ctx = { runId: 'r', target: f.target(), signal: new AbortController().signal };
    const result = module.handlers['muyu.settings.preview']({ changes: f.changes }, ctx);
    const preview = JSON.parse(result.text);
    assert.equal(preview.impact.before.value, true); assert.equal(preview.impact.after, false);
    assert.equal(preview.impact.enableAutoUpdate, true); assert.equal(preview.impact.useManualInjection, true);
    assert.deepEqual(f.metadata, original); assert.deepEqual(f.counts(), [0, 0]);
    assert.throws(() => module.handlers['muyu.settings.preview']({ changes: { ...f.changes, storyBlueprintAutoContinue: false } }, ctx), /BLUEPRINT_TOGGLE_REQUIRES_SEPARATE_DRAFT/);
    module.dispose();
});

test('enable saves reset variable before switch, preserves rule, blueprint and unrelated data', async () => {
    const f = fixture({ chatSave: async () => { assert.equal(f.settings.storyBlueprintEnabled, false); } });
    f.metadata.gd.variables.values.global.other = 'concurrent';
    const plan = f.plan(), result = await f.apply(plan);
    assert.equal(result.status, 'applied_confirmed');
    assert.deepEqual(result.blueprintToggle, { chatSave: 'confirmed', settingsSave: 'confirmed' });
    assert.equal(f.settings.storyBlueprintEnabled, true);
    assert.deepEqual(f.metadata.gd.storyBlueprint, { nodes: ['preserve'], progress: 9 });
    assert.equal(f.metadata.gd.variables.values.global.done, false);
    assert.equal(f.metadata.gd.variables.values.global.other, 'concurrent');
    assert.equal(f.metadata.gd.variables.defs[0].autoUpdate, true);
    assert.equal(f.metadata.gd.variables.defs[0].injectMode, 'manual');
    assert.equal(f.metadata.gd.variables.defs[0].rule, 'preserve rule');
    assert.deepEqual(f.counts(), [1, 1]);
    await assert.rejects(f.apply(plan), /STALE_BASELINE/);
    const receipt = actionReceipt({ id: 'apply:1', artifactId: 'a', revision: 1, status: result.status, result,
        content: { preview: previewSettings({ baseline: f.baseline, changes: f.changes }), blueprintTogglePlan: plan } });
    assert.deepEqual(validateReceipt(receipt), receipt);
    assert.deepEqual(receiptSources(receipt), ['source:configSettings', 'source:variables']);
    assert.match(receiptText(receipt), /全局蓝图开关保存/);
    assert.ok(!receiptContext([receipt]).includes('private-chat'));
    const forged = structuredClone(receipt); delete forged.blueprintToggle;
    assert.throws(() => validateReceipt(forged), /INVALID_RECEIPT/);
});

test('enable creates missing owned variable; disable resets existing value without changing its policy', async () => {
    const f = fixture({ missing: true }); await f.apply();
    assert.equal(f.metadata.gd.variables.defs[0].owner, 'group-director-story-blueprint');
    assert.equal(f.metadata.gd.variables.values.global.done, false);
    const g = fixture({ enabled: true }); const definition = structuredClone(g.metadata.gd.variables.defs[0]);
    await g.apply();
    assert.equal(g.settings.storyBlueprintEnabled, false);
    assert.equal(g.metadata.gd.variables.values.global.done, false);
    assert.deepEqual(g.metadata.gd.variables.defs[0], definition);
});

test('disable with missing variable does not create or save chat data', async () => {
    const f = fixture({ enabled: true, missing: true }), original = structuredClone(f.metadata);
    const result = await f.apply();
    assert.deepEqual(result.blueprintToggle, { chatSave: 'not_needed', settingsSave: 'confirmed' });
    assert.deepEqual(f.counts(), [0, 1]); assert.deepEqual(f.metadata, original);
});

test('conflicting, locked, malformed or reserved completion variables fail before mutations', () => {
    for (const mutate of [f => { f.metadata.gd.variables.defs[0].locked = true; },
        f => { f.metadata.gd.variables.defs[0].type = 'number'; }, f => { f.metadata.gd.variables.defs[0].scope = 'character'; },
        f => { f.metadata.gd.variables.defs[0].owner = 'other'; }, f => { f.settings.storyBlueprintCompletionVariableGuard = 'done'; },
        f => { f.metadata.gd.variables.defs.push({ id: 'done' }); }, f => { f.metadata.gd.variables.values.global.done = 'false'; },
        f => { f.settings.storyBlueprintCompletionVariable = '__proto__'; }, f => { f.settings.storyBlueprintCompletionVariable = '_done'; },
        f => { f.settings.storyBlueprintCompletionVariable = 'done_'; }, f => { f.metadata.gd.variables.log = {}; }]) {
        const f = fixture(); mutate(f);
        assert.throws(f.plan); assert.deepEqual(f.counts(), [0, 0]);
    }
});

test('stale variable, target, config dependency or busy execution refuses old preview', async () => {
    for (const mutate of [f => { f.metadata.gd.variables.values.global.done = false; },
        f => { f.metadata.gd.variables.defs[0].rule = 'new'; }, f => f.switchChat(),
        f => { f.settings.storyBlueprintAutoContinue = false; }, f => f.setBusy()]) {
        const f = fixture(), plan = f.plan(); mutate(f);
        await assert.rejects(f.apply(plan)); assert.deepEqual(f.counts(), [0, 0]);
    }
});

test('generic writer cannot bypass the dedicated plan or combine its switch with another setting', async () => {
    const f = fixture();
    await assert.rejects(f.writer.apply({ baseline: f.baseline, changes: f.changes, contractVersion: 2 }), /WRITE_UNAVAILABLE/);
    const changes = { ...f.changes, storyBlueprintAutoContinue: false };
    await assert.rejects(f.writer.apply({ baseline: f.baseline, changes, contractVersion: 2, blueprintTogglePlan: f.plan() }), /WRITE_UNAVAILABLE/);
    assert.deepEqual(f.counts(), [0, 0]);
    const bundle = createTaskBundleDraftPort({ getTarget: f.target, getSettings: () => f.settings });
    assert.throws(() => bundle.prepare(f.target(), { settings: f.changes }), /BUNDLE_SETTING_REQUIRES_SEPARATE_DRAFT/);
});

test('uncertain chat save leaves global switch untouched; global save failure reports partial completion', async () => {
    const f = fixture({ chatSave: async () => { throw Error('failed'); } }), result = await f.apply();
    assert.equal(result.status, 'outcome_unknown'); assert.equal(f.settings.storyBlueprintEnabled, false);
    assert.equal(f.metadata.gd.variables.values.global.done, false); assert.deepEqual(f.counts(), [1, 0]);
    const g = fixture({ settingsSave: async () => { throw Error('failed'); } }), second = await g.apply();
    assert.equal(second.status, 'partial'); assert.equal(g.settings.storyBlueprintEnabled, true);
    assert.deepEqual(second.blueprintToggle, { chatSave: 'confirmed', settingsSave: 'error' });
});

test('concurrent related changes while chat save waits stop global write without rollback', async () => {
    for (const mutate of [f => f.switchChat(), f => { f.metadata.gd.variables.values.global.done = true; },
        f => { f.settings.storyBlueprintAutoContinue = false; }, f => f.setBusy()]) {
        let release; const pending = new Promise(resolve => { release = resolve; });
        const f = fixture({ chatSave: () => pending }), promise = f.apply();
        mutate(f); release(); const result = await promise;
        assert.equal(result.status, 'partial'); assert.equal(result.blueprintToggle.settingsSave, 'not_started');
        assert.equal(f.settings.storyBlueprintEnabled, false); assert.deepEqual(f.counts(), [1, 0]);
    }
});

test('concurrent unrelated variable changes are retained and do not block completion', async () => {
    const f = fixture({ chatSave: async () => { f.metadata.gd.variables.values.global.other = 123; } });
    assert.equal((await f.apply()).status, 'applied_confirmed');
    assert.equal(f.metadata.gd.variables.values.global.other, 123);
});

test('no-save async boundary still checks chat identity before global write', async () => {
    const f = fixture({ enabled: true, missing: true }), result = f.apply();
    f.switchChat();
    assert.equal((await result).status, 'partial'); assert.equal(f.settings.storyBlueprintEnabled, true);
    assert.deepEqual(f.counts(), [0, 0]);
});
