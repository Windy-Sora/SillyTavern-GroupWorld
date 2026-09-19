import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createUserProviderLoader } from '../../systems/user-provider-loader.js';
import { CapabilityRegistry } from '../../systems/capability-registry.js';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

async function withAssetRuntime(run) {
    const OriginalFileReader = globalThis.FileReader;
    const OriginalBlob = globalThis.Blob;
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    let currentSource = '';
    const revoked = [];
    globalThis.FileReader = class {
        readAsText(file) {
            queueMicrotask(() => {
                if (file.readError) {
                    this.onerror?.();
                    return;
                }
                currentSource = file.source;
                this.result = file.source;
                this.onload?.();
            });
        }
    };
    globalThis.Blob = class {
        constructor(parts) {
            currentSource = parts.join('');
        }
    };
    URL.createObjectURL = () => `data:text/javascript,${encodeURIComponent(currentSource)}`;
    URL.revokeObjectURL = url => revoked.push(url);
    try {
        await run(revoked);
    } finally {
        globalThis.FileReader = OriginalFileReader;
        globalThis.Blob = OriginalBlob;
        URL.createObjectURL = originalCreateObjectURL;
        URL.revokeObjectURL = originalRevokeObjectURL;
    }
}

function createProviderHarness(settings, saveSettings = () => {}, loaderOptions = {}) {
    const providers = new Map();
    const deps = {
        registerProvider(provider) {
            const current = providers.get(provider.id);
            const sameOwner = current?._gdOwner
                && current._gdOwner === provider._gdOwner
                && current._gdOwnerId === provider._gdOwnerId;
            if (current && !sameOwner) throw new Error(`Provider "${provider.id}" is already registered`);
            providers.set(provider.id, provider);
            return provider;
        },
    };
    const loader = createUserProviderLoader({
        extension_settings: settings,
        EXT_KEY: 'gd',
        saveSettings,
        log: () => {},
        getRegisteredProviderIds: () => [...providers.keys()],
        getRegisteredProvider: id => providers.get(id),
        unregisterProvider(id, owner) {
            const current = providers.get(id);
            if (!current) return false;
            if (owner && (current._gdOwner !== owner.owner || current._gdOwnerId !== owner.ownerId)) return false;
            return providers.delete(id);
        },
        ...loaderOptions,
    });
    return { loader, providers, deps };
}

function createCapabilityHarness(settings, saveSettings = () => {}, loaderOptions = {}) {
    const capabilities = new Map();
    const registry = {
        register(cap) {
            const current = capabilities.get(cap.id);
            const sameOwner = current?._gdOwner
                && current._gdOwner === cap._gdOwner
                && current._gdOwnerId === cap._gdOwnerId;
            if (current && !sameOwner) throw new Error(`Capability "${cap.id}" is already registered`);
            capabilities.set(cap.id, { ...cap, enabled: cap.enabled !== false });
        },
        unregister(id, owner) {
            const current = capabilities.get(id);
            if (!current) return false;
            if (owner && (current._gdOwner !== owner.owner || current._gdOwnerId !== owner.ownerId)) return false;
            return capabilities.delete(id);
        },
        get: id => capabilities.get(id),
        list: () => [...capabilities.values()],
        setEnabled(id, enabled) {
            const cap = capabilities.get(id);
            if (cap) cap.enabled = !!enabled;
        },
    };
    const loader = createUserProviderLoader({
        extension_settings: settings,
        EXT_KEY: 'gd',
        saveSettings,
        log: () => {},
        CapabilityRegistry: registry,
        ...loaderOptions,
    });
    return { loader, registry, capabilities, deps: { CapabilityRegistry: registry } };
}

test('user asset import awaits async registration and rolls back partial provider state', async () => {
    await withAssetRuntime(async revoked => {
        const settings = { gd: { userProviders: [] } };
        const { loader, providers, deps } = createProviderHarness(settings);
        const result = await loader.importAsset({
            name: 'async-failure.js',
            source: 'export async function register(deps) { deps.registerProvider({ id: "partial", placeholder: "{{partial}}" }); await Promise.resolve(); throw new Error("register failed"); }',
        }, 'provider', deps);

        assert.equal(result.ok, false);
        assert.match(result.error, /register failed/);
        assert.deepEqual([...providers.keys()], []);
        assert.deepEqual(settings.gd.userProviders, []);
        assert.equal(revoked.length, 1);
    });
});

test('user asset import times out registration, rolls back partial state, and blocks late providers', async () => {
    await withAssetRuntime(async revoked => {
        const settings = { gd: { userProviders: [] } };
        const { loader, providers, deps } = createProviderHarness(settings, () => {}, { registrationTimeoutMs: 10 });
        const result = await loader.importAsset({
            name: 'timeout.js',
            source: `export async function register(deps) {
                deps.registerProvider({ id: "partial", placeholder: "{{partial}}" });
                await new Promise(resolve => setTimeout(resolve, 40));
                deps.registerProvider({ id: "late", placeholder: "{{late}}" });
            }`,
        }, 'provider', deps);

        assert.equal(result.ok, false);
        assert.match(result.error, /register\(\) timed out/);
        assert.deepEqual(settings.gd.userProviders, []);
        assert.deepEqual([...providers.keys()], []);
        await new Promise(resolve => setTimeout(resolve, 60));
        assert.deepEqual([...providers.keys()], []);
        assert.equal(revoked.length, 1);
    });
});

test('user capability timeout blocks late registry writes', async () => {
    await withAssetRuntime(async () => {
        const settings = { gd: { userCapabilities: [] } };
        const { loader, capabilities, deps } = createCapabilityHarness(settings, () => {}, { registrationTimeoutMs: 10 });
        const result = await loader.importAsset({
            name: 'timeout-cap.js',
            source: `export async function register(deps) {
                deps.CapabilityRegistry.register({ id: "partial.cap", executor() {} });
                await new Promise(resolve => setTimeout(resolve, 40));
                deps.CapabilityRegistry.register({ id: "late.cap", executor() {} });
            }`,
        }, 'capability', deps);

        assert.equal(result.ok, false);
        assert.match(result.error, /register\(\) timed out/);
        assert.deepEqual([...capabilities.keys()], []);
        await new Promise(resolve => setTimeout(resolve, 60));
        assert.deepEqual([...capabilities.keys()], []);
    });
});

test('failed async import persistence removes only its own state', async () => {
    await withAssetRuntime(async () => {
        const started = deferred();
        const save = deferred();
        const settings = { gd: { userProviders: [] } };
        const { loader, providers, deps } = createProviderHarness(settings, () => {
            started.resolve();
            return save.promise;
        });
        const importing = loader.importAsset({
            name: 'persist.js',
            source: 'export function register(deps) { deps.registerProvider({ id: "persist", placeholder: "{{persist}}" }); }',
        }, 'provider', deps);
        await started.promise;
        settings.gd.userProviders.push({ name: 'concurrent', source: '', ids: [], enabled: true });
        save.reject(new Error('save failed'));

        const result = await importing;
        assert.equal(result.ok, false);
        assert.deepEqual(settings.gd.userProviders.map(item => item.name), ['concurrent']);
        assert.deepEqual([...providers.keys()], []);
    });
});

test('capability partial registration and built-in collisions are owner-safe', async () => {
    await withAssetRuntime(async () => {
        const settings = { gd: { userCapabilities: [] } };
        const { loader, capabilities, deps } = createCapabilityHarness(settings);
        const partial = await loader.importAsset({
            name: 'partial-cap.js',
            source: 'export function register(deps) { deps.CapabilityRegistry.register({ id: "partial.cap", executor() {} }); throw new Error("cap failed"); }',
        }, 'capability', deps);
        assert.equal(partial.ok, false);
        assert.equal(capabilities.has('partial.cap'), false);

        const id = 'test.user-loader.collision';
        CapabilityRegistry.unregister(id);
        CapabilityRegistry.register({ id, executor: () => 'built-in' });
        try {
            const realSettings = { gd: { userCapabilities: [] } };
            const realLoader = createUserProviderLoader({
                extension_settings: realSettings,
                EXT_KEY: 'gd',
                saveSettings: () => {},
                log: () => {},
                CapabilityRegistry,
            });
            const collision = await realLoader.importAsset({
                name: 'collision.js',
                source: `export function register(deps) { deps.CapabilityRegistry.register({ id: "${id}", executor() { return "user"; } }); }`,
            }, 'capability', { CapabilityRegistry });
            assert.equal(collision.ok, false);
            assert.match(collision.error, /already registered/);
            assert.equal(CapabilityRegistry.get(id).executor(), 'built-in');
        } finally {
            CapabilityRegistry.unregister(id);
        }
    });
});

test('failed delete persistence restores the entry and keeps its runtime registration', async () => {
    const entry = { name: 'kept', source: '', ids: ['kept.id'], enabled: true };
    const settings = { gd: { userProviders: [entry] } };
    const { loader, providers, deps } = createProviderHarness(settings, () => Promise.reject(new Error('save failed')));
    deps.registerProvider({
        id: 'kept.id', placeholder: '{{kept}}',
        _gdOwner: 'group-director/user-provider', _gdOwnerId: 'kept',
    });

    await assert.rejects(loader.deleteAsset('kept', 'provider'), /save failed/);
    assert.equal(settings.gd.userProviders[0], entry);
    assert.equal(providers.has('kept.id'), true);
});

test('restore refreshes actual IDs and hot reload removes omitted managed assets', async () => {
    await withAssetRuntime(async () => {
        let saves = 0;
        const entry = {
            name: 'restored',
            source: 'export async function register(deps) { await Promise.resolve(); deps.registerProvider({ id: "restored.actual", placeholder: "{{restored.actual}}" }); }',
            ids: [], enabled: true,
        };
        const settings = { gd: { userProviders: [entry] } };
        const { loader, providers, deps } = createProviderHarness(settings, () => { saves++; });

        const restored = await loader.restoreAll('provider', deps);
        assert.deepEqual(restored, { loaded: ['restored'], failed: [] });
        assert.deepEqual(entry.ids, ['restored.actual']);
        assert.equal(saves, 1);
        assert.equal(providers.has('restored.actual'), true);

        settings.gd.userProviders = [];
        assert.deepEqual(await loader.restoreAll('provider', deps), { loaded: [], failed: [] });
        assert.equal(providers.has('restored.actual'), false);
    });
});

test('restore times out stalled module evaluation and continues with later assets', async () => {
    await withAssetRuntime(async revoked => {
        const stalled = {
            name: 'stalled',
            source: 'await new Promise(() => {}); export function register() {}',
            ids: [], enabled: true,
        };
        const healthy = {
            name: 'healthy',
            source: 'export function register(deps) { deps.registerProvider({ id: "healthy.id", placeholder: "{{healthy}}" }); }',
            ids: [], enabled: true,
        };
        const settings = { gd: { userProviders: [stalled, healthy] } };
        const { loader, providers, deps } = createProviderHarness(settings, () => {}, { registrationTimeoutMs: 10 });

        const result = await loader.restoreAll('provider', deps);

        assert.deepEqual(result.loaded, ['healthy']);
        assert.equal(result.failed.length, 1);
        assert.equal(result.failed[0].name, 'stalled');
        assert.match(result.failed[0].error, /module load timed out/);
        assert.equal(providers.has('healthy.id'), true);
        assert.equal(revoked.length, 2);
    });
});

test('restore rejects async modules safely and rolls back metadata when its save fails', async () => {
    await withAssetRuntime(async () => {
        const rejectingEntry = {
            name: 'rejecting',
            source: 'export async function register(deps) { deps.registerProvider({ id: "rejecting.id", placeholder: "{{rejecting.id}}" }); await Promise.resolve(); throw new Error("restore failed"); }',
            ids: [], enabled: true,
        };
        const first = createProviderHarness({ gd: { userProviders: [rejectingEntry] } });
        const rejected = await first.loader.restoreAll('provider', first.deps);
        assert.deepEqual(rejected.loaded, []);
        assert.match(rejected.failed[0].error, /restore failed/);
        assert.deepEqual([...first.providers.keys()], []);

        const saveEntry = {
            name: 'save-rejecting',
            source: 'export function register(deps) { deps.registerProvider({ id: "save-rejecting.id", placeholder: "{{save-rejecting.id}}" }); }',
            ids: [], enabled: true,
        };
        const second = createProviderHarness(
            { gd: { userProviders: [saveEntry] } },
            () => Promise.reject(new Error('metadata save failed')),
        );
        const saveRejected = await second.loader.restoreAll('provider', second.deps);
        assert.deepEqual(saveRejected.loaded, []);
        assert.match(saveRejected.failed[0].error, /metadata save failed/);
        assert.deepEqual(saveEntry.ids, []);
        assert.deepEqual([...second.providers.keys()], []);
    });
});

test('failed hot restore reinstates the prior same-owner provider definition', async () => {
    await withAssetRuntime(async () => {
        const entry = {
            name: 'refresh',
            source: 'export async function register(deps) { deps.registerProvider({ id: "refresh.id", placeholder: "{{new}}" }); await Promise.resolve(); throw new Error("refresh failed"); }',
            ids: ['refresh.id'], enabled: true,
        };
        const settings = { gd: { userProviders: [entry] } };
        const { loader, providers, deps } = createProviderHarness(settings);
        deps.registerProvider({
            id: 'refresh.id', placeholder: '{{old}}',
            _gdOwner: 'group-director/user-provider', _gdOwnerId: 'refresh',
        });

        const restored = await loader.restoreAll('provider', deps);

        assert.deepEqual(restored.loaded, []);
        assert.match(restored.failed[0].error, /refresh failed/);
        assert.equal(providers.get('refresh.id').placeholder, '{{old}}');
    });
});

test('capability enabled persistence rolls back on rejection and preserves unrelated edits', async () => {
    const save = deferred();
    const started = deferred();
    const entry = { name: 'toggle', source: '', ids: ['toggle.id', 'toggle.second'], enabled: true, note: 'before' };
    const settings = { gd: { userCapabilities: [entry] } };
    const { loader, registry } = createCapabilityHarness(settings, () => {
        started.resolve();
        return save.promise;
    });
    registry.register({ id: 'toggle.id', executor() {}, enabled: false });
    registry.register({ id: 'toggle.second', executor() {}, enabled: true });

    const persisting = loader.persistCapabilityEnabled();
    await started.promise;
    entry.note = 'concurrent';
    save.reject(new Error('toggle save failed'));

    await assert.rejects(persisting, /toggle save failed/);
    assert.equal(entry.enabled, true);
    assert.equal(entry.note, 'concurrent');
});

test('input, security warning, read failure, and missing register contracts are stable', async () => {
    await withAssetRuntime(async revoked => {
        const settings = { gd: {} };
        const { loader, deps } = createProviderHarness(settings);
        assert.equal((await loader.importAsset(null, 'provider', deps)).ok, false);
        assert.equal((await loader.importAsset({ name: 'x.txt' }, 'provider', deps)).ok, false);
        assert.match((await loader.importAsset({ name: 'x.js', source: '' }, 'unknown', deps)).error, /Unsupported/);
        assert.equal(await loader.deleteAsset('missing', 'provider'), false);
        assert.equal(await loader.deleteAsset('missing', 'unknown'), false);

        const readFailure = await loader.importAsset({ name: 'read.js', source: '', readError: true }, 'provider', deps);
        assert.match(readFailure.error, /Failed to read file/);

        const cancelledLoader = createUserProviderLoader({
            extension_settings: settings, EXT_KEY: 'gd', saveSettings: () => {}, log: () => {},
            confirmImport: async html => { assert.match(html, /Security warning/); return false; },
        });
        const cancelled = await cancelledLoader.importAsset({
            name: 'danger.js', source: 'export function register() { fetch("/x"); }',
        }, 'provider', deps);
        assert.match(cancelled.error, /cancelled/);

        const missing = await loader.importAsset({ name: 'missing.js', source: 'export const value = 1;' }, 'provider', deps);
        assert.match(missing.error, /must export/);
        assert.equal(revoked.length, 1);
        assert.deepEqual(loader.listAssets('provider'), []);
        assert.deepEqual(await loader.restoreAll('unknown'), {
            loaded: [], failed: [{ name: 'unknown', error: 'Unsupported user asset type: unknown' }],
        });
    });
});

test('user asset UI reports persistence failures and always releases controls', async () => {
    const source = await readFile(new URL('../../ui/sections/userProviders.js', import.meta.url), 'utf8');
    assert.match(source, /finally\s*\{\s*btn\.prop\('disabled', false\);\s*\$\(this\)\.val\(''\);/s);
    assert.match(source, /Delete failed:/);
    assert.match(source, /catch \(e\)[\s\S]*finally \{\s*btn\.prop\('disabled', false\);/);
});
