import { createApprovedActions } from './coordinator.js';
export function createSkillActions({ getArtifact, validate, getTarget, writer, changed }) {
    return createApprovedActions({ contract: { idPrefix: 'skill-save:', available: () => !!writer,
        matchesArtifact: artifact => artifact.kind === 'skill-draft' && artifact.content?.module === 'skill', validate,
        execute: record => writer.save(record.content), resultStatus: result => result?.status === 'saved_unconfirmed' ? 'saved_unconfirmed' : 'outcome_unknown',
        notExecuted: error => ['SKILL_STALE', 'SKILL_READ_ONLY', 'SKILL_INVALID', 'SKILL_DUPLICATE', 'SKILL_IDENTITY_CHANGE', 'SKILL_CAPACITY', 'SKILL_STORE_UNAVAILABLE', 'ACTION_STALE'].includes(error?.message),
    }, getArtifact, getTarget, changed });
}
