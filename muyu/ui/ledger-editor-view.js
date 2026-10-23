import { renderLedgerEditApply } from './ledger-edit-apply-view.js';
export function renderLedgerEditor({doc,card,artifact,state,controller,act,lang}) {
    const t=(zh,en)=>lang==='en'?en:zh,c=artifact.content;
    const node=(tag,text,parent=card)=>{const e=doc.createElement(tag);e.textContent=text;parent.append(e);return e;};
    node('p',c.name+' · '+(c.operation==='clear'?t('清空此条','Clear entry'):t('编辑此条','Edit entry')));
    if(c.selector)node('p',t('导演账本目标：','Ledger entry target: ')+c.selector);
    for(const warning of c.warnings)node('p',warning);
    const details=node('details','');node('summary',t('完整导演账本差异','Complete ledger entry changes'),details);
    node('code',JSON.stringify({before:c.before,after:c.after},null,2),node('pre','',details));
    if(state.ledgerEditActions?.some(a=>a.artifactId===artifact.id&&a.revision===artifact.revision&&a.status==='pending'))details.open=true;
    renderLedgerEditApply({doc,card,artifact,state,controller,act,lang});
}
