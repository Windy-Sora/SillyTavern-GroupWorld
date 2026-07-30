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
    const genId = () => `sblib_${Date.now()}_${++_idCounter}`;

    function getLibraries() {
        if (!Array.isArray(settings.storyBlueprintLibraries)) settings.storyBlueprintLibraries = [];
        return settings.storyBlueprintLibraries;
    }

    function saveAll() {
        extension_settings[EXT_KEY] = settings;
        saveSettings();
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

    function saveCurrentAsLibrary(name, description = '', options = {}) {
        const entry = buildEntry(name, description, options.includeProgress !== false);
        getLibraries().push(entry);
        saveAll();
        log(`[GroupDirector] Story Blueprint library saved: "${entry.name}"`);
        return entry;
    }

    function getLibrary(id) {
        return getLibraries().find(x => x.id === id) || null;
    }

    function deleteLibrary(id) {
        const list = getLibraries();
        const idx = list.findIndex(x => x.id === id);
        if (idx < 0) return false;
        list.splice(idx, 1);
        saveAll();
        return true;
    }

    async function applyLibrary(id, options = {}) {
        const entry = getLibrary(id);
        if (!entry) throw new Error('Story Blueprint library not found');
        const data = normalize(entry);
        if (!data) throw new Error('Invalid Story Blueprint library data');
        const result = storyBlueprintSystem.applyImportText(JSON.stringify(data), {
            includeProgress: options.includeProgress !== false,
        });
        if (!result.ok) throw new Error(result.error || 'Story Blueprint import failed');
        await saveChatConditional?.();
        return result;
    }

    function exportLibrary(id) {
        const entry = getLibrary(id);
        if (!entry) throw new Error('Story Blueprint library not found');
        const data = normalize(entry);
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `story-blueprint-${safeFileName(entry.name)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
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
        getLibraries().push(entry);
        saveAll();
        return entry;
    }

    return {
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
