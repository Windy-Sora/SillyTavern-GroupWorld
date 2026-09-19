/**
 * Memory Export System — export/import character memories as standalone JSON.
 *
 * The most complex export system due to nested per-character array storage.
 *
 * Export: builds { memories: { avatar: { name, entries[] } } } with all fields preserved
 * Import: avatar matching (exact → name → fuzzy), per-character replace/append,
 *         event-text dedup on append, max-entry trim, round→-1 on all imported entries
 *
 * Storage: chat_metadata[EXT_KEY].charMemories = { [avatar]: [...entries] }
 */

import { djb2Hash } from '../utils/string-utils.js';

const MEMORY_EXPORT_VERSION = 1;

function sameJsonValue(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}

function findMatchingEntries(left, right) {
    const leftKeys = left.map(entry => JSON.stringify(entry));
    const rightKeys = right.map(entry => JSON.stringify(entry));
    const table = Array.from({ length: left.length + 1 }, () => new Uint16Array(right.length + 1));
    for (let i = left.length - 1; i >= 0; i--) {
        for (let j = right.length - 1; j >= 0; j--) {
            table[i][j] = leftKeys[i] === rightKeys[j]
                ? table[i + 1][j + 1] + 1
                : Math.max(table[i + 1][j], table[i][j + 1]);
        }
    }
    const matches = [];
    for (let i = 0, j = 0; i < left.length && j < right.length;) {
        if (leftKeys[i] === rightKeys[j]) {
            matches.push([i++, j++]);
        } else if (table[i + 1][j] >= table[i][j + 1]) {
            i++;
        } else {
            j++;
        }
    }
    return matches;
}

function rollbackMemoryEntries(previous = [], applied = [], current = [], maxEntries = 200) {
    if (sameJsonValue(current, applied)) return structuredClone(previous);
    const appliedToPrevious = new Map(findMatchingEntries(previous, applied).map(([before, after]) => [after, before]));
    const matches = [[-1, -1], ...findMatchingEntries(applied, current), [applied.length, current.length]];
    const result = structuredClone(previous);
    for (let gap = matches.length - 2; gap >= 0; gap--) {
        const [leftApplied, leftCurrent] = matches[gap];
        const [rightApplied, rightCurrent] = matches[gap + 1];
        const removedIndexes = [];
        for (let index = leftApplied + 1; index < rightApplied; index++) {
            if (appliedToPrevious.has(index)) removedIndexes.push(appliedToPrevious.get(index));
        }
        const inserted = current.slice(leftCurrent + 1, rightCurrent);
        if (!removedIndexes.length && !inserted.length) continue;

        let insertAt;
        if (removedIndexes.length) {
            insertAt = Math.min(...removedIndexes);
            for (const index of removedIndexes.sort((a, b) => b - a)) result.splice(index, 1);
        } else {
            let anchor = leftApplied;
            while (anchor >= 0 && !appliedToPrevious.has(anchor)) anchor--;
            if (anchor >= 0) {
                insertAt = appliedToPrevious.get(anchor) + 1;
            } else {
                anchor = rightApplied;
                while (anchor < applied.length && !appliedToPrevious.has(anchor)) anchor++;
                insertAt = anchor < applied.length ? appliedToPrevious.get(anchor) : result.length;
            }
        }
        result.splice(insertAt, 0, ...structuredClone(inserted));
    }

    while (result.length > maxEntries) result.shift();
    return result;
}

// ── Validation ──────────────────────────────────────────────────────

function validateExportFormat(obj) {
    if (!obj || typeof obj !== 'object') return { ok: false, error: 'Not a valid JSON object' };
    if (obj.type !== 'memory-export') return { ok: false, error: 'Not a memory export file (missing "type":"memory-export")' };
    if (!obj.version || obj.version < 1) return { ok: false, error: `Unsupported version: ${obj.version}` };
    if (!obj.memories || typeof obj.memories !== 'object') return { ok: false, error: 'Missing or invalid "memories" object' };
    if (!obj.template || typeof obj.template !== 'object') return { ok: false, error: 'Missing or invalid "template" object' };
    return { ok: true };
}

// ── Template consistency ────────────────────────────────────────────

function checkTemplateConsistency(importedTemplate, currentSettings, defaults) {
    const diffs = [];
    const items = [
        { key: 'memoryPrompt', label: 'Memory Prompt', current: currentSettings.memoryPrompt || defaults.prompt, import: importedTemplate.memoryPrompt || '' },
        { key: 'memoryJsonSchema', label: 'JSON Schema', current: currentSettings.memoryJsonSchema || defaults.schema, import: importedTemplate.memoryJsonSchema || '' },
        { key: 'memoryRenderTemplate', label: 'Render Template', current: currentSettings.memoryRenderTemplate || defaults.render, import: importedTemplate.memoryRenderTemplate || '' },
        { key: 'memoryCompressPrompt', label: 'Compress Prompt', current: currentSettings.memoryCompressPrompt || defaults.compress, import: importedTemplate.memoryCompressPrompt || '' },
    ];
    for (const item of items) {
        const curHash = djb2Hash(item.current);
        const impHash = djb2Hash(item.import);
        if (curHash !== impHash) {
            diffs.push({ key: item.key, label: item.label, currentHash: curHash, importHash: impHash });
        }
    }
    return { consistent: diffs.length === 0, diffs };
}

// ── Avatar matching ──────────────────────────────────────────────────

/**
 * Try to find a current group member matching an imported avatar/name.
 * Returns { avatar, name, matchType: 'exact'|'name'|'fuzzy'|null } or null.
 */
function findMatchingCharacter(importedAvatar, importedName, groupMembers, characters) {
    // 1. Exact avatar match
    if (groupMembers.includes(importedAvatar)) {
        const c = characters.find(ch => ch.avatar === importedAvatar);
        return { avatar: importedAvatar, name: c?.name || importedName, matchType: 'exact' };
    }
    // 2. Exact name match
    const byName = characters.find(c =>
        groupMembers.includes(c.avatar) && c.name.toLowerCase() === importedName.toLowerCase()
    );
    if (byName) {
        return { avatar: byName.avatar, name: byName.name, matchType: 'name' };
    }
    // 3. Substring fuzzy match (name contains importedName or vice versa, min 3 chars)
    const fuzzy = characters.find(c =>
        groupMembers.includes(c.avatar) && (
            (importedName.length >= 3 && c.name.toLowerCase().includes(importedName.toLowerCase())) ||
            (c.name.length >= 3 && importedName.toLowerCase().includes(c.name.toLowerCase()))
        )
    );
    if (fuzzy) {
        return { avatar: fuzzy.avatar, name: fuzzy.name, matchType: 'fuzzy' };
    }
    return null;
}

// ── Build / Apply ────────────────────────────────────────────────────

function buildExportJson(opts) {
    const { avatarEntries, groupNote, settings, getCurrentGroup, defaults } = opts;
    const group = getCurrentGroup();

    return {
        version: MEMORY_EXPORT_VERSION,
        type: 'memory-export',
        exportedAt: new Date().toISOString(),
        source: { groupName: group?.name || '', groupNote: groupNote || '' },
        template: {
            memoryPrompt: settings.memoryPrompt || defaults.prompt,
            memoryJsonSchema: settings.memoryJsonSchema || defaults.schema,
            memoryRenderTemplate: settings.memoryRenderTemplate || defaults.render,
            memoryCompressPrompt: settings.memoryCompressPrompt || defaults.compress,
        },
        memories: avatarEntries,
    };
}

/**
 * Apply imported memories to chat_metadata.
 *
 * @param {Object} importData - full parsed import object
 * @param {Object} decisions - { [importedAvatar]: { targetAvatar, mode: 'replace'|'append', skipCompressed: false } }
 * @param {Object} options - { importTemplate?: boolean }
 */
async function applyImport(importData, decisions, options, deps) {
    const { settings, getChatMetadata, getCharacters, saveChatConditional, saveSettings, EXT_KEY, log } = deps;

    const store = () => {
        const cm = getChatMetadata();
        if (!cm[EXT_KEY]) cm[EXT_KEY] = {};
        if (!cm[EXT_KEY].charMemories) cm[EXT_KEY].charMemories = {};
        return cm[EXT_KEY].charMemories;
    };

    const maxEntries = settings.memoryMaxEntries ?? 200;
    let totalApplied = 0;
    let totalSkipped = 0;
    const memoryStore = store();
    const rollback = new Map();

    for (const [importedAvatar, decision] of Object.entries(decisions)) {
        if (!decision.enabled) { totalSkipped++; continue; }
        if (importedAvatar === '__proto__' || importedAvatar === 'constructor') continue;

        const memData = importData.memories[importedAvatar];
        if (!memData || !Array.isArray(memData.entries)) continue;

        let entries = memData.entries;

        // Filter compressed if requested
        if (decision.skipCompressed) {
            entries = entries.filter(e => !e.compressed);
        }

        // Normalize: set round=-1, preserve timestamp, preserve all custom fields
        entries = entries.map(e => ({
            ...e,
            round: -1,
            timestamp: e.timestamp || Date.now(),
        }));

        const targetAvatar = decision.targetAvatar;
        const existing = memoryStore[targetAvatar] || [];
        if (!rollback.has(targetAvatar)) {
            rollback.set(targetAvatar, {
                existed: Object.prototype.hasOwnProperty.call(memoryStore, targetAvatar),
                previous: structuredClone(memoryStore[targetAvatar]),
                applied: null,
            });
        }

        let merged;
        let appliedHere = 0;
        if (decision.mode === 'replace') {
            merged = entries;
            appliedHere = entries.length;
        } else {
            // Append with event-text dedup
            const existingEvents = new Set(
                existing.map(e => (e.event || '').toLowerCase().trim())
            );
            const newEntries = [];
            for (const entry of entries) {
                const eventKey = (entry.event || '').toLowerCase().trim();
                if (existingEvents.has(eventKey)) continue;
                existingEvents.add(eventKey);
                newEntries.push(entry);
            }
            merged = [...existing, ...newEntries];
            appliedHere = newEntries.length;
        }

        // Trim to max
        while (merged.length > maxEntries) {
            merged.shift();
        }

        memoryStore[targetAvatar] = merged;
        rollback.get(targetAvatar).applied = structuredClone(merged);
        totalApplied += appliedHere;
    }

    try {
        await saveChatConditional();
    } catch (error) {
        for (const [avatar, state] of rollback) {
            const restored = rollbackMemoryEntries(state.previous || [], state.applied || [], memoryStore[avatar] || [], maxEntries);
            if (state.existed || restored.length) memoryStore[avatar] = restored;
            else delete memoryStore[avatar];
        }
        throw error;
    }

    // Optionally import template
    let templateImported = false;
    if (options.importTemplate && importData.template) {
        const t = importData.template;
        if (t.memoryPrompt !== undefined) settings.memoryPrompt = t.memoryPrompt;
        if (t.memoryJsonSchema !== undefined) settings.memoryJsonSchema = t.memoryJsonSchema;
        if (t.memoryRenderTemplate !== undefined) settings.memoryRenderTemplate = t.memoryRenderTemplate;
        if (t.memoryCompressPrompt !== undefined) settings.memoryCompressPrompt = t.memoryCompressPrompt;
        saveSettings();
        templateImported = true;
    }

    log(`Imported ${totalApplied} memory entries (${Object.keys(decisions).length} characters)${templateImported ? ' + templates' : ''}`);
    return { applied: totalApplied, skipped: totalSkipped, templateImported };
}

// ─── Factory ─────────────────────────────────────────────────────────

export function createMemoryExportSystem(deps) {
    const { settings, EXT_KEY, getChatMetadata, getCharacters, getCurrentGroup, saveChatConditional, saveSettings, log } = deps;
    const { defaultMemoryPrompt, defaultMemorySchema, defaultMemoryRender, defaultMemoryCompressPrompt } = deps;

    const defaults = {
        prompt: defaultMemoryPrompt || '',
        schema: defaultMemorySchema || '',
        render: defaultMemoryRender || '',
        compress: defaultMemoryCompressPrompt || '',
    };

    function getStore() {
        const cm = getChatMetadata();
        if (!cm[EXT_KEY]) cm[EXT_KEY] = {};
        if (!cm[EXT_KEY].charMemories) cm[EXT_KEY].charMemories = {};
        return cm[EXT_KEY].charMemories;
    }

    // ── Export ──────────────────────────────────────────────────────

    function getExportableCharacters() {
        const group = getCurrentGroup();
        if (!group) return [];
        const members = group.members.filter(a => !group.disabled_members?.includes(a));
        const store = getStore();
        const chars = getCharacters();

        return members
            .filter(avatar => store[avatar] && store[avatar].length > 0)
            .map(avatar => {
                const c = chars.find(ch => ch.avatar === avatar);
                return {
                    avatar,
                    name: c?.name || avatar,
                    count: store[avatar].length,
                };
            });
    }

    function exportMemories(selectedAvatars, groupNote) {
        const store = getStore();
        const chars = getCharacters();
        const avatarEntries = {};

        for (const avatar of selectedAvatars) {
            const entries = store[avatar];
            if (!entries || !entries.length) continue;
            const c = chars.find(ch => ch.avatar === avatar);
            avatarEntries[avatar] = {
                name: c?.name || avatar,
                entries: entries.map(e => ({ ...e })), // shallow clone preserves custom fields
            };
        }

        if (Object.keys(avatarEntries).length === 0) return null;

        const json = buildExportJson({
            avatarEntries, groupNote, settings, getCurrentGroup, defaults,
        });

        const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const safeName = (json.source.groupName || 'memories').replace(/[^a-zA-Z0-9一-鿿\-_]/g, '_').substring(0, 40);
        const dateStr = new Date().toISOString().slice(0, 10);
        const count = Object.keys(avatarEntries).length;
        a.download = `memories-${count}chars-${safeName}-${dateStr}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        log(`Exported ${count} character(s) memories`);
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

        const consistency = checkTemplateConsistency(obj.template, settings, defaults);

        // Build matching information for each imported character
        const group = getCurrentGroup();
        const members = group?.members?.filter(a => !group.disabled_members?.includes(a)) || [];
        const chars = getCharacters();

        const matchResults = {};
        for (const [avatar, data] of Object.entries(obj.memories)) {
            if (!data || typeof data !== 'object' || Array.isArray(data)) {
                return { ok: false, error: `Invalid memory entry for "${avatar}"` };
            }
            if (typeof data.name !== 'string' || !data.name.trim()) {
                return { ok: false, error: `Missing or invalid name for "${avatar}"` };
            }
            if (!Array.isArray(data.entries)) {
                return { ok: false, error: `Missing or invalid entries for "${avatar}"` };
            }
            const invalidEntryIndex = data.entries.findIndex(entry => !entry || typeof entry !== 'object' || Array.isArray(entry));
            if (invalidEntryIndex !== -1) {
                return { ok: false, error: `Invalid memory entry at index ${invalidEntryIndex} for "${avatar}"` };
            }
            const match = findMatchingCharacter(avatar, data.name, members, chars);
            matchResults[avatar] = {
                importedName: data.name,
                importedAvatar: avatar,
                entryCount: data.entries?.length || 0,
                compressedCount: data.entries?.filter(e => e.compressed).length || 0,
                match,
            };
        }

        return {
            ok: true,
            data: {
                ...obj,
                _templateConsistent: consistency.consistent,
                _templateDiffs: consistency.diffs,
                _matches: matchResults,
            },
        };
    }

    async function applyMemoryImport(importData, decisions, options = {}) {
        return applyImport(importData, decisions, options, {
            settings, getChatMetadata, getCharacters, saveChatConditional, saveSettings, EXT_KEY, log,
        });
    }

    /**
     * Build a decision object for each imported character with defaults.
     * decision = { enabled, targetAvatar, mode: 'append', skipCompressed: false }
     */
    function buildDefaultDecisions(matches) {
        const decisions = {};
        for (const [importedAvatar, m] of Object.entries(matches)) {
            decisions[importedAvatar] = {
                enabled: !!m.match,
                targetAvatar: m.match?.avatar || importedAvatar,
                mode: 'append',
                skipCompressed: false,
            };
        }
        return decisions;
    }

    return {
        getExportableCharacters,
        exportMemories,
        parseImportFile,
        applyMemoryImport,
        buildDefaultDecisions,
    };
}
