import assert from 'node:assert/strict';
import test from 'node:test';
import { register as registerCharMemory } from '../../assets/providers/char-memory.js';
import { createCustomPromptsSystem } from '../../systems/custom-prompts-system.js';
import { CapabilityRegistry } from '../../systems/capability-registry.js';
import { createProfileSystem } from '../../systems/profile-system.js';
import { createUserProviderLoader } from '../../systems/user-provider-loader.js';
import { getProviders, unregisterProvider } from '../../provider-registry.js';

test('BUG-1: current-character memory provider awaits asynchronous memory lookup', async t => {
    t.after(() => unregisterProvider('charMemoryCurrent'));
    t.after(() => unregisterProvider('charMemory'));
    registerCharMemory({
        getMemoriesForAll: () => ({}),
        getMemoriesForChar: async name => [{
            event: `${name} remembered`,
            mood: 'calm',
        }],
        log: () => {},
    });

    const provider = getProviders().find(item => item.id === 'charMemoryCurrent');
    const rendered = await provider.render({ character: 'Alice' });
    assert.equal(rendered.content, '- Alice remembered [calm]');
    assert.equal(rendered.data.length, 1);
});

test('BUG-3: overwrite import updates the existing custom prompt in place', () => {
    const registered = new Map();
    const settings = {
        customPromptsEnabled: true,
        customPrompts: [{
            id: 'existing',
            name: 'scene',
            content: 'old',
            dataJson: '{"version":1}',
            scope: 'global',
            enabled: true,
        }],
    };
    const system = createCustomPromptsSystem({
        settings,
        saveSettings: () => {},
        registerProvider: provider => registered.set(provider.id, provider),
        unregisterProvider: id => registered.delete(id),
        getProviders: () => [...registered.values()],
        log: () => {},
    });

    const result = system.importPrompts({
        prompts: [{
            name: 'scene',
            content: 'new',
            dataJson: '{"version":2}',
            scope: 'character',
            enabled: false,
        }],
    }, true);

    assert.deepEqual(result, { added: 0, overwritten: 1, conflicts: [] });
    assert.equal(settings.customPrompts.length, 1);
    assert.deepEqual(settings.customPrompts[0], {
        id: 'existing',
        name: 'scene',
        content: 'new',
        dataJson: '{"version":2}',
        scope: 'character',
        enabled: false,
    });
});

test('BUG-7/BUG-8: user capability loader uses its injected registry and unregisters deleted assets', async () => {
    const removed = [];
    const enabled = [];
    const registry = {
        list: () => [{ id: 'cap.one', enabled: false }],
        setEnabled: (id, value) => enabled.push([id, value]),
        unregister: id => removed.push(id),
    };
    const extensionSettings = {
        gd: {
            userCapabilities: [{
                name: 'sample',
                source: '',
                ids: ['cap.one', 'cap.two'],
                enabled: false,
            }],
        },
    };
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

test('BUG-10: failed profile generation always clears QUIET_PROMPT', async () => {
    const promptCalls = [];
    const system = createProfileSystem({
        settings: {
            profileEnabled: true,
            profileGeneratorPrompt: 'Profile {{charName}}',
            agentConfigs: { profile: {} },
        },
        EXT_KEY: 'gd',
        getChatMetadata: () => ({}),
        getChat: () => [],
        getCharacters: () => [{ avatar: 'alice.png', name: 'Alice' }],
        saveChatConditional: async () => {},
        getContext: () => ({ generateRaw: async () => '' }),
        setExtensionPrompt: (...args) => promptCalls.push(args),
        inject_ids: { QUIET_PROMPT: 'quiet' },
        extension_prompt_types: { IN_PROMPT: 0 },
        isRoundActive: () => false,
        renderPrompt: async prompt => prompt,
        createCaller: () => ({
            generate: async () => { throw new Error('model failed'); },
        }),
    });

    await assert.rejects(
        system.generateSingleProfile('alice.png'),
        /model failed/,
    );
    assert.deepEqual(promptCalls.at(-1), ['quiet', '', 0, 0, true]);
});

test('BUG-13: capability scope override survives unregister and re-registration', t => {
    const id = 'test.regression.scope-override';
    t.after(() => {
        CapabilityRegistry.unregister(id);
        delete CapabilityRegistry._scopeOverrides[id];
    });
    CapabilityRegistry._scopeOverrides[id] = 'round';

    CapabilityRegistry.register({ id, scope: 'message', executor: async () => {} });
    assert.equal(CapabilityRegistry.get(id).scope, 'round');
    CapabilityRegistry.unregister(id);
    CapabilityRegistry.register({ id, scope: 'message', executor: async () => {} });
    assert.equal(CapabilityRegistry.get(id).scope, 'round');
});
