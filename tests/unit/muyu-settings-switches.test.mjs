import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../../settings.js';
import { createCustomPromptsSystem } from '../../systems/custom-prompts-system.js';
import { createProfileLibrarySystem } from '../../systems/profile-library-system.js';
import { createSettingsSwitchPort } from '../../muyu/host/settings-switches.js';
import { createConfigWriter } from '../../muyu/host/config-write.js';
import { dependencyFields, readSettingsFields, previewSettings, configFields } from '../../muyu/config/registry.js';
import { settingsSwitchFields } from '../../muyu/config/settings-switch-rules.js';
import { configPresentation } from '../../muyu/config/presentation.js';
import { requiredSources } from '../../muyu/application/capabilities.js';
import { prepareGeneratedProfile } from '../../muyu/config/generated-profile.js';
import { createTaskBundleDraftPort } from '../../muyu/host/task-bundle-draft.js';

function fixture(save = async () => {}) {
    const settings = structuredClone(DEFAULT_SETTINGS); settings.customPromptsEnabled = false;
    settings.customPrompts = [{ id: 'one', name: 'my_note', enabled: true, content: 'Private {{char}}', dataJson: '{"x":1}' }];
    const providers = new Map(); let saved = 0, ordinarySaves = 0, applied = 0, busy = false;
    const saveSettings = async () => { saved++; await save(); };
    const prompts = createCustomPromptsSystem({ settings, saveSettings, registerProvider: row => providers.set(row.id, row),
        unregisterProvider: id => providers.delete(id), getProviders: () => [...providers.values()], log() {} });
    const profiles = createProfileLibrarySystem({ settings, extension_settings: {}, EXT_KEY: 'gd', saveSettings,
        getCurrentGroup: () => null, getProfiles: () => ({}), getCharacters: () => [], applyImport: () => { applied++; } });
    const port = createSettingsSwitchPort({ customPromptsSystem: prompts, profileLibrarySystem: profiles });
    const writer = createConfigWriter({ getSettings: () => settings, saveSettings: async () => { ordinarySaves++; },
        isBusy: () => busy, settingsSwitchPort: port });
    const request = changes => ({ baseline: readSettingsFields(settings, dependencyFields(Object.keys(changes))), changes, contractVersion: 2 });
    return { settings, prompts, profiles, providers, writer, request, setBusy: () => { busy = true; }, counts: () => ({ saved, ordinarySaves, applied }) };
}

test('settings switches have closed boolean schemas, readable labels and config-only read permissions', () => {
    const f = fixture();
    for (const field of settingsSwitchFields) {
        assert.ok(configFields.includes(field));
        assert.ok(configPresentation(field).label.zh); assert.ok(configPresentation(field).label.en);
        assert.deepEqual(requiredSources('muyu.settings.preview', { changes: { [field]: true } }), ['source:configSettings']);
        assert.throws(() => previewSettings(f.request({ [field]: 'true' })));
    }
    for (const field of ['profileLibraryAutoLoad.mode', 'profileLibraryAutoLoad.fixedId', 'profileLibraryAutoLoad.matchNameOnly']) {
        assert.ok(!configFields.includes(field));
        assert.throws(() => previewSettings(f.request({ [field]: true })));
    }
});

test('auto-load preview includes current dangerous policies without reading package content or mutating', () => {
    const f = fixture();
    Object.assign(f.settings.profileLibraryAutoLoad, { overwriteExisting: true, importTemplate: true });
    const before = structuredClone(f.settings), preview = previewSettings(f.request({ 'profileLibraryAutoLoad.enabled': true }));
    assert.ok(preview.warnings.includes('PROFILE_LIBRARY_MAY_OVERWRITE_EXISTING'));
    assert.ok(preview.warnings.includes('PROFILE_LIBRARY_MAY_IMPORT_GLOBAL_TEMPLATES'));
    assert.match(preview.notice, /覆盖已有档案：开/); assert.match(preview.notice, /导入模板设置：开/);
    assert.deepEqual(f.settings, before); assert.deepEqual(f.counts(), { saved: 0, ordinarySaves: 0, applied: 0 });
});

test('auto-load settings save via real business queue without importing, calling models or changing sibling policy', async () => {
    const f = fixture(), before = structuredClone(f.settings.profileLibraryAutoLoad);
    const result = await f.writer.apply(f.request({ 'profileLibraryAutoLoad.enabled': true, 'profileLibraryAutoLoad.importTemplate': true }));
    assert.equal(result.status, 'applied_unconfirmed'); assert.equal(result.changed, false);
    assert.deepEqual(f.settings.profileLibraryAutoLoad, { ...before, enabled: true, importTemplate: true });
    assert.deepEqual(f.counts(), { saved: 1, ordinarySaves: 0, applied: 0 });
});

test('custom Prompt switch registers and unregisters owned Providers, preserves source and never renders', async () => {
    const f = fixture(), before = structuredClone(f.settings.customPrompts);
    const enable = await f.writer.apply(f.request({ customPromptsEnabled: true }));
    assert.equal(enable.status, 'applied_unconfirmed'); assert.equal(enable.changed, false);
    assert.ok(f.providers.has('my_note')); assert.deepEqual(f.settings.customPrompts, before);
    f.providers.set('other', { id: 'other', render: () => { throw Error('must not run'); } });
    await f.writer.apply(f.request({ customPromptsEnabled: false }));
    assert.ok(!f.providers.has('my_note')); assert.ok(f.providers.has('other'));
    assert.deepEqual(f.counts(), { saved: 2, ordinarySaves: 0, applied: 0 });
});

test('business save rejection reports unknown outcome and preserves original narrow rollback', async () => {
    for (const changes of [{ customPromptsEnabled: true }, { 'profileLibraryAutoLoad.enabled': true }]) {
        const f = fixture(async () => { throw Error('failed'); }), before = structuredClone(f.settings);
        const result = await f.writer.apply(f.request(changes));
        assert.equal(result.status, 'outcome_unknown'); assert.equal(result.saveError, true);
        assert.equal(f.settings.customPromptsEnabled, before.customPromptsEnabled);
        assert.deepEqual(f.settings.profileLibraryAutoLoad, before.profileLibraryAutoLoad);
        assert.equal(f.providers.size, 0); assert.equal(f.counts().ordinarySaves, 0);
    }
});

test('failed settings save retains concurrent unrelated settings and auto-load option edits', async () => {
    const f = fixture(async () => { f.settings.lang = 'en'; f.settings.profileLibraryAutoLoad.overwriteExisting = true; throw Error('failed'); });
    await f.writer.apply(f.request({ 'profileLibraryAutoLoad.enabled': true }));
    assert.equal(f.settings.profileLibraryAutoLoad.enabled, false);
    assert.equal(f.settings.profileLibraryAutoLoad.overwriteExisting, true); assert.equal(f.settings.lang, 'en');
});

test('queued stale baseline and generation starts are checked before business mutation', async () => {
    for (const changes of [{ customPromptsEnabled: true }, { 'profileLibraryAutoLoad.enabled': true }]) {
        for (const type of ['baseline', 'busy']) {
            const f = fixture(), operation = f.writer.apply(f.request(changes));
            if (type === 'busy') f.setBusy();
            else if (changes.customPromptsEnabled) f.settings.customPromptsEnabled = true;
            else f.settings.profileLibraryAutoLoad.overwriteExisting = true;
            await assert.rejects(operation, /STALE_BASELINE|WRITE_UNAVAILABLE/);
            assert.equal(f.counts().saved, 0); assert.equal(f.providers.size, 0);
        }
    }
});

test('incomplete legacy auto-load baseline is rejected, not silently default-filled', () => {
    const f = fixture(); delete f.settings.profileLibraryAutoLoad.matchHash;
    assert.throws(() => previewSettings(f.request({ 'profileLibraryAutoLoad.enabled': true })), /UNSUPPORTED_BASELINE/);
    assert.ok(!Object.hasOwn(f.settings.profileLibraryAutoLoad, 'matchHash'));
});

test('settings-only writer cannot bypass business port; mixed drafts, bundles and reusable profiles are rejected', async () => {
    const f = fixture();
    const generic = createConfigWriter({ getSettings: () => f.settings, saveSettings: async () => {}, isBusy: () => false });
    await assert.rejects(generic.apply(f.request({ customPromptsEnabled: true })), /WRITE_UNAVAILABLE/);
    for (const field of settingsSwitchFields) {
        assert.throws(() => previewSettings(f.request({ [field]: true, lang: 'en' })), /REQUIRES_SEPARATE_DRAFT/);
        assert.throws(() => prepareGeneratedProfile({ name: 'x', changes: { [field]: true } }));
        const target = { kind: 'chat', userKey: 'test', chatKey: 'a' };
        const bundle = createTaskBundleDraftPort({ getTarget: () => target, getSettings: () => f.settings });
        assert.throws(() => bundle.prepare(target, { settings: { [field]: true } }), /REQUIRES_SEPARATE_DRAFT/);
    }
});

test('active auto-load prevents queued policy mutation', async () => {
    let writes = 0;
    const port = createSettingsSwitchPort({ profileLibrarySystem: { isAutoLoading: () => true,
        updateAutoLoadSettings: async (_, { beforeApply }) => { beforeApply(); writes++; } } });
    await assert.rejects(port.apply({ 'profileLibraryAutoLoad.enabled': true }, () => {}), /WRITE_UNAVAILABLE/);
    assert.equal(writes, 0);
});

test('business systems bound to a replaced settings object cannot spend the current settings approval', async () => {
    const f = fixture(), replacement = structuredClone(f.settings);
    const writer = createConfigWriter({ getSettings: () => replacement, saveSettings: async () => {}, isBusy: () => false,
        settingsSwitchPort: createSettingsSwitchPort({ customPromptsSystem: f.prompts, profileLibrarySystem: f.profiles }) });
    for (const changes of [{ customPromptsEnabled: true }, { 'profileLibraryAutoLoad.enabled': true }]) {
        await assert.rejects(writer.apply(f.request(changes)), /STALE_BASELINE/);
    }
    assert.equal(f.counts().saved, 0); assert.equal(f.providers.size, 0);
});
