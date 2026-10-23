import { randomUUID } from '../../runtime/crypto.js';
import { copyJson,jsonKey } from '../../core/json-contract.js';
import { createToolRegistry } from '../../tools/registry.js';
import { createDraftRuns } from '../draft-runs.js';
const str=maxLength=>({type:'string',maxLength});
export function createSelectionEditorModule({port,charge}) {
 const registry=createToolRegistry(),runs=createDraftRuns(port);
 const kind={type:'string',enum:['worldbooks','profile-autoload']};
 const outputSchema={type:'object',properties:{candidateId:str(100),text:str(24000),applyRequested:{type:'boolean'}},required:['candidateId','text'],additionalProperties:false};
 for(const [name,properties,required,description] of [
  ['read',{kind},['kind'],'Read global GroupWorld world book source mode/manual selection and available book names, or profile auto-load policy and available package IDs/names. Requires selectionState. No book/profile bodies, ST activation state, persistence confirmation or automatic loading.'],
  ['preview',{kind,revision:str(80),changesJson:str(24000),apply:{type:'boolean'}},['kind','revision','changesJson'],'Preview exact global selection changes from read revision. worldbooks changesJson accepts sourceMode(st/manual),selectedNames(string array; full manual-list replacement; requires explicit manual mode when currently st). Does not change ST activation/content. profile-autoload accepts enabled,mode(best/fixed),fixedId(existing package ID for fixed mode),matchHash,matchAvatarName,overwriteExisting,importTemplate. All except mode/fixedId are booleans; omitted keys preserved. matchNameOnly is not writable because auto-loading ignores it. Save only, no immediate import/generation. Normal mode requires exact UI approval. apply=true only explicit execution intent in full access. Do not retry unknown save outcomes.'],
 ]) registry.register({id:'muyu.selection.'+name,version:1,description,inputSchema:{type:'object',properties,required,additionalProperties:false},outputSchema,scope:'global',effect:'read',dataClasses:['selection-state'],confirmation:'policy',resourceKeys:[],timeoutMs:1000,retryPolicy:{kind:'none',maxAttempts:1}});
 registry.seal();
 return {registry,handlers:{
  'muyu.selection.read':(args,ctx)=>{const text=JSON.stringify(port.read(ctx.target,args.kind));if(text.length>24000)throw Error('SELECTION_READ_TOO_LARGE');if(charge&&!charge(ctx.runId,new TextEncoder().encode(text).length))throw Error('PROVIDER_BUDGET_EXCEEDED');return{candidateId:'',text};},
  'muyu.selection.preview':(args,ctx)=>{const run=runs.get(ctx.runId);if(!run||jsonKey(run.target)!==jsonKey(ctx.target)||!port)throw Error('RUN_NOT_BOUND');runs.discardCandidate(ctx.runId);
   const content=port.preview(ctx.target,{...args,changes:JSON.parse(args.changesJson)}),candidateId='selection:'+randomUUID();run.candidate={content,candidateId};
   return{candidateId,text:JSON.stringify({state:'draft_only',kind:content.kind,warnings:content.warnings}),...(args.apply?{applyRequested:true}:{})};},
 },
 bindRun(identity){if(runs.size>=128||runs.has(identity.id))throw Error('RUN_CAPACITY');runs.set(identity.id,{taskId:identity.taskId,target:copyJson(identity.target),candidate:null});},
 transferRun(from,identity){const run=runs.get(from);if(!run)return;if(runs.has(identity.id)||run.taskId!==identity.taskId||jsonKey(run.target)!==jsonKey(identity.target))throw Error('INVALID_RUN_TRANSFER');runs.take(from);runs.set(identity.id,run);},
 publishDraft(app,id,candidateId){const run=runs.get(id),state=app.snapshot().runs.find(r=>r.id===id);if(!run?.candidate||run.candidate.candidateId!==candidateId||state?.status!=='succeeded'||state.taskId!==run.taskId||jsonKey(state.target)!==jsonKey(run.target))throw Error('INVALID_CANDIDATE_SOURCE');port.assertFresh(run.candidate.content);const artifact=app.createArtifact({taskId:run.taskId,sourceRunId:id,kind:'selection-draft',content:run.candidate.content});runs.publish(id,artifact);return artifact;},
 validateSaved(app,id,revision){const artifact=app.getArtifact(id),state=app.snapshot().runs.find(r=>r.id===artifact.sourceRunId);if(artifact.kind!=='selection-draft'||artifact.revision!==revision||state?.status!=='succeeded'||state.taskId!==artifact.taskId)throw Error('INVALID_SELECTION_DRAFT');port.assertFresh(artifact.content);return app.validateArtifact(id,revision,{structural:'passed',baseline:'matched-at-validation',intent:'requires_user_review',writes:'global-selection-policy'});},
 retainArtifacts:artifacts=>runs.retainArtifacts(artifacts),forgetRun:id=>runs.delete(id),dispose(){runs.clear();},
 };
}
