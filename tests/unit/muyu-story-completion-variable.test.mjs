import test from 'node:test';
import assert from 'node:assert/strict';
import { createStoryCompletionVariablePort } from '../../muyu/host/story-completion-variable.js';
import { createConfigWriter } from '../../muyu/host/config-write.js';
import { dependencyFields, previewSettings, readSettingsFields } from '../../muyu/config/registry.js';
import { actionReceipt, receiptSources, validateReceipt } from '../../muyu/actions/receipts.js';
import { requiredSources } from '../../muyu/application/capabilities.js';
import { createSettingsModule } from '../../muyu/modules/settings/index.js';

function fixture({ chatSave = async () => {}, settingsSave = async () => ({ confirmed: true }) } = {}) {
    const settings = { storyBlueprintEnabled: true, storyBlueprintCompletionVariable: 'old_done', storyBlueprintCompletionVariableGuard: '' };
    const metadata = { gd: { variables: { defs: [{ id: 'old_done', type: 'boolean', scope: 'global' }],
        values: { global: { old_done: true }, character: {} }, log: [] } } };
    let current = metadata, target = { kind: 'chat', userKey: 'test', chatKey: 'a' };
    let chatSaves = 0, settingsSaves = 0;
    const port = createStoryCompletionVariablePort({ getTarget: () => target, getMetadata: () => current, getSettings: () => settings,
        extensionKey: 'gd', saveChatConfirmed: async value => { chatSaves++; await chatSave(value); } });
    const writer = createConfigWriter({ getSettings: () => settings, saveSettings: async () => { settingsSaves++; return settingsSave(); },
        isBusy: () => false, completionVariablePort: port });
    const changes = { storyBlueprintCompletionVariable: 'new_done' };
    const baseline = readSettingsFields(settings, dependencyFields(Object.keys(changes)));
    return { settings, metadata, port, writer, changes, baseline, target: () => target,
        switchChat: () => { current = {}; target = { kind: 'chat', userKey: 'test', chatKey: 'b' }; },
        chatSaves: () => chatSaves, settingsSaves: () => settingsSaves };
}

test('completion-variable preview is bounded and requires variable-read authorization', () => {
    const f = fixture();
    const preview = previewSettings({ baseline: f.baseline, changes: f.changes });
    assert.deepEqual(preview.manifest.settings, f.changes);
    assert.ok(preview.warnings.includes('STORY_COMPLETION_VARIABLE_REQUIRES_CHAT_CREATION'));
    for (const value of ['Bad Name', 'abc-', 'ABC', '', '__proto__', 'constructor', 'x'.repeat(65)]) {
        assert.throws(() => previewSettings({ baseline: f.baseline, changes: { storyBlueprintCompletionVariable: value } }));
    }
    assert.deepEqual(requiredSources('muyu.settings.preview', { changes: f.changes }), ['source:configSettings', 'source:variables']);
    const module = createSettingsModule({ getSettings: () => f.settings, getTarget: f.target, completionVariablePort: f.port });
    module.bindRun({ id: 'run', taskId: 'task', target: f.target() });
    const result = module.handlers['muyu.settings.preview']({ changes: f.changes },
        { runId: 'run', target: f.target(), signal: new AbortController().signal });
    assert.deepEqual(JSON.parse(result.text).impact, { scope: 'current-chat', newVariableId: 'new_done', initialValue: false, oldVariable: 'retained' });
    module.forgetRun('run');
});

test('approved completion-variable write saves new false variable before global name and retains old true value', async () => {
    const f = fixture();
    const plan = f.port.plan(f.target(), 'old_done', 'new_done');
    const result = await f.writer.apply({ baseline: f.baseline, changes: f.changes, contractVersion: 2, completionVariablePlan: plan });
    assert.equal(result.status, 'applied_confirmed');
    assert.deepEqual(result.completionVariable, { chatSave: 'confirmed', settingsSave: 'confirmed' });
    assert.equal(f.metadata.gd.variables.values.global.old_done, true);
    assert.equal(f.metadata.gd.variables.values.global.new_done, false);
    assert.equal(f.metadata.gd.variables.defs.at(-1).owner, 'group-director-story-blueprint');
    assert.equal(f.settings.storyBlueprintCompletionVariable, 'new_done');
    assert.equal(f.settings.storyBlueprintCompletionVariableGuard, 'new_done');
    assert.equal(f.chatSaves(), 1); assert.equal(f.settingsSaves(), 1);
    assert.throws(() => f.port.assertFresh(plan), /STALE_COMPLETION_PREVIEW/);
    assert.throws(() => f.port.plan(f.target(), 'new_done', 'old_done'), /COMPLETION_VARIABLE_OCCUPIED/);
    const receipt = actionReceipt({ id: 'apply:1', artifactId: 'a', revision: 1, status: result.status, result,
        content: { preview: { contractVersion: 2, diff: [{ field: 'storyBlueprintCompletionVariable', before: '"old_done"', after: '"new_done"' }] }, completionVariablePlan: plan } });
    assert.deepEqual(validateReceipt(receipt), receipt);
    assert.deepEqual(receiptSources(receipt), ['source:configSettings', 'source:variables']);
});

test('occupied name and chat switch reject the write before any mutation', async () => {
    const occupied = fixture();
    occupied.metadata.gd.variables.values.global.new_done = false;
    assert.throws(() => occupied.port.plan(occupied.target(), 'old_done', 'new_done'), /COMPLETION_VARIABLE_OCCUPIED/);
    delete occupied.metadata.gd.variables.values.global.new_done;
    occupied.metadata.gd.variables.defs.push({ id: 'New Done', type: 'boolean', scope: 'global' });
    assert.throws(() => occupied.port.plan(occupied.target(), 'old_done', 'new_done'), /COMPLETION_VARIABLE_OCCUPIED/);
    const switched = fixture();
    const plan = switched.port.plan(switched.target(), 'old_done', 'new_done');
    switched.switchChat();
    await assert.rejects(switched.writer.apply({ baseline: switched.baseline, changes: switched.changes, contractVersion: 2,
        completionVariablePlan: plan }), /TARGET_UNAVAILABLE/);
    assert.equal(switched.chatSaves(), 0); assert.equal(switched.settingsSaves(), 0);
});

test('chat save uncertainty does not change the global name; settings save failure reports partial completion', async () => {
    const chatFailed = fixture({ chatSave: async () => { throw Error('chat save failed'); } });
    const first = await chatFailed.writer.apply({ baseline: chatFailed.baseline, changes: chatFailed.changes, contractVersion: 2,
        completionVariablePlan: chatFailed.port.plan(chatFailed.target(), 'old_done', 'new_done') });
    assert.equal(first.status, 'outcome_unknown');
    assert.equal(first.completionVariable.settingsSave, 'not_started');
    assert.equal(chatFailed.settings.storyBlueprintCompletionVariable, 'old_done');
    assert.equal(chatFailed.settingsSaves(), 0);

    const settingsFailed = fixture({ settingsSave: async () => { throw Error('settings save failed'); } });
    const second = await settingsFailed.writer.apply({ baseline: settingsFailed.baseline, changes: settingsFailed.changes, contractVersion: 2,
        completionVariablePlan: settingsFailed.port.plan(settingsFailed.target(), 'old_done', 'new_done') });
    assert.equal(second.status, 'partial');
    assert.deepEqual(second.completionVariable, { chatSave: 'confirmed', settingsSave: 'error' });
    assert.equal(settingsFailed.metadata.gd.variables.values.global.new_done, false);
});

test('switching chats while the variable save waits never writes the global name', async () => {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const f = fixture({ chatSave: () => pending });
    const operation = f.writer.apply({ baseline: f.baseline, changes: f.changes, contractVersion: 2,
        completionVariablePlan: f.port.plan(f.target(), 'old_done', 'new_done') });
    await Promise.resolve();
    f.switchChat();
    release();
    const result = await operation;
    assert.equal(result.status, 'outcome_unknown');
    assert.equal(result.completionVariable.settingsSave, 'not_started');
    assert.equal(f.settings.storyBlueprintCompletionVariable, 'old_done');
    assert.equal(f.settingsSaves(), 0);
});
