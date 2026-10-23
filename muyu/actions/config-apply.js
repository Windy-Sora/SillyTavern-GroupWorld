import { createApprovedActions } from './coordinator.js';

/** Config-specific checks and writer; approval lifecycle stays action-generic. */
export function createConfigActions({ getArtifact, validate, getTarget, writer, changed = () => {}, checkpoint = null }) {
    const contract = {
        idPrefix: 'apply:',
        available: () => !!writer,
        matchesArtifact: artifact => artifact.kind === 'config-draft' && !!artifact.content?.preview?.diff?.length,
        validate,
        execute: record => writer.apply({ baseline: record.content.baseline,
            changes: record.content.requestedChanges ?? record.content.preview.manifest.settings,
            contractVersion: record.content.preview.contractVersion,
            memoryPrunePlan: record.content.memoryPrunePlan || null,
            blueprintTogglePlan: record.content.blueprintTogglePlan || null,
            completionVariablePlan: record.content.completionVariablePlan || null }),
        resultStatus: result => ['applied_confirmed', 'applied_unconfirmed', 'partial', 'outcome_unknown'].includes(result?.status) ? result.status : 'outcome_unknown',
        notExecuted: error => ['STALE_BASELINE', 'STALE_MEMORY_PREVIEW', 'STALE_COMPLETION_PREVIEW', 'STALE_BLUEPRINT_PREVIEW', 'COMPLETION_VARIABLE_CONFLICT', 'COMPLETION_VARIABLE_OCCUPIED', 'TARGET_UNAVAILABLE', 'ACTION_STALE', 'WRITE_UNAVAILABLE', 'EMPTY_CHANGES'].includes(error?.message),
    };
    return createApprovedActions({ contract, getArtifact, getTarget, changed, checkpoint });
}
