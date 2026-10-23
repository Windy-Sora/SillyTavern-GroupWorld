import { applyApprovedBlueprintLibraryChat } from './blueprint-library-chat.js';
import { validateBlueprintLibraryDefinition } from './blueprint-library-validation.js';
/**
 * Story Blueprint Library System.
 *
 * Persistent convenience storage over the existing Story Blueprint export/import
 * format. Entries live in extension settings so they can be reused across chats.
 */

function clone(value) {
    return JSON.parse(JSON.stringify(value ?? null));
}

function safeFileName(name) {
    return String(name || 'story-blueprint')
        .replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_')
        .substring(0, 50) || 'story-blueprint';
}

function countNodes(nodes) {
    if (!Array.isArray(nodes)) return 0;
    return nodes.reduce((sum, node) => sum + 1 + countNodes(node?.children), 0);
}

export function createStoryBlueprintLibrarySystem({
    settings,
    extension_settings,
    EXT_KEY,
    saveSettings,
    saveChatConditional,
    getCurrentGroup,
    storyBlueprintSystem,
    log = console.log,
}) {
    let _idCounter = 0;
    let mutationQueue = Promise.resolve();
    const genId = () => `sblib_${Date.now()}_${++_idCounter}`;

    function getLibraries() {
        if (!Array.isArray(settings.storyBlueprintLibraries)) settings.storyBlueprintLibraries = [];
        return settings.storyBlueprintLibraries;
    }

    async function saveAll() {
        extension_settings[EXT_KEY] = settings;
        await saveSettings();
    }

    function enqueueMutation(work) {
        const task = mutationQueue.then(work, work);
        mutationQueue = task.catch(() => {});
        return task;
    }

    function normalize(entryOrData) {
        if (!entryOrData) return null;
        if (entryOrData.exportData?.type === 'group-director-story-blueprint') return entryOrData.exportData;
        if (entryOrData.type === 'group-director-story-blueprint') return entryOrData;
        return null;
    }

    function buildEntry(name, description = '', includeProgress = true) {
        const title = String(name || '').trim();
        if (!title) throw new Error('Library name is required');
        const data = storyBlueprintSystem.buildExportFile(!!includeProgress);
        const blueprint = data.storyBlueprint?.blueprint;
        if (!blueprint) throw new Error('No Story Blueprint to save');
        data.libraryMeta = {
            name: title,
            description: description || '',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            includeProgress: !!includeProgress,
        };
        const group = getCurrentGroup?.();
        return {
            id: genId(),
            name: title,
            description: description || '',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            sourceGroupName: group?.name || '',
            blueprintTitle: blueprint.title || 'Story Blueprint',
            nodeCount: countNodes(blueprint.nodes),
            stepCount: storyBlueprintSystem.getSteps?.().length || 0,
            includeProgress: !!includeProgress,
            exportData: data,
        };
    }

    async function saveCurrentAsLibrary(name, description = '', options = {}) {
        const entry = buildEntry(name, description, options.includeProgress !== false);
        return enqueueMutation(async () => {
            const list = getLibraries();
            list.push(entry);
            try { await saveAll(); }
            catch (error) {
                const index = list.indexOf(entry);
                if (index >= 0) list.splice(index, 1);
                throw error;
            }
            log(`[GroupDirector] Story Blueprint library saved: "${entry.name}"`);
            return entry;
        });
    }

    function getLibrary(id) {
        return getLibraries().find(x => x.id === id) || null;
    }

    async function deleteLibrary(id) {
        return enqueueMutation(async () => {
            const list = getLibraries();
            const idx = list.findIndex(x => x.id === id);
            if (idx < 0) return false;
            const before = list[idx - 1];
            const after = list[idx + 1];
            const [removed] = list.splice(idx, 1);
            try { await saveAll(); }
            catch (error) {
                if (!list.includes(removed)) {
                    const afterIndex = after ? list.indexOf(after) : -1;
                    const beforeIndex = before ? list.indexOf(before) : -1;
                    const restoreIndex = afterIndex >= 0 ? afterIndex : beforeIndex >= 0 ? beforeIndex + 1 : Math.min(idx, list.length);
                    list.splice(restoreIndex, 0, removed);
                }
                throw error;
            }
            return true;
        });
    }

    async function applyLibrary(id, options = {}) {
        const entry = getLibrary(id);
        if (!entry) throw new Error('Story Blueprint library not found');
        const data = normalize(entry);
        if (!data) throw new Error('Invalid Story Blueprint library data');
        const result = await storyBlueprintSystem.applyImportTextAndSave(JSON.stringify(data), {
            includeProgress: options.includeProgress !== false,
        });
        if (!result.ok) throw new Error(result.error || 'Story Blueprint import failed');
        return result;
    }

    function exportLibrary(id) {
        const entry = getLibrary(id);
        if (!entry) throw new Error('Story Blueprint library not found');
        const data = normalize(entry);
        if (!data) throw new Error('Invalid Story Blueprint library data');
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        let a;
        let appended = false;
        try {
            a = document.createElement('a');
            a.href = url;
            a.download = `story-blueprint-${safeFileName(entry.name)}.json`;
            document.body.appendChild(a);
            appended = true;
            a.click();
        } finally {
            try { if (appended) document.body.removeChild(a); }
            finally { URL.revokeObjectURL(url); }
        }
        return data;
    }

    async function importFileToLibrary(file) {
        const text = await file.text();
        let data;
        try { data = JSON.parse(text); } catch (e) { throw new Error(`Invalid JSON: ${e.message}`); }
        const valid = storyBlueprintSystem.validateBlueprintInput(data);
        if (!valid.ok) throw new Error(valid.error || 'Invalid Story Blueprint file');
        const isWrapped = data.type === 'group-director-story-blueprint';
        const blueprint = isWrapped ? (data.storyBlueprint?.blueprint || data.storyBlueprint) : valid.blueprint;
        const exportData = isWrapped ? data : {
            version: 1,
            type: 'group-director-story-blueprint',
            exportedAt: new Date().toISOString(),
            storyBlueprint: {
                blueprint: clone(valid.blueprint),
                doneSignals: [],
                lastGeneratedAt: 0,
                lastError: '',
                completeNoticeKey: '',
                continuePending: false,
            },
        };
        const name = exportData.libraryMeta?.name || blueprint?.title || file.name.replace(/\.json$/i, '') || 'Imported Story Blueprint';
        const entry = {
            id: genId(),
            name,
            description: exportData.libraryMeta?.description || '',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            sourceGroupName: exportData.source?.groupName || '',
            blueprintTitle: blueprint?.title || 'Story Blueprint',
            nodeCount: countNodes(blueprint?.nodes),
            stepCount: 0,
            includeProgress: Array.isArray(exportData.storyBlueprint?.doneSignals),
            exportData,
        };
        return enqueueMutation(async () => {
            const list = getLibraries();
            list.push(entry);
            try { await saveAll(); }
            catch (error) {
                const index = list.indexOf(entry);
                if (index >= 0) list.splice(index, 1);
                throw error;
            }
            return entry;
        });
    }

    function mutateApproved({ operation, id, definition, expectedSettings, validate }) {
        return enqueueMutation(async () => {
            if (settings !== expectedSettings) throw Error('STALE_LIBRARY_ASSET');
            validate();
            if (!['create','update','delete'].includes(operation)) throw Error('INVALID_LIBRARY_DRAFT');
            if (operation !== 'delete') validateBlueprintLibraryDefinition(definition);
            const list = getLibraries(), index = list.findIndex(row => row?.id === id);
            if (operation !== 'create' && index < 0) throw Error('STALE_LIBRARY_ASSET');
            if (definition && list.some(row => row.id !== id && row.name === definition.name)) throw Error('LIBRARY_NAME_CONFLICT');
            const before = index < 0 ? null : list[index];
            const next = operation === 'delete' ? null : {
                id: before?.id || genId(), ...clone(definition), createdAt: before?.createdAt ?? Date.now(), updatedAt: Date.now(),
                sourceGroupName: definition.exportData.source?.groupName || '', ...validateBlueprintLibraryDefinition(definition),
            };
            if (operation === 'create') list.push(next);
            else if (operation === 'delete') list.splice(index, 1);
            else list[index] = next;
            const applied = next && JSON.stringify(next);
            const result = status => ({status, id: next?.id || id, persistence: status === 'saved_unconfirmed' ? 'unconfirmed' : 'unknown'});
            // A failed save can have reached persistence. Never retry or restore a whole list.
            try { await saveAll(); } catch { return result('outcome_unknown'); }
            if (settings.storyBlueprintLibraries !== list || (next ? list.filter(row=>row?.id===next.id).length !== 1 || !list.includes(next) || JSON.stringify(next)!==applied : list.some(row=>row?.id===id))) return result('outcome_unknown');
            return result('saved_unconfirmed');
        });
    }

    return {
        applyApprovedToChat: args => enqueueMutation(() => applyApprovedBlueprintLibraryChat({...args,extensionKey:EXT_KEY})),
        mutateApproved,
        getLibraries,
        saveCurrentAsLibrary,
        getLibrary,
        deleteLibrary,
        applyLibrary,
        exportLibrary,
        importFileToLibrary,
        saveAll,
    };
}
