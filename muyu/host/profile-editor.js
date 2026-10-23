import { randomUUID } from '../runtime/crypto.js';
import {copyJson,jsonKey} from '../core/json-contract.js';
import {applyApprovedProfileEdit} from '../../systems/profile-editor.js';
import {createProfileCreationPort} from './profile-creation.js';
const record=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function createProfileEditorPort({getTarget,getMetadata,getCharacters,getCreationContext,extensionKey,saveChatConfirmed,isBusy=()=>false,changed,creationChanged}) {
    const creation=createProfileCreationPort({getTarget,getMetadata,getCreationContext,extensionKey,saveChatConfirmed,isBusy,changed:creationChanged});
    const plans=new Map(),versions=new Map();
    function context(target){
        if(target?.kind!=='chat'||jsonKey(target)!==jsonKey(getTarget()))throw Error('TARGET_UNAVAILABLE');
        if(isBusy())throw Error('PROFILE_BUSY');
        const metadata=getMetadata(),root=metadata?.[extensionKey],store=root?.characterProfiles,archive=root?.archivedProfiles;
        if(!record(metadata)||root!==undefined&&!record(root)||store!==undefined&&!record(store)||archive!==undefined&&!record(archive))throw Error('UNSUPPORTED_PROFILE_STORE');
        const characters=copyJson((getCharacters()||[]).map(c=>({avatar:c.avatar,name:c.name})));
        if(characters.length>512||characters.some(c=>typeof c.avatar!=='string'||!c.avatar||typeof c.name!=='string')||new Set(characters.map(c=>c.avatar)).size!==characters.length)throw Error('PROFILE_CHARACTERS_UNAVAILABLE');
        const avatars=Object.keys(store||{});
        if(avatars.length>512||avatars.some(a=>['__proto__','constructor','prototype'].includes(a)||!record(store[a])))throw Error('UNSUPPORTED_PROFILE_STORE');
        if(metadata!==getMetadata()||jsonKey(target)!==jsonKey(getTarget()))throw Error('TARGET_UNAVAILABLE');
        return{metadata,root,store,archive,avatars,characters};
    }
    function role(live,selector){
        if(typeof selector!=='string'||!/^profile-role:(0|[1-9]\d*)$/.test(selector))throw Error('INVALID_PROFILE_EDIT');
        const avatar=live.avatars[Number(selector.slice(13))];
        if(!avatar)throw Error('PROFILE_NOT_FOUND');
        const before=copyJson(live.store[avatar]);
        const archived=Object.hasOwn(live.archive||{},avatar)?copyJson(live.archive[avatar]):null;
        return{avatar,before,archived,name:live.characters.find(c=>c.avatar===avatar)?.name||'（已移除的角色 / Removed character）'};
    }
    const schemaKey=live=>jsonKey({version:live.root?.profileVersion??null,hash:live.root?.profileSchemaHash??null});
    function fingerprint(live,r){return jsonKey({avatar:r.avatar,before:r.before,archived:r.archived,archivePresent:Object.hasOwn(live.archive||{},r.avatar),characters:live.characters,schema:schemaKey(live)});}
    function version(live,selector){
        const r=role(live,selector),fp=fingerprint(live,r),key=jsonKey({target:getTarget(),selector}),old=versions.get(key);
        if(!old||old.metadata!==live.metadata||old.store!==live.store||old.archive!==live.archive||old.fp!==fp)versions.set(key,{metadata:live.metadata,store:live.store,archive:live.archive,fp,revision:randomUUID()});
        if(versions.size>512)versions.delete(versions.keys().next().value);
        return versions.get(key).revision;
    }
    function list(target,offset=0){
        if(!Number.isInteger(offset)||offset<0||offset>512)throw Error('INVALID_PROFILE_EDIT');
        const live=context(target);
        return{items:live.avatars.slice(offset,offset+16).map((a,i)=>{const character='profile-role:'+(offset+i),r=role(live,character);return{character,name:r.name,state:r.before.state??'unknown',editable:record(r.before.profile),revision:version(live,character)};}),nextOffset:offset+16<live.avatars.length?offset+16:-1};
    }
    function read(target,character,revision,offset=0){
        const live=context(target);if(version(live,character)!==revision)throw Error('STALE_PROFILE_EDIT');
        const r=role(live,character),text=JSON.stringify({character,name:r.name,current:r.before,archived:r.archived,persistence:'unknown',untrusted:true});
        if(!Number.isInteger(offset)||offset<0||offset>text.length)throw Error('INVALID_PROFILE_EDIT');
        return{character,revision,text:text.slice(offset,offset+6000),nextOffset:offset+6000<text.length?offset+6000:-1,untrusted:true};
    }
    function preview(target,args){
        if(!['update','delete'].includes(args.operation))throw Error('INVALID_PROFILE_EDIT');
        const live=context(target);if(version(live,args.character)!==args.revision)throw Error('STALE_PROFILE_EDIT');
        const r=role(live,args.character),changes=copyJson(args.changes);
        if(!record(changes)||Object.keys(changes).some(k=>!['summary','tags','motivation','relationships'].includes(k)))throw Error('INVALID_PROFILE_EDIT');
        if(args.operation==='delete'&&Object.keys(changes).length)throw Error('INVALID_PROFILE_EDIT');
        for(const key of ['summary','motivation','relationships'])if(key in changes&&(typeof changes[key]!=='string'||changes[key].length>12000))throw Error('INVALID_PROFILE_EDIT');
        if('tags' in changes&&(!Array.isArray(changes.tags)||changes.tags.length>64||changes.tags.some(t=>typeof t!=='string'||!t.trim()||t.length>200)))throw Error('INVALID_PROFILE_EDIT');
        let after=null;
        if(args.operation==='update'){
            if(!record(r.before.profile))throw Error('PROFILE_NOT_EDITABLE');
            const profile={...r.before.profile,...changes};
            if('tags' in changes)profile.tags=changes.tags.map(t=>t.trim());
            if(jsonKey(profile)===jsonKey(r.before.profile))throw Error('EMPTY_CHANGES');
            after={...r.before,profile,manualEdited:true,updatedAt:Date.now(),state:'ready'};
        }
        const candidate={module:'profile-editor',ticket:'profile-edit:'+randomUUID(),target,character:args.character,name:r.name,operation:args.operation,before:r.before,after,
            archiveBefore:args.operation==='delete'?r.archived:null,archiveAfter:args.operation==='delete'?r.before:null,
            warnings:['仅修改当前聊天档案，不改角色卡或资源库。 / Only this chat profile changes, not the character card or library.',
                args.operation==='delete'?'删除沿用旧界面的归档语义；同角色已有归档将被替换，完整差异已列出。 / Delete archives the profile and replaces any previous archive for this role.':'保留自定义字段及来源信息；设为手工编辑、已就绪，更新时间为预览时刻。 / Custom/source fields stay; mark manually edited and ready, with the preview timestamp.',
                '保存未知不自动重试或整仓回滚。 / Unknown saves never auto-retry or roll back the store.']};
        if(new TextEncoder().encode(JSON.stringify(candidate)).length>24000)throw Error('PROFILE_DRAFT_TOO_LARGE');
        const content=copyJson(candidate);if(plans.size>=64)throw Error('PROFILE_PLAN_CAPACITY');
        plans.set(content.ticket,{content:copyJson(content),live,avatar:r.avatar,fp:fingerprint(live,r),schema:schemaKey(live)});
        return content;
    }
    function assertFresh(content){
        if(content?.operation==='create')return creation.assertFresh(content);
        const plan=plans.get(content?.ticket);if(!plan||jsonKey(plan.content)!==jsonKey(content))throw Error('STALE_PROFILE_EDIT');
        const live=context(content.target),r=role(live,content.character);
        if(live.metadata!==plan.live.metadata||live.root!==plan.live.root||live.store!==plan.live.store||live.archive!==plan.live.archive||fingerprint(live,r)!==plan.fp)throw Error('STALE_PROFILE_EDIT');
        return plan;
    }
    return Object.freeze({list,read,preview,createTargets:creation.createTargets,createPreview:creation.createPreview,assertFresh,release:content=>{plans.delete(content?.ticket);creation.release(content);},clear:()=>{plans.clear();versions.clear();creation.clear();},async apply(content){
        if(content?.operation==='create')return creation.apply(content);
        const plan=assertFresh(content);
        try{return await applyApprovedProfileEdit({metadata:plan.live.metadata,extensionKey,avatar:plan.avatar,after:content.after,validate:()=>assertFresh(content),saveChatConfirmed,changed,
            isCurrent:()=>{
                const live=context(content.target),root=live.root;
                return live.metadata===plan.live.metadata&&root===plan.live.root&&live.store===plan.live.store&&jsonKey(live.characters)===jsonKey(plan.live.characters)&&
                    schemaKey(live)===plan.schema&&
                    (content.after===null?!Object.hasOwn(live.store,plan.avatar)&&jsonKey(live.archive?.[plan.avatar])===jsonKey(content.archiveAfter):
                        jsonKey(live.store[plan.avatar])===jsonKey(content.after));
            }});
        }finally{plans.delete(content.ticket);}
    }});
}
