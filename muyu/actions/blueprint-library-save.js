import { createApprovedActions } from './coordinator.js';
export function createBlueprintLibraryActions({ getArtifact, validate, getTarget, writer, changed }) {
    return createApprovedActions({ contract: {
        idPrefix: 'blueprint-library-save:', available: () => !!writer,
        matchesArtifact: artifact => artifact.kind === 'blueprint-library-draft' && artifact.content?.module === 'blueprint-library',
        validate, execute: record => writer.save(record.content),
        resultStatus: result => ['saved_unconfirmed', 'outcome_unknown'].includes(result?.status) ? result.status : 'outcome_unknown',
        notExecuted: error => ['STALE_LIBRARY_ASSET','INVALID_LIBRARY_DRAFT','LIBRARY_BUSY','LIBRARY_ASSET_UNSUPPORTED','LIBRARY_STORE_UNAVAILABLE','LIBRARY_NAME_CONFLICT','LIBRARY_DRAFT_TOO_LARGE','WRITE_UNAVAILABLE','ACTION_STALE'].includes(error?.message),
    }, getArtifact, getTarget, changed });
}
