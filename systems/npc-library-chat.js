/** Controlled NPC import: await chat save before optional global Prompt.
 * Unknown writes are neither rolled back over concurrent edits nor retried. */
export async function applyApprovedNpcLibraryChat({settings,extensionKey,saveSettings,metadata,changes,template,validate,isCurrent,saveChatConfirmed}) {
    if(typeof saveChatConfirmed!=='function')throw Error('WRITE_UNAVAILABLE');
    validate();
    const root=metadata[extensionKey]||(metadata[extensionKey]={}),npcs=root.npcs||(root.npcs=[]);
    const applied=[];
    for(const change of changes){
        const next={...change.after,createdAt:change.before?.createdAt??Date.now()};
        if(change.index<0)npcs.push(next);else npcs[change.index]=next;
        applied.push(JSON.parse(JSON.stringify(next)));
    }
    let chatSave='unknown',settingsSave='not_started';
    const result=status=>({status,chatSave,settingsSave,count:changes.length});
    try{await saveChatConfirmed(metadata);chatSave='confirmed';}catch{return result('outcome_unknown');}
    const current=checkPrompt=>{try{return metadata[extensionKey]===root&&root.npcs===npcs&&isCurrent(applied,checkPrompt);}catch{return false;}};
    if(!current(true))return result('partial');
    if(!template)return result('applied_confirmed');
    settings.npcPrompt=template.npcPrompt;
    try{await saveSettings();settingsSave='unconfirmed';}catch{settingsSave='unknown';return result('partial');}
    return result(current(false)&&settings.npcPrompt===template.npcPrompt?'applied_unconfirmed':'partial');
}
