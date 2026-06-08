export function createHistorySystem({ getChatMetadata, getChat, EXT_KEY, saveChatConditional, settings, log }) {
    const cm = () => getChatMetadata();

    function getDirectorHistory() {
        return cm()?.[EXT_KEY]?.directorHistory || [];
    }

    async function addToDirectorHistory(entry) {
        const meta = cm();
        if (!meta[EXT_KEY]) meta[EXT_KEY] = {};
        if (!meta[EXT_KEY].historyMeta) meta[EXT_KEY].historyMeta = {};
        if (!meta[EXT_KEY].directorHistory) meta[EXT_KEY].directorHistory = [];
        entry._chatLength = getChat().length;
        meta[EXT_KEY].directorHistory.push(entry);
        if (meta[EXT_KEY].historyMeta.scriptPrompt !== settings.llmScriptPrompt) {
            meta[EXT_KEY].historyMeta.scriptPrompt = settings.llmScriptPrompt;
        }
        await saveChatConditional();
    }

    async function pruneDirectorHistory(newChatLength) {
        const history = getDirectorHistory();
        if (!history.length) return;
        const pruned = history.filter(e => (e._chatLength || 0) <= newChatLength);
        if (pruned.length < history.length) {
            cm()[EXT_KEY].directorHistory = pruned;
            await saveChatConditional();
            log(`Pruned ${history.length - pruned.length} stale director history entries (chatLength=${newChatLength})`);
        }
    }

    return { getDirectorHistory, addToDirectorHistory, pruneDirectorHistory };
}
