import { renderBlueprintNodeEditApply } from './blueprint-node-edit-apply-view.js';
export function renderBlueprintNodeEditor({doc,card,artifact,state,controller,act,lang}) {
    const t=(zh,en)=>lang==='en'?en:zh,c=artifact.content;
    const node=(tag,text,parent=card)=>{const e=doc.createElement(tag);e.textContent=text;parent.append(e);return e;};
    const operations={initialize:t('新建空白蓝图','Create blank Blueprint'),create:t('新增节点','Create node'),delete:t('删除节点及子树','Delete node and subtree'),move:t('移动／排序节点','Move/reorder node')};
    node('p',c.name+' · '+(operations[c.operation]||t('编辑节点','Edit node')));
    if(c.operation){
        node('p',t('影响节点数：','Affected nodes: ')+c.affected.length);
        const scopes=new Set([...Object.keys(c.before?.progressTracks||{}),...Object.keys(c.after.progressTracks)]);
        for(const scope of scopes){
            const track=c.after.progressTracks[scope];
            const label=scope==='leaf'?t('按叶子节点','Leaf nodes'):scope==='all'?t('全部节点','All nodes'):t('指定层级 ','Level ')+scope.slice(6);
            const count=c.before?.progressTracks?.[scope]?.doneSignals?.length??(scope===c.after.activeProgressKey?c.before?.doneSignals?.length||0:0);
            node('p',label+' · '+t('存储的完成标记：','Stored completion signals: ')+count+' → '+(track?.doneSignals.length||0));
        }
    }
    if(c.selector)node('p',c.operation==='initialize'?t('目标：当前聊天的新蓝图','Target: new Blueprint in this chat'):t('蓝图节点目标：','Blueprint node target: ')+c.selector);
    for(const warning of c.warnings)node('p',warning);
    const details=node('details','');node('summary',c.operation==='initialize'?t('完整新建蓝图差异','Complete Blueprint creation changes'):t('完整蓝图节点差异','Complete node field changes'),details);
    node('code',JSON.stringify({before:c.before,after:c.after,...(c.operation?{completion:c.completion}:{})},null,2),node('pre','',details));
    if(state.blueprintNodeEditActions?.some(a=>a.artifactId===artifact.id&&a.revision===artifact.revision&&a.status==='pending'))details.open=true;
    renderBlueprintNodeEditApply({doc,card,artifact,state,controller,act,lang});
}
