export function renderNpcLibraryChat({doc,card,artifact,state,controller,act,lang}) {
    const t=(zh,en)=>lang==='en'?en:zh;
    const node=(tag,text,parent=card)=>{const e=doc.createElement(tag);e.textContent=text;parent.append(e);return e;};
    const c=artifact.content;
    node('p',c.operation==='capture'?t('从本聊天保存到全局NPC库','Save current chat NPCs to global NPC library'):t('应用NPC包到本聊天','Apply NPC package to current chat'));
    node('p',c.name+' · '+c.count);
    if(c.skipped.length)node('p',t('保留已有：','Existing preserved: ')+c.skipped.join(', '));
    for(const warning of c.warnings)node('p',warning);
    const details=node('details','');node('summary',t('完整NPC及提示词差异','Complete NPCs and Prompt changes'),details);
    node('code',JSON.stringify(c.operation==='capture'?c.draft.next:{NPCs:c.changes,globalTemplate:c.template},null,2),node('pre','',details));
    if(!state.canSaveNpcLibraryChat)return;
    const button=(label,fn)=>{const b=node('button',label);b.type='button';b.className='menu_button';b.disabled=state.busy||state.resetting||state.readOnly;b.onclick=()=>act(fn);};
    const action=state.npcLibraryChatActions?.find(a=>a.artifactId===artifact.id&&a.revision===artifact.revision);
    if(!action)button(t('审阅并准备执行','Review and prepare'),()=>controller.prepareNpcLibraryChat(artifact.id,artifact.revision));
    else if(action.status==='pending'){
        details.open=true;
        node('strong',c.template?t('将修改本聊天NPC及全局提示词，请确认完整差异。','This changes current chat NPCs AND global Prompt. Review the full changes.'):t('仅执行以上列明的存包或NPC修改。','Only execute the package/profile changes shown above.'));
        button(t('确认此操作','Confirm this operation'),()=>controller.approveNpcLibraryChat(action.id));
        button(t('取消','Cancel'),()=>controller.cancelNpcLibraryChat(action.id));
    }else if(!state.receipts?.some(r=>r.operationId===action.id))node('p',action.status);
}
