import { randomUUID } from '../runtime/crypto.js';
import { copyJson, jsonKey } from '../core/json-contract.js';
export function createProfileLibraryChatPort({ getSettings, getMetadata, getTarget, system, libraryPort, saveChatConfirmed, isBusy = () => false }) {
    const plans = new Map();
    function inspect(target) {
        if (target?.kind !== 'chat' || jsonKey(target)!==jsonKey(getTarget())) throw Error('TARGET_UNAVAILABLE');
        if (isBusy() || system.isAutoLoading?.()) throw Error('LIBRARY_BUSY');
        const metadata=getMetadata(),settings=getSettings();
        if (!metadata || typeof metadata!=='object' || Array.isArray(metadata)) throw Error('LIBRARY_CHAT_UNAVAILABLE');
        const state=copyJson(system.inspectChatLibrary(metadata));
        if (state.members.some(m=>['__proto__','prototype','constructor'].includes(m.avatar))) throw Error('INVALID_LIBRARY_CHAT');
        return {metadata,settings,state};
    }
    function keep(content, live, checkLibrary) {
        if (plans.size>=64) throw Error('LIBRARY_PLAN_CAPACITY');
        if (new TextEncoder().encode(JSON.stringify(content)).length>24000) throw Error('LIBRARY_DRAFT_TOO_LARGE');
        content=copyJson(content);
        plans.set(content.ticket,{content,live,checkLibrary});
        return content;
    }
    function capture(args,target) {
        const live=inspect(target), {state}=live;
        const profiles=state.members.flatMap(m=>{
            const p=state.profiles[m.avatar];
            return p?.state==='ready' && p.profile ? [{avatar:m.avatar,name:m.name,hash:p.hash||'',profile:p.profile}] : [];
        });
        if (!profiles.length) throw Error('LIBRARY_NO_READY_PROFILES');
        const exportData={version:1,type:'profile-export',source:{groupName:state.groupName,groupNote:args.description||''},template:state.template,profiles};
        const draft=libraryPort.preview({operation:'create',changes:{name:args.name,description:args.description||'',exportData}});
        return keep({module:'profile-library-chat',operation:'capture',ticket:randomUUID(),target,name:draft.next.name,
            draft,changes:[],template:null,skipped:[],unmatched:[],count:profiles.length,
            warnings:['只把当前群聊启用成员的已完成档案复制到全局库，已有聊天档案不变，不立即应用模板；后续自动加载可能使用此包。']},
            live,()=>libraryPort.assertDraft(draft));
    }
    function prepareApply(args,target) {
        const live=inspect(target),{state}=live;
        for(const key of ['overwriteExisting','importTemplate','matchNameOnly']) if(args[key]!==undefined&&typeof args[key]!=='boolean')throw Error('INVALID_LIBRARY_CHAT');
        const data=libraryPort.exportEntry(args.id,args.revision);
        const matched=system.matchLibraryProfiles(data,{members:state.members,liveProfiles:state.profiles,
            matchHash:true,matchAvatarName:true,matchNameOnly:args.matchNameOnly===true,overwriteExisting:args.overwriteExisting===true});
        // Stronger than legacy GUI: without explicit overwrite, preserve ANY existing record.
        const skipped=matched.matches.filter(m=>!args.overwriteExisting&&Object.hasOwn(state.profiles,m.targetAvatar));
        const usable=matched.matches.filter(m=>!skipped.includes(m));
        if(!usable.length)throw Error('LIBRARY_NO_CHANGES');
        const changes=usable.map(m=>({avatar:m.targetAvatar,name:m.targetName,matchType:m.matchType,before:state.profiles[m.targetAvatar]??null,
            after:{avatar:m.targetAvatar,name:m.targetName,hash:m.targetHash||m.profile.hash||'',profile:m.profile.profile,state:'ready',manualEdited:!!state.profiles[m.targetAvatar]?.manualEdited}}));
        const content={module:'profile-library-chat',operation:'apply',ticket:randomUUID(),target,name:data.libraryMeta?.name||'Profile package',
            libraryId:args.id,libraryRevision:args.revision,draft:null,changes,template:args.importTemplate?{before:state.rawTemplate,after:data.template}:null,
            skipped:skipped.map(m=>m.targetName),unmatched:matched.unmatchedMembers.map(m=>m.name),count:changes.length,
            warnings:['仅将列出的档案写入本聊天；不清空其他档案，不编辑消息正文，不调用模型。保存失败或切聊天后不自动重试。',
                args.matchNameOnly?'已允许仅名称匹配，重名可能关联错误，请逐项核对。':'按角色内容指纹或头像与姓名匹配，不启用仅名称匹配。',
                args.importTemplate?'同时替换全局档案生成 Prompt、Schema 与渲染模板，影响其他聊天。先保存聊天，再保存全局设置，两域可能部分完成。':'不修改全局档案模板。']};
        return keep(content,live,()=>libraryPort.exportEntry(args.id,args.revision));
    }
    function assertFresh(content) {
        const plan=plans.get(content?.ticket);
        if(!plan||jsonKey(plan.content)!==jsonKey(content))throw Error('STALE_LIBRARY_CHAT');
        const live=inspect(content.target);
        if(live.metadata!==plan.live.metadata||live.settings!==plan.live.settings||jsonKey(live.state)!==jsonKey(plan.live.state))throw Error('STALE_LIBRARY_CHAT');
        plan.checkLibrary(); return plan;
    }
    return Object.freeze({capture,prepareApply,assertFresh,release:content=>plans.delete(content?.ticket),clearPlans:()=>plans.clear(),
        async save(content) {
            const plan=assertFresh(content);
            try {
                if(content.operation==='capture'){
                    const result=await libraryPort.save(content.draft,{beforeApply:()=>assertFresh(content)});
                    return {...result,chatSave:'not_started',settingsSave:result.persistence,count:content.count};
                }
                return await system.applyApprovedToChat({metadata:plan.live.metadata,changes:content.changes,template:content.template?.after||null,saveChatConfirmed,
                    validate:()=>assertFresh(content),
                    isCurrent:(applied,checkTemplates)=>{
                        const live=inspect(content.target);
                        if(live.metadata!==plan.live.metadata||live.settings!==plan.live.settings||jsonKey(live.state.members)!==jsonKey(plan.live.state.members))return false;
                        plan.checkLibrary();
                        if(checkTemplates&&jsonKey(live.state.rawTemplate)!==jsonKey(plan.live.state.rawTemplate))return false;
                        return Object.entries(applied).every(([avatar,value])=>jsonKey(live.state.profiles[avatar])===jsonKey(value));
                    }});
            } finally {plans.delete(content.ticket);}
        },
    });
}
