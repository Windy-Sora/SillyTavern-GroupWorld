import { renderVariableApply } from './variable-apply-view.js';
export function renderVariableEditor({doc,card,artifact,state,controller,act,lang}) {
    const t=(zh,en)=>lang==='en'?en:zh,c=artifact.content;
    const node=(tag,text,parent=card)=>{const e=doc.createElement(tag);e.textContent=text;parent.append(e);return e;};
    const names={create:t('创建变量','Create variable'),update:t('编辑变量定义','Edit variable definition'),delete:t('删除变量','Delete variable'),set_value:t('修改变量值','Change variable value')};
    node('p',c.name+' · '+names[c.operation]);
    if(c.character)node('p',t('角色目标：','Character target: ')+c.character);
    for(const warning of c.warnings)node('p',warning);
    const details=node('details','');node('summary',t('完整定义与值差异','Complete definition and value changes'),details);
    node('code',JSON.stringify({before:c.before,after:c.after},null,2),node('pre','',details));
    if(state.variableActions?.some(a=>a.artifactId===artifact.id&&a.revision===artifact.revision&&a.status==='pending'))details.open=true;
    renderVariableApply({doc,card,artifact,state,controller,act,lang});
}
