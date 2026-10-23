import { createApprovedActions } from './coordinator.js';
export function createScriptActions({ getArtifact, validate, getTarget, writer, changed }) {
    return createApprovedActions({ contract: {
        idPrefix: 'script-save:', available: () => !!writer,
        matchesArtifact: artifact => artifact.kind === 'script-draft' && artifact.content?.module === 'script-executor',
        validate, execute: record => writer.save(record.content),
        resultStatus: result => ['saved_unconfirmed', 'outcome_unknown'].includes(result?.status) ? result.status : 'outcome_unknown',
        notExecuted: error => ['STALE_SCRIPT_ASSET', 'SCRIPT_ASSET_EXISTS', 'SCRIPT_ASSET_UNSUPPORTED', 'INVALID_SCRIPT_DRAFT', 'SCRIPT_STORE_UNAVAILABLE', 'WRITE_UNAVAILABLE', 'ACTION_STALE'].includes(error?.message),
    }, getArtifact, getTarget, changed });
}
