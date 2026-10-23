import { createStoryBlueprintSystem } from './story-blueprint-system.js';
const clone=value=>JSON.parse(JSON.stringify(value));

/** Actual blank-creation semantics, projected into isolated metadata only. */
export function projectBlankBlueprintCreation({ before, settings, chatLength }) {
    const metadata = { gd: before === null ? {} : { storyBlueprint: clone(before) } };
    const system = createStoryBlueprintSystem({ settings: clone(settings), EXT_KEY: 'gd', getChatMetadata: () => metadata,
        getChat: () => ({ length: chatLength }), saveChatConditional() {}, log() {} });
    system.createBlankBlueprint();
    return clone(metadata.gd.storyBlueprint);
}

/** Reuse the actual importer against isolated state. No host getters, saves or variables. */
export function projectBlueprintLibraryImport({before,exportData,settings,chatLength}) {
    const metadata={gd:{storyBlueprint:before?clone(before):undefined}};
    const system=createStoryBlueprintSystem({settings:clone(settings),EXT_KEY:'gd',getChatMetadata:()=>metadata,
        getChat:()=>({length:chatLength}),saveChatConditional:()=>{},log(){}});
    const result=system.applyImportText(JSON.stringify(exportData),{includeProgress:settings.includeProgress,persist:false});
    if(!result.ok)throw Error('INVALID_LIBRARY_CHAT');
    return clone(metadata.gd.storyBlueprint);
}

/** One chat save covers blueprint and existing completion value. Unknown writes never replay. */
export async function applyApprovedBlueprintLibraryChat({metadata,extensionKey,after,completion,validate,isCurrent,saveChatConfirmed}) {
    if(typeof saveChatConfirmed!=='function')throw Error('WRITE_UNAVAILABLE');
    validate();
    const root=metadata[extensionKey]||(metadata[extensionKey]={});
    root.storyBlueprint=clone(after);
    if(completion.exists)root.variables.values.global[completion.id]=false;
    const applied=root.storyBlueprint;
    let chatSave='unknown';
    const result=status=>({status,chatSave,settingsSave:'not_started'});
    try{await saveChatConfirmed(metadata);chatSave='confirmed';}catch{return result('outcome_unknown');}
    try {
        if(metadata[extensionKey]!==root||root.storyBlueprint!==applied||!isCurrent())return result('partial');
    }catch{return result('partial');}
    return result('applied_confirmed');
}
