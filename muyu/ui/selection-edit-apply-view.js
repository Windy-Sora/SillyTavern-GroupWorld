export function renderSelectionApply({doc,card,artifact,state,controller,act,lang}) {
 const t=(zh,en)=>lang==='en'?en:zh;
 const node=(tag,text)=>{const el=doc.createElement(tag);el.textContent=text;card.append(el);return el;};
 const button=(label,fn)=>{const el=node('button',label);el.type='button';el.className='menu_button';el.disabled=state.busy||state.resetting;el.onclick=()=>act(fn);};
 if(!state.canApplySelection)return;
 const a=state.selectionActions?.find(a=>a.artifactId===artifact.id&&a.revision===artifact.revision);
 if(!a){button(t('查看并保存选择策略','Review and save selection policy'),()=>controller.prepareSelectionApply(artifact.id,artifact.revision));return;}
 if(a.status==='pending'){
  node('strong',t('确认保存上述全局选择策略？','Save exactly these global selection changes?'));
  node('small',t('影响所有聊天；仅保存策略，不立即加载档案或扫描世界书。仅批准此版本一次；保存未知不自动重试。','Affects all chats. Saves policy only, no immediate profile load/world book scan. One approval for this revision; uncertain saves never auto-retry.'));
  button(t('保存这份修改','Save this change'),()=>controller.approveSelectionApply(a.id));
  button(t('取消','Cancel'),()=>controller.cancelSelectionApply(a.id));return;
 }
 if(state.receipts?.some(r=>r.operationId===a.id))return;
 const states={applying:t('正在保存全局设置；无法可靠取消。','Saving global settings; cancellation cannot be guaranteed.'),applied_confirmed:t('这次保存已确认。','This save was confirmed.'),applied_unconfirmed:t('已更新内存，持久化未确认。','Updated memory; persistence unconfirmed.'),partial:t('保存期间状态又变化，请核对回执。','State changed during saving; inspect the receipt.'),outcome_unknown:t('结果未知，请核对设置，不要自动重试。','Outcome unknown; inspect settings, do not retry automatically.'),not_executed:t('未执行：选择或草稿已变化。','Not executed: selection or draft changed.'),cancelled:t('已取消，未执行。','Cancelled; not executed.'),expired:t('已失效，未执行。','Expired; not executed.')};
 node('p',states[a.status]||'').setAttribute('role','status');
}
