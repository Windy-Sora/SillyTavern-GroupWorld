import assert from 'node:assert/strict';
import test from 'node:test';
import { createUserProviderLoader } from '../../systems/user-provider-loader.js';

test('BUG-7/BUG-8: user capability loader uses its injected registry and unregisters deleted assets', async () => {
    const removed = [];
    const enabled = [];
    const registry = {
        list: () => [{ id: 'cap.one', enabled: false }],
        setEnabled: (id, value) => enabled.push([id, value]),
        unregister: id => removed.push(id),
    };
    const extensionSettings = { gd: { userCapabilities: [{ name: 'sample', source: '', ids: ['cap.one', 'cap.two'], enabled: false }] } };
    let saves = 0;
    const loader = createUserProviderLoader({
        extension_settings: extensionSettings,
        EXT_KEY: 'gd',
        saveSettings: () => { saves++; },
        log: () => {},
        CapabilityRegistry: registry,
    });
    await loader.restoreCapabilityEnabled();
    assert.deepEqual(enabled, [['cap.one', false], ['cap.two', false]]);
    assert.equal(await loader.deleteAsset('sample', 'capability'), true);
    assert.deepEqual(removed, ['cap.one', 'cap.two']);
    assert.equal(extensionSettings.gd.userCapabilities.length, 0);
    assert.equal(saves, 1);
});
