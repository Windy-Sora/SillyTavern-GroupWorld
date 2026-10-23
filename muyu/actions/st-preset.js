import { createApprovedActions } from './coordinator.js';
export function createStPresetActions({getArtifact,validate,getTarget,writer,changed}) {
    return createApprovedActions({getArtifact,getTarget,changed,contract:{idPrefix:'st-preset:',available:()=>!!writer,
        matchesArtifact:a=>a.kind==='st-preset-draft'&&a.content?.module==='st-preset-editor',validate,
        execute:r=>writer.apply(r.content),resultStatus:r=>['applied_unconfirmed','outcome_unknown'].includes(r?.status)?r.status:'outcome_unknown',
        notExecuted:e=>['TARGET_UNAVAILABLE','STALE_PRESET','PRESET_BUSY','PRESET_EDITOR_OPEN','PRESET_CONNECTION_BOUND','PRESET_MIGRATION_REQUIRED','PRESET_UNSUPPORTED','INVALID_PRESET','PRESET_NAME_CONFLICT','PRESET_REPLACE_REQUIRED','WRITE_UNAVAILABLE','ACTION_STALE'].includes(e?.message)}});
}
