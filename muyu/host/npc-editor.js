import { randomUUID } from '../runtime/crypto.js';
import {copyJson,jsonKey} from '../core/json-contract.js';
import {createNpcCreationPort} from './npc-creation.js';
const record=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function createNpcEditorPort({getTarget,getMetadata,extensionKey,system,saveChatConfirmed,isBusy=()=>false,changed}) {
    const creation=createNpcCreationPort({getTarget,getMetadata,extensionKey,system,saveChatConfirmed,isBusy,changed});
    const plans=new Map(),versions=new Map();
    function context(target){
        if(target?.kind!=='chat'||jsonKey(target)!==jsonKey(getTarget()))throw Error('TARGET_UNAVAILABLE');
        if(isBusy()||system?.isGenerating?.())throw Error('NPC_BUSY');
        const metadata=getMetadata(),root=metadata?.[extensionKey],list=root?.npcs;
        if(!record(metadata)||root!==undefined&&!record(root)||list!==undefined&&(!Array.isArray(list)||list.length>512||list.some(e=>!record(e)||typeof e.name!=='string')))throw Error('UNSUPPORTED_NPC_STORE');
        const layout=copyJson((list||[]).map(e=>({name:e.name,importId:e.importId??null})));
        if(metadata!==getMetadata()||jsonKey(target)!==jsonKey(getTarget()))throw Error('TARGET_UNAVAILABLE');
        return{metadata,root,list,layout};
    }
    function selected(live,selector){
        if(typeof selector!=='string'||!/^npc:(0|[1-9]\d*)$/.test(selector))throw Error('INVALID_NPC_EDIT');
        const index=Number(selector.slice(4)),entry=live.list?.[index];
        if(!entry)throw Error('NPC_NOT_FOUND');
        return{index,entry,before:copyJson(entry)};
    }
    function version(live,selector){
        const r=selected(live,selector),fp=jsonKey({before:r.before,layout:live.layout}),key=jsonKey({target:getTarget(),selector}),old=versions.get(key);
        if(!old||old.metadata!==live.metadata||old.list!==live.list||old.entry!==r.entry||old.fp!==fp)versions.set(key,{metadata:live.metadata,list:live.list,entry:r.entry,fp,revision:randomUUID()});
        if(versions.size>512)versions.delete(versions.keys().next().value);
        return versions.get(key).revision;
    }
    function list(target,offset=0){
        if(!Number.isInteger(offset)||offset<0||offset>512)throw Error('INVALID_NPC_EDIT');
        const live=context(target);
        return{items:(live.list||[]).slice(offset,offset+16).map((e,i)=>({selector:'npc:'+(offset+i),name:e.name,imported:!!e.imported,hasFirstMessage:Object.hasOwn(e,'first_mes'),revision:version(live,'npc:'+(offset+i))})),nextOffset:offset+16<(live.list?.length||0)?offset+16:-1};
    }
    function read(target,selector,revision,offset=0){
        const live=context(target);if(version(live,selector)!==revision)throw Error('STALE_NPC_EDIT');
        const r=selected(live,selector),text=JSON.stringify({selector,npc:r.before,persistence:'unknown',untrusted:true});
        if(!Number.isInteger(offset)||offset<0||offset>text.length)throw Error('INVALID_NPC_EDIT');
        return{selector,revision,text:text.slice(offset,offset+6000),nextOffset:offset+6000<text.length?offset+6000:-1,untrusted:true};
    }
    function preview(target,args){
        if(!['update','delete'].includes(args.operation))throw Error('INVALID_NPC_EDIT');
        const live=context(target);if(version(live,args.selector)!==args.revision)throw Error('STALE_NPC_EDIT');
        const r=selected(live,args.selector),changes=copyJson(args.changes),keys=Object.keys(changes||{});
        if(!record(changes)||keys.some(k=>!['name','description','personality','scenario','first_mes'].includes(k)))throw Error('INVALID_NPC_EDIT');
        if(args.operation==='delete'&&keys.length)throw Error('INVALID_NPC_EDIT');
        if(keys.some(k=>typeof changes[k]!=='string'||changes[k].length>(k==='name'?200:12000)))throw Error('INVALID_NPC_EDIT');
        if('name' in changes&&!changes.name.trim())throw Error('INVALID_NPC_EDIT');
        if('first_mes' in changes&&!Object.hasOwn(r.before,'first_mes'))throw Error('NPC_FIRST_MESSAGE_UNAVAILABLE');
        const after=args.operation==='delete'?null:{...r.before,...Object.fromEntries(keys.map(k=>[k,changes[k].trim()]))};
        if(after&&live.list.some((e,i)=>i!==r.index&&e.name.toLowerCase()===after.name.toLowerCase()))throw Error('NPC_NAME_COLLISION');
        if(jsonKey(r.before)===jsonKey(after))throw Error('EMPTY_CHANGES');
        const candidate={module:'npc-editor',ticket:'npc-edit:'+randomUUID(),target,selector:args.selector,name:r.before.name,operation:args.operation,before:r.before,after,
            warnings:['仅修改当前聊天NPC记录，不修改／删除已导出的角色卡或资源库。 / Only this chat NPC record changes, not exported character cards or libraries.',
                args.operation==='delete'?'删除不归档，不能直接撤销。 / Deletion does not archive and cannot be directly undone.':'保留导入状态、角色卡标识、创建时间和自定义字段。 / Import status, card IDs, creation time and custom fields stay unchanged.',
                '保存未知不自动重试或整仓回滚。 / Unknown saves never auto-retry or roll back the store.']};
        if(new TextEncoder().encode(JSON.stringify(candidate)).length>24000)throw Error('NPC_DRAFT_TOO_LARGE');
        const content=copyJson(candidate);if(plans.size>=64)throw Error('NPC_PLAN_CAPACITY');
        plans.set(content.ticket,{content:copyJson(content),live,index:r.index,entry:r.entry,baseline:r.before,entries:live.list.slice()});
        return content;
    }
    function assertFresh(content){
        if(content?.operation==='create')return creation.assertFresh(content);
        const plan=plans.get(content?.ticket);if(!plan||jsonKey(plan.content)!==jsonKey(content))throw Error('STALE_NPC_EDIT');
        const live=context(content.target),r=selected(live,content.selector);
        if(live.metadata!==plan.live.metadata||live.root!==plan.live.root||live.list!==plan.live.list||r.entry!==plan.entry||
            live.list.length!==plan.entries.length||live.list.some((e,i)=>e!==plan.entries[i])||jsonKey(live.layout)!==jsonKey(plan.live.layout)||jsonKey(r.before)!==jsonKey(plan.baseline))throw Error('STALE_NPC_EDIT');
        return plan;
    }
    return Object.freeze({list,read,preview,createRead:creation.createRead,createPreview:creation.createPreview,assertFresh,release:content=>{plans.delete(content?.ticket);creation.release(content);},clear:()=>{plans.clear();versions.clear();creation.clear();},async apply(content){
        if(content?.operation==='create')return creation.apply(content);
        const plan=assertFresh(content);if(typeof system?.applyApprovedEdit!=='function')throw Error('WRITE_UNAVAILABLE');
        const layout=copyJson(plan.live.layout);if(content.after===null)layout.splice(plan.index,1);else layout[plan.index].name=content.after.name;
        try{return await system.applyApprovedEdit({metadata:plan.live.metadata,index:plan.index,after:content.after,saveChatConfirmed,changed,validate:()=>assertFresh(content),
            isCurrent:()=>{const live=context(content.target);return live.metadata===plan.live.metadata&&live.root===plan.live.root&&live.list===plan.live.list&&jsonKey(live.layout)===jsonKey(layout)&&
                (content.after===null?!live.list.includes(plan.entry):live.list[plan.index]===plan.entry&&jsonKey(live.list[plan.index])===jsonKey(content.after));}});
        }finally{plans.delete(content.ticket);}
    }});
}
