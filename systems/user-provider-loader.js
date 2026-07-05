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

import { callGenericPopup, POPUP_TYPE } from '../../../../popup.js';

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

function scanSource(source) {
    const found = [];
    for (const { pattern, label } of DANGEROUS_PATTERNS) {
        pattern.lastIndex = 0;
        const matches = source.match(pattern);
        if (matches) found.push({ label, count: matches.length });
    }
    return found;
}

export function createUserProviderLoader({ extension_settings, EXT_KEY, saveSettings, log, getRegisteredProviderIds, unregisterProvider, CapabilityRegistry }) {
    const STORE_KEYS = { provider: 'userProviders', capability: 'userCapabilities' };

    function getStore(type) {
        const key = STORE_KEYS[type];
        if (!extension_settings[EXT_KEY]) extension_settings[EXT_KEY] = {};
        if (!extension_settings[EXT_KEY][key]) extension_settings[EXT_KEY][key] = [];
        return extension_settings[EXT_KEY][key];
    }

    async function saveStore() {
        if (typeof saveSettings === 'function') saveSettings();
    }

    /**
     * Persist the enabled/disabled state of all user-imported capabilities.
     * Called whenever a capability toggle changes.
     */
    function persistCapabilityEnabled() {
        if (!CapabilityRegistry) return;
        const store = getStore('capability');
        const allCaps = CapabilityRegistry.list();
        let changed = false;
        for (const entry of store) {
            for (const id of (entry.ids || [])) {
                const cap = allCaps.find(c => c.id === id);
                if (cap && entry.enabled !== cap.enabled) {
                    entry.enabled = cap.enabled !== false;
                    changed = true;
                }
            }
        }
        if (changed) saveStore();
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
        if (!file || !file.name.endsWith('.js')) {
            return { ok: false, name: file?.name || 'unknown', error: 'Only .js files are supported' };
        }

        const name = file.name.replace(/\.js$/, '');
        const store = getStore(type);
        if (store.some(p => p.name === name)) {
            return { ok: false, name, error: `"${name}" already exists. Delete it first to re-import.` };
        }

        try {
            const source = await readFileAsText(file);

            const findings = scanSource(source);
            if (findings.length > 0) {
                const lines = findings.map(f => `  - ${f.label} (${f.count}x)`).join('\n');
                const userConfirmed = await callGenericPopup(
                    `<b>Security warning</b><br>Dangerous APIs detected:<br><br>${lines.replace(/\n/g, '<br>')}<br><br>` +
                    `This code could: steal chat logs, exfiltrate API keys, or hijack the page.<br>` +
                    `Only import from trusted sources.`,
                    POPUP_TYPE.CONFIRM
                );
                if (!userConfirmed) {
                    return { ok: false, name, error: 'Import cancelled by user (security warning)' };
                }
                log(`User ${type} "${name}": user confirmed import despite security warning: ${findings.map(f => f.label).join(', ')}`);
            }

            const blobUrl = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));
            const mod = await import(blobUrl);

            if (typeof mod.register !== 'function') {
                URL.revokeObjectURL(blobUrl);
                return { ok: false, name, error: 'Module must export function register(deps)' };
            }

            // Snapshot → register → diff to find added IDs
            const registry = type === 'capability' ? CapabilityRegistry : deps.CapabilityRegistry;
            const before = (getRegisteredProviderIds || registry)
                ? new Set(
                    type === 'provider' ? (getRegisteredProviderIds?.() ?? [])
                    : (registry?.list().map(c => c.id) ?? [])
                )
                : null;
            mod.register(deps);
            const after = before
                ? (type === 'provider'
                    ? (getRegisteredProviderIds?.() ?? [])
                    : (registry?.list().map(c => c.id) ?? []))
                : null;
            const addedIds = before && after
                ? after.filter(id => !before.has(id))
                : [];
            log(`User ${type} import diff: added=[${addedIds.join(',')}]`);

            // Revoke Blob URL — module is cached by import(), URL resource can be freed
            URL.revokeObjectURL(blobUrl);

            // Persist with enabled state
            store.push({ name, source, importedAt: Date.now(), ids: addedIds, enabled: true });
            await saveStore();

            log(`User ${type} "${name}" imported and registered`);
            return { ok: true, name };
        } catch (e) {
            log(`User ${type} "${name}" import failed:`, e.message);
            return { ok: false, name, error: e.message };
        }
    }

    /**
     * Delete a user-imported asset.
     */
    async function deleteAsset(name, type) {
        const store = getStore(type);
        const idx = store.findIndex(p => p.name === name);
        if (idx === -1) return false;
        const entry = store[idx];
        if (type === 'provider' && unregisterProvider) {
            for (const id of (entry.ids || [])) {
                unregisterProvider(id);
            }
        }
        store.splice(idx, 1);
        await saveStore();
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
        const store = getStore(type);
        const loaded = [], failed = [];

        for (const p of store) {
            try {
                const findings = scanSource(p.source);
                if (findings.length > 0) {
                    log(`Security: persisted ${type} "${p.name}" contains: ${findings.map(f => f.label).join(', ')}`);
                }
                const blobUrl = URL.createObjectURL(new Blob([p.source], { type: 'application/javascript' }));
                const mod = await import(blobUrl);
                if (typeof mod.register === 'function') {
                    mod.register(deps);
                    loaded.push(p.name);
                } else {
                    failed.push({ name: p.name, error: 'no register() export' });
                }
                URL.revokeObjectURL(blobUrl);
            } catch (e) {
                failed.push({ name: p.name, error: e.message });
            }
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
