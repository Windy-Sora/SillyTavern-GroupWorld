/** Append only; existing entry references and their field revisions remain intact. */
export async function applyApprovedNpcCreation({metadata,extensionKey,after,validate,saveChatConfirmed,isCurrent,changed}) {
    if(typeof saveChatConfirmed!=='function')throw Error('WRITE_UNAVAILABLE');
    validate();
    const root=metadata[extensionKey]??(metadata[extensionKey]={}),list=root.npcs??(root.npcs=[]),entry=structuredClone(after);
    list.push(entry);
    try{changed?.();}catch{/* Observers cannot alter outcomes. */}
    let confirmed=false,current=false;
    try{await saveChatConfirmed(metadata);confirmed=true;}catch{/* No retry or whole-store rollback. */}
    try{current=isCurrent(root,list,entry);}catch{/* Unknown verification is not success. */}
    return{status:!confirmed?'outcome_unknown':current?'applied_confirmed':'partial',chatSave:confirmed?'confirmed':'unknown'};
}
/** Exact approved NPC mutation, with shared field revisions supplied by the NPC system. */
export async function applyApprovedNpcEdit({metadata,extensionKey,index,after,validate,saveChatConfirmed,isCurrent,changed,mutate}) {
    if(typeof saveChatConfirmed!=='function')throw Error('WRITE_UNAVAILABLE');
    validate();
    const list=metadata[extensionKey].npcs,entry=list[index];
    if(after===null)list.splice(index,1);
    else{
        const updates={};
        for(const key of ['name','description','personality','scenario','first_mes'])if(Object.hasOwn(after,key)&&after[key]!==entry[key])updates[key]=after[key];
        mutate(entry,updates);
    }
    try{changed?.();}catch{/* Observers cannot alter outcome. */}
    let confirmed=false,current=false;
    try{await saveChatConfirmed(metadata);confirmed=true;}catch{/* Unknown outcome never auto-retries or restores the store. */}
    try{current=isCurrent();}catch{/* Verification unavailable is not success. */}
    return{status:!confirmed?'outcome_unknown':current?'applied_confirmed':'partial',chatSave:confirmed?'confirmed':'unknown'};
}
