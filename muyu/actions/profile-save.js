import { createApprovedActions } from './coordinator.js';

export function createProfileActions({ getArtifact, validate, getTarget, writer, changed = () => {} }) {
    return createApprovedActions({ contract: {
        idPrefix: 'profile-save:', available: () => !!writer,
        matchesArtifact: artifact => artifact.kind === 'profile-draft' && artifact.content?.module === 'generated-profile',
        validate, execute: record => writer.save(record.content),
        resultStatus: result => ['saved_confirmed', 'saved_unconfirmed', 'outcome_unknown'].includes(result?.status) ? result.status : 'outcome_unknown',
        notExecuted: error => ['PROFILE_NAME_EXISTS', 'PROFILE_STORE_UNAVAILABLE', 'WRITE_UNAVAILABLE', 'INVALID_PROFILE_DRAFT', 'ACTION_STALE'].includes(error?.message),
    }, getArtifact, getTarget, changed });
}
