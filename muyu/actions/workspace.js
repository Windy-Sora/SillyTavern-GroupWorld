import { createApprovedActions } from './coordinator.js';
export function createWorkspaceActions({getArtifact,validate,getTarget,writer,changed}) {
    return createApprovedActions({getArtifact,getTarget,changed,contract:{
        idPrefix:'workspace:',available:()=>!!writer?.workspaceWriter,
        matchesArtifact:a=>a.kind==='workspace-draft'&&a.content?.module==='service-workspace',
        validate,execute:record=>writer.workspaceWriter.apply(record.content),
        resultStatus:r=>r?.status==='saved_confirmed'?'saved_confirmed':'outcome_unknown',
        notExecuted:e=>['WORKSPACE_CONFLICT','WORKSPACE_PREVIEW_EXPIRED','WORKSPACE_BUSY','WORKSPACE_INVALID','WORKSPACE_CAPACITY','ACTION_STALE','WRITE_UNAVAILABLE'].includes(e?.message),
    }});
}
