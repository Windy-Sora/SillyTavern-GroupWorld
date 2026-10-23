import { renderProfileEditApply } from './profile-edit-apply-view.js';
export function renderProfileEditor({doc,card,artifact,state,controller,act,lang}) {
    const t=(zh,en)=>lang==='en'?en:zh,c=artifact.content;
    const node=(tag,text,parent=card)=>{const e=doc.createElement(tag);e.textContent=text;parent.append(e);return e;};
    const names={create:t('新建档案','Create profile'),update:t('编辑档案','Edit profile'),delete:t('删除档案','Delete profile')};
    node('p',c.name+' · '+names[c.operation]);
    if(c.character)node('p',t('角色目标：','Character target: ')+c.character);
    for(const warning of c.warnings)node('p',warning);
    const details=node('details','');node('summary',t('完整档案差异','Complete profile changes'),details);
    node('code',JSON.stringify({before:c.before,after:c.after,...(c.operation==='delete'?{archiveBefore:c.archiveBefore,archiveAfter:c.archiveAfter}:{})},null,2),node('pre','',details));
    if(state.profileEditActions?.some(a=>a.artifactId===artifact.id&&a.revision===artifact.revision&&a.status==='pending'))details.open=true;
    renderProfileEditApply({doc,card,artifact,state,controller,act,lang});
}
