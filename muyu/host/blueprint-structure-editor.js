import { randomUUID } from '../runtime/crypto.js';
import {copyJson,jsonKey} from '../core/json-contract.js';
import {inspectBlueprintCompletion} from './blueprint-completion.js';
import {inspectBlueprintStructure,projectBlueprintStructureEdit,applyApprovedBlueprintStructure} from '../../systems/blueprint-structure-editor.js';
const record=v=>v&&typeof v==='object'&&!Array.isArray(v);
export function createBlueprintStructureEditorPort({getTarget,getMetadata,getSettings,getChatLength,extensionKey,saveStructureConfirmed,isBusy=()=>false,changed}) {
 const plans=new Map(),versions=new Map();
 function context(target){
  if(target?.kind!=='chat'||jsonKey(target)!==jsonKey(getTarget()))throw Error('TARGET_UNAVAILABLE');
  if(isBusy())throw Error('BLUEPRINT_BUSY');
  const metadata=getMetadata(),root=metadata?.[extensionKey],state=root?.storyBlueprint,settings=getSettings?.(),length=getChatLength?.();
  if(!record(metadata)||!record(root)||!record(state)||!record(settings)||!Number.isSafeInteger(length)||length<0)throw Error('UNSUPPORTED_BLUEPRINT_STORE');
  if(state.continuePending)throw Error('BLUEPRINT_BUSY');
  const rows=inspectBlueprintStructure(state.blueprint);
  const config=copyJson(Object.fromEntries(['storyBlueprintProgressionMode','storyBlueprintProgressionLevel','storyBlueprintCompletionVariable','storyBlueprintCompletionVariableGuard'].filter(k=>settings[k]!==undefined).map(k=>[k,settings[k]])));
  if(config.storyBlueprintProgressionMode!==undefined&&!['leaf','all','level'].includes(config.storyBlueprintProgressionMode)||config.storyBlueprintProgressionLevel!==undefined&&(!Number.isSafeInteger(config.storyBlueprintProgressionLevel)||config.storyBlueprintProgressionLevel<0))throw Error('UNSUPPORTED_BLUEPRINT_STORE');
  const {vars,completion}=inspectBlueprintCompletion(settings,root);
  const snapshot=copyJson({state,config,length,completion});
  if(metadata!==getMetadata()||jsonKey(target)!==jsonKey(getTarget()))throw Error('TARGET_UNAVAILABLE');
  return {metadata,root,state,blueprint:state.blueprint,arrays:[state.blueprint.nodes,...rows.filter(r=>Array.isArray(r.node.children)).map(r=>r.node.children)],settings,vars,globalValues:vars?.values.global,rows,snapshot};
 }
 const sameRefs=(a,b)=>a.metadata===b.metadata&&a.root===b.root&&a.state===b.state&&a.blueprint===b.blueprint&&a.arrays.length===b.arrays.length&&a.arrays.every((r,i)=>r===b.arrays[i])&&a.settings===b.settings&&a.vars===b.vars&&a.globalValues===b.globalValues&&a.rows.length===b.rows.length&&a.rows.every((r,i)=>r.node===b.rows[i].node);
 function revision(live,target){
  const key=jsonKey(target),fp=jsonKey(live.snapshot),old=versions.get(key);
  if(!old||!sameRefs(live,old.live)||old.fp!==fp)versions.set(key,{live,fp,revision:randomUUID()});
  if(versions.size>64)versions.delete(versions.keys().next().value);
  return versions.get(key).revision;
 }
 function read(target,offset=0){
  if(!Number.isInteger(offset)||offset<0)throw Error('INVALID_BLUEPRINT_STRUCTURE');
  const live=context(target),text=JSON.stringify({state:live.snapshot.state,progressPolicy:live.snapshot.config,completion:live.snapshot.completion,persistence:'unknown',untrusted:true,notice:'Stored progress; structural edits prune each scope to runtime continuous prefix and clear an existing compatible completion signal. No generation or feature enabling.'});
  if(offset>text.length)throw Error('INVALID_BLUEPRINT_STRUCTURE');
  return{revision:revision(live,target),text:text.slice(offset,offset+6000),nextOffset:offset+6000<text.length?offset+6000:-1,untrusted:true};
 }
 function preview(target,args){
  const live=context(target);if(revision(live,target)!==args.revision)throw Error('STALE_BLUEPRINT_NODE_EDIT');
  const changes=copyJson(args.changes),{after,affected}=projectBlueprintStructureEdit({before:live.snapshot.state,operation:args.operation,changes,chatLength:live.snapshot.length,mode:live.snapshot.config.storyBlueprintProgressionMode,level:live.snapshot.config.storyBlueprintProgressionLevel,at:Date.now()});
  if(jsonKey(after.blueprint)===jsonKey(live.snapshot.state.blueprint))throw Error('EMPTY_CHANGES');
  const completion=live.snapshot.completion;
  const content=copyJson({module:'blueprint-node-editor',operation:args.operation,ticket:'blueprint-structure:'+randomUUID(),target,selector:'blueprint-tree',name:live.state.blueprint.title||'Story Blueprint',
   before:live.snapshot.state,after,affected,completion:{before:completion,after:completion.exists?{...completion,stored:true,value:false}:completion},
   warnings:['仅修改当前聊天蓝图结构，不修改资源库、功能开关或调用模型。 / Chat Blueprint structure only, no library/settings edits or model calls.',
   '删除包含全部子节点；移动保留子树。各模式／层级进度按原业务连续前缀整理，可能丢弃后续标记；完整差异显示实际结果。 / Delete removes subtree; move retains it. Each progress scope is reconciled to its continuous prefix, possibly dropping later signals; inspect full diff.',
   completion.exists?'已有兼容完成标记重置为false，避免旧信号推进新节点；不修改定义。 / Existing compatible completion value resets to false; definition unchanged.':'没有完成变量，不创建变量。 / No completion variable is created.',
   '保存未知不自动重试或整仓回滚。 / Unknown saves never auto-retry or restore the store.']});
  if(new TextEncoder().encode(JSON.stringify(content)).length>24000)throw Error('BLUEPRINT_NODE_DRAFT_TOO_LARGE');
  if(plans.size>=64)throw Error('BLUEPRINT_NODE_PLAN_CAPACITY');plans.set(content.ticket,{live,content:copyJson(content)});return content;
 }
 function assertFresh(content){
  const p=plans.get(content?.ticket);if(!p||jsonKey(content)!==jsonKey(p.content))throw Error('STALE_BLUEPRINT_NODE_EDIT');
  const live=context(content.target);if(!sameRefs(live,p.live)||jsonKey(live.snapshot)!==jsonKey(p.live.snapshot))throw Error('STALE_BLUEPRINT_NODE_EDIT');return p;
 }
 return Object.freeze({read,preview,assertFresh,release:content=>plans.delete(content?.ticket),clear(){plans.clear();versions.clear();},async apply(content){
  const p=assertFresh(content);
  try{return await applyApprovedBlueprintStructure({state:p.live.state,after:content.after,metadata:p.live.metadata,completion:content.completion.before,vars:p.live.vars,saveChatConfirmed:saveStructureConfirmed,changed,validate:()=>assertFresh(content),isCurrent:()=>{
   const live=context(content.target);
   return live.metadata===p.live.metadata&&live.root===p.live.root&&live.state===p.live.state&&live.settings===p.live.settings&&live.vars===p.live.vars&&live.globalValues===p.live.globalValues&&jsonKey(live.snapshot.state)===jsonKey(content.after)&&jsonKey(live.snapshot.completion)===jsonKey(content.completion.after)&&jsonKey(live.snapshot.config)===jsonKey(p.live.snapshot.config)&&live.snapshot.length===p.live.snapshot.length;
  }});}finally{plans.delete(content.ticket);}
 }});
}
