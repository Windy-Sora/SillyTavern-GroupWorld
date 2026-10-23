import { applyApprovedNpcLibraryChat } from './npc-library-chat.js';
import { validateNpcLibraryDefinition } from './npc-library-validation.js';
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
    let mutationQueue = Promise.resolve();
    function enqueueMutation(work) {
        const pending = mutationQueue.then(work, work);
        mutationQueue = pending.catch(() => {});
        return pending;
    }
    const genId = () => `npclib_${Date.now()}_${++_idCounter}`;

    function getLibraries() {
        if (!Array.isArray(settings.npcLibraries)) settings.npcLibraries = [];
        return settings.npcLibraries;
    }

    async function saveAll() {
        extension_settings[EXT_KEY] = settings;
        await saveSettings();
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

    async function saveCurrentAsLibrary(name, description = '') {
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
        return enqueueMutation(async () => {
            const list = getLibraries();
            list.push(entry);
            try { await saveAll(); }
            catch (error) {
                const index = list.indexOf(entry);
                if (index >= 0) list.splice(index, 1);
                throw error;
            }
            log(`[GroupDirector] NPC library saved: "${title}" (${entry.npcCount})`);
            return entry;
        });
    }

    function getLibrary(id) {
        return getLibraries().find(x => x?.id === id) || null;
    }

    async function deleteLibrary(id) {
        const list = getLibraries();
        const idx = list.findIndex(x => x?.id === id);
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
        if (!data) throw new Error('Invalid NPC library data');
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        let a;
        let appended = false;
        try {
            a = document.createElement('a');
            a.href = url;
            a.download = `npcs-${safeFileName(entry.name)}.json`;
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
        const list = getLibraries();
        list.push(entry);
        try { await saveAll(); }
        catch (error) {
            const index = list.indexOf(entry);
            if (index >= 0) list.splice(index, 1);
            throw error;
        }
        return entry;
    }


    function mutateApproved({ operation, id, definition, expectedSettings, validate }) {
        return enqueueMutation(async () => {
            if (settings !== expectedSettings) throw Error('STALE_LIBRARY_ASSET');
            validate();
            if (!['create','update','delete'].includes(operation)) throw Error('INVALID_LIBRARY_DRAFT');
            if (operation !== 'delete') validateNpcLibraryDefinition(definition);
            const list = getLibraries(), index = list.findIndex(row => row?.id === id);
            if (operation !== 'create' && index < 0) throw Error('STALE_LIBRARY_ASSET');
            if (definition && list.some(row => row.id !== id && row.name === definition.name)) throw Error('LIBRARY_NAME_CONFLICT');
            const before = index < 0 ? null : list[index];
            const next = operation === 'delete' ? null : {
                id: before?.id || genId(), ...clone(definition), createdAt: before?.createdAt ?? Date.now(), updatedAt: Date.now(),
                sourceGroupName: definition.exportData.source?.groupName || '', npcCount: definition.exportData.npcs.length,
            };
            if (operation === 'create') list.push(next);
            else if (operation === 'delete') list.splice(index, 1);
            else list[index] = next;
            const applied = next && JSON.stringify(next);
            const result = status => ({status, id: next?.id || id, persistence: status === 'saved_unconfirmed' ? 'unconfirmed' : 'unknown'});
            // A failed save can have reached persistence. Never retry or restore a whole list.
            try { await saveAll(); } catch { return result('outcome_unknown'); }
            if (settings.npcLibraries !== list || (next ? list.filter(row=>row?.id===next.id).length !== 1 || !list.includes(next) || JSON.stringify(next)!==applied : list.some(row=>row?.id===id))) return result('outcome_unknown');
            return result('saved_unconfirmed');
        });
    }

    function inspectChatLibrary(metadata) {
        const root=metadata?.[EXT_KEY];
        if(root!==undefined&&(!root||typeof root!=='object'||Array.isArray(root)))throw Error('LIBRARY_CHAT_UNAVAILABLE');
        const npcs=root?.npcs??[];
        if(!Array.isArray(npcs))throw Error('LIBRARY_CHAT_UNAVAILABLE');
        const names=new Set();
        for(const npc of npcs){
            if(!npc||typeof npc.name!=='string'||!npc.name.trim()||npc.name!==npc.name.trim()||names.has(npc.name.toLowerCase()))throw Error('INVALID_LIBRARY_CHAT');
            names.add(npc.name.toLowerCase());
        }
        return {npcs:clone(npcs),groupName:getCurrentGroup?.()?.name||'',template:{npcPrompt:settings.npcPrompt||getDefaultNpcPrompt?.()||''},rawPrompt:settings.npcPrompt??null};
    }
    function applyApprovedToChat(args) {
        return enqueueMutation(()=>applyApprovedNpcLibraryChat({...args,settings,extensionKey:EXT_KEY,saveSettings:saveAll}));
    }
    return {
        inspectChatLibrary, applyApprovedToChat,
        mutateApproved,
        getLibraries,
        saveCurrentAsLibrary,
        getLibrary,
        deleteLibrary: (...args) => enqueueMutation(() => deleteLibrary(...args)),
        previewLibrary,
        applyLibrary,
        exportLibrary,
        importFileToLibrary: (...args) => enqueueMutation(() => importFileToLibrary(...args)),
        saveAll,
    };
}
