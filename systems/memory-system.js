import {
    assertExecutionSnapshot,
    captureExecutionSnapshot,
    snapshotValue,
} from './execution-snapshot.js';

/**
 * Character Memory System — per-character memory extraction and management.
 *
 * Storage: chat_metadata[EXT_KEY].charMemories = { [avatar]: [...entries] }
 *
 * Follows the same CRUD + scan + orphan detection patterns as Summary and Profile.
 */

export function createMemorySystem({
    settings,
    EXT_KEY,
    getChatMetadata,
    getChat,
    getCharacters,
    saveChatConditional,
    log,
    AgentRegistry,
    execute,
    buildContextPool,
    getCurrentGroup,
    createCaller,
    getContext,
    toastr: _toastr,
}) {
    const L = (zh, en) => (settings.lang === 'zh' ? zh : en);

    // ─── Helpers ───────────────────────────────────────────────────────

    function getStore(metadata = getChatMetadata()) {
        const cm = metadata;
        if (!cm[EXT_KEY]) cm[EXT_KEY] = {};
        if (!cm[EXT_KEY].charMemories) cm[EXT_KEY].charMemories = {};
        return cm[EXT_KEY].charMemories;
    }

    async function saveStore() {
        await saveChatConditional();
    }

    function getMemories(avatar, metadata = getChatMetadata()) {
        return getStore(metadata)[avatar] || [];
    }

    function setMemories(avatar, memories, metadata = getChatMetadata()) {
        getStore(metadata)[avatar] = memories;
    }

    function executionResource(metadata, chat, avatar) {
        const character = getCharacters().find(candidate => candidate.avatar === avatar);
        return {
            memories: getMemories(avatar, metadata),
            chat: chat.map(message => [message.name, message.mes, message.is_user, message.is_system, message.avatar]),
            character: character
                ? [character.name, character.description, character.personality, character.scenario]
                : null,
        };
    }

    async function replaceMemories(avatar, memories, metadata = getChatMetadata()) {
        const store = getStore(metadata);
        const hadPrevious = Object.prototype.hasOwnProperty.call(store, avatar);
        const previous = store[avatar];
        store[avatar] = memories;
        const appliedState = snapshotValue(memories);
        try { await saveStore(); }
        catch (error) {
            if (snapshotValue(store[avatar]) === appliedState) {
                if (hadPrevious) store[avatar] = previous;
                else delete store[avatar];
            }
            throw error;
        }
    }

    async function removeMemories(avatar, metadata = getChatMetadata()) {
        const store = getStore(metadata);
        if (!Object.prototype.hasOwnProperty.call(store, avatar)) return;
        const previous = store[avatar];
        delete store[avatar];
        try { await saveStore(); }
        catch (error) {
            if (!Object.prototype.hasOwnProperty.call(store, avatar)) store[avatar] = previous;
            throw error;
        }
    }

    // ─── CRUD ──────────────────────────────────────────────────────────

    /**
     * Generate memories for one character by scanning recent conversation.
     */
    async function generateForCharacter(avatar) {
        const agent = AgentRegistry.get('memory');
        if (!agent) throw new Error('Memory agent not registered');

        const char = getCharacters().find(c => c.avatar === avatar);
        if (!char) throw new Error(`Character not found: ${avatar}`);

        const executionSnapshot = captureExecutionSnapshot({
            getChatMetadata,
            getChat,
            getResource: (metadata, chat) => executionResource(metadata, chat, avatar),
        });
        const existing = structuredClone(getMemories(avatar, executionSnapshot.metadata));
        const agentConfig = settings.agentConfigs?.['memory'] || {};
        const stGenerateRaw = (opts) => getContext().generateRaw(opts);
        const caller = createCaller(
            agentConfig,
            stGenerateRaw,
            () => getContext().stopGeneration()
        );
        const group = getCurrentGroup();

        const pool = buildContextPool({
            group,
            memoryCharacter: char,
            memoryExistingList: () => existing,
        });

        const callCfg = { ...agentConfig.call };
        const result = await execute(agent, {
            pool, caller,
            config: { ...settings, call: callCfg },
        });

        if (!result || !Array.isArray(result) || result.length === 0) {
            const error = new Error(L('未提取到新记忆', 'No new memories extracted'));
            error.code = 'NO_NEW_MEMORIES';
            throw error;
        }

        assertExecutionSnapshot(executionSnapshot, {
            getChatMetadata,
            getChat,
            getResource: (metadata, chat) => executionResource(metadata, chat, avatar),
            message: 'Memory generation became stale',
        });

        // Re-read current memories to avoid overwriting concurrent changes
        const current = getMemories(avatar, executionSnapshot.metadata);
        const next = [...current, ...result];
        const max = settings.memoryMaxEntries ?? 200;
        while (next.length > max) next.shift();
        await replaceMemories(avatar, next, executionSnapshot.metadata);

        return result;
    }

    /**
     * Generate memories for all group members at once.
     */
    async function generateForAll() {
        const group = getCurrentGroup();
        if (!group) throw new Error(L('请先加入群聊', 'Not in a group chat'));

        const members = group.members.filter(a => !group.disabled_members?.includes(a));
        if (!members.length) throw new Error(L('群聊无可用角色', 'No enabled members'));

        const results = {};
        for (const avatar of members) {
            try {
                results[avatar] = await generateForCharacter(avatar);
            } catch (e) {
                log(`[GD] Memory generation failed for ${avatar}: ${e.message}`);
                results[avatar] = []; // consistent shape: always an array
            }
        }
        return results;
    }

    /** Update a single memory entry. */
    async function updateEntry(avatar, index, updates) {
        const memories = getMemories(avatar);
        if (index < 0 || index >= memories.length) throw new Error('Invalid index');
        const next = structuredClone(memories);
        Object.assign(next[index], updates);
        await replaceMemories(avatar, next);
    }

    /** Delete a single memory entry. */
    async function deleteEntry(avatar, index) {
        const memories = getMemories(avatar);
        if (index < 0 || index >= memories.length) throw new Error('Invalid index');
        const next = [...memories];
        next.splice(index, 1);
        await replaceMemories(avatar, next);
    }

    /** Delete ALL memories for a character. */
    async function deleteCharacterMemories(avatar) {
        await removeMemories(avatar);
    }

    /** Revert last N memories for a character. */
    async function revertLast(avatar, count = 1) {
        const memories = getMemories(avatar);
        const next = [...memories];
        const removed = next.splice(-count, count);
        await replaceMemories(avatar, next);
        return removed;
    }

    /** Reset all memories for all characters. */
    async function resetAll() {
        const cm = getChatMetadata();
        const meta = cm[EXT_KEY];
        if (!meta) {
            await saveStore();
            return;
        }
        const previous = meta.charMemories;
        const applied = {};
        meta.charMemories = applied;
        try { await saveStore(); }
        catch (error) {
            if (meta.charMemories === applied) meta.charMemories = previous;
            throw error;
        }
    }

    let _pruning = false;

    /** Trim all characters' memories to current max (call on settings change). */
    async function pruneAfter() {
        if (_pruning) return;
        _pruning = true;
        try {
            const max = settings.memoryMaxEntries ?? 200;
            const store = getStore();
            let changed = false;
            const changes = [];
            for (const [avatar, memories] of Object.entries(store)) {
                if (memories.length > max) {
                    const previous = structuredClone(memories);
                    while (memories.length > max) memories.shift();
                    changes.push({ avatar, previous, appliedState: snapshotValue(memories) });
                    changed = true;
                }
            }
            if (changed) {
                try { await saveStore(); }
                catch (error) {
                    for (const change of changes) {
                        if (snapshotValue(store[change.avatar]) === change.appliedState) {
                            store[change.avatar] = change.previous;
                        }
                    }
                    throw error;
                }
            }
        } finally {
            _pruning = false;
        }
    }

    const DEFAULT_COMPRESS_PROMPT = `Given the following character memories, produce a concise one-paragraph summary that captures the key events, emotional arcs, and character development. Preserve important names, places, and turning points.

Character: {{charName}}
Description: {{charDescription}}
Personality: {{charPersonality}}

Memories to compress:
{{memories}}

Output ONLY the summary text. No JSON, no formatting, no preamble. Write in the same language as the input memories.`;

    /** Compress old memories into an LLM-generated summary, keeping recent ones. */
    async function compressOldMemories(avatar, keepRecent = 5) {
        if (keepRecent <= 0) return null; // slice(0, -0) === slice(0, 0) === []
        const executionSnapshot = captureExecutionSnapshot({
            getChatMetadata,
            getChat,
            getResource: (metadata, chat) => executionResource(metadata, chat, avatar),
        });
        const memories = structuredClone(getMemories(avatar, executionSnapshot.metadata));
        if (memories.length <= keepRecent) return null;

        const char = getCharacters().find(c => c.avatar === avatar);
        if (!char) throw new Error('Character not found');

        const oldOnes = memories.slice(0, -keepRecent);
        const recentOnes = memories.slice(-keepRecent);

        // Build prompt
        const compressPrompt = settings.memoryCompressPrompt || DEFAULT_COMPRESS_PROMPT;
        const memoriesText = oldOnes.map((m, i) => `${i + 1}. ${m.event} [${m.mood}]`).join('\n');

        let filled = compressPrompt
            .replace(/\{\{charName\}\}/g, char.name)
            .replace(/\{\{charDescription\}\}/g, char.description || '')
            .replace(/\{\{charPersonality\}\}/g, char.personality || '')
            .replace(/\{\{memories\}\}/g, memoriesText);

        let summary;
        try {
            const agentConfig = settings.agentConfigs?.['memory'] || {};
            const stGenerateRaw = (opts) => getContext().generateRaw(opts);
            const compressCaller = createCaller(
                agentConfig,
                stGenerateRaw,
                () => getContext().stopGeneration()
            );
            const response = await compressCaller.generate(filled);
            summary = (typeof response === 'string' ? response : String(response ?? '')).trim();
            if (!summary) throw new Error('Empty response');
        } catch (e) {
            // Fallback: old semicolon join
            log(`Memory compress LLM failed (${e.message}), falling back to local join`);
            summary = oldOnes.map(m => m.event).join('; ');
        }

        // Replace old entries with one compressed entry
        const compressed = [{
            event: summary,
            mood: 'mixed',
            round: -1,
            timestamp: Date.now(),
            compressed: true,
            originalCount: oldOnes.length,
        }];

        const newMemories = [...compressed, ...recentOnes];
        assertExecutionSnapshot(executionSnapshot, {
            getChatMetadata,
            getChat,
            getResource: (metadata, chat) => executionResource(metadata, chat, avatar),
            message: 'Memory compression became stale',
        });
        await replaceMemories(avatar, newMemories, executionSnapshot.metadata);

        return { removed: oldOnes.length, kept: recentOnes.length, compressed: 1 };
    }

    // ─── Queries ───────────────────────────────────────────────────────

    /** Count memories per character. */
    function getStats() {
        const store = getStore();
        const stats = {};
        for (const [avatar, memories] of Object.entries(store)) {
            const char = getCharacters().find(c => c.avatar === avatar);
            stats[avatar] = {
                name: char?.name || avatar,
                count: memories.length,
                latestRound: memories.length > 0 ? memories[memories.length - 1].round : 0,
            };
        }
        return stats;
    }

    /**
     * Detect orphan memories (pointing to messages that were deleted).
     * Returns avatars with potentially stale memories.
     */
    function detectOrphans() {
        const store = getStore();
        const chatLen = getChat().length;
        const orphans = [];

        for (const [avatar, memories] of Object.entries(store)) {
            const stale = memories.filter(m => m.round > chatLen);
            if (stale.length > 0) {
                const char = getCharacters().find(c => c.avatar === avatar);
                orphans.push({ avatar, name: char?.name || avatar, staleCount: stale.length });
            }
        }
        return orphans;
    }

    /** List all memories for a character. */
    function listMemories(avatar) {
        return getMemories(avatar);
    }

    /** Get total memory count across all characters. */
    function totalCount() {
        let count = 0;
        for (const memories of Object.values(getStore())) {
            count += memories.length;
        }
        return count;
    }

    return {
        generateForCharacter, generateForAll,
        updateEntry, deleteEntry, deleteCharacterMemories,
        revertLast, resetAll, compressOldMemories,
        getStats, detectOrphans, listMemories, totalCount,
        getMemories, pruneAfter,
        // Internal helpers for auto-migration
        _setMemories: (avatar, mems) => replaceMemories(avatar, mems),
        _deleteKey: avatar => removeMemories(avatar),
    };
}
