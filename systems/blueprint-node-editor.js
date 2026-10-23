/** Text/content edits deliberately bypass tree normalization and progress pruning. */
export function projectBlueprintNodeEdit(before,changes) {
    const record=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
    const kind=v=>v===null?'null':Array.isArray(v)?'array':typeof v;
    if(!record(changes)||Object.keys(changes).some(k=>!['title','content'].includes(k)))throw Error('INVALID_BLUEPRINT_NODE_EDIT');
    const after=structuredClone(before);
    if('title' in changes){
        if(typeof changes.title!=='string'||!changes.title.trim()||changes.title.length>256)throw Error('INVALID_BLUEPRINT_NODE_EDIT');
        after.title=changes.title.trim();
    }
    if('content' in changes){
        if(!record(changes.content)||!record(before.content))throw Error('INVALID_BLUEPRINT_NODE_EDIT');
        for(const [key,value]of Object.entries(changes.content)){
            if(!Object.hasOwn(before.content,key))throw Error('BLUEPRINT_FIELD_NOT_FOUND');
            if(kind(value)!==kind(before.content[key]))throw Error('BLUEPRINT_FIELD_TYPE_MISMATCH');
            after.content[key]=structuredClone(value);
        }
    }
    return after;
}
export async function applyApprovedBlueprintNodeEdit({node,after,metadata,validate,saveChatConfirmed,isCurrent,changed}) {
    if(typeof saveChatConfirmed!=='function')throw Error('WRITE_UNAVAILABLE');
    validate();
    // ID/type/children and progress are never assigned.
    node.title=after.title;
    if(Object.hasOwn(after,'content'))node.content=structuredClone(after.content);
    try{changed?.();}catch{/* Observers do not alter outcome. */}
    let confirmed=false,current=false;
    try{await saveChatConfirmed(metadata);confirmed=true;}catch{/* No rollback or automatic retry. */}
    try{current=isCurrent();}catch{/* Unavailable verification is not success. */}
    return{status:!confirmed?'outcome_unknown':current?'applied_confirmed':'partial',chatSave:confirmed?'confirmed':'unknown'};
}
