const record = value => value && typeof value === 'object' && !Array.isArray(value);
const moods = new Set(['happy', 'sad', 'angry', 'fearful', 'excited', 'neutral', 'mixed']);
const fail = code => { const error = new Error(code); error.code = code; throw error; };
const key = value => {
    const text = JSON.stringify(value);
    if (typeof text !== 'string' || text.length > 16 * 1024 * 1024) fail('MEMORY_CONTEXT_TOO_LARGE');
    return text;
};
/** Assistant history/config persistence is not a change to the GD business generation contract. */
export const memoryGenerationSettings = settings => Object.fromEntries(Object.entries(settings).filter(([name]) => !name.startsWith('muyu')));

/** Controlled business generation. No UI/permissions here; callers must approve an exact ticket. */
export function createApprovedMemoryGeneration({ settings, EXT_KEY, getChatMetadata, getChat, getCharacters,
    AgentRegistry, execute, buildContextPool, getCurrentGroup, createCaller, getContext, isBusy = () => false }) {
    let running = 0;
    const physical = new Set();
    function inspect(avatar, { fingerprint = true } = {}) {
        if (typeof avatar !== 'string' || !avatar || ['__proto__', 'constructor', 'prototype'].includes(avatar)) fail('INVALID_MEMORY_CHARACTER');
        const metadata = getChatMetadata(), chat = getChat(), root = metadata?.[EXT_KEY], store = root?.charMemories;
        if (!record(metadata) || !Array.isArray(chat) || root !== undefined && !record(root) || store !== undefined && !record(store)) fail('UNSUPPORTED_MEMORY_STORE');
        const entries = store && Object.hasOwn(store, avatar) ? store[avatar] : [];
        if (!Array.isArray(entries) || entries.some(row => !record(row) || typeof row.event !== 'string')) fail('UNSUPPORTED_MEMORY_STORE');
        const character = getCharacters().find(row => row.avatar === avatar), agent = AgentRegistry.get('memory');
        if (!character || !agent) fail('MEMORY_GENERATION_UNAVAILABLE');
        const limit = settings.memoryMaxEntries ?? 200;
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2000) fail('UNSUPPORTED_MEMORY_LIMIT');
        const group = getCurrentGroup();
        return { metadata, chat, root, store, entries, hasEntries: !!store && Object.hasOwn(store, avatar), character, agent, group, limit,
            fingerprint: fingerprint ? key({ chat, entries, character: [character.name, character.description, character.personality, character.scenario], group, settings: memoryGenerationSettings(settings) }) : undefined };
    }
    function assertBaseline(before, avatar, applied) {
        const now = inspect(avatar);
        if (now.metadata !== before.metadata || now.chat !== before.chat || now.character !== before.character || now.agent !== before.agent) fail('STALE_MEMORY_GENERATION');
        if (!applied) {
            if (now.root !== before.root || now.store !== before.store || now.hasEntries !== before.hasEntries ||
                before.hasEntries && now.entries !== before.entries || now.fingerprint !== before.fingerprint) fail('STALE_MEMORY_GENERATION');
        } else if (now.root !== applied.root || now.store !== applied.store || now.entries !== applied.entries || key(now.entries) !== applied.key ||
            key({ chat: now.chat, character: [now.character.name, now.character.description, now.character.personality, now.character.scenario], group: now.group, settings: memoryGenerationSettings(settings) }) !== before.restKey) fail('STALE_MEMORY_GENERATION');
        return now;
    }
    async function generateApproved(avatar, { mode, signal, validate, onPhase, saveChatConfirmed, changed } = {}) {
        if (!['trial', 'save'].includes(mode) || typeof validate !== 'function') fail('INVALID_MEMORY_GENERATION');
        if (running || physical.size || isBusy()) fail('MEMORY_BUSY');
        if (mode === 'save' && typeof saveChatConfirmed !== 'function') fail('WRITE_UNAVAILABLE');
        const before = inspect(avatar);
        before.restKey = key({ chat: before.chat, character: [before.character.name, before.character.description, before.character.personality, before.character.scenario], group: before.group, settings: memoryGenerationSettings(settings) });
        const check = () => {
            if (signal?.aborted) fail('CANCELLED');
            validate(); assertBaseline(before, avatar);
        };
        check(); running++;
        try {
            // Copy the pipeline contract; do not replace the shared registered Agent.
            const stages = [...before.agent.pipelineOrder], functions = { ...before.agent.pipeline };
            const guarded = { ...before.agent, pipelineOrder: stages, pipeline: {} };
            for (const stage of stages) if (typeof functions[stage] === 'function') guarded.pipeline[stage] = async (...args) => {
                check(); const value = await functions[stage](...args); check(); return value;
            };
            const config = structuredClone(settings.agentConfigs?.memory || {});
            const original = createCaller(config, options => getContext().generateRaw(options));
            let modelStarted = false;
            const caller = { ...original, generate: async (prompt, options) => {
                check(); if (modelStarted) fail('MEMORY_CALL_ALREADY_STARTED');
                modelStarted = true; onPhase?.('generate');
                // Retain the physical lease after managedCall stops waiting for a native request.
                const work = Promise.resolve().then(() => { check(); return original.generate(prompt, options); });
                physical.add(work);
                try { return await work; } finally { physical.delete(work); }
            } };
            const pool = buildContextPool({ group: before.group, memoryCharacter: before.character,
                memoryExistingList: () => structuredClone(before.entries) });
            check(); onPhase?.('render');
            const result = await execute(guarded, { pool, caller,
                config: { ...settings, enableTrace: false, call: { ...config.call, retries: 0, signal } } });
            check();
            if (!Array.isArray(result)) fail('INVALID_MEMORY_OUTPUT');
            if (!result.length) return { status: 'no_result', chatSave: 'not_started', generated: 0, pruned: 0, entries: [] };
            if (result.length > 1024 || result.some(row => !record(row) || typeof row.event !== 'string' || !row.event.trim() || row.event.length > 12000 || !moods.has(row.mood || 'neutral'))) fail('INVALID_MEMORY_OUTPUT');
            const timestamp = Date.now();
            const entries = result.map(row => ({ event: row.event.trim(), mood: row.mood || 'neutral', round: before.chat.length, timestamp }));
            if (new TextEncoder().encode(JSON.stringify(entries)).length > 32768) fail('MEMORY_OUTPUT_TOO_LARGE');
            const pruned = Math.max(0, before.entries.length + entries.length - before.limit);
            if (mode === 'trial') return { status: 'trial_completed', chatSave: 'not_started', generated: entries.length, pruned: 0, wouldPrune: pruned, entries };
            check(); onPhase?.('save'); check();
            const root = before.metadata[EXT_KEY] ?? (before.metadata[EXT_KEY] = {});
            const store = root.charMemories ?? (root.charMemories = {});
            const next = [...before.entries, ...entries].slice(-before.limit);
            store[avatar] = next;
            const applied = { root, store, entries: next, key: key(next) };
            let confirmed = false;
            try { await saveChatConfirmed(before.metadata); confirmed = true; } catch { /* Unknown save never retries or erases concurrent edits. */ }
            let current = false;
            try { if (!signal?.aborted) { validate(); assertBaseline(before, avatar, applied); current = true; } } catch { /* Historical write is not current state. */ }
            try { changed?.(); } catch { /* UI observers cannot change execution outcome. */ }
            return { status: !confirmed ? 'outcome_unknown' : current ? 'applied_confirmed' : 'partial',
                chatSave: confirmed ? 'confirmed' : 'unknown', generated: entries.length, pruned, entries };
        } finally { running--; }
    }
    return { generateApproved, inspectGeneration: inspect, isGenerating: () => running > 0 || physical.size > 0 };
}
