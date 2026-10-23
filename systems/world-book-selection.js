/** GD selection only; never load content or change ST activation. */
export async function applyWorldBookSelection({settings,after,validate,saveSettings,clearCache,isCurrent,changed}) {
    if(typeof saveSettings!=='function'||typeof clearCache!=='function')throw Error('WRITE_UNAVAILABLE');
    let cacheError=false;
 validate();settings.worldBookSourceMode=after.sourceMode;settings.worldBookSelection=structuredClone(after.selection);
    try{clearCache();}catch{cacheError=true;}try{changed?.();}catch{}
    let receipt,error=false,current=false;
    try{receipt=await saveSettings();}catch{error=true;}
    try{current=isCurrent();}catch{}
    return{status:error||cacheError?'outcome_unknown':!current?'partial':receipt?.confirmed===true?'applied_confirmed':'applied_unconfirmed',
        settingsSave:error?'unknown':receipt?.confirmed===true?'confirmed':'unconfirmed'};
}
