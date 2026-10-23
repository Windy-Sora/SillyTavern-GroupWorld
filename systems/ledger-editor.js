const record=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=v=>typeof v==='string'&&v.length<=12000;
const names=v=>Array.isArray(v)&&v.length<=128&&v.every(s=>typeof s==='string'&&s.trim()&&s.length<=256);
export function projectLedgerEdit(before,operation,input) {
    const changes=structuredClone(input);
    if(!record(changes)||!['update','clear'].includes(operation)||Object.keys(changes).some(k=>!['reason','speakers','scripts','loreAssignments'].includes(k)))throw Error('INVALID_LEDGER_EDIT');
    if(operation==='clear'){if(Object.keys(changes).length)throw Error('INVALID_LEDGER_EDIT');return {};}
    if('reason' in changes&&!text(changes.reason))throw Error('INVALID_LEDGER_EDIT');
    if('speakers' in changes&&!names(changes.speakers))throw Error('INVALID_LEDGER_EDIT');
    if('scripts' in changes&&(!record(changes.scripts)||Object.entries(changes.scripts).some(([k,v])=>!k.trim()||k.length>256||!text(v))))throw Error('INVALID_LEDGER_EDIT');
    if('loreAssignments' in changes&&(!record(changes.loreAssignments)||Object.entries(changes.loreAssignments).some(([k,v])=>!k.trim()||k.length>256||!names(v))))throw Error('INVALID_LEDGER_EDIT');
    const after={...structuredClone(before),...changes};
    // Existing names is a display alias for speakers; show its change in the full diff.
    if('speakers' in changes&&Object.hasOwn(before,'names'))after.names=structuredClone(changes.speakers);
    return after;
}
export async function applyApprovedLedgerEdit({list,index,after,metadata,validate,saveChatConfirmed,isCurrent,changed}) {
    if(typeof saveChatConfirmed!=='function')throw Error('WRITE_UNAVAILABLE');
    validate();
    // Keep the entry slot and all internal metadata, including pruning anchors.
    const entry=list[index],internal=Object.fromEntries(Object.entries(entry).filter(([k])=>k.startsWith('_')));
    for(const key of Object.keys(entry))if(!key.startsWith('_'))delete entry[key];
    Object.assign(entry,internal,structuredClone(after));
    try{changed?.(index);}catch{/* Observers cannot change persistence outcome. */}
    let confirmed=false,current=false;
    try{await saveChatConfirmed(metadata);confirmed=true;}catch{/* Never roll back or auto-retry. */}
    try{current=isCurrent();}catch{/* Verification unavailable is not success. */}
    return {status:!confirmed?'outcome_unknown':current?'applied_confirmed':'partial',chatSave:confirmed?'confirmed':'unknown'};
}
