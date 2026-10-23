export function renderProviderInstall({ doc, card, artifact, state, controller, act, lang }) {
    const t = (zh, en) => lang === 'en' ? en : zh;
    const node = (tag, text, parent = card) => { const el = doc.createElement(tag); el.textContent = text; parent.append(el); return el; };
    node('p', `${artifact.content.name}.js → ${artifact.content.ids.join(', ')}`);
    const operation = artifact.content.operation, deleting = operation === 'delete';
    if (operation) node('strong', deleting ? t('删除用户 Provider 资产', 'Delete user Provider asset') : t('替换用户 Provider 资产', 'Replace user Provider asset'));
    const details = node('details', '');
    node('summary', deleting ? t('删除目标详情', 'Deletion target details') : t('完整源码（执行前请审阅）', 'Full source (review before execution)'), details);
    if (operation === 'update') {
        node('p', t('替换前源码', 'Previous source'), details);
        node('code', artifact.content.previous.source, node('pre', '', details));
        node('p', t('替换后源码', 'Replacement source'), details);
        node('p', `${t('原 ID', 'Previous IDs')}: ${artifact.content.previous.ids.join(', ')}`, details);
    }
    node('code', deleting ? `${artifact.content.name}.js\n${artifact.content.ids.join(', ')}\n${artifact.content.baseRevision}` : artifact.content.source, node('pre', '', details));
    for (const warning of artifact.content.warnings) node('p', warning);
    if (!state.canInstallProvider) return;
    const button = (text, fn) => { const b = node('button', text); b.type = 'button'; b.className = 'menu_button'; b.disabled = state.busy || state.resetting; b.onclick = () => act(fn); };
    const action = state.providerActions?.find(row => row.artifactId === artifact.id && row.revision === artifact.revision);
    if (!action) { button(deleting ? t('审阅并准备删除', 'Review and prepare deletion') : operation ? t('审阅并准备替换', 'Review and prepare replacement') : t('审阅并准备导入', 'Review and prepare import'), () => controller.prepareProviderInstall(artifact.id, artifact.revision)); return; }
    if (action.status === 'pending') {
        details.open = true;
        node('strong', deleting ? t('将删除源码并卸载所属 ID，模板引用不会自动修复。确认删除此版本？', 'Delete source and unload owned IDs; references will not be repaired. Delete this exact version?') : t('导入或替换即执行代码，影响全局注册表。确认执行这份完整源码？', 'Import/replacement executes code and changes the global registry. Execute this exact source?'));
        button(deleting ? t('确认删除并卸载', 'Delete and unload') : operation ? t('确认替换并注册', 'Replace and register') : t('确认导入并注册', 'Import and register'), () => controller.approveProviderInstall(action.id));
        button(t('取消', 'Cancel'), () => controller.cancelProviderInstall(action.id));
    } else if (!state.receipts?.some(row => row.operationId === action.id)) {
        node('p', action.status === 'saved_unconfirmed' ? t('当时已注册，持久化未确认。', 'Registered then; persistence unconfirmed.') : action.status === 'outcome_unknown' ? t('结果未知，可能已产生副作用；请核对，不要自动重试。', 'Outcome unknown; side effects may have happened. Check, do not retry automatically.') : action.status);
    }
}
