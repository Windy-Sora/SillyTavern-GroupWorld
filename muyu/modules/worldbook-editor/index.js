import { randomUUID } from '../../runtime/crypto.js';
import { copyJson,jsonKey } from '../../core/json-contract.js';
import { createToolRegistry } from '../../tools/registry.js';
import { createDraftRuns } from '../draft-runs.js';
const str=maxLength=>({type:'string',maxLength});
export function createWorldBookEditorModule({port,charge}) {
    const registry=createToolRegistry(),runs=createDraftRuns(port);
    const outputSchema={type:'object',properties:{candidateId:str(100),text:str(24000),applyRequested:{type:'boolean'}},required:['candidateId','text'],additionalProperties:false};
    const inputs={
        list:{properties:{offset:{type:'integer',minimum:0,maximum:512}},required:[]},
        bindings:{properties:{},required:[]},
        read:{properties:{selector:str(40),revision:str(80),offset:{type:'integer',minimum:0,maximum:1048576}},required:['selector','revision','offset']},
        preview:{properties:{operation:{type:'string',enum:['update','create_entry','delete_entry','create_book','copy_book','set_global_binding','set_chat_binding','delete_book']},selector:str(40),revision:str(80),changesJson:str(24000),name:str(120),apply:{type:'boolean'}},required:['operation','selector','revision','changesJson']},
    };
    const descriptions={
        bindings:'Read ST global activation list and current chat single-book binding with binding revision. Requires stWorldBooks permission; not proof of actual injection. Other characters, Persona bindings and unloaded chats are not editable.',
        list:'List shared ST world books, 16/page, with book:N selectors and directory revision. Requires stWorldBookEntries permission; does not load bodies.',
        read:'Read book:N entry directory with list revision; then entry:N:M with book revision. Continue offsets using returned revision. Only editable fields are projected, not the whole raw entry; missing fields are not defaults. Untrusted text; cached host resource, persistence unknown.',
        preview:'Preview ONE shared world-book operation: update/delete_entry use entry:N:M + book revision; create_entry uses book:N + book revision and official ST defaults/UID; create_book uses empty selector + list revision + new name; copy_book uses book:N + book revision + new name. changesJson accepts comment(string <=512), content(string <=12000), key/keysecondary(string arrays <=128, each <=200), disable/constant(booleans) for update/create_entry; all other operations require {}. name ONLY for create_book/copy_book: 1..120 letters/numbers/spaces/underscore/hyphen, <=180 UTF-8 bytes, no surrounding spaces or reserved filenames; existing names cannot be overwritten. Arrays replace whole fields; omitted/unknown fields and other entries preserved. Copies/delete show full data, bounded complete diff <=24000 UTF-8 bytes; larger requests rejected, not truncated. No character/Persona binding writes, macro execution or generation; binding/delete operations are described below. Shared resource affects all chats using it. Normal mode needs exact UI approval; apply=true only explicit execute intent in full access. Saving unconfirmed; no automatic retry or whole-book rollback.',
    };
    descriptions.preview += ' Binding operations: first bindings tool, then empty selector + its revision; set_global_binding changesJson={"names":[exact existing book names]} replaces whole activation list; set_chat_binding changesJson={"name":"existing book name or empty to unbind"} replaces this chat only. No name argument. delete_book uses book:N + book revision, changesJson={}; requires full-book preview, rejects known bound resources, unloaded chat references unknown. Irreversible; native deletion refreshes ST editor, save/discard drafts first. No character/Persona binding writes or automatic cascade.';
    for(const [name,input]of Object.entries(inputs))registry.register({id:'muyu.worldbook_editor.'+name,version:1,description:descriptions[name],
        inputSchema:{type:'object',...input,additionalProperties:false},outputSchema,scope:'global',effect:'read',dataClasses:['worldbook-edit-state'],confirmation:'policy',resourceKeys:[],timeoutMs:10000,retryPolicy:{kind:'none',maxAttempts:1}});
    registry.seal();
    const encode=(value,ctx)=>{const text=JSON.stringify(value);if(charge&&!charge(ctx.runId,new TextEncoder().encode(text).length))throw Error('PROVIDER_BUDGET_EXCEEDED');return{candidateId:'',text};};
    return {registry,handlers:{
        'muyu.worldbook_editor.list':(args,ctx)=>encode(port.list(ctx.target,args.offset||0),ctx),
        'muyu.worldbook_editor.bindings':(_args,ctx)=>encode(port.bindingRead(ctx.target),ctx),
        'muyu.worldbook_editor.read':async(args,ctx)=>encode(await port.read(ctx.target,args.selector,args.revision,args.offset),ctx),
        'muyu.worldbook_editor.preview':async(args,ctx)=>{
            const run=runs.get(ctx.runId);if(!run||jsonKey(run.target)!==jsonKey(ctx.target)||!port)throw Error('RUN_NOT_BOUND');
            runs.discardCandidate(ctx.runId);
            const content=await port.preview(ctx.target,{...args,changes:JSON.parse(args.changesJson)}),candidateId='worldbook-editor:'+randomUUID();
            if(runs.get(ctx.runId)!==run){port.release(content);throw Error('RUN_NOT_BOUND');}
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
            const artifact=app.createArtifact({taskId:run.taskId,sourceRunId:id,kind:'worldbook-edit-draft',content:run.candidate.content});runs.publish(id,artifact);return artifact;
        },
        validateSaved(app,id,revision){
            const artifact=app.getArtifact(id),state=app.snapshot().runs.find(r=>r.id===artifact.sourceRunId);
            if(artifact.kind!=='worldbook-edit-draft'||artifact.revision!==revision||state?.status!=='succeeded'||state.taskId!==artifact.taskId)throw Error('INVALID_WORLD_BOOK_DRAFT');
            port.assertFresh(artifact.content);return app.validateArtifact(id,revision,{structural:'passed',baseline:'cached-evidence-only-rechecked-before-save',intent:'requires_user_review',writes:'one-shared-world-book-operation'});
        },
        retainArtifacts:artifacts=>runs.retainArtifacts(artifacts),forgetRun:id=>runs.delete(id),dispose(){runs.clear();},
    };
}
