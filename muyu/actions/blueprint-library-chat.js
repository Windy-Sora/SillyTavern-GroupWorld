import { createApprovedActions } from './coordinator.js';
export function createBlueprintLibraryChatActions({ getArtifact, validate, getTarget, writer, changed }) {
    return createApprovedActions({ contract: {
        idPrefix: 'blueprint-library-chat:', available: () => !!writer,
        matchesArtifact: artifact => artifact.kind === 'blueprint-library-chat-draft' && artifact.content?.module === 'blueprint-library-chat',
        validate, execute: record => writer.save(record.content),
        resultStatus: result => ['saved_unconfirmed', 'applied_confirmed', 'applied_unconfirmed', 'partial', 'outcome_unknown'].includes(result?.status) ? result.status : 'outcome_unknown',
        notExecuted: error => ['COMPLETION_VARIABLE_CONFLICT','STALE_LIBRARY_CHAT','TARGET_UNAVAILABLE','INVALID_LIBRARY_CHAT','LIBRARY_CHAT_UNAVAILABLE','LIBRARY_GROUP_REQUIRED','STALE_LIBRARY_ASSET','INVALID_LIBRARY_DRAFT','LIBRARY_BUSY','LIBRARY_ASSET_UNSUPPORTED','LIBRARY_STORE_UNAVAILABLE','LIBRARY_NAME_CONFLICT','LIBRARY_DRAFT_TOO_LARGE','WRITE_UNAVAILABLE','ACTION_STALE'].includes(error?.message),
    }, getArtifact, getTarget, changed });
}
