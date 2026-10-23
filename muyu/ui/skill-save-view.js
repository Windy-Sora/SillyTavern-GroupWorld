export function renderSkillSave({ doc, card, artifact, state, controller, act, lang }) {
    const t = (zh, en) => lang === 'en' ? en : zh;
    const node = (tag, text, parent = card) => { const el = doc.createElement(tag); el.textContent = text; parent.append(el); return el; };
    const content = artifact.content;
    const operations = { create: t('新建', 'Create'), update: t('编辑', 'Edit'), delete: t('删除', 'Delete'), enable: t('启停', 'Enable / disable'), copy: t('复制', 'Copy'), feature: t('技能总开关', 'Skill switch') };
    node('p', content.name + ' · ' + operations[content.operation] + ' · ' + (content.enabled ? t('启用', 'Enabled') : t('禁用／删除', 'Disabled / deleted')));
    const details = node('details', ''); node('summary', t('完整技能差异', 'Complete Skill changes'), details);
    try { const value = controller.skillDraftDisplay(artifact.id, artifact.revision); node('code', JSON.stringify(value, null, 2), node('pre', '', details)); }
    catch { node('p', t('此预览已失效或已执行；不能重新批准。', 'Preview expired or already consumed; cannot approve again.'), details); return; }
    for (const warning of content.warnings) node('p', warning);
    const action = state.skillActions?.find(row => row.artifactId === artifact.id && row.revision === artifact.revision);
    const button = (text, fn) => { const el = node('button', text); el.type = 'button'; el.className = 'menu_button'; el.disabled = state.busy || state.resetting || state.readOnly; el.onclick = () => act(fn); };
    if (!action) button(t('审阅并准备保存', 'Review and prepare save'), () => controller.prepareSkillSave(artifact.id, artifact.revision));
    else if (action.status === 'pending') { details.open = true; button(t('确认此操作', 'Confirm operation'), () => controller.approveSkillSave(action.id)); button(t('取消', 'Cancel'), () => controller.cancelSkillSave(action.id)); }
}
