/**
 * NPC Library System.
 *
 * Persistent convenience storage over the existing NPC export/import format.
 */

function clone(value) {
    return JSON.parse(JSON.stringify(value ?? null));
}

function safeFileName(name) {
    return String(name || 'npcs')
        .replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_')
        .substring(0, 50) || 'npcs';
}

export function createNpcLibrarySystem({
    settings,
    extension_settings,
    EXT_KEY,
    saveSettings,
    getCurrentGroup,
    npcSystem,
    parseNpcImportFile,
    applyNpcImport,
    getDefaultNpcPrompt,
    log = console.log,
}) {
    let _idCounter = 0;
    const genId = () => `npclib_${Date.now()}_${++_idCounter}`;

    function getLibraries() {
        if (!Array.isArray(settings.npcLibraries)) settings.npcLibraries = [];
        return settings.npcLibraries;
    }

    function saveAll() {
        extension_settings[EXT_KEY] = settings;
        saveSettings();
    }

    function normalize(entryOrData) {
        if (!entryOrData) return null;
        if (entryOrData.exportData?.type === 'npc-export') return entryOrData.exportData;
        if (entryOrData.type === 'npc-export') return entryOrData;
        return null;
    }

    function buildExportData(name, description = '') {
        const group = getCurrentGroup?.();
        const npcs = npcSystem.getNpcs?.() || [];
        return {
            version: 1,
            type: 'npc-export',
            exportedAt: new Date().toISOString(),
            source: {
                groupName: group?.name || '',
                groupNote: description || '',
            },
            template: {
                npcPrompt: settings.npcPrompt || getDefaultNpcPrompt?.() || '',
            },
            libraryMeta: {
                name,
                description: description || '',
                createdAt: Date.now(),
                updatedAt: Date.now(),
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

    function saveCurrentAsLibrary(name, description = '') {
        const title = String(name || '').trim();
        if (!title) throw new Error('Library name is required');
        const data = buildExportData(title, description);
        if (!data.npcs.length) throw new Error('No NPCs to save');
        const entry = {
            id: genId(),
            name: title,
            description: description || '',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            sourceGroupName: data.source.groupName || '',
            npcCount: data.npcs.length,
            exportData: data,
        };
        getLibraries().push(entry);
        saveAll();
        log(`[GroupDirector] NPC library saved: "${title}" (${entry.npcCount})`);
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

    function previewLibrary(id) {
        const entry = getLibrary(id);
        const data = normalize(entry);
        if (!data) return { total: 0, newCount: 0, overwriteCount: 0 };
        const parsed = parseNpcImportFile(JSON.stringify(data));
        if (!parsed.ok) return { total: data.npcs?.length || 0, newCount: 0, overwriteCount: 0, error: parsed.error };
        const npcs = parsed.data.npcs || [];
        return {
            total: npcs.length,
            newCount: npcs.filter(n => n._action === 'new').length,
            overwriteCount: npcs.filter(n => n._action === 'overwrite').length,
        };
    }

    async function applyLibrary(id, options = {}) {
        const entry = getLibrary(id);
        if (!entry) throw new Error('NPC library not found');
        const data = normalize(entry);
        if (!data) throw new Error('Invalid NPC library data');
        const parsed = parseNpcImportFile(JSON.stringify(data));
        if (!parsed.ok) throw new Error(parsed.error || 'Invalid NPC library data');
        const names = parsed.data.npcs.map(n => n.name);
        return await applyNpcImport(parsed.data, names, { importTemplate: !!options.importTemplate });
    }

    function exportLibrary(id) {
        const entry = getLibrary(id);
        if (!entry) throw new Error('NPC library not found');
        const data = normalize(entry);
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `npcs-${safeFileName(entry.name)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return data;
    }

    async function importFileToLibrary(file) {
        const text = await file.text();
        const parsed = parseNpcImportFile(text);
        if (!parsed.ok) throw new Error(parsed.error || 'Invalid NPC export');
        const data = JSON.parse(text);
        const name = data.libraryMeta?.name || data.source?.groupName || file.name.replace(/\.json$/i, '') || 'Imported NPCs';
        const entry = {
            id: genId(),
            name,
            description: data.libraryMeta?.description || data.source?.groupNote || '',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            sourceGroupName: data.source?.groupName || '',
            npcCount: Array.isArray(data.npcs) ? data.npcs.length : 0,
            exportData: data,
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
        previewLibrary,
        applyLibrary,
        exportLibrary,
        importFileToLibrary,
        saveAll,
    };
}
