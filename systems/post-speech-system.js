/**
 * PostSpeech Decision Store — persists multimodal policy decisions
 * per chat in chat_metadata, with dedup and prune support.
 *
 * Follows the same pattern as history-system.js (ledger) and
 * npc-system.js (NPCs).
 *
 * Record format:
 *   { messageIndex, messageName, capabilityId, params, policy, timestamp }
 *
 * Dedup key: `${messageIndex}:${capabilityId}`
 */

export function createPostSpeechSystem({
    settings,
    EXT_KEY,
    getChatMetadata,
    getChat,
    saveChatConditional,
    log,
}) {
    const DEDUP_PREFIX = 'ps:';

    // ─── Helpers ───────────────────────────────────────────────────────

    function getStore() {
        const cm = getChatMetadata();
        if (!cm[EXT_KEY]) cm[EXT_KEY] = {};
        if (!cm[EXT_KEY].postSpeechDecisions) cm[EXT_KEY].postSpeechDecisions = [];
        return cm[EXT_KEY].postSpeechDecisions;
    }

    async function saveStore() {
        await saveChatConditional();
    }

    function makeKey(messageIndex, capabilityId) {
        return `${DEDUP_PREFIX}${messageIndex}:${capabilityId}`;
    }

    // ─── CRUD ──────────────────────────────────────────────────────────

    /** Check if a decision was already made for this (message, capability). */
    function wasExecuted(messageIndex, capabilityId) {
        return getStore().some(
            r => r.messageIndex === messageIndex && r.capabilityId === capabilityId
        );
    }

    /** Record a decision after execution. */
    async function record(messageIndex, messageName, capabilityId, params, policy) {
        const store = getStore();
        store.push({
            messageIndex,
            messageName,
            capabilityId,
            params,
            policySummary: policy ? { intents: policy.intents?.length ?? 0, timing: policy.timing?.mode ?? 'immediate' } : null,
            timestamp: Date.now(),
        });
        // Keep storage bounded — max 500 records
        while (store.length > 500) store.shift();
        await saveStore();
    }

    /** List all decisions (oldest first) for visualization — matches execution order. */
    function list(limit = 50) {
        const store = getStore();
        return store.slice(-limit);
    }

    /** Prune decisions after a given message index (on MESSAGE_DELETED). */
    async function pruneAfter(messageIndex) {
        const store = getStore();
        const before = store.length;
        const filtered = store.filter(r => r.messageIndex <= messageIndex);
        if (filtered.length < before) {
            getChatMetadata()[EXT_KEY].postSpeechDecisions = filtered;
            await saveStore();
            log(`PostSpeech: pruned ${before - filtered.length} decisions after message ${messageIndex}`);
        }
    }

    /** Clear all decisions (on CHAT_CHANGED). */
    async function clearAll() {
        const cm = getChatMetadata();
        if (cm[EXT_KEY]) {
            cm[EXT_KEY].postSpeechDecisions = [];
            await saveStore();
        }
    }

    /** Total count of decisions in storage. */
    function count() {
        return getStore().length;
    }

    return { wasExecuted, record, list, pruneAfter, clearAll, count };
}
