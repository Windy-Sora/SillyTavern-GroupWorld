import { randomUUID } from '../runtime/crypto.js';
import { copyJson,jsonKey } from '../core/json-contract.js';
import { slugifyId } from '../../systems/variable-system.js';
import { projectVariableEdit,applyApprovedVariableEdit } from '../../systems/variable-editor.js';
const record=v=>v&&typeof v==='object'&&!Array.isArray(v);
export function createVariableEditorPort({getTarget,getMetadata,getSettings,getCharacters,getGroup,extensionKey,saveChatConfirmed,isBusy=()=>false,changed}) {
    const plans=new Map(),versions=new Map();
    function context(target) {
        if(target?.kind!=='chat'||jsonKey(target)!==jsonKey(getTarget()))throw Error('TARGET_UNAVAILABLE');
        if(isBusy())throw Error('VARIABLE_BUSY');
        const metadata=getMetadata(),settings=getSettings(),root=metadata?.[extensionKey],vars=root?.variables;
        if(!record(metadata)||root!==undefined&&!record(root)||vars!==undefined&&(!record(vars)||!Array.isArray(vars.defs)||!record(vars.values)||
            !record(vars.values.global)||!record(vars.values.character)||vars.log!==undefined&&!Array.isArray(vars.log)))throw Error('UNSUPPORTED_VARIABLE_STORE');
        const chars=getCharacters()||[],group=getGroup?.()||null;
        if(!Array.isArray(chars)||chars.length>512||chars.some(c=>!record(c)||typeof c.avatar!=='string'||!c.avatar||typeof c.name!=='string')||
            new Set(chars.map(c=>c.avatar)).size!==chars.length)throw Error('VARIABLE_CHARACTERS_UNAVAILABLE');
        const characters=copyJson(chars.map(c=>({avatar:c.avatar,name:c.name})));
        const members=group?.members||null,disabled=group?.disabled_members||[];
        if(members!==null&&!Array.isArray(members)||!Array.isArray(disabled))throw Error('VARIABLE_CHARACTERS_UNAVAILABLE');
        const characterGroup=members?.length?copyJson({members,disabled_members:disabled}):null;
        const config=copyJson({completionId:slugifyId(settings?.storyBlueprintCompletionVariable||'gd_story_chapter_done'),guard:settings?.storyBlueprintCompletionVariableGuard||''});
        if(getMetadata()!==metadata||jsonKey(target)!==jsonKey(getTarget()))throw Error('TARGET_UNAVAILABLE');
        return {metadata,vars,settings,characters,group:characterGroup,config};
    }
    function selected(live,id) {
        if(typeof id!=='string'||slugifyId(id)!==id||!(/^[a-z0-9_]{1,64}$/).test(id)||['__proto__','constructor','prototype'].includes(id))throw Error('INVALID_VARIABLE_ID');
        const rows=live.vars?.defs.filter(d=>slugifyId(d?.id)===id)||[];
        if(rows.length>1||rows[0]&&rows[0].id!==id)throw Error('VARIABLE_ID_COLLISION');
        const values=live.vars?.values;
        if(values&&Object.hasOwn(values.character,id)&&!record(values.character[id]))throw Error('UNSUPPORTED_VARIABLE_STORE');
        return copyJson({definition:rows[0]||null,global:{present:Object.hasOwn(values?.global||{},id),value:Object.hasOwn(values?.global||{},id)?values.global[id]:null},
            characters:Object.hasOwn(values?.character||{},id)?values.character[id]:null});
    }
    function editable(live,id,before) {
        if(id===live.config.completionId||id===live.config.guard||before.definition?.owner)throw Error('VARIABLE_REQUIRES_SPECIAL_EDITOR');
    }
    function snapshot(live,id) {return {before:selected(live,id),logs:copyJson((live.vars?.log||[]).filter(r=>r?.id===id)),characters:live.characters,group:live.group,config:live.config};}
    function version(live,id){
        const fingerprint=jsonKey(snapshot(live,id)),key=jsonKey({target:getTarget(),id}),old=versions.get(key);
        if(!old||old.metadata!==live.metadata||old.vars!==live.vars||old.fingerprint!==fingerprint)versions.set(key,{metadata:live.metadata,vars:live.vars,fingerprint,revision:randomUUID()});
        if(versions.size>512)versions.delete(versions.keys().next().value);
        return versions.get(key).revision;
    }
    function roles(live){return live.characters.map((c,i)=>({selector:'character:'+i,name:c.name,
        available:!live.group||live.group.members.includes(c.avatar)&&!live.group.disabled_members.includes(c.avatar)}));}
    function list(target,offset=0){
        if(!Number.isInteger(offset)||offset<0||offset>1024)throw Error('INVALID_VARIABLE_EDIT');
        const live=context(target),defs=live.vars?.defs||[];
        if(defs.length>1024||new Set(defs.map(d=>slugifyId(d?.id))).size!==defs.length)throw Error('VARIABLE_ID_COLLISION');
        return {items:defs.slice(offset,offset+24).map(d=>({id:d.id,label:String(d.label||d.id).slice(0,100),scope:d.scope,type:d.type,
            editable:!(d.owner||d.id===live.config.completionId||d.id===live.config.guard),revision:version(live,d.id)})),nextOffset:offset+24<defs.length?offset+24:-1};
    }
    function read(target,id,revision,offset=0){
        const live=context(target);if(version(live,id)!==revision)throw Error('STALE_VARIABLE_EDIT');
        const text=JSON.stringify({variable:selected(live,id),characters:roles(live),scopeNotice:'global means this chat, not all chats; values are stored/default data, not evaluated or persistence-confirmed'});
        if(!Number.isInteger(offset)||offset<0||offset>text.length)throw Error('INVALID_VARIABLE_EDIT');
        return {id,revision,text:text.slice(offset,offset+6000),nextOffset:offset+6000<text.length?offset+6000:-1,untrusted:true};
    }
    function preview(target,args) {
        if(!['create','update','delete','set_value'].includes(args.operation))throw Error('INVALID_VARIABLE_EDIT');
        const live=context(target),id=args.id,baseline=snapshot(live,id),before=baseline.before;editable(live,id,before);
        if(args.operation==='create'){
            if(args.revision||before.definition||before.global.present||before.characters!==null||baseline.logs.length)throw Error('VARIABLE_ID_COLLISION');
        }else if(!before.definition)throw Error('VARIABLE_NOT_FOUND');
        else if(!args.revision||version(live,id)!==args.revision)throw Error('STALE_VARIABLE_EDIT');
        let avatar=null;
        if(args.operation==='set_value'&&before.definition.scope==='character'){
            if(typeof args.character!=='string'||!/^character:(0|[1-9]\d*)$/.test(args.character))throw Error('VARIABLE_CHARACTER_REQUIRED');
            const index=Number(args.character.slice(10)),role=roles(live)[index];
            if(!role?.available)throw Error('VARIABLE_CHARACTER_UNAVAILABLE');
            avatar=live.characters[index].avatar;
        }else if(args.character)throw Error('INVALID_VARIABLE_EDIT');
        const after=projectVariableEdit({id,operation:args.operation,changes:copyJson(args.changes),before,characters:live.characters,group:live.group,targetAvatar:avatar});
        if(jsonKey({definition:after.definition,global:after.global,characters:after.characters})===jsonKey(before)&&args.operation!=='delete')throw Error('EMPTY_CHANGES');
        const content=copyJson({module:'variable-editor',operation:args.operation,id,target,ticket:'variable-edit:'+randomUUID(),name:after.definition?.label||before.definition?.label||id,
            before,after:{definition:after.definition,global:after.global,characters:after.characters},character:args.character||'',
            warnings:['仅修改当前聊天；global表示聊天内全局值。差异中的角色值和默认值并非持久化确认或规则求值结果。',
                '作用域切换会清除原作用域值；resetValues=true会清除该变量全部已存值。类型切换要求剩余值符合新类型。',
                args.operation==='delete'?'删除此变量定义、全局／角色值和该变量的更新记录；不能直接撤销。':'数值增量、追加和对象合并仅显式选择时使用；set_value默认替换。',
                '保存未知不自动重试或整仓回滚；手动值编辑会新增记录，超过100条时淘汰最旧记录。']});
        if(new TextEncoder().encode(JSON.stringify(content)).length>24000)throw Error('VARIABLE_DRAFT_TOO_LARGE');
        if(plans.size>=64)throw Error('VARIABLE_PLAN_CAPACITY');
        plans.set(content.ticket,{content:copyJson(content),live,baseline:copyJson(baseline),after:copyJson(after)});return content;
    }
    function assertFresh(content){
        const plan=plans.get(content?.ticket);if(!plan||jsonKey(plan.content)!==jsonKey(content))throw Error('STALE_VARIABLE_EDIT');
        const live=context(content.target);
        if(live.metadata!==plan.live.metadata||live.vars!==plan.live.vars||live.settings!==plan.live.settings||jsonKey(snapshot(live,content.id))!==jsonKey(plan.baseline))throw Error('STALE_VARIABLE_EDIT');
        editable(live,content.id,selected(live,content.id));return plan;
    }
    return Object.freeze({list,read,preview,assertFresh,release:content=>plans.delete(content?.ticket),clear:()=>{plans.clear();versions.clear();},
        async apply(content){
            const plan=assertFresh(content);
            try{return await applyApprovedVariableEdit({metadata:plan.live.metadata,extensionKey,id:content.id,after:plan.after,operation:content.operation,saveChatConfirmed,changed,
                validate:()=>assertFresh(content),isCurrent:()=>{
                    const live=context(content.target);
                    return live.metadata===plan.live.metadata&&live.settings===plan.live.settings&&jsonKey(selected(live,content.id))===jsonKey(content.after)&&
                        jsonKey(live.config)===jsonKey(plan.live.config)&&jsonKey(live.characters)===jsonKey(plan.live.characters)&&jsonKey(live.group)===jsonKey(plan.live.group)&&
                        (content.operation!=='delete'||!(live.vars?.log||[]).some(r=>r?.id===content.id));
                }});}finally{plans.delete(content.ticket);}
        },
    });
}
