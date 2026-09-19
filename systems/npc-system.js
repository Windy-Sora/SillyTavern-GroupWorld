import {
    assertExecutionSnapshot,
    captureExecutionSnapshot,
    snapshotValue,
    staleExecutionError,
} from './execution-snapshot.js';

function sameValue(a, b) {
    return snapshotValue(a) === snapshotValue(b);
}

function npcFailure(error, conflict) {
    if (!conflict) return error;
    const failure = new Error(`${error.message}; concurrent NPC edits may retain this operation's data`, { cause: error });
    failure.rollbackIncomplete = true;
    return failure;
}

export class NpcImportTrackingError extends Error {
    constructor(avatarName, cause) {
        super(`Character was created as ${avatarName}, but its import status could not be confirmed`);
        this.name = 'NpcImportTrackingError';
        this.avatarName = avatarName;
        this.remoteCreated = true;
        this.cause = cause;
    }
}

function createNpcImportId() {
    if (globalThis.crypto?.randomUUID) return `npc_${globalThis.crypto.randomUUID()}`;
    return `npc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * NPC System — generate, store, edit, and import NPCs as character cards.
 *
 * Storage: chat_metadata[EXT_KEY].npcs = [{ name, description, personality,
 *   scenario, first_mes, imported, importedAvatar, createdAt }, ...]
 */
export function createNpcSystem({
    settings,
    EXT_KEY,
    getChatMetadata,
    getChat,
    saveChatConditional,
    characters,
    getCharacters = () => characters,
    log,
    AgentRegistry,
    execute,
    buildContextPool,
    getCurrentGroup,
    createCaller,
    getContext,
    toastr,
}) {
    const L = (zh, en) => (settings.lang === 'zh' ? zh : en);
    const fieldRevisions = new WeakMap();
    const entryRevisions = new WeakMap();

    function bumpFieldRevision(entry, key) {
        let fields = fieldRevisions.get(entry);
        if (!fields) { fields = new Map(); fieldRevisions.set(entry, fields); }
        const revision = (fields.get(key) || 0) + 1;
        fields.set(key, revision);
        entryRevisions.set(entry, (entryRevisions.get(entry) || 0) + 1);
        return revision;
    }

    // ─── Helpers ───────────────────────────────────────────────────────

    function getNpcs(metadata = getChatMetadata()) {
        const cm = metadata;
        if (!cm[EXT_KEY]) cm[EXT_KEY] = {};
        if (!cm[EXT_KEY].npcs) cm[EXT_KEY].npcs = [];
        return cm[EXT_KEY].npcs;
    }

    async function saveNpcs(metadata = getChatMetadata()) {
        await saveChatConditional(metadata);
    }

    async function saveMutation(metadata, rollback) {
        try { await saveNpcs(metadata); }
        catch (error) {
            if (error.persistenceUnknown) throw error;
            throw npcFailure(error, rollback());
        }
        if (getChatMetadata() !== metadata) {
            throw staleExecutionError('NPC change became stale after the chat changed; the original chat was saved');
        }
    }

    function findCurrentNpc(metadata, entry, oldName) {
        const list = getNpcs(metadata);
        let index = list.indexOf(entry);
        if (index < 0 && entry.importId) index = list.findIndex(npc => npc?.importId === entry.importId);
        if (index < 0) index = list.findIndex(npc => npc?.name?.toLowerCase() === entry.name?.toLowerCase());
        if (index < 0 && oldName !== entry.name) {
            index = list.findIndex(npc => npc?.name?.toLowerCase() === oldName?.toLowerCase());
        }
        return { list, index };
    }

    async function replaceNpcs(npcs, metadata = getChatMetadata()) {
        const root = metadata[EXT_KEY] || (metadata[EXT_KEY] = {});
        const previous = root.npcs;
        root.npcs = npcs;
        const appliedState = snapshotValue(npcs);
        try { await saveNpcs(metadata); }
        catch (error) {
            if (!error.persistenceUnknown && snapshotValue(root.npcs) === appliedState) root.npcs = previous;
            throw error;
        }
    }

    /** Check if a name conflicts with existing NPCs or characters. */
    function nameExists(name) {
        const lower = name.toLowerCase();
        if (getNpcs().some(n => n.name.toLowerCase() === lower)) return true;
        if ((getCharacters() || []).some(c => c.name.toLowerCase() === lower)) return true;
        return false;
    }

    // ─── CRUD ──────────────────────────────────────────────────────────

    async function generateNpcs() {
        const agent = AgentRegistry.get('npc');
        if (!agent) throw new Error('NPC agent not registered');

        const executionSnapshot = captureExecutionSnapshot({
            getChatMetadata,
            getChat,
            getResource: metadata => getNpcs(metadata),
        });
        const existingNpcs = structuredClone(getNpcs(executionSnapshot.metadata));
        const maxCount = settings.npcMaxCount ?? 10;
        const remaining = maxCount - existingNpcs.length;
        if (remaining <= 0) {
            throw new Error(L(`NPC 数量已达上限 (${maxCount})`, `NPC count limit reached (${maxCount})`));
        }

        const batchSize = Math.min(settings.npcBatchSize ?? 3, remaining);
        const group = getCurrentGroup();

        const agentConfig = settings.agentConfigs?.['npc'] || {};
        const stGenerateRaw = (opts) => getContext().generateRaw(opts);
        const caller = createCaller(
            agentConfig,
            stGenerateRaw,
            () => getContext().stopGeneration()
        );

        const pool = buildContextPool({
            group,
            npcExistingList: () => existingNpcs,
            npcBatchSize: () => batchSize,
            npcGenerateFirstMes: () => settings.npcGenerateFirstMes ?? false,
        });

        const callCfg = {
            ...agentConfig.call,
            onRetry: ({ attempt, maxRetries }) => {
                toastr?.()?.warning?.(L(`NPC 生成重试中 (${attempt}/${maxRetries})...`, `NPC retry (${attempt}/${maxRetries})...`));
            },
        };

        const result = await execute(agent, {
            pool,
            caller,
            config: { ...settings, call: callCfg, enableTrace: settings.debugLogging },
        });

        if (!result || !Array.isArray(result) || result.length === 0) {
            throw new Error(L('NPC 生成失败：LLM 未返回有效结果', 'NPC generation failed: no valid result'));
        }

        assertExecutionSnapshot(executionSnapshot, {
            getChatMetadata,
            getChat,
            getResource: metadata => getNpcs(metadata),
            message: 'NPC generation became stale',
        });

        // Add only accepted NPCs, so the return value matches the persisted change.
        const npcs = getNpcs(executionSnapshot.metadata);
        const added = [];
        for (const npc of result) {
            if (npcs.length >= maxCount) break;
            const lower = npc.name.toLowerCase();
            if (npcs.some(existing => existing.name.toLowerCase() === lower)
                || (getCharacters() || []).some(char => char.name.toLowerCase() === lower)) {
                log(`NPC dedup skipped: "${npc.name}" (already exists)`);
                continue;
            }
            npcs.push(npc);
            added.push(npc);
        }
        if (!added.length) return [];
        const addedStates = added.map(entry => ({
            entry, state: snapshotValue(entry), revision: entryRevisions.get(entry) || 0,
        }));
        await saveMutation(executionSnapshot.metadata, () => {
            let conflict = false;
            const current = getNpcs(executionSnapshot.metadata);
            for (const { entry, state, revision } of addedStates) {
                const index = current.indexOf(entry) >= 0
                    ? current.indexOf(entry)
                    : current.findIndex(npc => npc?.name?.toLowerCase() === entry.name?.toLowerCase());
                if (index < 0) continue;
                if (snapshotValue(current[index]) === state
                    && (entryRevisions.get(entry) || 0) === revision) current.splice(index, 1);
                else conflict = true;
            }
            return conflict;
        });

        return added;
    }

    async function updateNpc(index, updates) {
        const metadata = getChatMetadata();
        const npcs = getNpcs(metadata);
        if (index < 0 || index >= npcs.length) return;
        const entry = npcs[index];
        const oldName = entry.name;
        const previous = new Map(Object.keys(updates).map(key => [key, {
            present: Object.hasOwn(entry, key), value: structuredClone(entry[key]),
        }]));
        const revisions = new Map(Object.keys(updates).map(key => [key, bumpFieldRevision(entry, key)]));
        Object.assign(entry, updates);
        const applied = new Map(Object.keys(updates).map(key => [key, structuredClone(entry[key])]));
        await saveMutation(metadata, () => {
            const { list, index: currentIndex } = findCurrentNpc(metadata, entry, oldName);
            if (currentIndex < 0) return true;
            const current = list[currentIndex];
            let conflict = false;
            for (const [key, before] of previous) {
                if ((current === entry && fieldRevisions.get(entry)?.get(key) !== revisions.get(key))
                    || !sameValue(current[key], applied.get(key))) {
                    conflict = true;
                    continue;
                }
                if (before.present) current[key] = before.value;
                else delete current[key];
            }
            return conflict;
        });
    }

    async function deleteNpc(index) {
        const metadata = getChatMetadata();
        const npcs = getNpcs(metadata);
        if (index < 0 || index >= npcs.length) return;
        const before = npcs[index - 1];
        const after = npcs[index + 1];
        const [removed] = npcs.splice(index, 1);
        await saveMutation(metadata, () => {
            const current = getNpcs(metadata);
            if (current.includes(removed)
                || current.some(npc => npc?.name?.toLowerCase() === removed.name?.toLowerCase())) return true;
            const neighborIndex = neighbor => {
                if (!neighbor) return -1;
                const byIdentity = current.indexOf(neighbor);
                if (byIdentity >= 0) return byIdentity;
                if (neighbor.importId) {
                    const byId = current.findIndex(npc => npc?.importId === neighbor.importId);
                    if (byId >= 0) return byId;
                }
                return current.findIndex(npc => npc?.name?.toLowerCase() === neighbor.name?.toLowerCase());
            };
            const afterIndex = neighborIndex(after);
            const beforeIndex = neighborIndex(before);
            const restoreIndex = afterIndex >= 0 ? afterIndex : beforeIndex >= 0 ? beforeIndex + 1 : Math.min(index, current.length);
            current.splice(restoreIndex, 0, removed);
            return false;
        });
    }

    /**
     * Import an NPC as a character card via ST's API.
     * Uses the /api/characters/create endpoint which takes character JSON data
     * and creates a PNG card from DEFAULT_AVATAR_PATH.
     */
    async function importNpcAsCharacter(index) {
        const metadata = getChatMetadata();
        const npcs = getNpcs(metadata);
        const npc = npcs[index];
        if (!npc) throw new Error('NPC not found');
        if (npc.imported && npc.importedAvatar) return npc.importedAvatar;
        if (!npc.importId) npc.importId = createNpcImportId();
        const importId = npc.importId;
        const executionSnapshot = captureExecutionSnapshot({
            getChatMetadata,
            getResource: capturedMetadata => getNpcs(capturedMetadata),
        });

        // Build character data in V2 format
        const charData = {
            name: npc.name,
            description: npc.description || '',
            personality: npc.personality || '',
            scenario: npc.scenario || '',
            first_mes: npc.first_mes || '',
            create_date: new Date().toISOString(),
        };

        try {
            const csrfToken = (await getCsrfToken()) ?? '';
            assertExecutionSnapshot(executionSnapshot, {
                getChatMetadata,
                getResource: metadata => getNpcs(metadata),
                message: 'NPC import became stale',
            });
            const resp = await fetch('/api/characters/create', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfToken,
                },
                body: JSON.stringify({
                    ch_name: charData.name,
                    description: charData.description,
                    personality: charData.personality,
                    scenario: charData.scenario,
                    first_mes: charData.first_mes,
                }),
            });

            if (!resp.ok) {
                if (resp.status === 403) { _csrfToken = null; _csrfTokenTime = 0; }
                const err = await resp.text().catch(() => '');
                throw new Error(`Character create failed: ${resp.status} ${err.substring(0, 200)}`);
            }

            const avatarName = await resp.text();
            // avatarName is something like "张铁柱.png"
            if (getChatMetadata() === executionSnapshot.metadata) {
                const current = getNpcs(executionSnapshot.metadata);
                const currentIndex = current.findIndex(candidate => candidate.importId === importId);
                if (currentIndex >= 0) {
                    const next = structuredClone(current);
                    next[currentIndex] = { ...next[currentIndex], imported: true, importedAvatar: avatarName };
                    try {
                        await replaceNpcs(next, executionSnapshot.metadata);
                    } catch (saveError) {
                        executionSnapshot.metadata[EXT_KEY].npcs = next;
                        log('NPC import tracking save failed after character creation:', saveError.message);
                        throw new NpcImportTrackingError(avatarName, saveError);
                    }
                }
            }

            return avatarName;
        } catch (e) {
            log('NPC import error:', e.message);
            throw e;
        }
    }

    // Cache CSRF token with TTL
    let _csrfToken = null;
    let _csrfTokenTime = 0;
    const CSRF_TTL = 30 * 60 * 1000; // 30 minutes
    async function getCsrfToken() {
        if (_csrfToken && (Date.now() - _csrfTokenTime) < CSRF_TTL) return _csrfToken;
        const resp = await fetch('/csrf-token');
        const data = await resp.json();
        _csrfToken = data.token;
        _csrfTokenTime = Date.now();
        return _csrfToken;
    }

    return { getNpcs, generateNpcs, updateNpc, deleteNpc, importNpcAsCharacter, nameExists };
}
