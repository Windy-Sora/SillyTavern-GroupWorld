import { createApprovedActions } from './coordinator.js';
export function createSelectionActions({ getArtifact, validate, getTarget, writer, changed }) {
    return createApprovedActions({ getArtifact, getTarget, changed, contract: {
        idPrefix: 'selection:', available: () => !!writer,
        matchesArtifact: a => a.kind === 'selection-draft' && a.content?.module === 'selection-editor',
        validate, execute: record => writer.apply(record.content),
        resultStatus: result => ['applied_confirmed', 'applied_unconfirmed', 'partial', 'outcome_unknown'].includes(result?.status) ? result.status : 'outcome_unknown',
        notExecuted: error => ['TARGET_UNAVAILABLE','STALE_SELECTION_EDIT','SELECTION_BUSY','PROFILE_LIBRARY_NOT_FOUND','UNSUPPORTED_SELECTION_STORE','WRITE_UNAVAILABLE','ACTION_STALE'].includes(error?.message),
    } });
}
