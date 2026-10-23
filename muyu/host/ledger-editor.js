import { randomUUID } from '../runtime/crypto.js';
import {copyJson,jsonKey} from '../core/json-contract.js';
import {projectLedgerEdit,applyApprovedLedgerEdit} from '../../systems/ledger-editor.js';
const record=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const publicFields=e=>copyJson(Object.fromEntries(Object.entries(e).filter(([k])=>!k.startsWith('_'))));
export function createLedgerEditorPort({getTarget,getMetadata,extensionKey,saveChatConfirmed,isBusy=()=>false,changed}) {
    const plans=new Map(),versions=new Map();
    function context(target){
        if(target?.kind!=='chat'||jsonKey(target)!==jsonKey(getTarget()))throw Error('TARGET_UNAVAILABLE');
        if(isBusy())throw Error('LEDGER_BUSY');
        const metadata=getMetadata(),root=metadata?.[extensionKey],list=root?.directorHistory;
        if(!record(metadata)||root!==undefined&&!record(root)||list!==undefined&&(!Array.isArray(list)||list.length>512||new Set(list).size!==list.length||list.some(e=>!record(e))))throw Error('UNSUPPORTED_LEDGER_STORE');
        const refs=(list||[]).slice();
        if(metadata!==getMetadata()||jsonKey(target)!==jsonKey(getTarget()))throw Error('TARGET_UNAVAILABLE');
        return{metadata,root,list,refs};
    }
    function selected(live,selector){
        if(typeof selector!=='string'||!/^ledger:(0|[1-9]\d*)$/.test(selector))throw Error('INVALID_LEDGER_EDIT');
        const index=Number(selector.slice(7)),entry=live.list?.[index];if(!entry)throw Error('LEDGER_NOT_FOUND');
        return{index,entry,full:copyJson(entry),before:publicFields(entry)};
    }
    const layoutMatches=(a,b)=>a.list===b.list&&a.refs.length===b.refs.length&&a.refs.every((e,i)=>e===b.refs[i]);
    function version(live,selector){
        const r=selected(live,selector),fp=jsonKey(r.full),key=jsonKey({target:getTarget(),selector}),old=versions.get(key);
        if(!old||old.metadata!==live.metadata||old.root!==live.root||!layoutMatches(old.live,live)||old.fp!==fp)versions.set(key,{metadata:live.metadata,root:live.root,live,fp,revision:randomUUID()});
        if(versions.size>512)versions.delete(versions.keys().next().value);
        return versions.get(key).revision;
    }
    function list(target,offset=0){
        if(!Number.isInteger(offset)||offset<0||offset>512)throw Error('INVALID_LEDGER_EDIT');
        const live=context(target);
        return{items:(live.list||[]).slice(offset,offset+16).map((e,i)=>({selector:'ledger:'+(offset+i),round:offset+i+1,cleared:!e.speakers&&!e.reason,revision:version(live,'ledger:'+(offset+i))})),nextOffset:offset+16<(live.list?.length||0)?offset+16:-1};
    }
    function read(target,selector,revision,offset=0){
        const live=context(target);if(version(live,selector)!==revision)throw Error('STALE_LEDGER_EDIT');
        const r=selected(live,selector),text=JSON.stringify({selector,entry:r.before,persistence:'unknown',untrusted:true,notice:'Editable history, not proof of past execution. Internal anchors withheld.'});
        if(!Number.isInteger(offset)||offset<0||offset>text.length)throw Error('INVALID_LEDGER_EDIT');
        return{selector,revision,text:text.slice(offset,offset+6000),nextOffset:offset+6000<text.length?offset+6000:-1,untrusted:true};
    }
    function preview(target,args){
        const live=context(target);if(version(live,args.selector)!==args.revision)throw Error('STALE_LEDGER_EDIT');
        const r=selected(live,args.selector),after=projectLedgerEdit(r.before,args.operation,copyJson(args.changes));
        if(jsonKey(after)===jsonKey(r.before))throw Error('EMPTY_CHANGES');
        const content=copyJson({module:'ledger-editor',ticket:'ledger-edit:'+randomUUID(),target,selector:args.selector,operation:args.operation,name:'Ledger #'+(r.index+1),before:r.before,after,
            warnings:['仅修改当前聊天一条账本；清空保留位置和内部消息锚点，不删除条目。 / One chat ledger entry only; clearing keeps its slot and internal anchors.',
            '发言人／剧本可影响后续导演恢复与提示词；编辑历史不证明过去实际发言或保存成功，不立即生成。 / Speakers/scripts can affect future Director recovery/prompts; editable history is not proof of past execution. No immediate generation.',
            '已有names随speakers同步；其他未指定字段保留。保存未知不重试或整仓回滚。 / Existing names follows speakers; omitted fields preserved. Never retry unknown saves or roll back the store.']});
        if(new TextEncoder().encode(JSON.stringify(content)).length>24000)throw Error('LEDGER_DRAFT_TOO_LARGE');
        if(plans.size>=64)throw Error('LEDGER_PLAN_CAPACITY');
        plans.set(content.ticket,{content:copyJson(content),live,index:r.index,entry:r.entry,full:r.full});return content;
    }
    function assertFresh(content){
        const plan=plans.get(content?.ticket);if(!plan||jsonKey(plan.content)!==jsonKey(content))throw Error('STALE_LEDGER_EDIT');
        const live=context(content.target),r=selected(live,content.selector);
        if(live.metadata!==plan.live.metadata||live.root!==plan.live.root||!layoutMatches(plan.live,live)||r.entry!==plan.entry||jsonKey(r.full)!==jsonKey(plan.full))throw Error('STALE_LEDGER_EDIT');
        return plan;
    }
    return Object.freeze({list,read,preview,assertFresh,release:content=>plans.delete(content?.ticket),clear:()=>{plans.clear();versions.clear();},async apply(content){
        const plan=assertFresh(content),internal=Object.fromEntries(Object.entries(plan.full).filter(([k])=>k.startsWith('_'))),expected={...internal,...content.after};
        try{return await applyApprovedLedgerEdit({list:plan.live.list,index:plan.index,after:content.after,metadata:plan.live.metadata,saveChatConfirmed,changed,validate:()=>assertFresh(content),
            isCurrent:()=>{const live=context(content.target),r=selected(live,content.selector);return live.metadata===plan.live.metadata&&live.root===plan.live.root&&layoutMatches(plan.live,live)&&r.entry===plan.entry&&jsonKey(r.full)===jsonKey(expected);}});
        }finally{plans.delete(content.ticket);}
    }});
}
