import { randomUUID } from '../runtime/crypto.js';
import { copyJson,jsonKey } from '../core/json-contract.js';
import {inspectBlueprintCompletion} from './blueprint-completion.js';
import { projectBlueprintLibraryImport } from '../../systems/blueprint-library-chat.js';
const record=v=>v&&typeof v==='object'&&!Array.isArray(v);
export function createBlueprintLibraryChatPort({getSettings,getMetadata,getTarget,getChatLength,extensionKey,system,libraryPort,saveChatConfirmed,isBusy=()=>false}) {
    const plans=new Map();
    function inspect(target) {
        if(target?.kind!=='chat'||jsonKey(target)!==jsonKey(getTarget()))throw Error('TARGET_UNAVAILABLE');
        if(isBusy())throw Error('LIBRARY_BUSY');
        const metadata=getMetadata(),settings=getSettings(),length=getChatLength();
        if(!record(metadata)||!record(settings)||!Number.isSafeInteger(length)||length<0)throw Error('LIBRARY_CHAT_UNAVAILABLE');
        const root=metadata[extensionKey],state=root?.storyBlueprint;
        if(root!==undefined&&!record(root)||state!==undefined&&!record(state))throw Error('LIBRARY_CHAT_UNAVAILABLE');
        if(state?.continuePending)throw Error('LIBRARY_BUSY');
        const config=copyJson(Object.fromEntries(['storyBlueprintEnabled','storyBlueprintProgressionMode','storyBlueprintProgressionLevel','storyBlueprintCompletionVariable','storyBlueprintCompletionVariableGuard'].filter(k=>settings[k]!==undefined).map(k=>[k,settings[k]])));
        const {vars,completion}=inspectBlueprintCompletion(settings,root);
        const snapshot=copyJson({state:state||null,config,length,completion});
        return {metadata,settings,vars,snapshot};
    }
    function keep(content,live,checkLibrary) {
        if(plans.size>=64)throw Error('LIBRARY_PLAN_CAPACITY');
        if(new TextEncoder().encode(JSON.stringify(content)).length>24000)throw Error('LIBRARY_DRAFT_TOO_LARGE');
        content=copyJson(content);plans.set(content.ticket,{content:copyJson(content),live,checkLibrary});return content;
    }
    function capture(args,target) {
        if(args.includeProgress!==undefined&&typeof args.includeProgress!=='boolean')throw Error('INVALID_LIBRARY_CHAT');
        const live=inspect(target),before=live.snapshot.state;
        if(!before?.blueprint)throw Error('LIBRARY_NO_BLUEPRINT');
        const state=args.includeProgress?before:{blueprint:before.blueprint,doneSignals:[],progressTracks:{}};
        const exportData={type:'group-director-story-blueprint',version:1,storyBlueprint:state,libraryMeta:{includeProgress:!!args.includeProgress}};
        const draft=libraryPort.preview({operation:'create',changes:{name:args.name,description:args.description||'',exportData}});
        return keep({module:'blueprint-library-chat',operation:'capture',ticket:randomUUID(),target,name:draft.next.name,draft,
            before:null,after:null,completion:null,count:countNodes(before.blueprint.nodes),includeProgress:!!args.includeProgress,
            warnings:['复制本聊天蓝图到新全局库；默认不带进度，显式选择才保存已有进度。不改聊天或变量、不启用或生成。']},live,()=>libraryPort.assertDraft(draft));
    }
    function prepareApply(args,target) {
        if(args.includeProgress!==undefined&&typeof args.includeProgress!=='boolean')throw Error('INVALID_LIBRARY_CHAT');
        const live=inspect(target),data=libraryPort.exportEntry(args.id,args.revision),before=live.snapshot.state;
        const after=projectBlueprintLibraryImport({before,exportData:data,settings:{...live.snapshot.config,includeProgress:!!args.includeProgress},chatLength:live.snapshot.length});
        return keep({module:'blueprint-library-chat',operation:'apply',ticket:randomUUID(),target,name:data.libraryMeta.name,
            libraryId:args.id,libraryRevision:args.revision,draft:null,before,after,completion:live.snapshot.completion,
            count:countNodes(after.blueprint.nodes),includeProgress:!!args.includeProgress,
            warnings:['替换当前聊天整棵蓝图，不合并旧节点；不修改全局设置、不启用功能或调用模型。',
                args.includeProgress?'按现有业务规则整理包内各模式／层级进度：仅保留各轨道连续前缀，消息位置限于当前聊天；以完整差异中的结果为准，不改变当前推进模式。':'不导入包内进度；清空旧蓝图全部模式／层级进度和旧进度归档。',
                live.snapshot.completion.exists?'将已有兼容的当前块完成标记重置为 false，避免旧信号推进新蓝图；不改变量定义。':'没有完成变量，不创建变量。',
                '聊天保存包含蓝图与完成标记。未知结果可能保留内存修改，不自动重试或恢复整个旧仓库。']},live,()=>libraryPort.exportEntry(args.id,args.revision));
    }
    function assertFresh(content) {
        const plan=plans.get(content?.ticket);
        if(!plan||jsonKey(plan.content)!==jsonKey(content))throw Error('STALE_LIBRARY_CHAT');
        const live=inspect(content.target);
        if(live.metadata!==plan.live.metadata||live.settings!==plan.live.settings||live.vars!==plan.live.vars||jsonKey(live.snapshot)!==jsonKey(plan.live.snapshot))throw Error('STALE_LIBRARY_CHAT');
        plan.checkLibrary();return plan;
    }
    return Object.freeze({capture,prepareApply,assertFresh,release:content=>plans.delete(content?.ticket),clearPlans:()=>plans.clear(),
        async save(content) {
            const plan=assertFresh(content);
            try {
                if(content.operation==='capture'){
                    const r=await libraryPort.save(content.draft,{beforeApply:()=>assertFresh(content)});
                    return {...r,chatSave:'not_started',settingsSave:r.persistence};
                }
                return await system.applyApprovedToChat({metadata:plan.live.metadata,after:content.after,completion:content.completion,saveChatConfirmed,
                    validate:()=>assertFresh(content),isCurrent:()=>{
                        const live=inspect(content.target),expected=copyJson(plan.live.snapshot);
                        expected.state=content.after;
                        if(content.completion.exists){expected.completion.value=false;expected.completion.stored=true;}
                        return live.metadata===plan.live.metadata&&live.settings===plan.live.settings&&live.vars===plan.live.vars&&jsonKey(live.snapshot)===jsonKey(expected);
                    }});
            }finally{plans.delete(content.ticket);}
        },
    });
}
function countNodes(nodes){return nodes.reduce((n,node)=>n+1+countNodes(node.children||[]),0);}
