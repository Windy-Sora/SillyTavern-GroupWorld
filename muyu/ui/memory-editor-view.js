import { renderMemoryEditApply } from './memory-edit-apply-view.js';
export function renderMemoryEditor({doc,card,artifact,state,controller,act,lang}) {
    const t=(zh,en)=>lang==='en'?en:zh,c=artifact.content;
    const node=(tag,text,parent=card)=>{const e=doc.createElement(tag);e.textContent=text;parent.append(e);return e;};
    const names={create:t('新增记忆','New memory'),update:t('编辑记忆','Edit memory'),delete:t('删除记忆','Delete memory')};
    node('p',c.name+' · '+names[c.operation]);
    if(c.character)node('p',t('角色目标：','Character target: ')+c.character+' · '+t('条目序号：','Entry index: ')+c.index);
    for(const warning of c.warnings)node('p',warning);
    const details=node('details','');node('summary',t('完整记忆差异','Complete memory changes'),details);
    node('code',JSON.stringify({before:c.before,after:c.after},null,2),node('pre','',details));
    if(state.memoryEditActions?.some(a=>a.artifactId===artifact.id&&a.revision===artifact.revision&&a.status==='pending'))details.open=true;
    renderMemoryEditApply({doc,card,artifact,state,controller,act,lang});
}
