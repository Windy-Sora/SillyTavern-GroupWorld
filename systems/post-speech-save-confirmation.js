import { snapshotValue } from './execution-snapshot.js';

export class PostSpeechPersistenceUnknownError extends Error {
    constructor(cause) {
        super(`PostSpeech persistence status is unknown: verification read failed (${cause.message})`, { cause });
        this.name = 'PostSpeechPersistenceUnknownError';
        this.persistenceUnknown = true;
    }
}

// The host resolves saveChatConditional even after a failed save or timeout.
export function createConfirmedPostSpeechChatSave({
    saveChatConditional, getCurrentChatId, getCurrentGroup, getContext,
    getChatMetadata, getRequestHeaders, EXT_KEY,
    fetchChat = fetch,
}) {
    return async function savePostSpeechChatConfirmed(metadata = getChatMetadata()) {
        const chatId = getCurrentChatId();
        if (!chatId) throw new Error('No chat is available for PostSpeech persistence');
        const group = getCurrentGroup();
        const context = group ? null : getContext();
        const character = context?.characters?.[context.characterId];
        if (!group && !character) throw new Error('No character is available for PostSpeech persistence');
        const expected = snapshotValue(metadata[EXT_KEY]?.postSpeechDecisions ?? []);

        await saveChatConditional();

        let storedDecisions;
        try {
            const response = await fetchChat(group ? '/api/chats/group/get' : '/api/chats/get', {
                method: 'POST',
                headers: getRequestHeaders(),
                cache: 'no-cache',
                body: JSON.stringify(group
                    ? { id: chatId }
                    : { ch_name: character.name, file_name: chatId, avatar_url: character.avatar }),
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const storedChat = await response.json();
            if (!Array.isArray(storedChat) || !storedChat.length || !storedChat[0]?.chat_metadata) {
                throw new Error('chat header is unavailable');
            }
            storedDecisions = storedChat[0].chat_metadata[EXT_KEY]?.postSpeechDecisions ?? [];
        } catch (error) {
            throw new PostSpeechPersistenceUnknownError(error);
        }
        const stored = snapshotValue(storedDecisions);
        if (stored !== expected && stored !== snapshotValue(metadata[EXT_KEY]?.postSpeechDecisions ?? [])) {
            throw new Error('PostSpeech persistence could not be confirmed');
        }
    };
}
