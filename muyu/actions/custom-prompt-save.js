import { createApprovedActions } from './coordinator.js';
export function createCustomPromptActions({ getArtifact, validate, getTarget, writer, changed }) {
    return createApprovedActions({ contract: {
        idPrefix: 'custom-prompt-save:', available: () => !!writer,
        matchesArtifact: artifact => artifact.kind === 'custom-prompt-draft' && artifact.content?.module === 'custom-prompt',
        validate, execute: record => writer.save(record.content),
        resultStatus: result => ['saved_unconfirmed', 'outcome_unknown'].includes(result?.status) ? result.status : 'outcome_unknown',
        notExecuted: error => ['INVALID_PROMPT_BATCH', 'INVALID_PROMPT_IMPORT', 'PROMPT_BATCH_TOO_LARGE', 'PROMPT_ASSET_EXISTS', 'STALE_PROMPT_ASSET', 'PROMPT_NAME_CONFLICT', 'PROMPT_ASSET_UNSUPPORTED', 'INVALID_PROMPT_DRAFT', 'PROMPT_DRAFT_TOO_LARGE', 'PROMPT_STORE_UNAVAILABLE', 'WRITE_UNAVAILABLE', 'ACTION_STALE'].includes(error?.message),
    }, getArtifact, getTarget, changed });
}
