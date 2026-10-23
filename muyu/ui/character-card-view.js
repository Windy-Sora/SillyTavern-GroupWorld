export function renderCharacterCard({doc,card,artifact,state,controller,act,lang}){
    const t=(zh,en)=>lang==='en'?en:zh,c=artifact.content;
    const node=(tag,text,parent=card)=>{const el=doc.createElement(tag);el.textContent=text;parent.append(el);return el;};
    node('p',t('酒馆角色卡：','ST character card: ')+c.name);
    const operationLabel={copy:t('复制整张保存卡（保留显示名）','Copy entire saved card (same display name)'),create:t('创建默认头像角色卡','Create character card with default avatar'),rename:t('修改显示名（文件名和旧消息不变）','Change display name (filename and past messages unchanged)'),delete:t('永久删除角色卡（保留聊天文件）','Permanently delete card (keep chat files)'),update:t('修改指定文本字段','Update specified text fields')};
    node('p',operationLabel[c.operation]);
    for(const warning of c.warnings)node('small',warning);
    const details=node('details','');node('summary',t('完整批准差异','Complete approved changes'),details);node('pre',JSON.stringify({before:c.before,after:c.after},null,2),details);
    if(!state.canApplyCharacterCard)return;
    const action=state.characterCardActions?.find(a=>a.artifactId===artifact.id&&a.revision===artifact.revision);
    const button=(zh,en,fn)=>{const b=node('button',t(zh,en));b.type='button';b.className='menu_button';b.disabled=state.busy||state.resetting;b.onclick=()=>act(fn);};
    if(!action){button('查看并执行角色卡操作','Review character-card operation',()=>controller.prepareCharacterCardApply(artifact.id,artifact.revision));return;}
    if(action.status==='pending'){details.open=true;node('strong',c.operation==='create'?t('创建独立资源，不覆盖已有卡，不自动选择角色或切换聊天。','Creates independent resource; no overwriting, character selection or chat switching.'):t('共享资源操作，不改变已有聊天消息。请先保存／放弃目标角色编辑草稿，并切换离开该角色。','Shared resource operation; existing chat messages unchanged. Save/discard drafts and select another character first.'));
        if(c.operation==='delete')node('strong',t('无法撤销。聊天文件保留但可能失去入口；未知引用未清理，请先导出备份。','Cannot undo. Chat files kept but may lose access; unknown references are not cleaned. Export backup first.'));
        const labels={copy:['复制这张角色卡','Copy this character card'],create:['创建这张角色卡','Create this character card'],rename:['应用显示名修改','Apply display name change'],delete:['永久删除这张角色卡','Permanently delete this character card'],update:['应用这份文本修改','Apply these text changes']};
        button(...labels[c.operation],()=>controller.approveCharacterCardApply(action.id));button('取消','Cancel',()=>controller.cancelCharacterCardApply(action.id));}
    else node('p',action.status==='applied_unconfirmed'?t('当时已调用接口并核对字段／新资源；持久化仍未确认，酒馆界面需手动刷新。','Host operation and fields/new resource checked at the time; persistence unconfirmed, refresh ST UI manually.'):action.status==='outcome_unknown'?t('结果未知，不自动重试或回滚，请人工核对。','Outcome unknown; no retry or rollback, verify manually.'):action.status);
}
