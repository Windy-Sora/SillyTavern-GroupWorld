import { createApprovedActions } from './coordinator.js';
export function createCustomAgentActions({ getArtifact, validate, getTarget, writer, changed }) {
    return createApprovedActions({ contract: {
        idPrefix: 'custom-agent-save:', available: () => !!writer,
        matchesArtifact: artifact => artifact.kind === 'custom-agent-draft' && artifact.content?.module === 'custom-agent',
        validate, execute: record => writer.save(record.content),
        resultStatus: result => ['saved_unconfirmed', 'outcome_unknown'].includes(result?.status) ? result.status : 'outcome_unknown',
        notExecuted: error => ['STALE_AGENT_ASSET', 'AGENT_ASSET_EXISTS', 'AGENT_PROVIDER_CONFLICT', 'AGENT_ASSET_UNSUPPORTED', 'INVALID_AGENT_DRAFT', 'INVALID_AGENT_BATCH', 'INVALID_AGENT_IMPORT', 'AGENT_IMPORT_NO_CHANGES', 'AGENT_BATCH_TOO_LARGE', 'AGENT_STORE_UNAVAILABLE', 'WRITE_UNAVAILABLE', 'ACTION_STALE'].includes(error?.message),
    }, getArtifact, getTarget, changed });
}
