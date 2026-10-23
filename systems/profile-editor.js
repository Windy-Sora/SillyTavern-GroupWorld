/** Exact manual creation; never overwrite profiles, archives or shared schema metadata. */
export async function applyApprovedProfileCreation({metadata,extensionKey,avatar,after,validate,saveChatConfirmed,isCurrent,changed}) {
    if(typeof saveChatConfirmed!=='function')throw Error('WRITE_UNAVAILABLE');
    validate();
    const root=metadata[extensionKey]??(metadata[extensionKey]={});
    const store=root.characterProfiles??(root.characterProfiles={});
    const entry=structuredClone(after);store[avatar]=entry;
    try{changed?.();}catch{/* Observers do not change outcomes. */}
    let confirmed=false,current=false;
    try{await saveChatConfirmed(metadata);confirmed=true;}catch{/* No retry or whole-store rollback. */}
    try{current=isCurrent(root,store,entry);}catch{/* Unavailable verification is not success. */}
    return{status:!confirmed?'outcome_unknown':current?'applied_confirmed':'partial',chatSave:confirmed?'confirmed':'unknown'};
}
/** Exact chat-profile update or GUI-compatible archive. Unknown saves never restore the entire store. */
export async function applyApprovedProfileEdit({metadata,extensionKey,avatar,after,validate,saveChatConfirmed,isCurrent,changed}) {
    if(typeof saveChatConfirmed!=='function')throw Error('WRITE_UNAVAILABLE');
    validate();
    const root=metadata[extensionKey];
    if(after===null){
        if(!root.archivedProfiles)root.archivedProfiles={};
        root.archivedProfiles[avatar]=root.characterProfiles[avatar];
        delete root.characterProfiles[avatar];
    }else root.characterProfiles[avatar]=structuredClone(after);
    try{changed?.();}catch{/* Observer errors are not write outcomes. */}
    let confirmed=false,current=false;
    try{await saveChatConfirmed(metadata);confirmed=true;}catch{/* Preserve memory state and report unknown. */}
    try{current=isCurrent();}catch{/* Unavailable verification is not success. */}
    return{status:!confirmed?'outcome_unknown':current?'applied_confirmed':'partial',chatSave:confirmed?'confirmed':'unknown'};
}
