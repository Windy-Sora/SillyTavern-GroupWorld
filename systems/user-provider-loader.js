/**
 * User Asset Loader — imports, persists, and auto-loads user-added modules.
 *
 * Supports both 'provider' and 'capability' asset types.
 *
 * Flow:
 *   1. User selects a .js file via GUI
 *   2. Source stored in extension_settings[EXT_KEY].userProviders / userCapabilities
 *   3. Source → Blob URL → dynamic import() → register(deps)
 *   4. On startup, all stored assets are restored and registered
 *
 * Zero server-side dependencies. Fully self-contained.
 */

const DANGEROUS_PATTERNS = [
    { pattern: /\bfetch\s*\(/g,               label: 'fetch() — network exfiltration' },
    { pattern: /\bXMLHttpRequest\b/g,         label: 'XMLHttpRequest — network exfiltration' },
    { pattern: /\bnavigator\.sendBeacon\b/g, label: 'navigator.sendBeacon() — unmonitored POST' },
    { pattern: /document\.cookie\b/g,        label: 'document.cookie — credential theft' },
    { pattern: /\blocalStorage\b\.\s*getItem|\blocalStorage\b\[/g, label: 'localStorage read — data theft' },
    { pattern: /\bsessionStorage\b/g,         label: 'sessionStorage — data theft' },
    { pattern: /\beval\s*\(/g,               label: 'eval() — arbitrary code execution' },
    { pattern: /\bnew\s+Function\s*\(/g,     label: 'new Function() — arbitrary code execution' },
    { pattern: /document\.write\s*\(/g,     label: 'document.write() — DOM injection' },
    { pattern: /\bwindow\.top\b|\bwindow\.parent\b/g, label: 'window.top/parent — frame manipulation' },
];

const USER_PROVIDER_OWNER = 'group-director/user-provider';
const USER_CAPABILITY_OWNER = 'group-director/user-capability';
const DEFAULT_REGISTRATION_TIMEOUT_MS = 10000;

function scanSource(source) {
    const found = [];
    for (const { pattern, label } of DANGEROUS_PATTERNS) {
        pattern.lastIndex = 0;
        const matches = source.match(pattern);
        if (matches) found.push({ label, count: matches.length });
    }
    return found;
}

export function createUserProviderLoader({ extension_settings, EXT_KEY, saveSettings, log, getRegisteredProviderIds, getRegisteredProvider, unregisterProvider, CapabilityRegistry, confirmImport, registrationTimeoutMs = DEFAULT_REGISTRATION_TIMEOUT_MS }) {
    const STORE_KEYS = { provider: 'userProviders', capability: 'userCapabilities' };
    const managedIds = { provider: new Map(), capability: new Map() };
    const managedInitialized = { provider: false, capability: false };
    const timeoutMs = Number.isFinite(registrationTimeoutMs) && registrationTimeoutMs > 0
        ? registrationTimeoutMs
        : DEFAULT_REGISTRATION_TIMEOUT_MS;

    async function withTimeout(promise, label, onTimeout = () => {}) {
        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => {
                onTimeout();
                const error = new Error(`${label} timed out after ${timeoutMs}ms`);
                error.name = 'TimeoutError';
                reject(error);
            }, timeoutMs);
        });
        try {
            return await Promise.race([promise, timeout]);
        } finally {
            clearTimeout(timer);
        }
    }

    function getStore(type) {
        const key = STORE_KEYS[type];
        if (!key) throw new Error(`Unsupported user asset type: ${type}`);
        if (!extension_settings[EXT_KEY]) extension_settings[EXT_KEY] = {};
        if (!extension_settings[EXT_KEY][key]) extension_settings[EXT_KEY][key] = [];
        return extension_settings[EXT_KEY][key];
    }

    async function saveStore() {
        if (typeof saveSettings === 'function') await saveSettings();
    }

    function getAssetDeps(type, name, deps, registeredIds, previousEntries, lifecycle) {
        const assertActive = () => {
            if (!lifecycle.active) throw new Error(`User ${type} "${name}" registration is no longer active`);
        };
        if (type === 'provider' && typeof deps.registerProvider === 'function') {
            return {
                ...deps,
                registerProvider: provider => {
                    assertActive();
                    if (provider?.id && !previousEntries.has(provider.id)) {
                        previousEntries.set(provider.id, getRegisteredProvider?.(provider.id));
                    }
                    const result = deps.registerProvider({
                        ...provider,
                        _gdOwner: USER_PROVIDER_OWNER,
                        _gdOwnerId: name,
                    });
                    if (provider?.id) registeredIds.add(provider.id);
                    return result;
                },
            };
        }
        if (type === 'capability') {
            const registry = deps.CapabilityRegistry || CapabilityRegistry;
            if (!registry) return deps;
            const ownedRegistry = Object.create(registry);
            ownedRegistry.register = cap => {
                assertActive();
                if (cap?.id && !previousEntries.has(cap.id)) {
                    previousEntries.set(cap.id, registry.get?.(cap.id));
                }
                const result = registry.register({
                    ...cap,
                    _gdOwner: USER_CAPABILITY_OWNER,
                    _gdOwnerId: name,
                });
                if (cap?.id) registeredIds.add(cap.id);
                return result;
            };
            return { ...deps, CapabilityRegistry: ownedRegistry };
        }
        return deps;
    }

    function unregisterOwned(type, id, name) {
        if (type === 'provider') {
            return unregisterProvider?.(id, { owner: USER_PROVIDER_OWNER, ownerId: name }) ?? false;
        }
        return CapabilityRegistry?.unregister(id, { owner: USER_CAPABILITY_OWNER, ownerId: name }) ?? false;
    }

    function isOwnedBy(type, entry, name) {
        const owner = type === 'provider' ? USER_PROVIDER_OWNER : USER_CAPABILITY_OWNER;
        return entry?._gdOwner === owner && entry._gdOwnerId === name;
    }

    function getRegistryEntry(type, id, deps = {}) {
        if (type === 'provider') return getRegisteredProvider?.(id);
        return (deps.CapabilityRegistry || CapabilityRegistry)?.get?.(id);
    }

    function rollbackRegistered(type, ids, name, previousEntries, deps = {}) {
        for (const id of ids) {
            const current = getRegistryEntry(type, id, deps);
            if (current && !isOwnedBy(type, current, name)) continue;
            const previous = previousEntries.get(id);
            unregisterOwned(type, id, name);
            if (previous) {
                if (type === 'provider') deps.registerProvider?.(previous);
                else (deps.CapabilityRegistry || CapabilityRegistry)?.register(previous);
            }
        }
    }

    function getRegistryIds(type, deps = {}) {
        if (type === 'provider') return getRegisteredProviderIds?.() ?? [];
        const registry = deps.CapabilityRegistry || CapabilityRegistry;
        return registry?.list().map(c => c.id) ?? [];
    }

    function ensureManagedIds(type) {
        if (managedInitialized[type]) return;
        for (const entry of getStore(type)) {
            managedIds[type].set(entry.name, new Set(entry.ids || []));
        }
        managedInitialized[type] = true;
    }

    /**
     * Persist the enabled/disabled state of all user-imported capabilities.
     * Called whenever a capability toggle changes.
     */
    async function persistCapabilityEnabled() {
        if (!CapabilityRegistry) return;
        const store = getStore('capability');
        const allCaps = CapabilityRegistry.list();
        const previousByEntry = new Map();
        for (const entry of store) {
            for (const id of (entry.ids || [])) {
                const cap = allCaps.find(c => c.id === id);
                if (cap && entry.enabled !== cap.enabled) {
                    const next = cap.enabled !== false;
                    if (!previousByEntry.has(entry)) previousByEntry.set(entry, entry.enabled);
                    entry.enabled = next;
                }
            }
        }
        const changes = [...previousByEntry].map(([entry, previous]) => ({ entry, previous, next: entry.enabled }));
        if (changes.length) {
            try {
                await saveStore();
            } catch (e) {
                for (const { entry, previous, next } of changes) {
                    if (entry.enabled === next) entry.enabled = previous;
                }
                throw e;
            }
        }
    }

    /**
     * Restore persisted enabled state for capabilities after re-import.
     */
    async function restoreCapabilityEnabled() {
        if (!CapabilityRegistry) return;
        const store = getStore('capability');
        for (const entry of store) {
            const enabled = entry.enabled !== false; // default true
            for (const id of (entry.ids || [])) {
                try { CapabilityRegistry.setEnabled(id, enabled); } catch (_) {}
            }
        }
    }

    /**
     * Import a user-selected .js file as a provider or capability.
     */
    async function importAsset(file, type, deps = {}) {
        if (!STORE_KEYS[type]) {
            return { ok: false, name: file?.name || 'unknown', error: `Unsupported user asset type: ${type}` };
        }
        if (!file || !file.name.endsWith('.js')) {
            return { ok: false, name: file?.name || 'unknown', error: 'Only .js files are supported' };
        }

        const name = file.name.replace(/\.js$/, '');
        const store = getStore(type);
        if (store.some(p => p.name === name)) {
            return { ok: false, name, error: `"${name}" already exists. Delete it first to re-import.` };
        }

        let blobUrl = '';
        const registeredIds = new Set();
        const previousEntries = new Map();
        let insertedEntry = null;
        try {
            const source = await readFileAsText(file);

            const findings = scanSource(source);
            if (findings.length > 0) {
                const lines = findings.map(f => `  - ${f.label} (${f.count}x)`).join('\n');
                const warningHtml =
                    `<b>Security warning</b><br>Dangerous APIs detected:<br><br>${lines.replace(/\n/g, '<br>')}<br><br>` +
                    `This code could: steal chat logs, exfiltrate API keys, or hijack the page.<br>` +
                    `Only import from trusted sources.`;
                const userConfirmed = typeof confirmImport === 'function'
                    ? await confirmImport(warningHtml)
                    : false;
                if (!userConfirmed) {
                    return { ok: false, name, error: 'Import cancelled by user (security warning)' };
                }
                log(`User ${type} "${name}": user confirmed import despite security warning: ${findings.map(f => f.label).join(', ')}`);
            }

            blobUrl = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));
            const mod = await withTimeout(import(blobUrl), `User ${type} "${name}" module load`);

            if (typeof mod.register !== 'function') {
                return { ok: false, name, error: 'Module must export function register(deps)' };
            }

            // Snapshot → register → diff to find added IDs
            const lifecycle = { active: true };
            try {
                await withTimeout(
                    Promise.resolve().then(() => mod.register(getAssetDeps(type, name, deps, registeredIds, previousEntries, lifecycle))),
                    `User ${type} "${name}" register()`,
                    () => { lifecycle.active = false; },
                );
            } finally {
                lifecycle.active = false;
            }
            const liveIds = new Set(getRegistryIds(type, deps));
            const addedIds = [...registeredIds].filter(id => liveIds.has(id));
            log(`User ${type} import diff: added=[${addedIds.join(',')}]`);

            // Persist with enabled state
            insertedEntry = { name, source, importedAt: Date.now(), ids: addedIds, enabled: true };
            store.push(insertedEntry);
            await saveStore();
            ensureManagedIds(type);
            managedIds[type].set(name, new Set(addedIds));

            log(`User ${type} "${name}" imported and registered`);
            return { ok: true, name };
        } catch (e) {
            if (insertedEntry) {
                const insertedIndex = store.indexOf(insertedEntry);
                if (insertedIndex !== -1) store.splice(insertedIndex, 1);
            }
            rollbackRegistered(type, registeredIds, name, previousEntries, deps);
            log(`User ${type} "${name}" import failed:`, e.message);
            return { ok: false, name, error: e.message };
        } finally {
            if (blobUrl) URL.revokeObjectURL(blobUrl);
        }
    }

    /**
     * Delete a user-imported asset.
     */
    async function deleteAsset(name, type) {
        if (!STORE_KEYS[type]) return false;
        const store = getStore(type);
        const idx = store.findIndex(p => p.name === name);
        if (idx === -1) return false;
        const entry = store[idx];
        store.splice(idx, 1);
        try {
            await saveStore();
        } catch (e) {
            if (!store.some(item => item.name === name)) store.splice(Math.min(idx, store.length), 0, entry);
            throw e;
        }
        for (const id of (entry.ids || [])) unregisterOwned(type, id, name);
        ensureManagedIds(type);
        managedIds[type].delete(name);
        log(`User ${type} "${name}" deleted and unregistered`);
        return true;
    }

    function listAssets(type) {
        return getStore(type).map(p => ({ name: p.name, importedAt: p.importedAt, ids: p.ids || [], enabled: p.enabled !== false }));
    }

    /**
     * Restore all persisted assets of a given type on startup.
     */
    async function restoreAll(type, deps = {}) {
        if (!STORE_KEYS[type]) return { loaded: [], failed: [{ name: String(type), error: `Unsupported user asset type: ${type}` }] };
        const store = getStore(type);
        const loaded = [], failed = [];
        ensureManagedIds(type);
        const previousManaged = new Map([...managedIds[type]].map(([name, ids]) => [name, new Set(ids)]));
        const restoredIds = new Map();
        const metadataBefore = new Map();
        const newlyAdded = [];

        for (const p of store) {
            let blobUrl = '';
            const registeredIds = new Set();
            const previousEntries = new Map();
            try {
                const findings = scanSource(p.source);
                if (findings.length > 0) {
                    log(`Security: persisted ${type} "${p.name}" contains: ${findings.map(f => f.label).join(', ')}`);
                }
                blobUrl = URL.createObjectURL(new Blob([p.source], { type: 'application/javascript' }));
                const mod = await withTimeout(import(blobUrl), `User ${type} "${p.name}" module load`);
                if (typeof mod.register === 'function') {
                    const lifecycle = { active: true };
                    try {
                        await withTimeout(
                            Promise.resolve().then(() => mod.register(getAssetDeps(type, p.name, deps, registeredIds, previousEntries, lifecycle))),
                            `User ${type} "${p.name}" register()`,
                            () => { lifecycle.active = false; },
                        );
                    } finally {
                        lifecycle.active = false;
                    }
                    const liveIds = new Set(getRegistryIds(type, deps));
                    const actualIds = [...registeredIds].filter(id => liveIds.has(id));
                    metadataBefore.set(p, p.ids || []);
                    p.ids = actualIds;
                    restoredIds.set(p.name, new Set(actualIds));
                    newlyAdded.push({ name: p.name, ids: new Set(actualIds), previousEntries, deps });
                    loaded.push(p.name);
                } else {
                    failed.push({ name: p.name, error: 'no register() export' });
                }
            } catch (e) {
                rollbackRegistered(type, registeredIds, p.name, previousEntries, deps);
                failed.push({ name: p.name, error: e.message });
            } finally {
                if (blobUrl) URL.revokeObjectURL(blobUrl);
            }
        }

        const metadataChanged = [...metadataBefore].some(([entry, oldIds]) =>
            oldIds.length !== entry.ids.length || oldIds.some((id, index) => id !== entry.ids[index]));
        if (metadataChanged) {
            try {
                await saveStore();
            } catch (e) {
                for (const [entry, oldIds] of metadataBefore) entry.ids = oldIds;
                for (const item of newlyAdded) rollbackRegistered(type, item.ids, item.name, item.previousEntries, item.deps);
                return { loaded: [], failed: [...failed, ...loaded.map(name => ({ name, error: e.message }))] };
            }
        }

        const currentNames = new Set(store.map(entry => entry.name));
        for (const [name, ids] of previousManaged) {
            if (failed.some(item => item.name === name)) continue;
            const currentIds = restoredIds.get(name) || new Set();
            if (!currentNames.has(name) || restoredIds.has(name)) {
                for (const id of ids) {
                    if (!currentIds.has(id)) unregisterOwned(type, id, name);
                }
            }
        }
        for (const name of currentNames) {
            if (restoredIds.has(name)) managedIds[type].set(name, restoredIds.get(name));
        }
        for (const name of previousManaged.keys()) {
            if (!currentNames.has(name)) managedIds[type].delete(name);
        }

        // Restore capability enabled states
        if (type === 'capability') {
            await restoreCapabilityEnabled();
        }

        if (loaded.length || failed.length) {
            log(`User ${type}s: ${loaded.length} restored` +
                (failed.length ? `, ${failed.length} failed` : ''));
        }
        return { loaded, failed };
    }

    function readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsText(file);
        });
    }

    return { importAsset, deleteAsset, listAssets, restoreAll, persistCapabilityEnabled, restoreCapabilityEnabled };
}
