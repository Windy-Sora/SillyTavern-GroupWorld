import { createApprovedActions } from './coordinator.js';
export function createProfileEditActions({ getArtifact, validate, getTarget, writer, changed }) {
    return createApprovedActions({ getArtifact, getTarget, changed, contract: {
        idPrefix: 'profile-edit:', available: () => !!writer,
        matchesArtifact: a => a.kind === 'profile-edit-draft' && a.content?.module === 'profile-editor',
        validate, execute: record => writer.apply(record.content),
        resultStatus: result => ['applied_confirmed', 'partial', 'outcome_unknown'].includes(result?.status) ? result.status : 'outcome_unknown',
        notExecuted: error => ['TARGET_UNAVAILABLE', 'STALE_PROFILE_EDIT', 'PROFILE_BUSY', 'PROFILE_CREATION_UNAVAILABLE', 'PROFILE_SCHEMA_STALE',  'PROFILE_NOT_FOUND', 'UNSUPPORTED_PROFILE_STORE', 'PROFILE_CHARACTERS_UNAVAILABLE', 'WRITE_UNAVAILABLE', 'ACTION_STALE'].includes(error?.message),
    } });
}
