import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareGeneratedProfile } from '../../muyu/config/generated-profile.js';
import { createProfileWriter } from '../../muyu/host/profile-write.js';
import { createConfigProfileSystem } from '../../systems/config-profile-system.js';

test('Generated profile is a portable partial settings patch, not current settings', () => {
    const result = prepareGeneratedProfile({ name: '  Group pacing  ', description: '  Two speakers  ', changes: { mode: 'formula', topN: 2 } });
    assert.equal(result.name, 'Group pacing');
    assert.deepEqual(result.settings, { mode: 'formula', topN: 2 });
    assert.equal(result.saveOnly, true);
    assert.equal(Object.hasOwn(result.settings, 'memoryEnabled'), false);
});

test('Generated profile rejects unsafe, unknown and side-effectful fields', () => {
    for (const changes of [
        { apiKey: 'secret' }, { userProviders: [] }, { variables: {} }, { memoryMaxEntries: 10 },
        { storyBlueprintCompletionVariable: 'done' }, { storyBlueprintEnabled: true }, { 'scoreWeights.mention': 2 }, { topN: 0 }, { lang: 'en' }, { debugLogging: true },
    ]) assert.throws(() => prepareGeneratedProfile({ name: 'Unsafe', changes }));
    assert.throws(() => prepareGeneratedProfile({ name: ' ', changes: { mode: 'formula' } }), /PROFILE_NAME_REQUIRED/);
    assert.throws(() => prepareGeneratedProfile({ name: 'Empty', changes: {} }), /EMPTY_PROFILE/);
});

test('Profile writer confirms save without applying settings and rejects duplicate names', async () => {
    const settings = { mode: 'off', topN: 1, configProfiles: [] }; let saves = 0;
    const writer = createProfileWriter({ getSettings: () => settings, saveSettings: async () => { saves++; return { confirmed: true }; },
        getDrawerKeys: () => ({ directorLlm: ['topN'], profilesAndData: ['memoryEnabled'] }) });
    const content = prepareGeneratedProfile({ name: 'Pacing', changes: { mode: 'formula', topN: 2 } });
    const result = await writer.save(content);
    assert.equal(result.status, 'saved_confirmed');
    assert.equal(result.activeSettingsChanged, false);
    assert.equal(settings.mode, 'off'); assert.equal(settings.topN, 1);
    assert.deepEqual(settings.configProfiles[0].settings, { mode: 'formula', topN: 2 });
    assert.deepEqual(settings.configProfiles[0].drawers, { directorLlm: true });
    assert.equal(saves, 1);
    await assert.rejects(writer.save(content), /PROFILE_NAME_EXISTS/);
    assert.equal(saves, 1); assert.equal(settings.configProfiles.length, 1);
});

test('Uncertain profile save is not retried or rolled back over concurrent changes', async () => {
    const settings = { configProfiles: [] }; let release, saves = 0;
    const writer = createProfileWriter({ getSettings: () => settings, saveSettings: () => { saves++; return new Promise((_, reject) => { release = reject; }); }, getDrawerKeys: () => ({}) });
    const content = prepareGeneratedProfile({ name: 'Pacing', changes: { topN: 2 } });
    const pending = writer.save(content);
    await assert.rejects(writer.save(content), /WRITE_UNAVAILABLE/);
    settings.configProfiles.push({ id: 'other', name: 'Concurrent' });
    release(Error('network'));
    const result = await pending;
    assert.equal(result.status, 'outcome_unknown'); assert.equal(saves, 1);
    assert.deepEqual(settings.configProfiles.map(p => p.name), ['Pacing', 'Concurrent']);
});

test('Saved generated profile can be applied by the existing profile system', async () => {
    const settings = { mode: 'off', topN: 1, memoryEnabled: false, configProfiles: [] };
    const system = createConfigProfileSystem({ settings, EXT_KEY: 'gd', extension_settings: {}, saveSettingsDebounced: () => {}, log: () => {} });
    const writer = createProfileWriter({ getSettings: () => settings, saveSettings: async () => ({ confirmed: true }), getDrawerKeys: system.getDrawerKeys });
    const result = await writer.save(prepareGeneratedProfile({ name: 'Two speakers', changes: { mode: 'formula', topN: 2 } }));
    assert.equal(settings.mode, 'off'); assert.equal(settings.topN, 1);
    const applied = await system.applyProfile(result.profileId);
    assert.deepEqual(applied.changed, ['mode', 'topN']);
    assert.equal(settings.mode, 'formula'); assert.equal(settings.topN, 2); assert.equal(settings.memoryEnabled, false);
});
