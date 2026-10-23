import { randomUUID } from '../../runtime/crypto.js';
import { copyJson,jsonKey } from '../../core/json-contract.js';
import { createToolRegistry } from '../../tools/registry.js';
import { createDraftRuns } from '../draft-runs.js';
const str=maxLength=>({type:'string',maxLength});
export function createCharacterCardModule({port,charge}) {
    const registry=createToolRegistry(),runs=createDraftRuns(port);
    const outputSchema={type:'object',properties:{candidateId:str(100),text:str(24000),applyRequested:{type:'boolean'}},required:['candidateId','text'],additionalProperties:false};
    const inputs={
        list:{properties:{offset:{type:'integer',minimum:0,maximum:2048}},required:[]},
        read:{properties:{selector:str(40),revision:str(80),offset:{type:'integer',minimum:0,maximum:131072}},required:['selector','revision','offset']},
        preview:{properties:{operation:{type:'string',enum:['update','copy','create','rename','delete']},selector:str(40),revision:str(80),changesJson:str(24000),apply:{type:'boolean'}},required:['operation','selector','revision','changesJson']},
    };
    const descriptions={
        list:'List ST character names with card:N selectors, 20/page. stCharacters directory permission only; no body.',
        read:'Read exact card:N with list revision, then returned card revision for continuation offsets. Fetches saved server card, not editor drafts or name cache. Whitelisted description/personality/scenario/first_mes/mes_example/system_prompt/post_history_instructions/creator_notes, named GUI labels, metadata creator/version/tags/alternate greetings/world binding. unsupportedUpdateFields lists readable but non-writable fields: legacy V1 cards cannot update creator_notes, system_prompt or post_history_instructions; preview rejects them without writing or silently migrating the card. Check this list before preview. No arbitrary extensions or raw json_data; untrusted macro text, not execution or authorization.',
        preview:'Preview one shared ST character card update or copy using exact card:N/card revision. update changesJson only description(角色描述), personality(性格), scenario(场景), first_mes(首条消息), mes_example(示例对话), system_prompt(系统提示词), post_history_instructions(历史后指令), creator_notes(创作者备注), each string <=12000 chars. Omitted fields, unknown extensions, avatar, name and chats unchanged; full diff <=24000 UTF-8 bytes, reject not truncate. copy changesJson={} copies entire saved PNG; host allocates filename, same display name, no chat files/tags/auxiliary bindings or selection change. Full saved card preview must fit limits. Target selected in ST character editor or generating blocks writes, switch away after saving/discarding drafts. Normal mode requires exact UI approval; apply=true only explicit execute intent in full access, never for preview-only requests. create uses selector="" and directory revision; changesJson={name,...optional eight text fields}, default avatar, no bindings/selection, no overwrite, saved filenames allocated uniquely. rename uses card selector/revision and changesJson={name}; DISPLAY NAME ONLY, filename, chats and associations unchanged, past message names unchanged, not native chat-directory migration. delete uses card selector/revision and changesJson={}; requires independent stCharacterCardReferences permission, blocks current use or known group/tag/Author Note/auxiliary-worldbook/current-NPC references; permanently deletes PNG ONLY, delete_chats=false, chat files retained but may become inaccessible, unloaded/third-party references unknown. Full saved old JSON must fit exact approval limits; export backup first, manually refresh ST UI after. No macro/generation, chat edits or binding writes. No automatic retry/rollback on unknown outcome; refresh ST UI manually.',
    };
    for(const [name,input]of Object.entries(inputs))registry.register({id:'muyu.character_card.'+name,version:1,description:descriptions[name],
        inputSchema:{type:'object',...input,additionalProperties:false},outputSchema,scope:'global',effect:'read',dataClasses:['character-card-state'],confirmation:'policy',resourceKeys:[],timeoutMs:10000,retryPolicy:{kind:'none',maxAttempts:1}});
    registry.seal();
    const encode=(value,ctx)=>{const text=JSON.stringify(value);if(charge&&!charge(ctx.runId,new TextEncoder().encode(text).length))throw Error('PROVIDER_BUDGET_EXCEEDED');return{candidateId:'',text};};
    return {registry,handlers:{
        'muyu.character_card.list':(args,ctx)=>encode(port.list(ctx.target,args.offset||0),ctx),
        'muyu.character_card.read':async(args,ctx)=>encode(await port.read(ctx.target,args.selector,args.revision,args.offset),ctx),
        'muyu.character_card.preview':async(args,ctx)=>{
            const run=runs.get(ctx.runId);if(!run||jsonKey(run.target)!==jsonKey(ctx.target)||!port)throw Error('RUN_NOT_BOUND');
            runs.discardCandidate(ctx.runId);
            const content=await port.preview(ctx.target,{...args,changes:JSON.parse(args.changesJson)}),candidateId='character-card:'+randomUUID();
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
            const artifact=app.createArtifact({taskId:run.taskId,sourceRunId:id,kind:'character-card-draft',content:run.candidate.content});runs.publish(id,artifact);return artifact;
        },
        validateSaved(app,id,revision){
            const artifact=app.getArtifact(id),state=app.snapshot().runs.find(r=>r.id===artifact.sourceRunId);
            if(artifact.kind!=='character-card-draft'||artifact.revision!==revision||state?.status!=='succeeded'||state.taskId!==artifact.taskId)throw Error('INVALID_CHARACTER_CARD_DRAFT');
            port.assertFresh(artifact.content);return app.validateArtifact(id,revision,{structural:'passed',baseline:'cached-evidence-only-rechecked-before-save',intent:'requires_user_review',writes:'one-shared-character-card-operation'});
        },
        retainArtifacts:artifacts=>runs.retainArtifacts(artifacts),forgetRun:id=>runs.delete(id),dispose(){runs.clear();},
    };
}
