import { createApprovedActions } from './coordinator.js';
export function createNpcEditActions({ getArtifact, validate, getTarget, writer, changed }) {
    return createApprovedActions({ getArtifact, getTarget, changed, contract: {
        idPrefix: 'npc-edit:', available: () => !!writer,
        matchesArtifact: a => a.kind === 'npc-edit-draft' && a.content?.module === 'npc-editor',
        validate, execute: record => writer.apply(record.content),
        resultStatus: result => ['applied_confirmed', 'partial', 'outcome_unknown'].includes(result?.status) ? result.status : 'outcome_unknown',
        notExecuted: error => ['TARGET_UNAVAILABLE', 'STALE_NPC_EDIT', 'NPC_BUSY', 'NPC_CREATION_UNAVAILABLE',  'NPC_NOT_FOUND', 'UNSUPPORTED_NPC_STORE', 'NPC_CHARACTERS_UNAVAILABLE', 'WRITE_UNAVAILABLE', 'ACTION_STALE'].includes(error?.message),
    } });
}
