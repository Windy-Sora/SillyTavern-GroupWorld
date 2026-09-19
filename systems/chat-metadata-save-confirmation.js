import { snapshotValue } from './execution-snapshot.js';

export class ChatMetadataPersistenceUnknownError extends Error {
    constructor(label, cause) {
        super(`${label} persistence status is unknown: verification read failed (${cause.message})`, { cause });
        this.name = 'ChatMetadataPersistenceUnknownError';
        this.persistenceUnknown = true;
    }
}

// SillyTavern's saveChatConditional resolves even when its internal save fails
// or times out. Confirm the selected metadata slice by reading the original
// chat header back from storage before reporting success.
export function createConfirmedChatMetadataSave({
    saveChatConditional, getCurrentChatId, getCurrentGroup, getContext,
    getChatMetadata, getRequestHeaders, selectValue, label = 'Chat metadata',
    fetchChat = fetch,
}) {
    return async function saveChatMetadataConfirmed(metadata = getChatMetadata()) {
        const chatId = getCurrentChatId();
        if (!chatId) throw new Error(`No chat is available for ${label} persistence`);
        const group = getCurrentGroup();
        const context = group ? null : getContext();
        const character = context?.characters?.[context.characterId];
        if (!group && !character) throw new Error(`No character is available for ${label} persistence`);
        const expected = snapshotValue(selectValue(metadata));

        await saveChatConditional();

        let storedValue;
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
            storedValue = selectValue(storedChat[0].chat_metadata);
        } catch (error) {
            throw new ChatMetadataPersistenceUnknownError(label, error);
        }

        const stored = snapshotValue(storedValue);
        // A concurrent edit may have joined the same host save. Accept either
        // the submitted state or the current state of the original metadata.
        if (stored !== expected && stored !== snapshotValue(selectValue(metadata))) {
            throw new Error(`${label} persistence could not be confirmed`);
        }
    };
}
