import { createApprovedActions } from './coordinator.js';
export function createMemoryEditActions({ getArtifact, validate, getTarget, writer, changed }) {
    return createApprovedActions({ getArtifact, getTarget, changed, contract: {
        idPrefix: 'memory-edit:', available: () => !!writer,
        matchesArtifact: a => a.kind === 'memory-edit-draft' && a.content?.module === 'memory-editor',
        validate, execute: record => writer.apply(record.content),
        resultStatus: result => ['applied_confirmed', 'partial', 'outcome_unknown'].includes(result?.status) ? result.status : 'outcome_unknown',
        notExecuted: error => ['TARGET_UNAVAILABLE', 'STALE_MEMORY_EDIT', 'MEMORY_BUSY', 'MEMORY_NOT_FOUND', 'UNSUPPORTED_MEMORY_STORE', 'MEMORY_CHARACTERS_UNAVAILABLE', 'MEMORY_CREATION_UNAVAILABLE', 'WRITE_UNAVAILABLE', 'ACTION_STALE'].includes(error?.message),
    } });
}
