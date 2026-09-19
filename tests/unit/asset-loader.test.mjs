import test from 'node:test';
import assert from 'node:assert/strict';

import { AssetLoader } from '../../systems/asset-loader.js';

test('AssetLoader registers valid modules and isolates missing exports and imports', async () => {
    const originalWarn = console.warn;
    const originalError = console.error;
    const warnings = [];
    const errors = [];
    console.warn = (...args) => warnings.push(args);
    console.error = (...args) => errors.push(args);
    try {
        const deps = { registered: [], marker: 'called' };
        const result = await AssetLoader._loadAll({
            basePath: '../tests/fixtures',
            modules: ['asset-loader-register', 'asset-loader-no-register', 'asset-loader-missing'],
        }, deps);
        assert.deepEqual(result, {
            loaded: ['asset-loader-register'],
            failed: ['asset-loader-no-register', 'asset-loader-missing'],
        });
        assert.deepEqual(deps.registered, ['called']);
        assert.equal(warnings.length, 1);
        assert.equal(errors.length, 1);
    } finally {
        console.warn = originalWarn;
        console.error = originalError;
    }
});

test('AssetLoader provider and capability wrappers report aggregate results', async () => {
    const originalLog = console.log;
    const logs = [];
    console.log = message => logs.push(message);
    try {
        const deps = { registered: [], marker: 'wrapper' };
        const providers = await AssetLoader.providers({ basePath: '../tests/fixtures', modules: ['asset-loader-register'] }, deps);
        const capabilities = await AssetLoader.capabilities({ basePath: '../tests/fixtures', modules: ['asset-loader-register'] }, deps);
        assert.deepEqual(providers, { loaded: ['asset-loader-register'], failed: [] });
        assert.deepEqual(capabilities, { loaded: ['asset-loader-register'], failed: [] });
        assert.deepEqual(deps.registered, ['wrapper', 'wrapper']);
        assert.match(logs[0], /providers: 1 loaded/);
        assert.match(logs[1], /capabilities: 1 loaded/);
    } finally { console.log = originalLog; }
});
