import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../../settings.js';
import { fieldDefinition, dependencyFields, readSettingsFields, previewSettings } from '../../muyu/config/registry.js';
import { configurationCoverage } from '../../muyu/config/coverage.js';
import { configValue } from '../../muyu/config/presentation.js';
import { createConfigWriter } from '../../muyu/host/config-write.js';
import { createConfigActions } from '../../muyu/actions/config-apply.js';
import { createTaskBundleDraftPort } from '../../muyu/host/task-bundle-draft.js';
import { createTaskBundleWriter } from '../../muyu/host/task-bundle-write.js';
import { syncGeneralSettingsView } from '../../ui/general-settings-view.js';
import { requiredSources } from '../../muyu/application/capabilities.js';
const baseline = (settings, changes) => readSettingsFields(settings, dependencyFields(Object.keys(changes)));

test('General settings expose bounded language and debug contracts, not dormant knobs or private agent settings', () => {
    for (const field of ['lang', 'debugLogging']) {
        assert.equal(fieldDefinition(field).domain, 'general');
        assert.equal(configurationCoverage().find(r => r.key === field).status, 'supported');
        assert.ok(fieldDefinition(field).presentation.label.zh);
    }
    assert.equal(configValue('lang', 'en'), '英文');
    assert.equal(configValue('debugLogging', true), '开启');
    assert.deepEqual(requiredSources('muyu.settings.preview', { changes: { lang: 'en', debugLogging: true } }), ['source:configSettings']);
    for (const changes of [{ lang: 'fr' }, { lang: true }, { debugLogging: 'true' }, { debugLogging: 1 }, { memoryTokenBudget: 3000 }, { llmJsonSchemaHint: 'text' }, { muyuHistoryData: {} }]) {
        assert.throws(() => previewSettings({ baseline: {}, changes }));
    }
});

test('General settings preview stays read-only and exact approval saves only requested fields once', async () => {
    const settings = structuredClone(DEFAULT_SETTINGS), before = structuredClone(settings), changes = { lang: 'en', debugLogging: true };
    const observed = baseline(settings, changes), preview = previewSettings({ baseline: observed, changes });
    assert.deepEqual(settings, before); assert.ok(preview.warnings.includes('DEBUG_LOGGING_MAY_RECORD_PRIVATE_DATA'));
    assert.match(preview.notice, /下次打开/); assert.match(preview.notice, /不删除旧记录/);
    let saves = 0; const refreshed = [];
    const writer = createConfigWriter({ getSettings: () => settings, saveSettings: async () => { saves++; }, changed: fields => refreshed.push(fields) });
    const artifact = { id: 'a', revision: 1, kind: 'config-draft', sessionId: 's', content: { module: 'settings-config', baseline: observed, preview } };
    const actions = createConfigActions({ getArtifact: () => artifact, getTarget: () => ({ kind: 'global', userKey: 'u' }), validate() {}, writer });
    const action = actions.prepare('a', 1); assert.equal(saves, 0);
    const result = await actions.approve(action.id); assert.equal(result.status, 'applied_unconfirmed');
    assert.equal(saves, 1); assert.deepEqual(settings, { ...before, ...changes });
    assert.deepEqual(refreshed, [['lang', 'debugLogging']]); assert.throws(() => actions.approve(action.id), /STALE/);
});

test('General settings reject stale approval and preserve unrelated concurrent data on failed save', async () => {
    const settings = { lang: 'zh', debugLogging: false, other: 'old' }, changes = { lang: 'en' }, observed = baseline(settings, changes);
    let saves = 0;
    const writer = createConfigWriter({ getSettings: () => settings, saveSettings: async () => { saves++; settings.other = 'concurrent'; throw Error('failed'); } });
    settings.lang = 'en'; await assert.rejects(writer.apply({ baseline: observed, changes, contractVersion: 2 }), /STALE/); assert.equal(saves, 0);
    settings.lang = 'zh'; const result = await writer.apply({ baseline: observed, changes, contractVersion: 2 });
    assert.equal(result.saveError, true); assert.notEqual(result.status, 'applied_confirmed');
    assert.equal(settings.lang, 'en'); assert.equal(settings.other, 'concurrent'); assert.equal(settings.debugLogging, false);
});

test('General settings use the existing settings-only task bundle writer', async () => {
    const settings = { lang: 'zh', debugLogging: false }, target = { kind: 'chat', userKey: 'u', chatKey: 'a' }; let saves = 0;
    const port = createTaskBundleDraftPort({ getTarget: () => target, getSettings: () => settings });
    const content = port.prepare(target, { settings: { lang: 'en', debugLogging: true } });
    assert.equal(settings.lang, 'zh');
    const writer = createTaskBundleWriter({ draftPort: port, getTarget: () => target, configWriter: createConfigWriter({ getSettings: () => settings, saveSettings: async () => { saves++; return { confirmed: true }; } }) });
    await writer.apply(content); assert.equal(settings.lang, 'en'); assert.equal(settings.debugLogging, true); assert.equal(saves, 1);
});

test('General UI refresh updates controls without metadata restore or remounting the active conversation', () => {
    const mutations = [], translations = [], refreshes = [];
    const ctx = { settings: { lang: 'en', debugLogging: true }, chat_metadata: { secret: 'saved draft' },
        $c: id => ({ val: value => mutations.push([id, value]), prop: (key, value) => mutations.push([id, key, value]) }),
        muyuOwner: { refreshView: options => refreshes.push(options) } };
    syncGeneralSettingsView(ctx, ['lang', 'debugLogging'], (...args) => translations.push(args));
    assert.deepEqual(mutations, [['debug', 'checked', true], ['lang', 'en']]);
    assert.deepEqual(translations, [['en']]); assert.deepEqual(refreshes, [{ preserveActive: true }]);
    syncGeneralSettingsView(ctx, ['debugLogging'], () => assert.fail('unrelated language refresh'));
    assert.equal(refreshes.length, 1);
});
