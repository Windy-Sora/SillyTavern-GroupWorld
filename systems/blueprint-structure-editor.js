import {reconcileBlueprintStructureProgress} from './story-blueprint-system.js';
const record=v=>v&&typeof v==='object'&&!Array.isArray(v);
/** Strict tree edits: no normalization, implicit ID rewriting or host getters. */
export function inspectBlueprintStructure(blueprint){
 if(!record(blueprint)||!Array.isArray(blueprint.nodes))throw Error('UNSUPPORTED_BLUEPRINT_STORE');
 const rows=[],ids=new Set(),seen=new Set();
 function visit(nodes,parentId='',depth=1){
  if(depth>8||!Array.isArray(nodes))throw Error('UNSUPPORTED_BLUEPRINT_STORE');
  for(const [index,node]of nodes.entries()){
   if(rows.length>=256||!record(node)||seen.has(node)||typeof node.id!=='string'||!node.id.trim()||node.id!==node.id.trim()||node.id.length>128||ids.has(node.id)||
    typeof node.type!=='string'||!node.type.trim()||node.type.length>80||typeof node.title!=='string'||!node.title.trim()||node.title.length>256||
    node.content!==undefined&&!record(node.content))throw Error('UNSUPPORTED_BLUEPRINT_STORE');
   seen.add(node);ids.add(node.id);rows.push({node,parentId,index,depth});
   if(node.children!==undefined)visit(node.children,node.id,depth+1);
  }
 }
 visit(blueprint.nodes);return rows;
}
export function projectBlueprintStructureEdit({before,operation,changes,chatLength,mode,level,at}){
 const source=inspectBlueprintStructure(before.blueprint);
 if(!record(changes)||!['create','delete','move'].includes(operation))throw Error('INVALID_BLUEPRINT_STRUCTURE');
 const keys={create:['parentId','index','node'],delete:['nodeId'],move:['nodeId','parentId','index']}[operation];
 if(Object.keys(changes).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(changes,k)))throw Error('INVALID_BLUEPRINT_STRUCTURE');
 const blueprint=structuredClone(before.blueprint),rows=inspectBlueprintStructure(blueprint);
 const byId=id=>rows.find(r=>r.node.id===id);
 const container=parentId=>{if(parentId==='')return blueprint.nodes;const p=byId(parentId);if(!p)throw Error('BLUEPRINT_NODE_NOT_FOUND');return p.node.children||(p.node.children=[]);};
 let affected=[];
 if(operation==='create'){
  if(typeof changes.parentId!=='string'||!record(changes.node)||Object.keys(changes.node).some(k=>!['id','type','title','content'].includes(k))||!record(changes.node.content))throw Error('INVALID_BLUEPRINT_STRUCTURE');
  const node={...structuredClone(changes.node),children:[]};
  if(source.some(r=>r.node.id===node.id))throw Error('BLUEPRINT_DUPLICATE_ID');
  const dest=container(changes.parentId);
  if(!Number.isInteger(changes.index)||changes.index<0||changes.index>dest.length)throw Error('INVALID_BLUEPRINT_STRUCTURE');
  dest.splice(changes.index,0,node);affected=[node.id];
 }else{
  if(typeof changes.nodeId!=='string')throw Error('INVALID_BLUEPRINT_STRUCTURE');
  const row=byId(changes.nodeId);if(!row)throw Error('BLUEPRINT_NODE_NOT_FOUND');
  const descendants=inspectBlueprintStructure({nodes:[row.node]}).map(r=>r.node.id);affected=descendants;
  if(operation==='move'&&(typeof changes.parentId!=='string'||descendants.includes(changes.parentId)))throw Error('BLUEPRINT_CYCLE');
  const original=container(row.parentId);original.splice(row.index,1);
  if(operation==='move'){
   const dest=container(changes.parentId);
   if(!Number.isInteger(changes.index)||changes.index<0||changes.index>dest.length)throw Error('INVALID_BLUEPRINT_STRUCTURE');
   dest.splice(changes.index,0,row.node);
  }
 }
 inspectBlueprintStructure(blueprint);
 const after=reconcileBlueprintStructureProgress(before,blueprint,{chatLength,mode,level,at});
 return{after,affected};
}
/** Single chat save also covers the pre-approved existing completion signal. */
export async function applyApprovedBlueprintStructure({state,after,metadata,completion,vars,validate,isCurrent,saveChatConfirmed,changed}){
 if(typeof saveChatConfirmed!=='function')throw Error('WRITE_UNAVAILABLE');validate();
 // Only the tree and explicit progress fields are assigned; no whole-chat restore.
 const keys=['blueprint','progressTracks','activeProgressKey','doneSignals','completeNoticeKey','legacyDoneSignals'];
 const cloned=structuredClone(after);for(const key of keys)if(Object.hasOwn(cloned,key))state[key]=cloned[key];
 if(completion.exists)vars.values.global[completion.id]=false;
 try{changed?.();}catch{}
 let confirmed=false,current=false;try{await saveChatConfirmed(metadata);confirmed=true;}catch{}
 try{current=isCurrent();}catch{}
 return{status:!confirmed?'outcome_unknown':current?'applied_confirmed':'partial',chatSave:confirmed?'confirmed':'unknown'};
}
