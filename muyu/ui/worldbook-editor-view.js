export function renderWorldBookEditor({ doc, card, artifact, state, controller, act, lang }) {
    const t = (zh, en) => lang === 'en' ? en : zh, c = artifact.content;
    const node = (tag, text, parent = card) => { const el = doc.createElement(tag); el.textContent = text; parent.append(el); return el; };
    const deleting = c.operation==='delete_book', binding = ['set_global_binding','set_chat_binding'].includes(c.operation);
    const bookOperation = ['create_book','copy_book','delete_book'].includes(c.operation);
    node('p', binding ? t('酒馆世界书绑定','ST world-book bindings') : (bookOperation ? t('世界书：','World book: ') : t('世界书条目：', 'World-book entry: ')) + c.name + (c.selector ? ' · ' + c.selector : ''));
    if(c.sourceName) node('p', t('复制来源：','Copy source: ') + c.sourceName);
    node('p', ({update:t('修改条目','Update entry'),create_entry:t('新增条目','Create entry'),delete_entry:t('删除完整条目','Delete complete entry'),create_book:t('创建空世界书（未绑定）','Create empty book (unbound)'),copy_book:t('复制世界书（未绑定）','Copy book (unbound)'),delete_book:t('永久删除整本世界书','Permanently delete world book'),set_global_binding:t('替换酒馆全局激活列表','Replace ST global activation list'),set_chat_binding:t('替换当前聊天绑定','Replace current chat binding')})[c.operation] || c.operation);
    for (const warning of c.warnings) node('p', warning);
    node('small', t('请先保存或放弃酒馆世界书编辑器中的草稿。此操作不会自动刷新该编辑器；保存后请手动核对。', 'Save or discard drafts in the ST world-book editor first. This action will not refresh that editor; verify manually afterwards.'));
    const details = node('details', ''); node('summary', binding ? t('完整绑定差异','Complete binding changes') : bookOperation ? t('完整世界书内容','Complete world-book contents') : t('完整条目差异', 'Complete entry changes'), details);
    node('pre', JSON.stringify({ before: c.before, after: c.after }, null, 2), details);
    if (!state.canApplyWorldBookEdit) return;
    const action = state.worldBookEditActions?.find(a => a.artifactId === artifact.id && a.revision === artifact.revision);
    const button = (zh, en, fn) => { const b = node('button', t(zh, en)); b.type = 'button'; b.className = 'menu_button'; b.disabled = state.busy || state.resetting; b.onclick = () => act(fn); };
    if (!action) { button(deleting ? '查看并删除整本世界书' : binding ? '查看并修改世界书绑定' : bookOperation ? '查看并创建世界书' : '查看并应用世界书条目', deleting ? 'Review and delete world book' : binding ? 'Review and change world-book binding' : bookOperation ? 'Review and create world book' : 'Review and apply world-book entry', () => controller.prepareWorldBookEditApply(artifact.id, artifact.revision)); return; }
    if (action.status === 'pending') { details.open = true; node('strong', deleting ? t('永久删除，无法撤销；未加载聊天的引用无法核实。','Permanent deletion; cannot undo. Unloaded chat references cannot be verified.') : binding ? t('确认替换所列绑定？不会立即生成或保证注入。','Replace the listed binding? No immediate generation or guaranteed injection.') : bookOperation ? t('确认创建独立世界书？不会自动绑定或激活。','Create a separate world book? It will not be bound or activated automatically.') : t('确认修改共享世界书？所有使用此书的聊天均可能受影响。', 'Change this shared book? All chats using it may be affected.'));
        button(deleting ? '永久删除这本世界书' : binding ? '应用这份绑定修改' : bookOperation ? '创建这份世界书' : c.operation === 'delete_entry' ? '删除这份完整条目' : '应用这份条目修改', deleting ? 'Permanently delete this world book' : binding ? 'Apply this binding change' : bookOperation ? 'Create this world book' : c.operation === 'delete_entry' ? 'Delete this complete entry' : 'Apply these entry changes', () => controller.approveWorldBookEditApply(action.id)); button('取消', 'Cancel', () => controller.cancelWorldBookEditApply(action.id));
    } else node('p', ({ applying: t('正在调用酒馆保存，无法可靠取消。', 'Host saving in progress; cancellation cannot be guaranteed.'),
        applied_unconfirmed: t('当时已调用保存；持久化未确认。不要自动重试。', 'Save called at the time; persistence unconfirmed. Do not retry automatically.'),
        outcome_unknown: t('保存结果或后续状态未知；请人工核对，不自动重试或回滚。', 'Save outcome or later state unknown; inspect manually. No automatic retry or rollback.'),
        not_executed: t('未执行：目标或整书基线变化。', 'Not executed: target or book baseline changed.'), cancelled: t('已取消，未执行。', 'Cancelled, not executed.'), expired: t('草稿已失效，未执行。', 'Expired, not executed.') })[action.status] || action.status);
}
