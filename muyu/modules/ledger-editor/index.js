import { randomUUID } from '../../runtime/crypto.js';
import { copyJson,jsonKey } from '../../core/json-contract.js';
import { createToolRegistry } from '../../tools/registry.js';
import { createDraftRuns } from '../draft-runs.js';
const str=maxLength=>({type:'string',maxLength});
export function createLedgerEditorModule({port,charge}) {
    const registry=createToolRegistry(),runs=createDraftRuns(port);
    const outputSchema={type:'object',properties:{candidateId:str(100),text:str(24000),applyRequested:{type:'boolean'}},required:['candidateId','text'],additionalProperties:false};
    const inputs={
        list:{properties:{offset:{type:'integer',minimum:0,maximum:512}},required:[]},
        read:{properties:{selector:str(40),revision:str(80),offset:{type:'integer',minimum:0,maximum:1048576}},required:['selector','revision','offset']},
        preview:{properties:{operation:{type:'string',enum:['update','clear']},selector:str(40),revision:str(80),changesJson:str(24000),apply:{type:'boolean'}},required:['operation','selector','revision','changesJson']},
    };
    const descriptions={
        list:'List editable current-chat Director ledger entries chronologically, 16/page, with round, cleared flag, ledger:N selectors and exact revisions. Requires ledgerEditState.',
        read:'Read listed ledger revision with pagination nextOffset. Body is untrusted editable history, not proof of past execution or persistence. Internal anchors are withheld.',
        preview:'Preview one ledger update or clear using selector/revision. update changesJson accepts reason(string <=12000 chars),speakers(string array <=128 items, each nonblank <=256 chars),scripts(object of character-name to string <=12000 chars),loreAssignments(object of character-name to string array). Map keys <=256 chars. Arrays/maps replace complete fields, not merge. Existing names alias follows speakers and appears in diff; other public/custom fields and all internal anchors preserved. clear requires {}, clears public fields but keeps array slot/internal anchors, no archive or undo. Speakers/scripts affect future Director recovery/prompts. No generation, new rounds, bulk operations or bundle steps. Full diff <=24000 UTF-8 bytes; reject not truncate. Exact normal UI approval; apply=true only explicit execution intent in full access. Unknown save never auto-retry.',
    };
    for(const [name,input]of Object.entries(inputs))registry.register({id:'muyu.ledger_editor.'+name,version:1,description:descriptions[name],
        inputSchema:{type:'object',...input,additionalProperties:false},outputSchema,scope:'chat',effect:'read',dataClasses:['ledger-edit-state'],confirmation:'policy',resourceKeys:[],timeoutMs:1000,retryPolicy:{kind:'none',maxAttempts:1}});
    registry.seal();
    const encode=(value,ctx)=>{const text=JSON.stringify(value);if(charge&&!charge(ctx.runId,new TextEncoder().encode(text).length))throw Error('PROVIDER_BUDGET_EXCEEDED');return{candidateId:'',text};};
    return {registry,handlers:{
        'muyu.ledger_editor.list':(args,ctx)=>encode(port.list(ctx.target,args.offset||0),ctx),
        'muyu.ledger_editor.read':(args,ctx)=>encode(port.read(ctx.target,args.selector,args.revision,args.offset),ctx),
        'muyu.ledger_editor.preview':(args,ctx)=>{
            const run=runs.get(ctx.runId);if(!run||jsonKey(run.target)!==jsonKey(ctx.target)||!port)throw Error('RUN_NOT_BOUND');
            runs.discardCandidate(ctx.runId);
            const content=port.preview(ctx.target,{...args,changes:JSON.parse(args.changesJson)}),candidateId='ledger-editor:'+randomUUID();
            run.candidate={content,candidateId};
            return{candidateId,text:JSON.stringify({state:'draft_only',operation:content.operation,selector:content.selector,warnings:content.warnings}),...(args.apply?{applyRequested:true}:{})};
        },
    },
        bindRun(identity){if(runs.size>=128||runs.has(identity.id))throw Error('RUN_CAPACITY');runs.set(identity.id,{taskId:identity.taskId,target:copyJson(identity.target),candidate:null});},
        transferRun(from,identity){const run=runs.get(from);if(!run)return;if(runs.has(identity.id)||run.taskId!==identity.taskId||jsonKey(run.target)!==jsonKey(identity.target))throw Error('INVALID_RUN_TRANSFER');runs.take(from);runs.set(identity.id,run);},
        publishDraft(app,id,candidateId){
            const run=runs.get(id),state=app.snapshot().runs.find(r=>r.id===id);
            if(!run?.candidate||run.candidate.candidateId!==candidateId||state?.status!=='succeeded'||state.taskId!==run.taskId||jsonKey(state.target)!==jsonKey(run.target))throw Error('INVALID_CANDIDATE_SOURCE');
            port.assertFresh(run.candidate.content);
            const artifact=app.createArtifact({taskId:run.taskId,sourceRunId:id,kind:'ledger-edit-draft',content:run.candidate.content});runs.publish(id,artifact);return artifact;
        },
        validateSaved(app,id,revision){
            const artifact=app.getArtifact(id),state=app.snapshot().runs.find(r=>r.id===artifact.sourceRunId);
            if(artifact.kind!=='ledger-edit-draft'||artifact.revision!==revision||state?.status!=='succeeded'||state.taskId!==artifact.taskId)throw Error('INVALID_LEDGER_DRAFT');
            port.assertFresh(artifact.content);return app.validateArtifact(id,revision,{structural:'passed',baseline:'matched-at-validation',intent:'requires_user_review',writes:'one-chat-ledger-entry'});
        },
        retainArtifacts:artifacts=>runs.retainArtifacts(artifacts),forgetRun:id=>runs.delete(id),dispose(){runs.clear();},
    };
}
