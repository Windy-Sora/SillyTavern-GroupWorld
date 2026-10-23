import { createApprovedActions } from './coordinator.js';
export function createCharacterCardActions({getArtifact,validate,getTarget,writer,changed}) {
    return createApprovedActions({getArtifact,getTarget,changed,contract:{idPrefix:'character-card:',available:()=>!!writer,
        matchesArtifact:a=>a.kind==='character-card-draft'&&a.content?.module==='character-card',validate,
        execute:r=>writer.apply(r.content),resultStatus:r=>['applied_unconfirmed','outcome_unknown'].includes(r?.status)?r.status:'outcome_unknown',
        notExecuted:e=>['TARGET_UNAVAILABLE','STALE_CHARACTER_CARD','CHARACTER_BUSY','CHARACTER_EDITOR_OPEN','CHARACTER_REFERENCED','CHARACTER_REFERENCES_UNAVAILABLE','INVALID_CHARACTER_CARD','INVALID_CHARACTER_NAME','UNSUPPORTED_CHARACTER','WRITE_UNAVAILABLE','ACTION_STALE'].includes(e?.message)}});
}
