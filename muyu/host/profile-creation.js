import { randomUUID } from '../runtime/crypto.js';
import {copyJson,jsonKey} from '../core/json-contract.js';
import {applyApprovedProfileCreation} from '../../systems/profile-editor.js';
const record=v=>v&&typeof v==='object'&&!Array.isArray(v);
export function createProfileCreationPort({getTarget,getMetadata,getCreationContext,extensionKey,saveChatConfirmed,isBusy=()=>false,changed}) {
 const versions=new Map(),plans=new Map();
 function context(target,character){
  if(target?.kind!=='chat'||jsonKey(target)!==jsonKey(getTarget()))throw Error('TARGET_UNAVAILABLE');
  if(isBusy())throw Error('PROFILE_BUSY');
  const metadata=getMetadata(),root=metadata?.[extensionKey],store=root?.characterProfiles,archive=root?.archivedProfiles;
  if(!record(metadata)||root!==undefined&&!record(root)||store!==undefined&&!record(store)||archive!==undefined&&!record(archive))throw Error('UNSUPPORTED_PROFILE_STORE');
  const avatars=Object.keys(store||{});if(avatars.length>512||avatars.some(a=>['__proto__','constructor','prototype'].includes(a)))throw Error('UNSUPPORTED_PROFILE_STORE');
  if(typeof getCreationContext!=='function')throw Error('PROFILE_CREATION_UNAVAILABLE');
  const info=copyJson(getCreationContext());
  if(typeof info.schemaHash!=='string'||!info.schemaHash||!Array.isArray(info.characters)||info.characters.length>512||info.characters.some(c=>typeof c.avatar!=='string'||!c.avatar||['__proto__','constructor','prototype'].includes(c.avatar)||typeof c.name!=='string'||typeof c.hash!=='string')||new Set(info.characters.map(c=>c.avatar)).size!==info.characters.length)throw Error('PROFILE_CHARACTERS_UNAVAILABLE');
  const schema=copyJson({version:root?.profileVersion??null,hash:root?.profileSchemaHash??null});
  if(schema.version!==null&&schema.version!==1||schema.hash!==null&&typeof schema.hash!=='string')throw Error('UNSUPPORTED_PROFILE_STORE');
  if(schema.hash&&schema.hash!==info.schemaHash)throw Error('PROFILE_SCHEMA_STALE');
  let selected;
  if(character!==undefined){
   if(typeof character!=='string'||!/^profile-character:(0|[1-9]\d*)$/.test(character))throw Error('INVALID_PROFILE_EDIT');
   selected=info.characters[Number(character.slice(18))];if(!selected)throw Error('PROFILE_NOT_FOUND');
  }
  if(metadata!==getMetadata()||jsonKey(target)!==jsonKey(getTarget()))throw Error('TARGET_UNAVAILABLE');
  return{metadata,root,store,archive,info,schema,selected,count:avatars.length,exists:!!selected&&Object.hasOwn(store||{},selected.avatar)};
 }
 const fp=live=>jsonKey({info:live.info,schema:live.schema,exists:live.exists});
 function version(live,target,character){const key=jsonKey({target,character}),old=versions.get(key),fingerprint=fp(live);if(!old||old.metadata!==live.metadata||old.root!==live.root||old.store!==live.store||old.archive!==live.archive||old.fp!==fingerprint)versions.set(key,{...live,fp:fingerprint,revision:randomUUID()});if(versions.size>512)versions.delete(versions.keys().next().value);return versions.get(key).revision;}
 function createTargets(target,offset=0){
  if(!Number.isInteger(offset)||offset<0||offset>512)throw Error('INVALID_PROFILE_EDIT');const live=context(target);
  return{items:live.info.characters.slice(offset,offset+16).map((c,i)=>{const character='profile-character:'+(offset+i),selected={...live,selected:c,exists:Object.hasOwn(live.store||{},c.avatar)};return{character,name:c.name,canCreate:!selected.exists&&selected.count<512,revision:version(selected,target,character)};}),nextOffset:offset+16<live.info.characters.length?offset+16:-1};
 }
 function createPreview(target,args){
  const live=context(target,args.character);if(live.exists)throw Error('PROFILE_ALREADY_EXISTS');if(version(live,target,args.character)!==args.revision)throw Error('STALE_PROFILE_EDIT');
  if(live.count>=512)throw Error('PROFILE_CAPACITY');
  const fields=copyJson(args.changes);
  if(!record(fields)||Object.keys(fields).some(k=>!['summary','tags','motivation','relationships'].includes(k))||typeof fields.summary!=='string'||!fields.summary.trim())throw Error('INVALID_PROFILE_EDIT');
  for(const k of ['summary','motivation','relationships'])if(k in fields&&(typeof fields[k]!=='string'||fields[k].length>12000))throw Error('INVALID_PROFILE_EDIT');
  if('tags'in fields&&(!Array.isArray(fields.tags)||fields.tags.length>64||fields.tags.some(t=>typeof t!=='string'||!t.trim()||t.length>200)))throw Error('INVALID_PROFILE_EDIT');
  const content=copyJson({module:'profile-editor',operation:'create',ticket:'profile-create:'+randomUUID(),target,character:args.character,name:live.selected.name,before:null,
   after:{avatar:live.selected.avatar,name:live.selected.name,hash:live.selected.hash,profile:{summary:fields.summary.trim(),tags:(fields.tags||[]).map(t=>t.trim()),motivation:fields.motivation||'',relationships:fields.relationships||''},state:'ready',manualEdited:true,updatedAt:Date.now()},archiveBefore:null,archiveAfter:null,
   warnings:['仅新建当前聊天指定角色档案，不覆盖任何已有记录，保留归档与共享Schema元数据。 / Create this chat profile only; no overwrite, archive or shared schema metadata changes.',
   '手工档案使用标准四字段；不承诺通过用户自定义生成Schema校验。已就绪不证明事实正确或已持久化。 / Manual standard four-field profile; no custom generation-schema validation claim. Ready is not fact or persistence confirmation.',
   '档案功能已开启时，新档案可被后续上下文注入使用；旧管理列表不会自动刷新，编辑草稿保留。 / If profiles are enabled, later context may use this profile; the old management list is not auto-refreshed and editor drafts stay.',
   '不修改角色卡、资源库或功能开关，不额外调用生成模型；保存未知不自动重试或整仓回滚。 / No card, library, enabling or extra generation; unknown saves never auto-retry or restore the store.']});
  if(new TextEncoder().encode(JSON.stringify(content)).length>24000)throw Error('PROFILE_DRAFT_TOO_LARGE');if(plans.size>=64)throw Error('PROFILE_PLAN_CAPACITY');plans.set(content.ticket,{live,content:copyJson(content),fp:fp(live)});return content;
 }
 function assertFresh(content){const p=plans.get(content?.ticket);if(!p||jsonKey(content)!==jsonKey(p.content))throw Error('STALE_PROFILE_EDIT');const live=context(content.target,content.character);if(live.exists||live.count>=512||live.metadata!==p.live.metadata||live.root!==p.live.root||live.store!==p.live.store||live.archive!==p.live.archive||fp(live)!==p.fp)throw Error('STALE_PROFILE_EDIT');return p;}
 return{createTargets,createPreview,assertFresh,release:content=>plans.delete(content?.ticket),clear(){plans.clear();versions.clear();},async apply(content){const p=assertFresh(content);try{return await applyApprovedProfileCreation({metadata:p.live.metadata,extensionKey,avatar:p.live.selected.avatar,after:content.after,saveChatConfirmed,changed,validate:()=>assertFresh(content),isCurrent:(root,store,entry)=>{const live=context(content.target,content.character);return live.metadata===p.live.metadata&&live.root===root&&live.store===store&&live.archive===p.live.archive&&store[p.live.selected.avatar]===entry&&jsonKey(entry)===jsonKey(content.after)&&jsonKey(live.info)===jsonKey(p.live.info)&&jsonKey(live.schema)===jsonKey(p.live.schema);}});}finally{plans.delete(content.ticket);}}};
}
