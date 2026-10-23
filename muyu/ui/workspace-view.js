export function renderWorkspace({doc,card,artifact,state,controller,act,lang}) {
    const t=(zh,en)=>lang==='en'?en:zh,c=artifact.content;
    const node=(tag,text,parent=card)=>{const el=doc.createElement(tag);el.textContent=text;parent.append(el);return el;};
    const button=(label,fn)=>{const el=node('button',label);el.type='button';el.className='menu_button';el.disabled=state.busy||state.resetting;el.onclick=()=>act(fn);};
    node('p',(c.operation==='create'?t('创建工作区文档：','Create workspace document: '):t('更新工作区文档：','Update workspace document: '))+c.path);
    node('small',t('仅暮羽私有工作区，不应用到酒馆或GroupWorld配置。预览5分钟失效；结果未知不要重试。','Private Muyu workspace only; not applied to ST/GroupWorld configuration. Preview expires after five minutes; never retry unknown outcomes.'));
    const detail=node('details','');node('summary',t('完整修改内容','Full change'),detail);
    node('pre',c.before||t('原文件不存在','No previous file'),detail);node('pre',c.after,detail);
    const action=state.workspaceActions?.find(a=>a.artifactId===artifact.id&&a.revision===artifact.revision);
    if(!state.canApplyWorkspace)return;
    if(!action){button(t('查看并批准写入','Review and approve write'),()=>controller.prepareWorkspaceApply(artifact.id,artifact.revision));return;}
    if(action.status==='pending'){detail.open=true;node('strong',t('只写入上方这份具体内容？','Write exactly the content above?'));button(t('写入这份文档','Write this document'),()=>controller.approveWorkspaceApply(action.id));button(t('取消','Cancel'),()=>controller.cancelWorkspaceApply(action.id));return;}
    if(!state.receipts?.some(r=>r.operationId===action.id))node('p',({applying:t('正在写入…','Writing…'),saved_confirmed:t('当时已同步文件并核验内容。','File synced and content verified at that time.'),outcome_unknown:t('结果未知，不要重试，请核对工作区文件。','Unknown outcome; inspect the workspace file, do not retry.'),not_executed:t('未执行：草稿失效或版本冲突。','Not executed: stale draft or revision conflict.'),cancelled:t('已取消。','Cancelled.'),expired:t('已失效。','Expired.')}[action.status]||''));
}
