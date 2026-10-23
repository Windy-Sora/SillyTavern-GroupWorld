import { copyJson, jsonKey } from '../muyu/core/json-contract.js';

const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fail = code => { const error = new Error(code); error.code = code; throw error; };
const fingerprint = value => {
    const result = JSON.stringify(value);
    if (typeof result !== 'string' || result.length > 16 * 1024 * 1024) fail('PROFILE_CONTEXT_TOO_LARGE');
    return result;
};
export const profileGenerationSettings = settings => Object.fromEntries(Object.entries(settings).filter(([name]) => !name.startsWith('muyu')));

/** Controlled single-character business generation; an exact execution permission belongs to the caller.
 * This first slice only supports the standard schema and missing-record saves, not overwrite or batch.
 * Inspection is private host state, never a tool DTO or persisted execution capability.
 */
export function createApprovedProfileGeneration({ settings, EXT_KEY, getChatMetadata, getChat, getCharacters,
    getCurrentGroup, getContext, hashChar, computeProfileSchemaHash, getDefaultProfileSchema,
    getDefaultProfileGeneratorPrompt, renderPrompt, createCaller, extractJsonObject, sanitizeJson,
    clearQuietPrompt, isBusy = () => false }) {
    let running = 0;
    const physical = new Set();
    function inspectGeneration(avatar, { fingerprint: includeFingerprint = true } = {}) {
        if (typeof avatar !== 'string' || !avatar || ['__proto__', 'constructor', 'prototype'].includes(avatar)) fail('INVALID_PROFILE_CHARACTER');
        const metadata = getChatMetadata(), chat = getChat(), root = metadata?.[EXT_KEY], store = root?.characterProfiles, archive = root?.archivedProfiles;
        if (!plain(metadata) || !Array.isArray(chat) || root !== undefined && !plain(root) || store !== undefined && !plain(store) || archive !== undefined && !plain(archive)) fail('UNSUPPORTED_PROFILE_STORE');
        if (root?.profileVersion !== undefined && root.profileVersion !== 1) fail('UNSUPPORTED_PROFILE_STORE');
        const schemaHash = computeProfileSchemaHash();
        if (root?.profileSchemaHash !== undefined && typeof root.profileSchemaHash !== 'string') fail('UNSUPPORTED_PROFILE_STORE');
        if (root?.profileSchemaHash && root.profileSchemaHash !== schemaHash) fail('PROFILE_SCHEMA_STALE');
        const characters = getCharacters();
        if (!Array.isArray(characters) || characters.length > 512 || characters.some(c => !plain(c)) || characters.filter(c => c.avatar === avatar).length !== 1) fail('PROFILE_CHARACTER_UNAVAILABLE');
        const character = characters.find(c => c.avatar === avatar);
        if (typeof character.name !== 'string' || character.name.length > 200 ||
            ['description', 'personality', 'scenario'].some(k => character[k] !== undefined && character[k] !== null && typeof character[k] !== 'string')) fail('PROFILE_CHARACTER_UNAVAILABLE');
        const exists = !!store && Object.hasOwn(store, avatar), entry = exists ? store[avatar] : null;
        const count = Object.keys(store || {}).length;
        if (count > 512) fail('PROFILE_CAPACITY_EXCEEDED');
        let schema;
        try {
            schema = copyJson(JSON.parse(settings.profileJsonSchema || getDefaultProfileSchema()));
            if (jsonKey(schema) !== jsonKey(JSON.parse(getDefaultProfileSchema()))) fail('UNSUPPORTED_PROFILE_SCHEMA');
        } catch { fail('UNSUPPORTED_PROFILE_SCHEMA'); }
        const context = getContext(), group = getCurrentGroup();
        const rest = includeFingerprint ? fingerprint({ chat, group, mainApi: context.mainApi,
            character: [character.name, character.description, character.personality, character.scenario],
            schema: [root?.profileVersion, root?.profileSchemaHash], settings: profileGenerationSettings(settings) }) : undefined;
        return { metadata, chat, root, store, archive, character, exists, entry, count, schema, schemaHash,
            rest, fingerprint: includeFingerprint ? fingerprint({ rest, entry }) : undefined };
    }
    function assertBaseline(before, avatar, applied) {
        const now = inspectGeneration(avatar);
        if (now.metadata !== before.metadata || now.chat !== before.chat || now.character !== before.character || now.archive !== before.archive || now.rest !== before.rest) fail('STALE_PROFILE_GENERATION');
        if (applied) {
            if (now.root !== applied.root || now.store !== applied.store || now.entry !== applied.entry || fingerprint(now.entry) !== applied.key) fail('STALE_PROFILE_GENERATION');
        } else if (now.root !== before.root || now.store !== before.store || now.exists !== before.exists || now.entry !== before.entry || now.fingerprint !== before.fingerprint) fail('STALE_PROFILE_GENERATION');
        return now;
    }
    // Cancellation stops waiting, not the native request/Provider. Retain the lease until it drains.
    async function tracked(operation, signal, cleanup) {
        if (signal?.aborted) fail('CANCELLED');
        const work = Promise.resolve().then(operation).finally(() => {
            try { cleanup?.(); } catch { /* UI cleanup cannot turn a result into a failed write. */ }
            physical.delete(work);
        });
        physical.add(work);
        let abort;
        const stopped = new Promise((_, reject) => {
            abort = () => { const error = new Error('CANCELLED'); error.code = 'CANCELLED'; reject(error); };
            signal?.addEventListener('abort', abort, { once: true });
            if (signal?.aborted) abort();
        });
        try { return await Promise.race([work, stopped]); }
        finally { signal?.removeEventListener('abort', abort); }
    }
    function parseOutput(response) {
        if (typeof response !== 'string' || new TextEncoder().encode(response).length > 65536) fail('INVALID_PROFILE_OUTPUT');
        let parsed;
        try { parsed = JSON.parse(response); } catch {
            try { const extracted = extractJsonObject(response); if (extracted) parsed = JSON.parse(sanitizeJson(extracted)); } catch { /* Invalid output never creates a failed placeholder. */ }
        }
        try { parsed = copyJson(parsed); } catch { fail('INVALID_PROFILE_OUTPUT'); }
        if (!plain(parsed) || Object.keys(parsed).some(k => !['summary', 'tags', 'motivation', 'relationships'].includes(k)) ||
            ['summary', 'motivation', 'relationships'].some(k => typeof parsed[k] !== 'string' || parsed[k].length > 12000) ||
            !Array.isArray(parsed.tags) || parsed.tags.length > 64 || parsed.tags.some(tag => typeof tag !== 'string' || tag.length > 200)) fail('INVALID_PROFILE_OUTPUT');
        return parsed;
    }
    async function generateApproved(avatar, { mode, signal, validate, onPhase, saveChatConfirmed, changed } = {}) {
        if (!['trial', 'save'].includes(mode) || typeof validate !== 'function') fail('INVALID_PROFILE_GENERATION');
        if (running || physical.size || isBusy()) fail('PROFILE_BUSY');
        if (!settings.profileEnabled) fail('PROFILE_DISABLED');
        if (mode === 'save' && typeof saveChatConfirmed !== 'function') fail('WRITE_UNAVAILABLE');
        const before = inspectGeneration(avatar);
        if (mode === 'save' && before.exists) fail('PROFILE_ALREADY_EXISTS');
        if (mode === 'save' && before.count >= 512) fail('PROFILE_CAPACITY_EXCEEDED');
        const check = () => {
            if (signal?.aborted) fail('CANCELLED');
            if (isBusy()) fail('PROFILE_BUSY');
            validate(); return assertBaseline(before, avatar);
        };
        check(); running++;
        try {
            const character = before.character;
            // Replacement callbacks preserve literal $&, $` and $' in user character fields.
            let prompt = (settings.profileGeneratorPrompt || getDefaultProfileGeneratorPrompt())
                .replace(/\{\{charName\}\}/g, () => character.name)
                .replace(/\{\{charDescription\}\}/g, () => character.description || '')
                .replace(/\{\{charPersonality\}\}/g, () => character.personality || '')
                .replace(/\{\{charScenario\}\}/g, () => character.scenario || '');
            onPhase?.('render'); check();
            prompt = await tracked(() => { check(); return renderPrompt(prompt, {}); }, signal);
            check();
            const config = structuredClone(settings.agentConfigs?.profile || {});
            const caller = createCaller(config, options => getContext().generateRaw({ ...options,
                ...(settings.profileJsonSchema ? { jsonSchema: { name: 'character_profile', value: before.schema, strict: true } } : {}) }));
            onPhase?.('generate'); check();
            const response = await tracked(() => { check(); return caller.generate(prompt, { signal }); }, signal,
                config.useCustom ? undefined : clearQuietPrompt);
            check();
            const profile = parseOutput(response);
            if (mode === 'trial') return { status: 'trial_completed', chatSave: 'not_started', profile,
                formatChecked: 'standard_fields', historicalExecutionOnly: true };
            const live = check();
            if (live.count >= 512) fail('PROFILE_CAPACITY_EXCEEDED');
            onPhase?.('save');
            if (check().count >= 512) fail('PROFILE_CAPACITY_EXCEEDED');
            const root = before.metadata[EXT_KEY] ?? (before.metadata[EXT_KEY] = {});
            const store = root.characterProfiles ?? (root.characterProfiles = {});
            const entry = { avatar, name: character.name, hash: hashChar(character.description, character.personality, character.scenario),
                profile, state: 'ready', manualEdited: false, updatedAt: Date.now() };
            store[avatar] = entry;
            const applied = { root, store, entry, key: fingerprint(entry) };
            let confirmed = false, current = false;
            try { await saveChatConfirmed(before.metadata); confirmed = true; } catch { /* Unknown is not a reason to retry or overwrite concurrent data. */ }
            try { if (!signal?.aborted) { validate(); assertBaseline(before, avatar, applied); current = true; } } catch { /* Result describes the historical write only. */ }
            if (current) { try { changed?.(); } catch { /* Notification cannot change the write outcome. */ } }
            return { status: !confirmed ? 'outcome_unknown' : current ? 'applied_confirmed' : 'partial',
                chatSave: confirmed ? 'confirmed' : 'unknown', profile, formatChecked: 'standard_fields', historicalExecutionOnly: true };
        } finally { running--; }
    }
    return { inspectGeneration, generateApproved, isGenerating: () => running > 0 || physical.size > 0 };
}
