/**
 * NPC Export System — export/import NPCs as standalone JSON files.
 *
 * Mirrors profile-export-system.js. Export packs NPC array + current
 * npcPrompt config into a single JSON. Import validates format, checks
 * prompt consistency, lets user pick which NPCs to merge.
 *
 * Pure factory — all state dependencies injected.
 */

import { djb2Hash } from '../utils/string-utils.js';
import { npcPresets } from '../assets/profiles/manifest.js';

const NPC_EXPORT_VERSION = 1;

function validateExportFormat(obj) {
    if (!obj || typeof obj !== 'object') return { ok: false, error: 'Not a valid JSON object' };
    if (obj.type !== 'npc-export') return { ok: false, error: 'Not an NPC export file (missing "type":"npc-export")' };
    if (!obj.version || obj.version < 1) return { ok: false, error: `Unsupported version: ${obj.version}` };
    if (!Array.isArray(obj.npcs)) return { ok: false, error: 'Missing or invalid "npcs" array' };
    if (!obj.template || typeof obj.template !== 'object') return { ok: false, error: 'Missing or invalid "template" object' };
    return { ok: true };
}

function checkPromptConsistency(importedTemplate, currentSettings, defaultPrompt) {
    const diffs = [];
    const currentPrompt = currentSettings.npcPrompt || defaultPrompt;
    const importPrompt = importedTemplate.npcPrompt || '';

    const curHash = djb2Hash(currentPrompt);
    const impHash = djb2Hash(importPrompt);
    if (curHash !== impHash) {
        diffs.push({ key: 'npcPrompt', label: 'NPC Prompt', currentHash: curHash, importHash: impHash });
    }
    return { consistent: diffs.length === 0, diffs };
}

function buildExportJson(opts) {
    const { npcs, groupNote, settings, getCurrentGroup, getDefaultNpcPrompt } = opts;
    const group = getCurrentGroup();

    return {
        version: NPC_EXPORT_VERSION,
        type: 'npc-export',
        exportedAt: new Date().toISOString(),
        source: {
            groupName: group?.name || '',
            groupNote: groupNote || '',
        },
        template: {
            npcPrompt: settings.npcPrompt || getDefaultNpcPrompt(),
        },
        npcs: npcs.map(n => ({
            name: n.name,
            description: n.description || '',
            personality: n.personality || '',
            scenario: n.scenario || '',
            first_mes: n.first_mes || '',
        })),
    };
}

function classifyImportNpc(name, existingNpcs) {
    const exists = existingNpcs.some(n => n.name.toLowerCase() === name.toLowerCase());
    return exists ? 'overwrite' : 'new';
}

function sameValue(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}

function rollbackNpcEntries(metadata, extKey, changes) {
    const npcs = metadata[extKey]?.npcs;
    if (!Array.isArray(npcs)) return changes.length > 0;
    let conflict = false;
    for (const { previous, applied } of [...changes].reverse()) {
        const index = npcs.findIndex(npc => npc?.name?.toLowerCase() === applied.name.toLowerCase());
        if (index < 0) {
            // A concurrent delete or rename owns the current state.
            conflict = true;
            continue;
        }
        const current = npcs[index];
        if (!previous) {
            if (sameValue(current, applied)) npcs.splice(index, 1);
            else conflict = true; // Preserve a concurrent edit to a newly imported NPC.
            continue;
        }
        const restored = { ...current };
        for (const key of new Set([...Object.keys(previous), ...Object.keys(applied), ...Object.keys(current)])) {
            if (!sameValue(current[key], applied[key])) {
                if (!sameValue(previous[key], applied[key])) conflict = true;
                continue;
            }
            if (Object.hasOwn(previous, key)) restored[key] = structuredClone(previous[key]);
            else delete restored[key];
        }
        npcs[index] = restored;
    }
    return conflict;
}

function importFailure(error, details = []) {
    if (!details.length) return error;
    const failure = new Error(`${error.message}; ${details.join('; ')}`, { cause: error });
    failure.rollbackIncomplete = true;
    return failure;
}

export function createNpcExportSystem(deps) {
    const {
        settings, saveSettings, getCurrentGroup, getChatMetadata,
        saveChatConditional, log,
    } = deps;

    const EXT_KEY = deps.EXT_KEY;

    function getDefaultNpcPrompt() {
        // Import dynamically to avoid circular dependency — DEFAULT_NPC_PROMPT
        // lives in agents/npc.js but we can't import it here. Instead, fall
        // back to an empty string; the UI passes the actual default via deps.
        return deps.defaultNpcPrompt || '';
    }

    function getNpcs(cm = getChatMetadata()) {
        if (!cm[EXT_KEY]) cm[EXT_KEY] = {};
        if (!cm[EXT_KEY].npcs) cm[EXT_KEY].npcs = [];
        return cm[EXT_KEY].npcs;
    }

    async function saveNpcs(metadata = getChatMetadata()) {
        await saveChatConditional(metadata);
    }

    const isZh = () => (settings.lang || 'zh') === 'zh';

    // ── Export ──────────────────────────────────────────────────────

    function exportNpcs(npcs, groupNote) {
        const json = buildExportJson({ npcs, groupNote, settings, getCurrentGroup, getDefaultNpcPrompt });
        const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const groupName = json.source.groupName || 'npcs';
        const safeName = groupName.replace(/[^a-zA-Z0-9一-鿿\-_]/g, '_').substring(0, 50);
        const dateStr = new Date().toISOString().slice(0, 10);
        a.download = `npcs-${safeName}-${dateStr}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        log(`Exported ${json.npcs.length} NPC(s)`);
        return json;
    }

    // ── Import ──────────────────────────────────────────────────────

    function parseImportFile(jsonText) {
        let obj;
        try { obj = JSON.parse(jsonText); } catch (e) {
            return { ok: false, error: `Invalid JSON: ${e.message}` };
        }
        const valid = validateExportFormat(obj);
        if (!valid.ok) return valid;

        const consistency = checkPromptConsistency(obj.template, settings, getDefaultNpcPrompt());

        const existingNpcs = getNpcs();
        const npcs = obj.npcs.filter(n => n && typeof n.name === 'string').map(n => ({
            ...n,
            _action: classifyImportNpc(n.name, existingNpcs),
        }));

        return {
            ok: true,
            data: {
                ...obj,
                npcs,
                _templateConsistent: consistency.consistent,
                _templateDiffs: consistency.diffs,
            },
        };
    }

    async function applyImport(importData, selectedNames, options = {}) {
        const selectedSet = new Set(selectedNames.map(s => s.toLowerCase()));
        const importNpcs = importData.npcs.filter(n => selectedSet.has(n.name.toLowerCase()));
        const importPrompt = options.importTemplate && importData.template?.npcPrompt !== undefined;
        if (!importNpcs.length && !importPrompt) return { applied: 0, skipped: 0, templateImported: false };

        const metadata = getChatMetadata();
        const existingNpcs = importNpcs.length ? getNpcs(metadata) : null;
        const changes = [];
        let applied = 0;

        for (const imp of importNpcs) {
            const existingIdx = existingNpcs.findIndex(n => n.name.toLowerCase() === imp.name.toLowerCase());
            const entry = {
                name: imp.name,
                description: imp.description || '',
                personality: imp.personality || '',
                scenario: imp.scenario || '',
                first_mes: imp.first_mes || '',
                imported: false,
                importedAvatar: null,
                createdAt: Date.now(),
            };

            const previous = existingIdx >= 0 ? structuredClone(existingNpcs[existingIdx]) : null;
            if (existingIdx >= 0) {
                // Preserve import tracking, overwrite content
                entry.imported = existingNpcs[existingIdx].imported;
                entry.importedAvatar = existingNpcs[existingIdx].importedAvatar;
                existingNpcs[existingIdx] = entry;
            } else {
                existingNpcs.push(entry);
            }
            changes.push({ previous, applied: structuredClone(entry) });
            applied++;
        }

        if (changes.length) {
            try {
                await saveNpcs(metadata);
            } catch (error) {
                if (error.persistenceUnknown) throw error;
                const conflict = rollbackNpcEntries(metadata, EXT_KEY, changes);
                throw importFailure(error, conflict ? ['concurrent NPC edits may retain imported data'] : []);
            }
            if (getChatMetadata() !== metadata) {
                throw new Error('NPC import became stale after the chat changed; the original chat was saved');
            }
        }

        if (importPrompt) {
            const hadPrompt = Object.hasOwn(settings, 'npcPrompt');
            const previousPrompt = settings.npcPrompt;
            const appliedPrompt = importData.template.npcPrompt;
            settings.npcPrompt = appliedPrompt;
            try {
                // The production callback queues a debounced settings save. Awaiting
                // it handles observable failures, not eventual disk-write failures.
                await saveSettings();
            } catch (error) {
                const details = [];
                if (settings.npcPrompt === appliedPrompt) {
                    if (hadPrompt) settings.npcPrompt = previousPrompt;
                    else delete settings.npcPrompt;
                    try { await saveSettings(); }
                    catch (restoreError) { details.push(`prompt compensation failed: ${restoreError.message}`); }
                } else {
                    details.push('concurrent prompt edit preserved');
                }
                if (changes.length) {
                    if (rollbackNpcEntries(metadata, EXT_KEY, changes)) {
                        details.push('concurrent NPC edits may retain imported data');
                    }
                    if (getChatMetadata() === metadata) {
                        try { await saveNpcs(metadata); }
                        catch (restoreError) { details.push(`NPC compensation save failed: ${restoreError.message}`); }
                    } else {
                        details.push('chat changed before NPC compensation could be saved');
                    }
                }
                throw importFailure(error, details);
            }
            log('NPC prompt imported');
        }

        const skipped = Math.max(0, selectedSet.size - applied); // selections not found in file
        log(`Imported ${applied} NPC(s), ${skipped} skipped${importPrompt ? ' + prompt' : ''}`);
        return { applied, skipped, templateImported: !!importPrompt };
    }

    async function loadPreset(name) {
        try {
            const resp = await fetch(`scripts/extensions/third-party/SillyTavern-GroupWorld/assets/profiles/${name}.json`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const text = await resp.text();
            return parseImportFile(text);
        } catch (e) {
            return { ok: false, error: `Failed to load preset "${name}": ${e.message}` };
        }
    }

    return {
        exportNpcs,
        parseImportFile,
        applyImport,
        loadPreset,
        getPresetNames: () => [...npcPresets],
    };
}
