export function renderScriptSave({ doc, card, artifact, state, controller, act, lang }) {
    const t = (zh, en) => lang === 'en' ? en : zh;
    const node = (tag, text, parent = card) => { const el = doc.createElement(tag); el.textContent = text; parent.append(el); return el; };
    const content = artifact.content;
    node('p', (content.next?.name || content.previous?.name) + ' · ' + ({ create: t('新增', 'Create'), update: t('修改', 'Update'), delete: t('删除', 'Delete') })[content.operation]);
    const details = node('details', ''); node('summary', t('完整定义与源码差异', 'Complete definition/source changes'), details);
    for (const [label, value] of [[t('修改前', 'Before'), content.previous], [t('修改后', 'After'), content.next]]) { node('p', label, details); node('code', JSON.stringify(value, null, 2), node('pre', '', details)); }
    for (const warning of content.warnings) node('p', warning);
    if (!state.canSaveScript) return;
    const button = (text, fn) => { const b = node('button', text); b.type = 'button'; b.className = 'menu_button'; b.disabled = state.busy || state.resetting; b.onclick = () => act(fn); };
    const action = state.scriptActions?.find(row => row.artifactId === artifact.id && row.revision === artifact.revision);
    if (!action) { button(t('审阅并准备保存', 'Review and prepare save'), () => controller.prepareScriptSave(artifact.id, artifact.revision)); return; }
    if (action.status === 'pending') {
        details.open = true;
        node('strong', content.next?.enabled ? t('确认保存此版本，并允许后续匹配事件自动执行此代码？', 'Save this exact version and allow future matching events to execute its code?') : t('确认保存／删除此版本？不会主动运行代码。', 'Save/delete this exact version? No active code execution.'));
        button(t('确认此操作', 'Confirm this operation'), () => controller.approveScriptSave(action.id));
        button(t('取消', 'Cancel'), () => controller.cancelScriptSave(action.id));
    } else if (!state.receipts?.some(row => row.operationId === action.id)) node('p', action.status);
}
