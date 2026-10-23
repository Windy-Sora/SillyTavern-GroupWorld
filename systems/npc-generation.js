const record = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fail = code => { const error = new Error(code); error.code = code; throw error; };
const key = value => {
    const result = JSON.stringify(value);
    if (typeof result !== 'string' || result.length > 16 * 1024 * 1024) fail('NPC_CONTEXT_TOO_LARGE');
    return result;
};
const nameKey = name => name.trim().toLowerCase();
export const npcGenerationSettings = settings => Object.fromEntries(Object.entries(settings).filter(([name]) => !name.startsWith('muyu')));

/** Generation is not character-card import. Callers must authorize an exact private execution ticket. */
export function createApprovedNpcGeneration({ settings, EXT_KEY, getChatMetadata, getChat, getCharacters,
    getCurrentGroup, getContext, AgentRegistry, execute, buildContextPool, createCaller, isBusy = () => false }) {
    let running = 0;
    const physical = new Set();
    function inspectGeneration({ count, fingerprint = true } = {}) {
        const metadata = getChatMetadata(), chat = getChat(), root = metadata?.[EXT_KEY], list = root?.npcs;
        if (!record(metadata) || !Array.isArray(chat) || root !== undefined && !record(root) ||
            list !== undefined && (!Array.isArray(list) || list.length > 512 || list.some(row => !record(row) || typeof row.name !== 'string'))) fail('UNSUPPORTED_NPC_STORE');
        const entries = list || [], characters = getCharacters(), agent = AgentRegistry.get('npc');
        if (!agent || !Array.isArray(characters) || characters.length > 512 || characters.some(c => !record(c) || typeof c.name !== 'string')) fail('NPC_GENERATION_UNAVAILABLE');
        const limit = settings.npcMaxCount ?? 10, configured = settings.npcBatchSize ?? 3, requested = count ?? configured;
        if (![limit, configured, requested].every(n => Number.isSafeInteger(n) && n >= 1 && n <= 200)) fail('UNSUPPORTED_NPC_LIMIT');
        const effectiveCount = Math.min(requested, Math.max(0, limit - entries.length));
        if (settings.npcGenerateFirstMes !== undefined && typeof settings.npcGenerateFirstMes !== 'boolean') fail('UNSUPPORTED_NPC_LIMIT');
        const group = getCurrentGroup();
        return { metadata, chat, root, list, entries, characters, agent, group, limit, requested, effectiveCount,
            firstMes: settings.npcGenerateFirstMes ?? false,
            fingerprint: fingerprint ? key({ chat, entries, characters, group, settings: npcGenerationSettings(settings) }) : undefined };
    }
    function assertBaseline(before, count, applied) {
        const now = inspectGeneration({ count });
        if (now.metadata !== before.metadata || now.chat !== before.chat || now.agent !== before.agent ||
            now.characters.length !== before.characters.length || now.characters.some((c, i) => c !== before.characters[i])) fail('STALE_NPC_GENERATION');
        if (!applied) {
            if (now.root !== before.root || now.list !== before.list || now.fingerprint !== before.fingerprint) fail('STALE_NPC_GENERATION');
        } else if (now.root !== applied.root || now.list !== applied.list || key(now.entries) !== applied.key ||
            key({ chat: now.chat, characters: now.characters, group: now.group, settings: npcGenerationSettings(settings) }) !== before.restKey) fail('STALE_NPC_GENERATION');
        return now;
    }
    async function generateApproved({ mode, count, signal, validate, onPhase, saveChatConfirmed, changed } = {}) {
        if (!['trial', 'save'].includes(mode) || typeof validate !== 'function') fail('INVALID_NPC_GENERATION');
        if (running || physical.size || isBusy()) fail('NPC_BUSY');
        if (!settings.npcEnabled) fail('NPC_DISABLED');
        if (mode === 'save' && typeof saveChatConfirmed !== 'function') fail('WRITE_UNAVAILABLE');
        const before = inspectGeneration({ count });
        if (!before.effectiveCount) fail('NPC_CAPACITY_EXCEEDED');
        // Snapshot identity separately: a provider must not mutate our baseline array in place.
        before.characters = [...before.characters];
        before.restKey = key({ chat: before.chat, characters: before.characters, group: before.group, settings: npcGenerationSettings(settings) });
        const check = () => {
            if (signal?.aborted) fail('CANCELLED');
            if (isBusy()) fail('NPC_BUSY');
            validate(); return assertBaseline(before, count);
        };
        check(); running++;
        try {
            const stages = [...before.agent.pipelineOrder], functions = { ...before.agent.pipeline };
            const guarded = { ...before.agent, pipelineOrder: stages, pipeline: {} };
            for (const stage of stages) if (typeof functions[stage] === 'function') guarded.pipeline[stage] = async (...args) => {
                check(); const result = await functions[stage](...args); check(); return result;
            };
            const config = structuredClone(settings.agentConfigs?.npc || {});
            const original = createCaller(config, options => getContext().generateRaw(options));
            let modelStarted = false;
            const caller = { ...original, generate: async (prompt, options) => {
                check(); if (modelStarted) fail('NPC_CALL_ALREADY_STARTED');
                modelStarted = true; onPhase?.('generate');
                const work = Promise.resolve().then(() => { check(); return original.generate(prompt, options); });
                physical.add(work);
                try { return await work; } finally { physical.delete(work); }
            } };
            const pool = buildContextPool({ group: before.group, npcExistingList: () => structuredClone(before.entries),
                npcBatchSize: () => before.effectiveCount, npcGenerateFirstMes: () => before.firstMes });
            onPhase?.('render'); check();
            const result = await execute(guarded, { pool, caller,
                config: { ...settings, enableTrace: false, call: { ...config.call, retries: 0, signal } } });
            check();
            if (!Array.isArray(result) || result.length > 1024) fail('INVALID_NPC_OUTPUT');
            const names = new Set([...before.entries, ...before.characters].map(c => nameKey(c.name)));
            const npcs = [], timestamp = Date.now();
            let skippedDuplicates = 0, omittedExcess = 0;
            for (const row of result) {
                if (!record(row) || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 200 ||
                    typeof row.description !== 'string' || !row.description.trim() || row.description.length > 12000 ||
                    ['personality', 'scenario'].some(field => typeof row[field] !== 'string' || row[field].length > 12000) ||
                    before.firstMes && (typeof row.first_mes !== 'string' || row.first_mes.length > 12000)) fail('INVALID_NPC_OUTPUT');
                const name = row.name.trim(), normalized = nameKey(name);
                if (names.has(normalized)) { skippedDuplicates++; continue; }
                names.add(normalized);
                if (npcs.length >= before.effectiveCount) { omittedExcess++; continue; }
                // The model/registered Agent cannot forge card-import links, IDs or timestamps.
                npcs.push({ name, description: row.description.trim(), personality: row.personality.trim(), scenario: row.scenario.trim(),
                    ...(before.firstMes ? { first_mes: row.first_mes.trim() } : {}), imported: false, importedAvatar: null, createdAt: timestamp });
            }
            if (new TextEncoder().encode(JSON.stringify(npcs)).length > 32768) fail('NPC_OUTPUT_TOO_LARGE');
            const base = { generated: npcs.length, requested: before.requested, effectiveCount: before.effectiveCount,
                skippedDuplicates, omittedExcess, npcs: structuredClone(npcs), historicalExecutionOnly: true };
            if (!npcs.length) return { ...base, status: 'no_result', chatSave: 'not_started' };
            if (mode === 'trial') return { ...base, status: 'trial_completed', chatSave: 'not_started' };
            onPhase?.('save'); check();
            const root = before.metadata[EXT_KEY] ?? (before.metadata[EXT_KEY] = {});
            const list = root.npcs ?? (root.npcs = []);
            list.push(...npcs);
            const applied = { root, list, key: key(list) };
            let confirmed = false, current = false;
            try { await saveChatConfirmed(before.metadata); confirmed = true; } catch { /* Unknown save never retries or restores the whole store. */ }
            try { if (!signal?.aborted) { validate(); assertBaseline(before, count, applied); current = true; } } catch { /* Historical result is not current state. */ }
            if (current) { try { changed?.(); } catch { /* Observers cannot alter the write outcome. */ } }
            return { ...base, status: !confirmed ? 'outcome_unknown' : current ? 'applied_confirmed' : 'partial', chatSave: confirmed ? 'confirmed' : 'unknown' };
        } finally { running--; }
    }
    return { inspectGeneration, generateApproved, isGenerating: () => running > 0 || physical.size > 0 };
}
