import { randomUUID } from '../runtime/crypto.js';
import {createBlueprintStructureEditorPort} from './blueprint-structure-editor.js';
import {createBlueprintInitializationPort} from './blueprint-initialization.js';
import {copyJson,jsonKey} from '../core/json-contract.js';
import {projectBlueprintNodeEdit,applyApprovedBlueprintNodeEdit} from '../../systems/blueprint-node-editor.js';
const record=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function createBlueprintNodeEditorPort({getTarget,getMetadata,extensionKey,saveChatConfirmed,getSettings,getChatLength,saveStructureConfirmed,isBusy=()=>false,changed}) {
    const structure=createBlueprintStructureEditorPort({getTarget,getMetadata,getSettings,getChatLength,extensionKey,saveStructureConfirmed,isBusy,changed});
    const initialization=createBlueprintInitializationPort({getTarget,getMetadata,getSettings,getChatLength,extensionKey,saveStructureConfirmed,isBusy,changed});
    const plans=new Map(),versions=new Map();
    function context(target){
        if(target?.kind!=='chat'||jsonKey(target)!==jsonKey(getTarget()))throw Error('TARGET_UNAVAILABLE');
        if(isBusy())throw Error('BLUEPRINT_BUSY');
        const metadata=getMetadata(),root=metadata?.[extensionKey],state=root?.storyBlueprint,blueprint=state?.blueprint;
        if(!record(metadata)||root!==undefined&&!record(root)||state!==undefined&&!record(state)||blueprint!=null&&!record(blueprint))throw Error('UNSUPPORTED_BLUEPRINT_STORE');
        if(state?.continuePending)throw Error('BLUEPRINT_BUSY');
        const rows=[],ids=new Set(),seen=new Set();
        function visit(nodes,path=[],depth=1){
            if(depth>8||!Array.isArray(nodes))throw Error('UNSUPPORTED_BLUEPRINT_STORE');
            nodes.forEach((node,index)=>{
                if(rows.length>=256||!record(node)||seen.has(node)||typeof node.id!=='string'||!node.id||ids.has(node.id)||typeof node.title!=='string'||typeof node.type!=='string'||
                    node.content!==undefined&&!record(node.content))throw Error('UNSUPPORTED_BLUEPRINT_STORE');
                ids.add(node.id);seen.add(node);const p=[...path,index];
                rows.push({node,path:p,id:node.id,type:node.type});if(node.children!==undefined)visit(node.children,p,depth+1);
            });
        }
        if(blueprint)visit(blueprint.nodes);
        const layout=copyJson(rows.map(r=>({path:r.path,id:r.id,type:r.type}))),stateFields={};
        for(const [key,value]of Object.entries(state||{}))if(key!=='blueprint')stateFields[key]=value;
        const progress=copyJson(stateFields);
        if(metadata!==getMetadata()||jsonKey(target)!==jsonKey(getTarget()))throw Error('TARGET_UNAVAILABLE');
        return{metadata,root,state,blueprint,rows,layout,progress};
    }
    function fields(node){const result={};for(const [key,value]of Object.entries(node))if(key!=='children')result[key]=value;return copyJson(result);}
    function selected(live,selector){
        if(typeof selector!=='string'||!/^blueprint-node:(0|[1-9]\d*)$/.test(selector))throw Error('INVALID_BLUEPRINT_NODE_EDIT');
        const row=live.rows[Number(selector.slice(15))];if(!row)throw Error('BLUEPRINT_NODE_NOT_FOUND');
        return{...row,before:fields(row.node)};
    }
    function version(live,selector){
        const r=selected(live,selector),fp=jsonKey({before:r.before,layout:live.layout,progress:live.progress}),key=jsonKey({target:getTarget(),selector}),old=versions.get(key);
        if(!old||old.metadata!==live.metadata||old.blueprint!==live.blueprint||old.node!==r.node||old.fp!==fp)versions.set(key,{metadata:live.metadata,blueprint:live.blueprint,node:r.node,fp,revision:randomUUID()});
        if(versions.size>512)versions.delete(versions.keys().next().value);
        return versions.get(key).revision;
    }
    function list(target,offset=0){
        if(!Number.isInteger(offset)||offset<0||offset>256)throw Error('INVALID_BLUEPRINT_NODE_EDIT');
        const live=context(target);
        return{items:live.rows.slice(offset,offset+16).map((r,i)=>({selector:'blueprint-node:'+(offset+i),title:r.node.title,type:r.type,path:r.path,revision:version(live,'blueprint-node:'+(offset+i))})),nextOffset:offset+16<live.rows.length?offset+16:-1};
    }
    function read(target,selector,revision,offset=0){
        const live=context(target);if(version(live,selector)!==revision)throw Error('STALE_BLUEPRINT_NODE_EDIT');
        const r=selected(live,selector),text=JSON.stringify({selector,node:r.before,path:r.path,progress:live.progress,persistence:'unknown',untrusted:true,notice:'Node fields exclude unchanged children; progress is stored state, not computed current step.'});
        if(!Number.isInteger(offset)||offset<0||offset>text.length)throw Error('INVALID_BLUEPRINT_NODE_EDIT');
        return{selector,revision,text:text.slice(offset,offset+6000),nextOffset:offset+6000<text.length?offset+6000:-1,untrusted:true};
    }
    function preview(target,args){
        const live=context(target);if(version(live,args.selector)!==args.revision)throw Error('STALE_BLUEPRINT_NODE_EDIT');
        const r=selected(live,args.selector),after=projectBlueprintNodeEdit(r.before,copyJson(args.changes));
        if(jsonKey(after)===jsonKey(r.before))throw Error('EMPTY_CHANGES');
        const candidate={module:'blueprint-node-editor',ticket:'blueprint-node-edit:'+randomUUID(),target,selector:args.selector,name:r.node.title,before:r.before,after,
            warnings:['仅修改当前聊天的节点标题／已有内容字段；不改ID、类型、子节点或资源库。 / Only this node title/existing content changes, not IDs, types, children or libraries.',
                '保留全部进度轨道和完成标记；编辑完成条件不会自动推进或重置。 / Preserve progress and completion signals; editing completion rules does not advance/reset.',
                '保存未知不自动重试或整仓回滚。 / Unknown saves never auto-retry or roll back the store.']};
        if(new TextEncoder().encode(JSON.stringify(candidate)).length>24000)throw Error('BLUEPRINT_NODE_DRAFT_TOO_LARGE');
        const content=copyJson(candidate);if(plans.size>=64)throw Error('BLUEPRINT_NODE_PLAN_CAPACITY');
        plans.set(content.ticket,{content:copyJson(content),live,node:r.node,before:r.before});return content;
    }
    function assertFresh(content){
        if(content?.operation==='initialize')return initialization.assertFresh(content);
        if(content?.operation)return structure.assertFresh(content);
        const plan=plans.get(content?.ticket);if(!plan||jsonKey(plan.content)!==jsonKey(content))throw Error('STALE_BLUEPRINT_NODE_EDIT');
        const live=context(content.target),r=selected(live,content.selector);
        if(live.metadata!==plan.live.metadata||live.root!==plan.live.root||live.state!==plan.live.state||live.blueprint!==plan.live.blueprint||r.node!==plan.node||
            live.rows.some((row,i)=>row.node!==plan.live.rows[i]?.node)||jsonKey(live.layout)!==jsonKey(plan.live.layout)||jsonKey(live.progress)!==jsonKey(plan.live.progress)||jsonKey(r.before)!==jsonKey(plan.before))throw Error('STALE_BLUEPRINT_NODE_EDIT');
        return plan;
    }
    return Object.freeze({list,read,preview,initializeRead:initialization.read,initializePreview:initialization.preview,structureRead:structure.read,structurePreview:structure.preview,assertFresh,release:content=>{plans.delete(content?.ticket);structure.release(content);initialization.release(content);},clear:()=>{plans.clear();versions.clear();structure.clear();initialization.clear();},async apply(content){
        if(content?.operation==='initialize')return initialization.apply(content);
        if(content?.operation)return structure.apply(content);
        const plan=assertFresh(content);
        try{return await applyApprovedBlueprintNodeEdit({node:plan.node,after:content.after,metadata:plan.live.metadata,saveChatConfirmed,changed,validate:()=>assertFresh(content),
            isCurrent:()=>{const live=context(content.target),r=selected(live,content.selector);return live.metadata===plan.live.metadata&&live.root===plan.live.root&&live.state===plan.live.state&&live.blueprint===plan.live.blueprint&&r.node===plan.node&&jsonKey(live.layout)===jsonKey(plan.live.layout)&&jsonKey(live.progress)===jsonKey(plan.live.progress)&&jsonKey(r.before)===jsonKey(content.after);}});
        }finally{plans.delete(content.ticket);}
    }});
}
