/**
 * Config Profile System — save/restore/export/import extension settings profiles.
 *
 * Each profile is a named snapshot of selected settings drawers.
 * Profiles are stored in extension_settings[EXT_KEY].configProfiles.
 *
 * Export: profile → .zip (manifest.json + optional user provider/capability .js files)
 * Import: .zip → parsed profile → add to list
 *
 * Pure factory — all state dependencies injected.
 */

import { configPresets } from '../assets/profiles/manifest.js';
import { DEFAULT_SETTINGS } from '../settings.js';

const CONFIG_PROFILE_VERSION = 1;

// ─── Drawer → settings key mapping ──────────────────────────────────
//
// When adding a NEW setting to settings.js DEFAULT_SETTINGS:
//   1. Add the key to the appropriate drawer array below (one line)
//   2. If unsure which drawer, put it in the closest matching one
//   3. On startup, uncovered keys are auto-detected and warned in console
//
// Mode & Scoring keys are intentionally excluded (never exported).

const DRAWER_KEYS = {
    directorLlm: [
        'llmPrompt', 'llmMaxSpeakers', 'llmRespectOrder',
        'llmContextDepth', 'llmCharDescMode', 'llmCharDescLength',
        'llmScriptEnabled', 'llmScriptPrompt', 'llmScriptWrapper',
        'llmScriptPosition',
        'llmHistoryEnabled', 'llmScriptContinuity', 'llmScriptContinuityMode',
        'llmScriptContinuityCount', 'llmScriptContinuityWrapper',
        'llmScriptContinuityHistoryWrapper',
        'llmWorldInfoEnabled', 'llmWorldInfoWrapper',
        'templateMaxPasses', 'templateRecursive', 'templateDebugPlaceholders',
        'knowledgeText',
        'forceSpeakMode', 'forceSpeakPrompt',
    ],
    worldBooks: ['worldBookMaxEntries'],
    profilesAndData: [
        'profileEnabled', 'profileTokenBudget', 'profileConcurrency',
        'profileGeneratorPrompt', 'profileJsonSchema', 'profileRenderTemplate',
        'memoryEnabled', 'memoryTokenBudget', 'memoryPrompt',
        'memoryJsonSchema', 'memoryRenderTemplate', 'memoryKeepRecent',
        'memoryMaxEntries', 'memoryCompressPrompt',
        'identityPrompt',
        'npcEnabled', 'npcMaxCount', 'npcBatchSize',
        'npcGenerateFirstMes', 'npcPrompt',
    ],
    contextLedger: [
        'summaryEnabled', 'summaryReusePrevious', 'summaryPrompt',
    ],
    multimodal: [
        'postSpeechMessageEnabled', 'postSpeechMessagePrompt',
        'postSpeechRoundEnabled', 'postSpeechRoundPrompt',
        'postSpeechBlocking', 'postSpeechDecisionLimit',
    ],
    assetManager: ['userProviders', 'userCapabilities', 'customPrompts', 'customPromptsEnabled'],
    agentsTools: ['agentConfigs', 'traceMaxEntries'],
};

/** Build a settings snapshot for the checked drawers. */
function snapshotSettings(settings, drawers) {
    const snap = {};
    const keys = new Set();
    for (const [drawer, enabled] of Object.entries(drawers)) {
        if (!enabled) continue;
        for (const k of (DRAWER_KEYS[drawer] || [])) keys.add(k);
    }
    for (const k of keys) {
        if (settings[k] !== undefined) {
            snap[k] = JSON.parse(JSON.stringify(settings[k]));
        }
    }
    return snap;
}

/** Apply a snapshot back to settings. Returns list of changed keys. */
function applySnapshot(settings, snap, options = {}) {
    const changed = [];
    for (const [k, v] of Object.entries(snap)) {
        if (k === 'userProviders' || k === 'userCapabilities') continue;
        if (k === 'customPrompts') {
            if (!options.customPromptsApplied) continue;
        }
        // Merge with DEFAULT_SETTINGS base: new keys get defaults, unknown keys preserved
        const base = JSON.parse(JSON.stringify(DEFAULT_SETTINGS[k] || null));
        const incoming = JSON.parse(JSON.stringify(v));
        let merged;
        if (base && typeof base === 'object' && !Array.isArray(base)) {
            // Nested objects (e.g., scoreWeights): deep merge with default as base
            merged = Object.assign({}, base, incoming);
        } else if (Array.isArray(base) && k === 'customPrompts') {
            // Arrays — just use incoming (merge handled by applyProfile)
            merged = incoming;
        } else {
            // Scalars — use incoming
            merged = incoming;
        }
        if (JSON.stringify(settings[k]) !== JSON.stringify(merged)) {
            changed.push(k);
        }
        settings[k] = merged;
    }
    return changed;
}

/** Strip API keys from agentConfigs. */
function stripApiKeys(configs) {
    if (!configs || typeof configs !== 'object') return configs;
    const stripped = JSON.parse(JSON.stringify(configs));
    for (const [, cfg] of Object.entries(stripped)) {
        if (cfg && typeof cfg === 'object') cfg.apiKey = '';
    }
    return stripped;
}

// ─── Factory ─────────────────────────────────────────────────────────

export function createConfigProfileSystem(deps) {
    const { settings, EXT_KEY, extension_settings, saveSettingsDebounced, log } = deps;

    function getProfiles() {
        if (!settings.configProfiles) settings.configProfiles = [];
        return settings.configProfiles;
    }

    function saveAll() {
        extension_settings[EXT_KEY] = settings;
        saveSettingsDebounced();
    }

    let _idCounter = 0;
    function genId() { return `cfg_${Date.now()}_${++_idCounter}`; }

    const isZh = () => (settings.lang || 'zh') === 'zh';

    // ── CRUD ──────────────────────────────────────────────────────

    function saveCurrentAsProfile(name, description, drawers) {
        const snap = snapshotSettings(settings, drawers);

        // Strip API keys from agentConfigs
        if (snap.agentConfigs) {
            snap.agentConfigs = stripApiKeys(snap.agentConfigs);
        }

        const profile = {
            id: genId(),
            name,
            description: description || '',
            createdAt: Date.now(),
            drawers: { ...drawers },
            settings: snap,
        };
        getProfiles().push(profile);
        saveAll();
        log(`Config profile saved: "${name}"`);
        return profile;
    }

    function deleteProfile(id) {
        const list = getProfiles();
        const idx = list.findIndex(p => p.id === id);
        if (idx < 0) return;
        list.splice(idx, 1);
        saveAll();
    }

    function applyProfile(id, customPromptMerge = 'replace') {
        const list = getProfiles();
        const profile = list.find(p => p.id === id);
        if (!profile) return { changed: [], customPromptConflicts: [] };

        // ── Custom prompts conflict detection ──
        let customPromptConflicts = [];
        const incoming = profile.settings.customPrompts;
        if (incoming && Array.isArray(incoming) && incoming.length > 0) {
            const existing = settings.customPrompts || [];
            const existingNames = new Set(existing.map(e => e.name));
            customPromptConflicts = incoming.filter(e => existingNames.has(e.name)).map(e => e.name);
        }

        // ── Apply snapshot ──
        const opts = { customPromptsApplied: customPromptMerge !== 'skip' };
        const changed = applySnapshot(settings, profile.settings, opts);

        // ── Merge custom prompts ──
        if (incoming && Array.isArray(incoming) && incoming.length > 0) {
            if (!settings.customPrompts) settings.customPrompts = [];
            const existing = settings.customPrompts;
            const existingNames = new Set(existing.map(e => e.name));

            if (customPromptMerge === 'replace') {
                // 'keep': keep existing same-names, add only different ones
                const toAdd = incoming.filter(e => !existingNames.has(e.name));
                existing.push(...toAdd.map(e => JSON.parse(JSON.stringify(e))));
            } else if (customPromptMerge === 'overwrite') {
                // Overwrite same-names, add different ones
                for (const e of incoming) {
                    const idx = existing.findIndex(x => x.name === e.name);
                    if (idx >= 0) {
                        existing[idx] = JSON.parse(JSON.stringify(e));
                    } else {
                        existing.push(JSON.parse(JSON.stringify(e)));
                    }
                }
            }
            // 'skip': don't touch customPrompts at all
        }

        // Restore userProviders/userCapabilities
        if (profile.settings.userProviders && Array.isArray(profile.settings.userProviders)) {
            settings.userProviders = JSON.parse(JSON.stringify(profile.settings.userProviders));
        }
        if (profile.settings.userCapabilities && Array.isArray(profile.settings.userCapabilities)) {
            settings.userCapabilities = JSON.parse(JSON.stringify(profile.settings.userCapabilities));
        }

        saveAll();
        log(`Config profile applied: "${profile.name}", ${changed.length} key(s) changed, ${customPromptConflicts.length} custom prompt conflict(s)`);
        return { changed, customPromptConflicts };
    }

    // ── JSZip loader (script-tag fallback for non-module environments) ──

    const JSZIP_PATH = '../../../../../lib/jszip.min.js';
    let _JSZip = null;

    async function ensureJSZip() {
        if (_JSZip) return _JSZip;
        if (window.JSZip) { _JSZip = window.JSZip; return _JSZip; }
        // Try dynamic import first (works in module browsers)
        try { await import(JSZIP_PATH); } catch (_) { /* non-module, fall through */ }
        if (window.JSZip) { _JSZip = window.JSZip; return _JSZip; }
        // Script tag fallback
        const script = document.createElement('script');
        script.src = JSZIP_PATH;
        document.head.appendChild(script);
        await new Promise((resolve, reject) => {
            script.onload = resolve;
            script.onerror = () => reject(new Error('JSZip script load failed'));
            setTimeout(() => reject(new Error('JSZip script load timeout')), 10000);
        });
        if (window.JSZip) { _JSZip = window.JSZip; return _JSZip; }
        throw new Error('JSZip not available');
    }

    // ── Export to .zip ────────────────────────────────────────────

    async function exportProfileAsZip(id) {
        const list = getProfiles();
        const profile = list.find(p => p.id === id);
        if (!profile) throw new Error('Profile not found');

        await ensureJSZip();
        const JSZip = _JSZip;

        const zip = new JSZip();

        // manifest.json
        const manifest = {
            version: CONFIG_PROFILE_VERSION,
            type: 'config-profile',
            exportedAt: new Date().toISOString(),
            name: profile.name,
            description: profile.description || '',
            createdAt: profile.createdAt,
            drawers: profile.drawers,
            settings: profile.settings,
        };
        zip.file('manifest.json', JSON.stringify(manifest, null, 2));

        // User providers/capabilities as .js files (only if assetManager drawer was selected)
        if (profile.drawers.assetManager) {
            const upFolder = zip.folder('user-providers');
            const ucFolder = zip.folder('user-capabilities');

            if (profile.settings.userProviders && Array.isArray(profile.settings.userProviders)) {
                for (const p of profile.settings.userProviders) {
                    if (p.name && p.source) {
                        const fileName = p.name.endsWith('.js') ? p.name : `${p.name}.js`;
                        upFolder.file(fileName, p.source);
                    }
                }
            }
            if (profile.settings.userCapabilities && Array.isArray(profile.settings.userCapabilities)) {
                for (const c of profile.settings.userCapabilities) {
                    if (c.name && c.source) {
                        const fileName = c.name.endsWith('.js') ? c.name : `${c.name}.js`;
                        ucFolder.file(fileName, c.source);
                    }
                }
            }
        }

        const blob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const safeName = (profile.name || 'config').replace(/[^a-zA-Z0-9一-鿿\-_]/g, '_').substring(0, 40);
        a.download = `group-world-config-${safeName}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        return manifest;
    }

    // ── Import from .zip ──────────────────────────────────────────

    async function importProfileFromZip(file) {
        await ensureJSZip();
        const JSZip = _JSZip;

        const data = await file.arrayBuffer();
        const zip = await JSZip.loadAsync(data);

        const manifestFile = zip.file('manifest.json');
        if (!manifestFile) throw new Error('Invalid config profile zip: missing manifest.json');

        const manifestText = await manifestFile.async('text');
        let manifest;
        try { manifest = JSON.parse(manifestText); } catch (e) {
            throw new Error('Invalid manifest.json: ' + e.message);
        }

        if (manifest.type !== 'config-profile') throw new Error('Not a config profile zip');
        if (!manifest.version || manifest.version < 1) throw new Error(`Unsupported version: ${manifest.version}`);

        // Read user-providers from zip
        const upFolder = zip.folder('user-providers');
        const ucFolder = zip.folder('user-capabilities');

        if (upFolder && manifest.settings.userProviders) {
            for (const p of manifest.settings.userProviders) {
                const fileName = p.name.endsWith('.js') ? p.name : `${p.name}.js`;
                const file = upFolder.file(fileName);
                if (file) {
                    p.source = await file.async('text');
                }
            }
        }
        if (ucFolder && manifest.settings.userCapabilities) {
            for (const c of manifest.settings.userCapabilities) {
                const fileName = c.name.endsWith('.js') ? c.name : `${c.name}.js`;
                const file = ucFolder.file(fileName);
                if (file) {
                    c.source = await file.async('text');
                }
            }
        }

        // Add to list
        const profile = {
            id: genId(),
            name: manifest.name || 'Imported Config',
            description: manifest.description || '',
            createdAt: Date.now(),
            drawers: manifest.drawers || {},
            settings: manifest.settings || {},
        };
        getProfiles().push(profile);
        saveAll();

        return profile;
    }

    return {
        getProfiles,
        saveCurrentAsProfile,
        deleteProfile,
        applyProfile,
        exportProfileAsZip,
        importProfileFromZip,
        getDrawerKeys: () => DRAWER_KEYS,
        /** Returns DEFAULT_SETTINGS keys NOT covered by any drawer. */
        getUncoveredKeys() {
            const allDk = new Set();
            for (const keys of Object.values(DRAWER_KEYS)) {
                for (const k of keys) allDk.add(k);
            }
            return Object.keys(DEFAULT_SETTINGS).filter(k => !allDk.has(k));
        },
        getPresetNames: () => [...configPresets],
        loadPreset: async (name) => {
            const resp = await fetch(`scripts/extensions/third-party/SillyTavern-GroupWorld/assets/profiles/${name}.json`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const manifest = await resp.json();
            if (manifest.type !== 'config-profile') throw new Error('Not a config profile preset');
            const profile = {
                id: genId(),
                name: manifest.name || name,
                description: manifest.description || '',
                createdAt: Date.now(),
                drawers: manifest.drawers || {},
                settings: manifest.settings || {},
            };
            getProfiles().push(profile);
            saveAll();
            return profile;
        },
    };
}
