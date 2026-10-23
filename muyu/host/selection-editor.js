import { randomUUID } from '../runtime/crypto.js';
import {configPresentation} from '../config/presentation.js';
import {copyJson,jsonKey} from '../core/json-contract.js';
import {applyWorldBookSelection} from '../../systems/world-book-selection.js';
import {visibleWorldBookNames,isInternalWorldBookName} from '../../systems/internal-world-books.js';
const record=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const keys=['enabled','mode','fixedId','matchHash','matchAvatarName','overwriteExisting','importTemplate'];
export function createSelectionEditorPort({getTarget,getSettings,getWorldNames,worldBookScanner,profileLibrarySystem,saveSettings,isBusy=()=>false,changed}) {
 const plans=new Map(),versions=new Map();
 function context(target,kind){
  const actual=getTarget();if(!actual||target?.userKey!==actual.userKey||!['chat','global'].includes(target.kind))throw Error('TARGET_UNAVAILABLE');
  if(isBusy()||profileLibrarySystem?.isAutoLoading?.())throw Error('SELECTION_BUSY');
  const settings=getSettings();if(!record(settings))throw Error('UNSUPPORTED_SELECTION_STORE');
  let before,options,refs=[],fingerprints=[];
  if(kind==='worldbooks'){
   options=copyJson(visibleWorldBookNames(getWorldNames()));
   if(!Array.isArray(options)||options.length>256||new Set(options).size!==options.length||options.some(n=>typeof n!=='string'||!n.trim()||n.length>256))throw Error('UNSUPPORTED_SELECTION_STORE');
   const rawSelection=settings.worldBookSelection??{};
   const selection=copyJson(record(rawSelection)?Object.fromEntries(Object.entries(rawSelection).filter(([name])=>!isInternalWorldBookName(name))):rawSelection);
   if(!record(selection)||Object.values(selection).some(v=>typeof v!=='boolean')||!['st','manual'].includes(settings.worldBookSourceMode))throw Error('UNSUPPORTED_SELECTION_STORE');
   before={sourceMode:settings.worldBookSourceMode,selection};
  }else if(kind==='profile-autoload'){
   before=copyJson(settings.profileLibraryAutoLoad);
   if(!record(before)||typeof before.matchNameOnly!=='boolean'||keys.some(k=>typeof before[k]!==(['mode','fixedId'].includes(k)?'string':'boolean'))||!['best','fixed'].includes(before.mode))throw Error('UNSUPPORTED_SELECTION_STORE');
   const libs=settings.profileLibraries??[];
   if(!Array.isArray(libs)||libs.length>256||libs.some(e=>!record(e)||typeof e.id!=='string'||!e.id||e.id.length>100||typeof e.name!=='string')||new Set(libs.map(e=>e.id)).size!==libs.length)throw Error('UNSUPPORTED_SELECTION_STORE');
   refs=libs.slice();fingerprints=libs.map(e=>{const text=JSON.stringify(e);if(text.length>1048576)throw Error('UNSUPPORTED_SELECTION_STORE');return text;});options=copyJson(libs.map(e=>({id:e.id,name:e.name})));
  }else throw Error('INVALID_SELECTION_EDIT');
  if(settings!==getSettings()||actual.userKey!==getTarget()?.userKey)throw Error('TARGET_UNAVAILABLE');
  return{settings,before,options,refs,fingerprints};
 }
 const fp=live=>jsonKey({before:live.before,options:live.options})+JSON.stringify(live.fingerprints);
 function revision(live,kind){
  const old=versions.get(kind),fingerprint=fp(live);
  if(!old||old.settings!==live.settings||old.fp!==fingerprint||old.refs.some((e,i)=>e!==live.refs[i]))versions.set(kind,{settings:live.settings,fp:fingerprint,refs:live.refs,revision:randomUUID()});
  return versions.get(kind).revision;
 }
 function read(target,kind){
  const live=context(target,kind);
  const presentation=kind==='worldbooks'?{sourceMode:configPresentation('worldBookSourceMode'),selection:{label:{zh:'GroupWorld手动选择世界书',en:'GroupWorld manually selected world books'}}}:Object.fromEntries([...keys,'matchNameOnly'].map(k=>[k,configPresentation('profileLibraryAutoLoad.'+k)]));
  return copyJson({kind,presentation,revision:revision(live,kind),current:live.before,available:live.options,persistence:'unknown',untrusted:true,
   notice:kind==='worldbooks'?'GroupWorld manual list and book names only; no ST activated selection/content.':'Policy/package names only, no profile content or matching count; auto-loading ignores matchNameOnly.'});
 }
 function preview(target,args){
  const live=context(target,args.kind);if(revision(live,args.kind)!==args.revision)throw Error('STALE_SELECTION_EDIT');
  const changes=copyJson(args.changes);if(!record(changes))throw Error('INVALID_SELECTION_EDIT');
  let after=copyJson(live.before);
  if(args.kind==='worldbooks'){
   if(Object.keys(changes).some(k=>!['selectedNames','sourceMode'].includes(k)))throw Error('INVALID_SELECTION_EDIT');
   if('sourceMode'in changes){if(!['st','manual'].includes(changes.sourceMode))throw Error('INVALID_SELECTION_EDIT');after.sourceMode=changes.sourceMode;}
   if('selectedNames'in changes){
    const names=changes.selectedNames;
    if(!Array.isArray(names)||names.length>256||new Set(names).size!==names.length||names.some(n=>typeof n!=='string'||!live.options.includes(n)))throw Error('WORLD_BOOK_NOT_FOUND');
    if(after.sourceMode!=='manual')throw Error('WORLD_SELECTION_REQUIRES_MANUAL_MODE');
    after.selection=Object.fromEntries(names.map(n=>[n,true]));copyJson(after);
   }
  }else{
   if(Object.keys(changes).some(k=>!keys.includes(k))||Object.entries(changes).some(([k,v])=>typeof v!==(['mode','fixedId'].includes(k)?'string':'boolean')))throw Error('INVALID_SELECTION_EDIT');
   after={...after,...changes};
   if(!['best','fixed'].includes(after.mode)||after.fixedId.length>100)throw Error('INVALID_SELECTION_EDIT');
   if(after.mode==='fixed'&&!live.options.some(e=>e.id===after.fixedId)||('fixedId'in changes&&after.fixedId&&!live.options.some(e=>e.id===after.fixedId)))throw Error('PROFILE_LIBRARY_NOT_FOUND');
  }
  if(jsonKey(after)===jsonKey(live.before))throw Error('EMPTY_CHANGES');
  const content=copyJson({module:'selection-editor',ticket:'selection-edit:'+randomUUID(),target:{kind:'global',userKey:target.userKey},kind:args.kind,selector:args.kind,
   name:args.kind==='worldbooks'?'世界书选择 / World book selection':'档案库加载策略 / Profile auto-load policy',before:live.before,after,
   warnings:args.kind==='worldbooks'?['替换完整GroupWorld手动列表，未列出的书取消选择；只在manual生效。不修改ST激活状态或正文。 / Full GroupWorld manual-list replacement; omitted books deselected, effective only in manual mode. ST untouched.',
   '保存并清理缓存，不立即扫描或调用模型；后续Provider可增加资料量。 / Save/cache invalidation only; later Provider use may add context.']:
   ['只保存全局策略，不立即导入、生成或改变库正文；后续加载可能覆盖档案、替换全局模板。 / Global policy only; later loading may overwrite profiles/global templates.',
   '自动加载仍禁用仅姓名匹配；固定模式需已有包。best模式固定ID不生效。 / Name-only matching remains disabled; fixed mode requires existing package, fixed ID inactive in best mode.']});
  if(new TextEncoder().encode(JSON.stringify(content)).length>24000)throw Error('SELECTION_DRAFT_TOO_LARGE');
  if(plans.size>=64)throw Error('SELECTION_PLAN_CAPACITY');
  plans.set(content.ticket,{content:copyJson(content),live,changes});return content;
 }
 function assertFresh(content){
  const p=plans.get(content?.ticket);if(!p||jsonKey(p.content)!==jsonKey(content))throw Error('STALE_SELECTION_EDIT');
  const live=context(content.target,content.kind);
  if(live.settings!==p.live.settings||fp(live)!==fp(p.live)||live.refs.some((e,i)=>e!==p.live.refs[i]))throw Error('STALE_SELECTION_EDIT');
  return p;
 }
 return Object.freeze({read,preview,assertFresh,release:content=>plans.delete(content?.ticket),clear:()=>{plans.clear();versions.clear();},async apply(content){
  const p=assertFresh(content);
  const isCurrent=()=>{const live=context(content.target,content.kind);return live.settings===p.live.settings&&jsonKey(live.before)===jsonKey(content.after)&&jsonKey(live.options)===jsonKey(p.live.options)&&JSON.stringify(live.fingerprints)===JSON.stringify(p.live.fingerprints)&&live.refs.every((e,i)=>e===p.live.refs[i]);};
  try{
   if(content.kind==='worldbooks'){
    if(typeof worldBookScanner?.clearCache!=='function')throw Error('WRITE_UNAVAILABLE');
    return await applyWorldBookSelection({settings:p.live.settings,after:content.after,validate:()=>assertFresh(content),saveSettings,clearCache:()=>worldBookScanner.clearCache(),isCurrent,changed});
   }
   if(typeof profileLibrarySystem?.updateAutoLoadSettings!=='function')throw Error('WRITE_UNAVAILABLE');
   let started=false;
   try{await profileLibrarySystem.updateAutoLoadSettings(p.changes,{beforeApply:owner=>{assertFresh(content);if(owner!==p.live.settings)throw Error('STALE_SELECTION_EDIT');started=true;}});}
   catch(e){if(!started)throw e;return{status:'outcome_unknown',settingsSave:'unknown'};}
   try{changed?.();}catch{}
   let current=false;try{current=isCurrent();}catch{}
   // Business save returns no correlated persistence confirmation.
   return{status:current?'applied_unconfirmed':'partial',settingsSave:'unconfirmed'};
  }finally{plans.delete(content.ticket);}
 }});
}
