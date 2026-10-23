import { createToolRegistry } from '../../tools/registry.js';
import { createDraftRuns } from '../draft-runs.js';
import { copyJson, jsonKey } from '../../core/json-contract.js';
import { randomUUID } from '../../runtime/crypto.js';
export function createServiceWorkspaceModule({ port, charge, usage = () => ({exhausted:false}) }) {
    const registry = createToolRegistry(), runs = createDraftRuns({ release: content => port?.workspaceWriter?.release(content) });
    const str = maxLength => ({ type: 'string', maxLength });
    const output = { type: 'object', additionalProperties: false, required: ['candidateId','text'], properties: { candidateId: str(100), text: str(24000), applyRequested: {type:'boolean'} } };
    const tool = (id,description,properties,required) => registry.register({id,version:1,description,inputSchema:{type:'object',additionalProperties:false,properties,required},
        outputSchema:output,scope:'global',effect:'read',dataClasses:['workspace-documents'],confirmation:'policy',resourceKeys:[],timeoutMs:12000,retryPolicy:{kind:'none',maxAttempts:1}});
    tool('muyu.service.write_file','PREVIEW ONLY: create/update one flat .md/.txt/.json document in the private Muyu workspace, NOT ST settings, scripts, libraries or arbitrary paths. Requires enabled workspace tools AND document-read consent, not write consent. New path uses expectedRevision=empty string (never overwrite); updates require SHA-256 from document list/read. Full old/new must fit 20000 UTF8 JSON bytes; reject, never truncate. Exact proposal expires in 5 minutes and needs GUI review/approval. apply=true only explicit write intent under full-access; never preview-only. No model commit tool. File synced/readback receipt is historical, not crash-proof directory persistence. Unknown outcome must not be retried.',
        {path:str(100),expectedRevision:str(64),text:str(12000),apply:{type:'boolean'}},['path','expectedRevision','text']);
    tool('muyu.service.validate_json','Validate supplied JSON syntax/complexity/unsafe keys only. No schema/business compatibility check, files, reads, writes or execution. Does not prove a GroupWorld/ST configuration is usable.',
        {text:str(12000)},['text']);
    registry.seal();
    return {registry,handlers:{
        'muyu.service.write_file': async(args,ctx) => {
            const run = runs.get(ctx.runId); if (!run || !port?.workspaceWriter || !run.capture?.allows('workspaceWrite')) throw Error('WRITE_UNAVAILABLE');
            if(usage(ctx.runId).exhausted)throw Error('PROVIDER_BUDGET_EXCEEDED');
            runs.discardCandidate(ctx.runId);
            let content;
            try { content = await port.workspaceWriter.preview(args,ctx.target,run.capture,ctx.signal); }
            catch(error) { if (['SERVICE_MISSING','SERVICE_UNAVAILABLE','SERVICE_INCOMPATIBLE'].includes(error.message)) run.capture.unavailable('workspaceWrite'); throw error; }
            if(ctx.signal.aborted||runs.get(ctx.runId)!==run||jsonKey(run.target)!==jsonKey(ctx.target)){port.workspaceWriter.release(content);throw Error('ACTION_STALE');}
            const text=JSON.stringify({state:'draft_only',path:content.path,operation:content.operation,expiresAt:content.expiresAt,notice:'Not written; approve the exact GUI draft.'});
            if(!charge(ctx.runId,new TextEncoder().encode(text).length)){port.workspaceWriter.release(content);throw Error('PROVIDER_BUDGET_EXCEEDED');}
            const candidateId='workspace:'+randomUUID(); run.candidate={content,candidateId};
            return {candidateId,text,...(args.apply?{applyRequested:true}:{})};
        },
        'muyu.service.validate_json':async(args,ctx)=>{
            const run=runs.get(ctx.runId); if(!run?.capture?.allows('jsonValidate')||!port?.workspaceWriter)throw Error('WRITE_UNAVAILABLE');
            if(usage(ctx.runId).exhausted)throw Error('PROVIDER_BUDGET_EXCEEDED');
            let data;try{data=await port.workspaceWriter.validate(args,run.capture,ctx.signal);}catch(error){if(['SERVICE_MISSING','SERVICE_UNAVAILABLE','SERVICE_INCOMPATIBLE'].includes(error.message))run.capture.unavailable('jsonValidate');throw error;}
            const text=JSON.stringify(data); if(!charge(ctx.runId,new TextEncoder().encode(text).length))throw Error('PROVIDER_BUDGET_EXCEEDED');return{candidateId:'',text};
        },
    },
    bindRun(identity,intent){if(runs.size>=128)throw Error('RUN_CAPACITY');runs.set(identity.id,{taskId:identity.taskId,target:copyJson(identity.target),capture:intent.serviceTools,candidate:null});},
    transferRun(from,identity){const run=runs.get(from);if(!run)return;if(run.taskId!==identity.taskId||jsonKey(run.target)!==jsonKey(identity.target)||runs.has(identity.id))throw Error('INVALID_RUN_TRANSFER');runs.take(from);runs.set(identity.id,run);},
    publishDraft(app,id,candidateId){const run=runs.get(id),state=app.snapshot().runs.find(r=>r.id===id);if(!run?.candidate||run.candidate.candidateId!==candidateId||state?.status!=='succeeded'||state.taskId!==run.taskId)throw Error('INVALID_CANDIDATE_SOURCE');port.workspaceWriter.assertFresh(run.candidate.content);const artifact=app.createArtifact({taskId:run.taskId,sourceRunId:id,kind:'workspace-draft',content:run.candidate.content});runs.publish(id,artifact);return artifact;},
    validateSaved(app,id,revision){const artifact=app.getArtifact(id),state=app.snapshot().runs.find(r=>r.id===artifact.sourceRunId);if(artifact.kind!=='workspace-draft'||artifact.revision!==revision||state?.status!=='succeeded'||state.taskId!==artifact.taskId)throw Error('INVALID_DRAFT');port.workspaceWriter.assertFresh(artifact.content);return app.validateArtifact(id,revision,{structural:'passed',intent:'requires_user_review',writes:'private-workspace'});},
    retainArtifacts:a=>runs.retainArtifacts(a),forgetRun:id=>runs.delete(id),dispose(){runs.clear();},
    };
}
