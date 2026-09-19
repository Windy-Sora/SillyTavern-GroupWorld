export function staleExecutionError(message = 'Execution became stale') {
    const error = new Error(message);
    error.name = 'StaleExecutionError';
    return error;
}

export function snapshotValue(value) {
    return JSON.stringify(value);
}

export function captureExecutionSnapshot({ getChatMetadata, getChat, getResource }) {
    const metadata = getChatMetadata();
    const chat = getChat?.();
    return {
        metadata,
        chat,
        chatState: getChat ? snapshotValue(chat) : undefined,
        resource: snapshotValue(getResource?.(metadata, chat)),
    };
}

export function assertExecutionSnapshot(snapshot, {
    getChatMetadata,
    getChat,
    getResource,
    message,
}) {
    if (getChatMetadata() !== snapshot.metadata) throw staleExecutionError(message);
    if (getChat) {
        const chat = getChat();
        if (chat !== snapshot.chat || snapshotValue(chat) !== snapshot.chatState) throw staleExecutionError(message);
    }
    if (getResource && snapshotValue(getResource(snapshot.metadata, snapshot.chat)) !== snapshot.resource) {
        throw staleExecutionError(message);
    }
}
