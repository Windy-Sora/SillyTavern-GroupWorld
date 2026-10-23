export function renderBlueprintLibrarySave({ doc, card, artifact, state, controller, act, lang }) {
    const t = (zh, en) => lang === 'en' ? en : zh;
    const node = (tag, text, parent = card) => { const el = doc.createElement(tag); el.textContent = text; parent.append(el); return el; };
    const content = artifact.content;
    const entries = [content], detailsList = [];
    for (const entry of entries) {
        node('p', (entry.next?.name || entry.previous?.name) + ' · ' + ({ create: t('新增', 'Create'), update: t('修改', 'Update'), delete: t('删除', 'Delete') })[entry.operation]);
        const details = node('details', ''); detailsList.push(details); node('summary', t('完整蓝图包及元数据差异', 'Complete Blueprint package and metadata changes'), details);
        for (const [label, value] of [[t('修改前', 'Before'), entry.previous], [t('修改后', 'After'), entry.next]]) { node('p', label, details); node('code', JSON.stringify(value, null, 2), node('pre', '', details)); }
        for (const warning of entry.warnings) node('p', warning);
    }
    if (!state.canSaveBlueprintLibrary) return;
    const button = (text, fn) => { const b = node('button', text); b.type = 'button'; b.className = 'menu_button'; b.disabled = state.busy || state.resetting || state.readOnly; b.onclick = () => act(fn); };
    const action = state.blueprintLibraryActions?.find(row => row.artifactId === artifact.id && row.revision === artifact.revision);
    if (!action) { button(t('审阅并准备保存', 'Review and prepare save'), () => controller.prepareBlueprintLibrarySave(artifact.id, artifact.revision)); return; }
    if (action.status === 'pending') {
        for (const details of detailsList) details.open = true;
        node('strong', t('确认保存／删除上述全部定义？不会主动调用模型。', 'Save/delete all definitions above? No model call is started.'));
        button(t('确认此操作', 'Confirm this operation'), () => controller.approveBlueprintLibrarySave(action.id));
        button(t('取消', 'Cancel'), () => controller.cancelBlueprintLibrarySave(action.id));
    } else if (!state.receipts?.some(row => row.operationId === action.id)) node('p', action.status);
}
