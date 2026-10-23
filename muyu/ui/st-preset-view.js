export function renderStPreset({doc,card,artifact,state,controller,act,lang}) {
    const t=(zh,en)=>lang==='en'?en:zh,c=artifact.content;
    const node=(tag,text,parent=card)=>{const el=doc.createElement(tag);el.textContent=text;parent.append(el);return el;};
    const labels={copy:['复制保存预设（不激活）','Copy saved preset (do not activate)'],save_current:['另存当前运行配置（不激活）','Save live settings as new preset (do not activate)'],update:['修改保存预设（不激活）','Edit saved preset (do not activate)'],select:['激活预设并替换当前参数与提示词','Activate preset, replacing live parameters and Prompts']};
    node('p',t('酒馆聊天补全预设：','ST chat-completion preset: ')+c.name);
    node('p',t(...labels[c.operation]));
    for(const warning of c.warnings)node('small',warning);
    const details=node('details','');node('summary',t('查看完整批准差异','Review complete approved changes'),details);node('pre',JSON.stringify({before:c.before,after:c.after},null,2),details);
    if(!state.canApplyStPreset)return;
    const action=state.stPresetActions?.find(a=>a.artifactId===artifact.id&&a.revision===artifact.revision);
    const button=(zh,en,fn)=>{const b=node('button',t(zh,en));b.type='button';b.className='menu_button';b.disabled=state.busy||state.resetting;b.onclick=()=>act(fn);};
    if(!action){button('查看并执行预设操作','Review preset operation',()=>controller.prepareStPresetApply(artifact.id,artifact.revision));return;}
    if(action.status==='pending'){
        details.open=true;
        node('strong',c.operation==='select'?t('当前运行参数与提示词将被替换，未保存修改会丢失。先关闭 Prompt 编辑弹窗，并关闭“将预设绑定到连接”。','Replaces current parameters and Prompts; unsaved changes will be lost. Close Prompt editor and disable connection binding.'):t('只保存资源，不切换正在使用的预设或修改当前运行参数。','Saves resource only; does not select it or modify live settings.'));
        button(...labels[c.operation],()=>controller.approveStPresetApply(action.id));button('取消','Cancel',()=>controller.cancelStPresetApply(action.id));
    } else node('p',action.status==='applied_unconfirmed'?t('当时已执行并核对宿主状态；持久化仍未确认，不代表当前状态或最终注入。','Operation and host state checked at the time; persistence unconfirmed, not current state or final injection.'):action.status==='outcome_unknown'?t('结果未知，不自动重试或回滚，请人工核对。','Outcome unknown; no automatic retry or rollback, verify manually.'):action.status);
}
