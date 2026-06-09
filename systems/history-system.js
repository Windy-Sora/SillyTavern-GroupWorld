export function createHistorySystem({ getChatMetadata, getChat, EXT_KEY, saveChatConditional, settings, log }) {
    const cm = () => getChatMetadata();

    const getMessageId = (msg) => msg?.send_date || null;

    function getDirectorHistory() {
        return cm()?.[EXT_KEY]?.directorHistory || [];
    }

    async function addToDirectorHistory(entry) {
        const chat = getChat();
        const meta = cm();
        if (!meta[EXT_KEY]) meta[EXT_KEY] = {};
        if (!meta[EXT_KEY].historyMeta) meta[EXT_KEY].historyMeta = {};
        if (!meta[EXT_KEY].directorHistory) meta[EXT_KEY].directorHistory = [];
        // Anchor to the last message's unique id so pruning survives
        // mid-chat deletions. Unlike chat.length, send_date is immutable and
        // globally unique per message.
        entry._anchorDate = getMessageId(chat[chat.length - 1]);
        entry._chatLength = chat.length; // fallback for backward compat
        meta[EXT_KEY].directorHistory.push(entry);
        if (meta[EXT_KEY].historyMeta.scriptPrompt !== settings.llmScriptPrompt) {
            meta[EXT_KEY].historyMeta.scriptPrompt = settings.llmScriptPrompt;
        }
        await saveChatConditional();
    }

    async function pruneDirectorHistory() {
        const history = getDirectorHistory();
        if (!history.length) return;
        const chat = getChat();
        const presentIds = new Set(chat.map(getMessageId).filter(Boolean));
        const pruned = history.filter(e => {
            // New entries use id-based anchoring
            if (e._anchorDate) return presentIds.has(e._anchorDate);
            // Old entries without anchor fall back to length-based check
            return (e._chatLength || 0) <= chat.length;
        });
        if (pruned.length < history.length) {
            cm()[EXT_KEY].directorHistory = pruned;
            await saveChatConditional();
            log(`Pruned ${history.length - pruned.length} stale director history entries (chatLength=${chat.length})`);
        }
    }

    return { getDirectorHistory, addToDirectorHistory, pruneDirectorHistory };
}
