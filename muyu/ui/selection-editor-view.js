import { configLabel,configValue } from '../config/presentation.js';
import { renderSelectionApply } from './selection-edit-apply-view.js';
export function renderSelectionEditor({doc,card,artifact,state,controller,act,lang}) {
    const t=(zh,en)=>lang==='en'?en:zh,c=artifact.content;
    const node=(tag,text,parent=card)=>{const e=doc.createElement(tag);e.textContent=text;parent.append(e);return e;};
    node('p',c.kind==='worldbooks'?t('世界书选择','World book selection'):t('档案库加载策略','Profile auto-load policy'));
    if(c.kind==='worldbooks'){
        node('p',configLabel('worldBookSourceMode',lang)+': '+configValue('worldBookSourceMode',c.before.sourceMode,lang)+' → '+configValue('worldBookSourceMode',c.after.sourceMode,lang));
        node('p',t('GroupWorld手动选择：','GroupWorld manual selection: ')+Object.keys(c.after.selection).filter(n=>c.after.selection[n]).join('、'));
    }else for(const k of Object.keys(c.after))if(JSON.stringify(c.before[k])!==JSON.stringify(c.after[k]))node('p',configLabel('profileLibraryAutoLoad.'+k,lang)+': '+configValue('profileLibraryAutoLoad.'+k,c.before[k],lang)+' → '+configValue('profileLibraryAutoLoad.'+k,c.after[k],lang));
    for(const warning of c.warnings)node('p',warning);
    const details=node('details','');node('summary',t('完整选择策略差异','Complete selection policy changes'),details);
    node('code',JSON.stringify({before:c.before,after:c.after},null,2),node('pre','',details));
    if(state.selectionActions?.some(a=>a.artifactId===artifact.id&&a.revision===artifact.revision&&a.status==='pending'))details.open=true;
    renderSelectionApply({doc,card,artifact,state,controller,act,lang});
}
