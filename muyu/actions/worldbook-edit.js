import { createApprovedActions } from './coordinator.js';
export function createWorldBookEditActions({ getArtifact, validate, getTarget, writer, changed }) {
    return createApprovedActions({ getArtifact, getTarget, changed, contract: {
        idPrefix: 'worldbook-edit:', available: () => !!writer,
        matchesArtifact: a => a.kind === 'worldbook-edit-draft' && a.content?.module === 'worldbook-editor',
        validate, execute: record => writer.apply(record.content),
        resultStatus: result => ['applied_unconfirmed', 'outcome_unknown'].includes(result?.status) ? result.status : 'outcome_unknown',
        notExecuted: error => ['TARGET_UNAVAILABLE', 'STALE_WORLD_BOOK_EDIT', 'WORLD_BOOK_BUSY', 'INVALID_WORLD_BOOK_EDIT', 'WORLD_BOOK_NAME_CONFLICT', 'WORLD_BOOK_STILL_BOUND', 'WORLD_BOOK_REFERENCES_UNKNOWN', 'UNSUPPORTED_WORLD_BOOK', 'WORLD_BOOK_TOO_LARGE', 'WRITE_UNAVAILABLE', 'ACTION_STALE'].includes(error?.message),
    } });
}
