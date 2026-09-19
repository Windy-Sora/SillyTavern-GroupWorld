import assert from 'node:assert/strict';
import test from 'node:test';
import { createCustomPromptsSystem } from '../../systems/custom-prompts-system.js';

test('BUG-3: overwrite import updates the existing custom prompt in place', async () => {
    const registered = new Map();
    const settings = {
        customPromptsEnabled: true,
        customPrompts: [{ id: 'existing', name: 'scene', content: 'old', dataJson: '{"version":1}', scope: 'global', enabled: true }],
    };
    const system = createCustomPromptsSystem({
        settings,
        saveSettings: () => {},
        registerProvider: provider => registered.set(provider.id, provider),
        unregisterProvider: id => registered.delete(id),
        getProviders: () => [...registered.values()],
        log: () => {},
    });
    const result = await system.importPrompts({
        prompts: [{ name: 'scene', content: 'new', dataJson: '{"version":2}', scope: 'character', enabled: false }],
    }, true);
    assert.deepEqual(result, { added: 0, overwritten: 1, conflicts: [] });
    assert.equal(settings.customPrompts.length, 1);
    assert.deepEqual(settings.customPrompts[0], {
        id: 'existing', name: 'scene', content: 'new', dataJson: '{"version":2}', scope: 'character', enabled: false,
    });
});
