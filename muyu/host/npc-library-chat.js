import { randomUUID } from '../runtime/crypto.js';
import { copyJson, jsonKey } from '../core/json-contract.js';
export function createNpcLibraryChatPort({getSettings,getMetadata,getTarget,system,libraryPort,saveChatConfirmed,isBusy=()=>false}) {
    const plans=new Map();
    function inspect(target) {
        if(target?.kind!=='chat'||jsonKey(target)!==jsonKey(getTarget()))throw Error('TARGET_UNAVAILABLE');
        if(isBusy())throw Error('LIBRARY_BUSY');
        const metadata=getMetadata(),settings=getSettings();
        if(!metadata||typeof metadata!=='object'||Array.isArray(metadata))throw Error('LIBRARY_CHAT_UNAVAILABLE');
        return {metadata,settings,state:copyJson(system.inspectChatLibrary(metadata))};
    }
    function keep(content,live,checkLibrary){
        if(plans.size>=64)throw Error('LIBRARY_PLAN_CAPACITY');
        if(new TextEncoder().encode(JSON.stringify(content)).length>24000)throw Error('LIBRARY_DRAFT_TOO_LARGE');
        content=copyJson(content);plans.set(content.ticket,{content,live,checkLibrary});return content;
    }
    function capture(args,target){
        const live=inspect(target),{state}=live;
        if(!state.npcs.length)throw Error('LIBRARY_NO_NPCS');
        const npcs=state.npcs.map(n=>({name:n.name,description:n.description||'',personality:n.personality||'',scenario:n.scenario||'',first_mes:n.first_mes||''}));
        const exportData={version:1,type:'npc-export',source:{groupName:state.groupName,groupNote:args.description||''},template:state.template,npcs};
        const draft=libraryPort.preview({operation:'create',changes:{name:args.name,description:args.description||'',exportData}});
        return keep({module:'npc-library-chat',operation:'capture',ticket:randomUUID(),target,name:draft.next.name,
            draft,changes:[],template:null,skipped:[],count:npcs.length,
            warnings:['将本聊天 NPC 的五项内容及有效 NPC 提示词复制到新全局库，不修改聊天、不生成角色卡、不应用提示词。导入追踪与角色卡关联不写入资源包。']},
            live,()=>libraryPort.assertDraft(draft));
    }
    function prepareApply(args,target){
        const live=inspect(target),{state}=live;
        for(const key of ['overwriteExisting','importTemplate'])if(args[key]!==undefined&&typeof args[key]!=='boolean')throw Error('INVALID_LIBRARY_CHAT');
        const data=libraryPort.exportEntry(args.id,args.revision),changes=[],skipped=[];
        for(const npc of data.npcs){
            const index=state.npcs.findIndex(n=>n.name.toLowerCase()===npc.name.toLowerCase()),before=index<0?null:state.npcs[index];
            if(before&&!args.overwriteExisting){skipped.push(before.name);continue;}
            const after={...before,name:npc.name,description:npc.description||'',personality:npc.personality||'',scenario:npc.scenario||'',first_mes:npc.first_mes||'',
                imported:before?.imported??false,importedAvatar:before?.importedAvatar??null};
            changes.push({index,before,after});
        }
        if(!changes.length)throw Error('LIBRARY_NO_CHANGES');
        return keep({module:'npc-library-chat',operation:'apply',ticket:randomUUID(),target,name:data.libraryMeta?.name||'NPC package',
            libraryId:args.id,libraryRevision:args.revision,draft:null,changes,template:args.importTemplate?{before:state.rawPrompt,after:data.template}:null,
            skipped,count:changes.length,warnings:['只新增或覆盖列出的聊天 NPC；按不区分大小写的姓名匹配，重名请核对。其他 NPC 保留；不会更新已生成的酒馆角色卡。',
                '保留已有 NPC 的角色卡导入追踪，新 NPC 为未导入；不启用功能、不生成、不修改消息正文。保存未知不自动重试。',
                args.importTemplate?'同时替换全局 NPC 提示词，影响所有聊天；先保存聊天、再保存设置，两域可能部分完成。':'不修改全局 NPC 提示词。']},
            live,()=>libraryPort.exportEntry(args.id,args.revision));
    }
    function assertFresh(content){
        const plan=plans.get(content?.ticket);
        if(!plan||jsonKey(plan.content)!==jsonKey(content))throw Error('STALE_LIBRARY_CHAT');
        const live=inspect(content.target);
        if(live.metadata!==plan.live.metadata||live.settings!==plan.live.settings||jsonKey(live.state)!==jsonKey(plan.live.state))throw Error('STALE_LIBRARY_CHAT');
        plan.checkLibrary();return plan;
    }
    return Object.freeze({capture,prepareApply,assertFresh,release:content=>plans.delete(content?.ticket),clearPlans:()=>plans.clear(),
        async save(content){
            const plan=assertFresh(content);
            try{
                if(content.operation==='capture'){
                    const result=await libraryPort.save(content.draft,{beforeApply:()=>assertFresh(content)});
                    return {...result,chatSave:'not_started',settingsSave:result.persistence,count:content.count};
                }
                return await system.applyApprovedToChat({metadata:plan.live.metadata,changes:content.changes,template:content.template?.after||null,saveChatConfirmed,
                    validate:()=>assertFresh(content),
                    isCurrent:(applied,checkPrompt)=>{
                        const live=inspect(content.target);
                        if(live.metadata!==plan.live.metadata||live.settings!==plan.live.settings)return false;
                        plan.checkLibrary();
                        if(checkPrompt&&live.state.rawPrompt!==plan.live.state.rawPrompt)return false;
                        return applied.every(value=>{const matches=live.state.npcs.filter(n=>n.name.toLowerCase()===value.name.toLowerCase());return matches.length===1&&jsonKey(matches[0])===jsonKey(value);});
                    }});
            }finally{plans.delete(content.ticket);}
        },
    });
}
