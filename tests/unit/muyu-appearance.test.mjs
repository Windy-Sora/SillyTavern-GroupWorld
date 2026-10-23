import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDisplayConfig, DISPLAY_THEMES } from '../../muyu/preferences/contract.js';
import { createDisplayConfigStore } from '../../muyu/host/display-config.js';

test('Appearance accepts only closed themes and preserves legacy display settings', () => {
    assert.deepEqual(validateDisplayConfig({ processDetail: 'compact' }), { processDetail: 'compact' });
    for (const theme of DISPLAY_THEMES) assert.deepEqual(validateDisplayConfig({ processDetail: 'verbose', theme }), { processDetail: 'verbose', theme });
    for (const theme of ['invalid', null, {}, '<style>']) assert.throws(() => validateDisplayConfig({ processDetail: 'compact', theme }), /DISPLAY_CONFIG_INVALID/);
    assert.throws(() => validateDisplayConfig({ processDetail: 'compact', permissions: true }), /DISPLAY_CONFIG_INVALID/);
});

test('Appearance persists with display preferences; failed save retains previous configuration', async () => {
    const settings = { muyuDisplayConfig: { processDetail: 'detailed' }, muyuDisplayConfigVersion: 1 };
    let fail = false;
    const store = createDisplayConfigStore({ getSettings: () => settings, saveSettings: async () => { if (fail) throw Error('offline'); } });
    await store.save({ processDetail: 'detailed', theme: 'light' });
    assert.deepEqual(store.read(), { processDetail: 'detailed', theme: 'light' });
    fail = true;
    await assert.rejects(store.save({ processDetail: 'compact', theme: 'dusk' }), /DISPLAY_CONFIG_SAVE_FAILED/);
    assert.deepEqual(store.read(), { processDetail: 'detailed', theme: 'light' });
});
