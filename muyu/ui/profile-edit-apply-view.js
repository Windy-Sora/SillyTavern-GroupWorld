export function renderProfileEditApply({ doc, card, artifact, state, controller, act, lang }) {
    const t = (zh, en) => lang === 'en' ? en : zh;
    const node = (tag, value) => { const el = doc.createElement(tag); el.textContent = value; card.append(el); return el; };
    const button = (label, fn, disabled = false) => { const el = node('button', label); el.type = 'button'; el.className = 'menu_button'; el.disabled = disabled; el.onclick = () => act(fn); return el; };
    if (!state.canApplyProfileEdit) return;
    const action = state.profileEditActions?.find(row => row.artifactId === artifact.id && row.revision === artifact.revision);
    const disabled = state.busy || state.resetting;
    const creating=artifact.content.operation==='create';
    if (!action) {
        button(creating?t('查看并新建档案','Review and create profile'):t('查看并应用档案', 'Review and apply profile entry'), () => controller.prepareProfileEditApply(artifact.id, artifact.revision), disabled);
        return;
    }
    if (action.status === 'pending') {
        node('strong', t('确认仅在当前聊天应用上述档案差异？', 'Apply exactly these profile entry changes to this chat?'));
        node('small', t('仅批准此草稿版本一次。聊天保存可能失败或结果未知；不会自动重试、回滚或修改其他聊天。其他档案和来源信息保持不变。',
            'One approval for this draft revision. Chat saving may fail or be uncertain; no automatic retry, rollback or changes to other chats. Other memories and source metadata stay unchanged.'));
        button(creating?t('新建这份档案','Create this profile'):t('应用这份档案修改', 'Apply this profile entry change'), () => controller.approveProfileEditApply(action.id), disabled);
        button(t('取消档案修改', 'Cancel profile entry change'), () => controller.cancelProfileEditApply(action.id), disabled);
        return;
    }
    if (state.receipts?.some(row => row.operationId === action.id)) return;
    const status = {
        applying: t('正在保存当前聊天；无法可靠取消。', 'Saving this chat; cancellation cannot be guaranteed.'),
        applied_confirmed: t('这次聊天保存已确认。', 'This chat save was confirmed.'),
        partial: t('已写入，但保存后目标又变化；请核对回执。', 'Written, but the target changed after saving; inspect the receipt.'),
        outcome_unknown: t('档案已写入内存，保存结果未知；不要自动重试。', 'The profile entry was written in profile; save outcome is unknown. Do not retry automatically.'),
        not_executed: t('未执行：聊天或草稿基线已变化。', 'Not executed: the chat or draft baseline changed.'),
        cancelled: t('已取消，未执行。', 'Cancelled; not executed.'),
        expired: t('已失效，未执行。', 'Expired; not executed.'),
    };
    node('p', status[action.status] || '').setAttribute('role', 'status');
}
