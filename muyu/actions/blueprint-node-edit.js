import { createApprovedActions } from './coordinator.js';
export function createBlueprintNodeEditActions({ getArtifact, validate, getTarget, writer, changed }) {
    return createApprovedActions({ getArtifact, getTarget, changed, contract: {
        idPrefix: 'blueprint-node-edit:', available: () => !!writer,
        matchesArtifact: a => a.kind === 'blueprint-node-edit-draft' && a.content?.module === 'blueprint-node-editor',
        validate, execute: record => writer.apply(record.content),
        resultStatus: result => ['applied_confirmed', 'partial', 'outcome_unknown'].includes(result?.status) ? result.status : 'outcome_unknown',
        notExecuted: error => ['TARGET_UNAVAILABLE','STALE_BLUEPRINT_NODE_EDIT','BLUEPRINT_BUSY','BLUEPRINT_NODE_NOT_FOUND','BLUEPRINT_ALREADY_EXISTS','COMPLETION_VARIABLE_CONFLICT','UNSUPPORTED_BLUEPRINT_STORE','WRITE_UNAVAILABLE','ACTION_STALE'].includes(error?.message),
    } });
}
