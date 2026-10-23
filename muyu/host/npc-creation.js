import { randomUUID } from '../runtime/crypto.js';
import {copyJson,jsonKey} from '../core/json-contract.js';
const record=v=>v&&typeof v==='object'&&!Array.isArray(v);
export function createNpcCreationPort({getTarget,getMetadata,extensionKey,system,saveChatConfirmed,isBusy=()=>false,changed}) {
 const versions=new Map(),plans=new Map();
 function context(target){
  if(target?.kind!=='chat'||jsonKey(target)!==jsonKey(getTarget()))throw Error('TARGET_UNAVAILABLE');if(isBusy()||system?.isGenerating?.())throw Error('NPC_BUSY');
  const metadata=getMetadata(),root=metadata?.[extensionKey],list=root?.npcs;
  if(!record(metadata)||root!==undefined&&!record(root)||list!==undefined&&(!Array.isArray(list)||list.length>512||list.some(e=>!record(e)||typeof e.name!=='string')))throw Error('UNSUPPORTED_NPC_STORE');
  if(typeof system?.inspectManualCreation!=='function')throw Error('NPC_CREATION_UNAVAILABLE');
  const info=copyJson(system.inspectManualCreation());
  if(!Number.isSafeInteger(info.limit)||info.limit<1||!Array.isArray(info.characters)||info.characters.length>512||info.characters.some(c=>typeof c.name!=='string'))throw Error('NPC_CHARACTERS_UNAVAILABLE');
  const layout=copyJson((list||[]).map(e=>({name:e.name,importId:e.importId??null})));
  if(metadata!==getMetadata()||jsonKey(target)!==jsonKey(getTarget()))throw Error('TARGET_UNAVAILABLE');
  return{metadata,root,list,entries:(list||[]).slice(),info,layout};
 }
 const fp=live=>jsonKey({info:live.info,layout:live.layout});
 function revision(live,target){const key=jsonKey(target),old=versions.get(key),fingerprint=fp(live);if(!old||old.metadata!==live.metadata||old.root!==live.root||old.list!==live.list||old.entries.some((e,i)=>e!==live.entries[i])||old.fp!==fingerprint)versions.set(key,{...live,fp:fingerprint,revision:randomUUID()});if(versions.size>64)versions.delete(versions.keys().next().value);return versions.get(key).revision;}
 function createRead(target,offset=0){const live=context(target),text=JSON.stringify({npcNames:live.layout.map(e=>e.name),characterNames:live.info.characters.map(c=>c.name),count:live.entries.length,limit:live.info.limit,editorLimit:512,canCreate:live.entries.length<Math.min(live.info.limit,512),persistence:'unknown',untrusted:true});if(!Number.isInteger(offset)||offset<0||offset>text.length)throw Error('INVALID_NPC_EDIT');return{revision:revision(live,target),text:text.slice(offset,offset+6000),nextOffset:offset+6000<text.length?offset+6000:-1,untrusted:true};}
 function createPreview(target,args){
  const live=context(target);if(revision(live,target)!==args.revision)throw Error('STALE_NPC_EDIT');if(live.entries.length>=Math.min(live.info.limit,512))throw Error('NPC_CAPACITY');
  const changes=copyJson(args.changes);if(!record(changes)||Object.keys(changes).some(k=>!['name','description','personality','scenario','first_mes'].includes(k))||typeof changes.name!=='string'||!changes.name.trim()||typeof changes.description!=='string'||!changes.description.trim())throw Error('INVALID_NPC_EDIT');
  if(Object.keys(changes).some(k=>typeof changes[k]!=='string'||changes[k].length>(k==='name'?200:12000)))throw Error('INVALID_NPC_EDIT');
  const name=changes.name.trim();if([...live.layout,...live.info.characters].some(c=>c.name.trim().toLowerCase()===name.toLowerCase()))throw Error('NPC_NAME_COLLISION');
  const after={name,description:changes.description.trim(),personality:(changes.personality||'').trim(),scenario:(changes.scenario||'').trim(),...('first_mes'in changes?{first_mes:changes.first_mes.trim()}:{}),imported:false,importedAvatar:null,createdAt:Date.now()};
  const content=copyJson({module:'npc-editor',operation:'create',ticket:'npc-create:'+randomUUID(),target,selector:'npc-new',name,before:null,after,warnings:[
   '仅追加当前聊天NPC记录，不覆盖已有NPC，不创建酒馆角色卡或修改资源库。 / Append a chat NPC only; no replacement, ST card creation or library edit.',
   '名称不得与已有NPC或酒馆角色重名，大小写与首尾空白不区分。导入状态为未导入。 / Name must not collide with NPCs or ST characters, ignoring case and surrounding spaces; not imported.',
   'NPC功能已开启时，新记录可被后续上下文读取；未导入不代表不会进入提示词。 / If NPC features are enabled, later context may read this record; not imported does not mean excluded from prompts.',
   '不额外调用生成模型、开启功能或裁剪；保存未知不重试或整仓回滚。 / No extra generation, enabling or pruning; unknown saves never auto-retry or restore the store.']});
  if(new TextEncoder().encode(JSON.stringify(content)).length>24000)throw Error('NPC_DRAFT_TOO_LARGE');if(plans.size>=64)throw Error('NPC_PLAN_CAPACITY');plans.set(content.ticket,{live,content:copyJson(content),fp:fp(live)});return content;
 }
 function assertFresh(content){const p=plans.get(content?.ticket);if(!p||jsonKey(content)!==jsonKey(p.content))throw Error('STALE_NPC_EDIT');const live=context(content.target);if(live.metadata!==p.live.metadata||live.root!==p.live.root||live.list!==p.live.list||live.entries.length!==p.live.entries.length||live.entries.some((e,i)=>e!==p.live.entries[i])||fp(live)!==p.fp)throw Error('STALE_NPC_EDIT');return p;}
 return{createRead,createPreview,assertFresh,release:content=>plans.delete(content?.ticket),clear(){plans.clear();versions.clear();},async apply(content){const p=assertFresh(content);if(typeof system?.applyApprovedCreation!=='function')throw Error('WRITE_UNAVAILABLE');try{return await system.applyApprovedCreation({metadata:p.live.metadata,after:content.after,saveChatConfirmed,changed,validate:()=>assertFresh(content),isCurrent:(root,list,entry)=>{const live=context(content.target);return live.metadata===p.live.metadata&&live.root===root&&live.list===list&&live.entries.length===p.live.entries.length+1&&p.live.entries.every((e,i)=>live.entries[i]===e)&&live.entries.at(-1)===entry&&jsonKey(entry)===jsonKey(content.after)&&jsonKey(live.layout)===jsonKey([...p.live.layout,{name:content.after.name,importId:null}])&&jsonKey(live.info)===jsonKey(p.live.info);}});}finally{plans.delete(content.ticket);}}};
}
