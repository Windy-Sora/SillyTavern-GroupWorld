export function renderBlueprintLibraryChat({doc,card,artifact,state,controller,act,lang}) {
    const t=(zh,en)=>lang==='en'?en:zh;
    const node=(tag,text,parent=card)=>{const e=doc.createElement(tag);e.textContent=text;parent.append(e);return e;};
    const c=artifact.content;
    node('p',c.operation==='capture'?t('从本聊天保存到全局蓝图库','Save current Blueprint to global library'):t('应用蓝图包到本聊天','Apply Blueprint package to current chat'));
    node('p',c.name+' · '+c.count);

    for(const warning of c.warnings)node('p',warning);
    const details=node('details','');node('summary',t('完整蓝图、进度与完成标记差异','Complete Blueprint, progress and completion signal changes'),details);
    node('code',JSON.stringify(c.operation==='capture'?c.draft.next:{before:c.before,after:c.after,completionSignal:c.completion?{id:c.completion.id,before:c.completion.value,after:c.completion.exists?false:null}:null},null,2),node('pre','',details));
    if(!state.canSaveBlueprintLibraryChat)return;
    const button=(label,fn)=>{const b=node('button',label);b.type='button';b.className='menu_button';b.disabled=state.busy||state.resetting||state.readOnly;b.onclick=()=>act(fn);};
    const action=state.blueprintLibraryChatActions?.find(a=>a.artifactId===artifact.id&&a.revision===artifact.revision);
    if(!action)button(t('审阅并准备执行','Review and prepare'),()=>controller.prepareBlueprintLibraryChat(artifact.id,artifact.revision));
    else if(action.status==='pending'){
        details.open=true;
        node('strong',t('仅执行以上列明的存包或蓝图修改；应用会替换本聊天蓝图，请核对进度和完成标记。','Only execute the changes shown. Application replaces this chat Blueprint; review progress and the completion signal.'));
        button(t('确认此操作','Confirm this operation'),()=>controller.approveBlueprintLibraryChat(action.id));
        button(t('取消','Cancel'),()=>controller.cancelBlueprintLibraryChat(action.id));
    }else if(!state.receipts?.some(r=>r.operationId===action.id))node('p',action.status);
}
