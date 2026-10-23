export function renderVariableApply({ doc, card, artifact, state, controller, act, lang }) {
    const t = (zh, en) => lang === 'en' ? en : zh;
    const node = (tag, value) => { const el = doc.createElement(tag); el.textContent = value; card.append(el); return el; };
    const button = (label, fn, disabled = false) => { const el = node('button', label); el.type = 'button'; el.className = 'menu_button'; el.disabled = disabled; el.onclick = () => act(fn); return el; };
    if (!state.canApplyVariable) return;
    const action = state.variableActions?.find(row => row.artifactId === artifact.id && row.revision === artifact.revision);
    const disabled = state.busy || state.resetting;
    if (!action) {
        button(t('查看并应用变量', 'Review and apply variable'), () => controller.prepareVariableApply(artifact.id, artifact.revision), disabled);
        return;
    }
    if (action.status === 'pending') {
        node('strong', t('确认仅在当前聊天应用上述变量差异？', 'Apply exactly these variable changes to this chat?'));
        node('small', t('仅批准此草稿版本一次。聊天保存可能失败或结果未知；不会自动重试、回滚或修改其他聊天。自动维护可能影响后续导演输出，但不保证模型一定更新数值。',
            'One approval for this draft revision. Chat saving may fail or be uncertain; no automatic retry, rollback or changes to other chats. Automatic maintenance can affect later director output but does not guarantee updates.'));
        button(t('应用这份变量修改', 'Apply this variable change'), () => controller.approveVariableApply(action.id), disabled);
        button(t('取消变量修改', 'Cancel variable change'), () => controller.cancelVariableApply(action.id), disabled);
        return;
    }
    if (state.receipts?.some(row => row.operationId === action.id)) return;
    const status = {
        applying: t('正在保存当前聊天；无法可靠取消。', 'Saving this chat; cancellation cannot be guaranteed.'),
        applied_confirmed: t('这次聊天保存已确认。', 'This chat save was confirmed.'),
        partial: t('已写入，但保存后目标又变化；请核对回执。', 'Written, but the target changed after saving; inspect the receipt.'),
        outcome_unknown: t('变量已写入内存，保存结果未知；不要自动重试。', 'The variable was written in memory; save outcome is unknown. Do not retry automatically.'),
        not_executed: t('未执行：聊天或草稿基线已变化。', 'Not executed: the chat or draft baseline changed.'),
        cancelled: t('已取消，未执行。', 'Cancelled; not executed.'),
        expired: t('已失效，未执行。', 'Expired; not executed.'),
    };
    node('p', status[action.status] || '').setAttribute('role', 'status');
}
