import assert from 'node:assert/strict';
import test from 'node:test';
import { providers, registerProvider, unregisterProvider } from '../../provider-registry.js';
import { createUserProviderLoader } from '../../systems/user-provider-loader.js';

test('user provider restore cannot replace or later delete another owner provider', async () => {
    providers.clear();
    const customAgentProvider = {
        id: 'shared', placeholder: '{{shared}}',
        _gdOwner: 'group-director/custom-agent', _gdOwnerId: 'agent-1',
    };
    registerProvider(customAgentProvider);
    const extensionSettings = {
        gd: {
            userProviders: [{
                name: 'legacy-asset', source: '', ids: ['shared'], enabled: true,
            }],
        },
    };
    const moduleSource = 'export function register(deps) { deps.registerProvider({ id: "shared", placeholder: "{{shared}}" }); }';
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = () => `data:text/javascript,${encodeURIComponent(moduleSource)}`;
    URL.revokeObjectURL = () => {};

    try {
        const loader = createUserProviderLoader({
            extension_settings: extensionSettings,
            EXT_KEY: 'gd',
            saveSettings: () => {},
            log: () => {},
            getRegisteredProviderIds: () => [...providers.keys()],
            unregisterProvider,
        });
        const restored = await loader.restoreAll('provider', { registerProvider });
        assert.deepEqual(restored.loaded, []);
        assert.match(restored.failed[0].error, /already registered/);
        assert.equal(providers.get('shared'), customAgentProvider);

        assert.equal(await loader.deleteAsset('legacy-asset', 'provider'), true);
        assert.equal(providers.get('shared'), customAgentProvider);
    } finally {
        URL.createObjectURL = originalCreateObjectURL;
        URL.revokeObjectURL = originalRevokeObjectURL;
        providers.clear();
    }
});
