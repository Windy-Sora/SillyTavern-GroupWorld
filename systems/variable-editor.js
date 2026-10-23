import { createVariableSystem,normalizeDefinition,slugifyId,coerceValue } from './variable-system.js';
const record=v=>v&&typeof v==='object'&&!Array.isArray(v);
const keys=['label','labelZh','scope','type','defaultValue','rule','ruleZh','autoUpdate','injectMode','updateMode','min','max','enumValues','showInDashboard','locked','dashboardOrder'];
export function validateEditableVariable(def) {
    if(!record(def)||slugifyId(def.id)!==def.id||!def.id||['__proto__','constructor','prototype'].includes(def.id)||
        !['string','number','boolean','enum','array','object'].includes(def.type)||!['global','character'].includes(def.scope)||
        typeof def.label!=='string'||!def.label.trim()||def.label.length>100||
        ['labelZh','rule','ruleZh'].some(k=>typeof def[k]!=='string'||def[k].length>(k==='labelZh'?100:1000))||
        ['autoUpdate','showInDashboard','locked'].some(k=>typeof def[k]!=='boolean')||
        !['always','manual'].includes(def.injectMode)||!['replace','append','merge','delta'].includes(def.updateMode)||
        !Number.isFinite(def.dashboardOrder)||
        ['min','max'].some(k=>def[k]!==null&&!Number.isFinite(def[k]))||
        def.min!==null&&def.max!==null&&def.min>def.max||
        !Array.isArray(def.enumValues)||def.enumValues.length>64||def.enumValues.some(v=>typeof v!=='string'||!v||v.length>100)||
        new Set(def.enumValues).size!==def.enumValues.length||def.type==='enum'&&!def.enumValues.length||
        def.updateMode==='delta'&&def.type!=='number'||def.updateMode==='merge'&&def.type!=='object'||
        def.updateMode==='append'&&!['array','string'].includes(def.type))throw Error('INVALID_VARIABLE_DEFINITION');
    validateEditableValue(def,def.defaultValue);
}
export function validateEditableValue(def,value) {
    const valid=def.type==='number'?typeof value==='number'&&Number.isFinite(value)&&
        (def.min===null||value>=def.min)&&(def.max===null||value<=def.max):
        def.type==='boolean'?typeof value==='boolean':
        def.type==='array'?Array.isArray(value):def.type==='object'?record(value):
        typeof value==='string'&&(def.type!=='enum'||def.enumValues.includes(value));
    if(!valid)throw Error('VARIABLE_VALUE_INCOMPATIBLE');
}
/** Real variable operations on one isolated variable, never legacy live saves. */
export function projectVariableEdit({id,operation,changes,before,characters,group,targetAvatar}) {
    if(!record(changes))throw Error('INVALID_VARIABLE_EDIT');
    const definitionKeys=keys.concat('resetValues');
    const allowed=operation==='set_value'?['value','updateMode']:operation==='delete'?[]:definitionKeys;
    if(Object.keys(changes).some(k=>!allowed.includes(k))||changes.resetValues!==undefined&&typeof changes.resetValues!=='boolean')throw Error('INVALID_VARIABLE_EDIT');
    const vars={defs:before.definition?[structuredClone(before.definition)]:[],values:{global:{},character:{}},log:[]},metadata={gd:{variables:vars}};
    if(before.global.present)vars.values.global[id]=structuredClone(before.global.value);
    if(before.characters!==null)vars.values.character[id]=structuredClone(before.characters);
    const system=createVariableSystem({getChatMetadata:()=>metadata,EXT_KEY:'gd',getCharacters:()=>characters,getCurrentGroup:()=>group,getChat:()=>[],saveChatConditional(){},log(){}});
    if(operation==='delete')system.deleteDefinition(id);
    else if(operation==='set_value'){
        if(!Object.hasOwn(changes,'value'))throw Error('INVALID_VARIABLE_EDIT');
        const def=normalizeDefinition(before.definition),mode=changes.updateMode||'replace';
        if(!['replace','append','merge','delta'].includes(mode))throw Error('INVALID_VARIABLE_EDIT');
        validateEditableVariable({...def,updateMode:mode});validateEditableValue(mode==='delta'?{...def,min:null,max:null}:def,changes.value);
        const old=system.getValue(id,targetAvatar),result=coerceValue({...def,updateMode:mode},changes.value,old);
        if(!result.ok)throw Error('VARIABLE_VALUE_INCOMPATIBLE');
        validateEditableValue(def,result.value);
        const r=system.setValue(id,changes.value,{target:targetAvatar,updateMode:mode,source:'manual',reason:'muyu-user-approved'});
        if(!r.ok)throw Error('VARIABLE_VALUE_INCOMPATIBLE');
    } else {
        if(operation==='create'&&(!Object.hasOwn(changes,'type')||!Object.hasOwn(changes,'scope')||!Object.hasOwn(changes,'defaultValue')||!Object.hasOwn(changes,'label')))throw Error('INCOMPLETE_VARIABLE_DRAFT');
        if(operation==='update'&&!Object.keys(changes).length)throw Error('EMPTY_CHANGES');
        const input={...(before.definition?normalizeDefinition(before.definition):normalizeDefinition({id})),...Object.fromEntries(keys.filter(k=>Object.hasOwn(changes,k)).map(k=>[k,changes[k]])),id};
        validateEditableVariable(input);
        system.upsertDefinition(input);
        if(changes.resetValues){
            delete vars.values.global[id];delete vars.values.character[id];
            if(input.scope==='global')vars.values.global[id]=structuredClone(input.defaultValue);
        }
        if(Object.hasOwn(vars.values.global,id))validateEditableValue(input,vars.values.global[id]);
        for(const value of Object.values(vars.values.character[id]||{}))validateEditableValue(input,value);
    }
    return {definition:vars.defs[0]||null,global:{present:Object.hasOwn(vars.values.global,id),value:Object.hasOwn(vars.values.global,id)?vars.values.global[id]:null},
        characters:Object.hasOwn(vars.values.character,id)?vars.values.character[id]:null,newLog:vars.log};
}

/** Mutate only the selected definition/value buckets. Persistence failure is unknown, never retry. */
export async function applyApprovedVariableEdit({metadata,extensionKey,id,after,operation,validate,isCurrent,saveChatConfirmed,changed=()=>{}}) {
    if(typeof saveChatConfirmed!=='function')throw Error('WRITE_UNAVAILABLE');
    validate();
    const root=metadata[extensionKey]||(metadata[extensionKey]={});
    const vars=root.variables||(root.variables={defs:[],values:{global:{},character:{}},log:[]});
    const index=vars.defs.findIndex(d=>d.id===id);
    if(operation==='delete'){
        vars.defs=vars.defs.filter(d=>d.id!==id);vars.log=(vars.log||[]).filter(row=>row?.id!==id);
    }else if(operation!=='set_value'){
        if(index<0)vars.defs.push(structuredClone(after.definition));else vars.defs[index]=structuredClone(after.definition);
    }
    if(after.global.present)vars.values.global[id]=structuredClone(after.global.value);else delete vars.values.global[id];
    if(after.characters!==null)vars.values.character[id]=structuredClone(after.characters);else delete vars.values.character[id];
    if(after.newLog.length){vars.log=vars.log||[];vars.log.push(...structuredClone(after.newLog));if(vars.log.length>100)vars.log.splice(0,vars.log.length-100);}
    try{changed(id);}catch{}
    try{await saveChatConfirmed(metadata);}catch{return{status:'outcome_unknown',chatSave:'unknown'};}
    try{if(metadata[extensionKey]!==root||root.variables!==vars||!isCurrent())return{status:'partial',chatSave:'confirmed'};}catch{return{status:'partial',chatSave:'confirmed'};}
    return{status:'applied_confirmed',chatSave:'confirmed'};
}
