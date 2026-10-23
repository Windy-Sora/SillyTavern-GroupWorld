export function renderProfileSave({ doc, card, artifact, state, controller, act, lang }) {
    const t = (zh, en) => lang === 'en' ? en : zh;
    const node = (tag, value) => { const el = doc.createElement(tag); el.textContent = value; card.append(el); return el; };
    const button = (label, fn) => { const el = node('button', label); el.type = 'button'; el.className = 'menu_button'; el.disabled = state.busy || state.resetting; el.onclick = () => act(fn); return el; };
    if (!state.canSaveProfile) return;
    const action = state.profileActions?.find(row => row.artifactId === artifact.id && row.revision === artifact.revision);
    if (!action) { button(t('审阅并保存到我的配置档', 'Review and save to My Profiles'), () => controller.prepareProfileSave(artifact.id, artifact.revision)); return; }
    if (action.status === 'pending') {
        node('strong', t('确认仅保存这份配置档？当前设置不会改变。', 'Save only this reusable profile? Active settings will not change.'));
        node('small', t('配置档将出现在“我的配置档”中；以后手动应用时才会影响所有聊天。保存结果不明时不会自动重试。', 'It will appear in My Profiles. Applying it later can affect all chats. Uncertain saves are never retried automatically.'));
        button(t('保存这份配置档', 'Save this profile'), () => controller.approveProfileSave(action.id));
        button(t('取消', 'Cancel'), () => controller.cancelProfileSave(action.id));
    } else if (!state.receipts?.some(row => row.operationId === action.id)) {
        const status = { applying: t('正在保存配置档…', 'Saving profile…'), saved_confirmed: t('配置档保存已确认；当前设置未改变。', 'Profile save confirmed; active settings unchanged.'),
            saved_unconfirmed: t('配置档已加入列表，但持久化未确认。', 'Profile added, persistence unconfirmed.'), outcome_unknown: t('保存结果不明；请到配置档列表核对，不要自动重试。', 'Save outcome unknown; check My Profiles, do not retry automatically.'),
            not_executed: t('未保存：名称重复、配置档无效或目标已变化。', 'Not saved: duplicate name, invalid draft or stale target.'), cancelled: t('已取消；未保存。', 'Cancelled; not saved.'), expired: t('已过期；未保存。', 'Expired; not saved.') };
        node('p', status[action.status] || '').setAttribute('role', 'status');
    }
}
