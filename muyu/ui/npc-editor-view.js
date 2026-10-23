import { renderNpcEditApply } from './npc-edit-apply-view.js';
export function renderNpcEditor({doc,card,artifact,state,controller,act,lang}) {
    const t=(zh,en)=>lang==='en'?en:zh,c=artifact.content;
    const node=(tag,text,parent=card)=>{const e=doc.createElement(tag);e.textContent=text;parent.append(e);return e;};
    const names={create:t('新建NPC','Create NPC'),update:t('编辑NPC','Edit npc'),delete:t('删除NPC','Delete npc')};
    node('p',c.name+' · '+names[c.operation]);
    if(c.selector)node('p',t('NPC目标：','NPC target: ')+c.selector);
    for(const warning of c.warnings)node('p',warning);
    const details=node('details','');node('summary',t('完整NPC差异','Complete npc changes'),details);
    node('code',JSON.stringify({before:c.before,after:c.after},null,2),node('pre','',details));
    if(state.npcEditActions?.some(a=>a.artifactId===artifact.id&&a.revision===artifact.revision&&a.status==='pending'))details.open=true;
    renderNpcEditApply({doc,card,artifact,state,controller,act,lang});
}
