import { createApprovedActions } from './coordinator.js';

/** One UI approval is bound to one exact bundle artifact and consumed once. */
export function createTaskBundleActions({ getArtifact, validate, getTarget, writer, changed = () => {}, checkpoint = null }) {
    return createApprovedActions({ getArtifact, getTarget, changed, checkpoint, contract: {
        idPrefix: 'bundle-apply:', available: () => !!writer,
        matchesArtifact: artifact => artifact.kind === 'task-bundle' && artifact.content?.module === 'task-bundle',
        validate, execute: (record, execution) => writer.apply(record.content, execution),
        resultStatus: result => ['applied_confirmed', 'applied_unconfirmed', 'partial', 'outcome_unknown', 'not_executed'].includes(result?.status) ? result.status : 'outcome_unknown',
        notExecuted: error => ['TARGET_UNAVAILABLE', 'STALE_TASK_BUNDLE', 'ACTION_STALE', 'WRITE_UNAVAILABLE'].includes(error?.message),
    } });
}
