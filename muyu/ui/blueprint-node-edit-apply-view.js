export function renderBlueprintNodeEditApply({ doc, card, artifact, state, controller, act, lang }) {
    const t = (zh, en) => lang === 'en' ? en : zh;
    const node = (tag, value) => { const el = doc.createElement(tag); el.textContent = value; card.append(el); return el; };
    const button = (label, fn, disabled = false) => { const el = node('button', label); el.type = 'button'; el.className = 'menu_button'; el.disabled = disabled; el.onclick = () => act(fn); return el; };
    if (!state.canApplyBlueprintNodeEdit) return;
    const action = state.blueprintNodeEditActions?.find(row => row.artifactId === artifact.id && row.revision === artifact.revision);
    const disabled = state.busy || state.resetting;
    const structural=!!artifact.content.operation;
    const initializing=artifact.content.operation==='initialize';
    if (!action) {
        button(initializing?t('查看并创建空白蓝图','Review and create blank Blueprint'):t('查看并应用蓝图节点', 'Review and apply blueprint node'), () => controller.prepareBlueprintNodeEditApply(artifact.id, artifact.revision), disabled);
        return;
    }
    if (action.status === 'pending') {
        node('strong', initializing?t('确认仅在当前聊天创建这份空白蓝图？','Create exactly this blank Blueprint in this chat?'):t('确认仅在当前聊天应用上述蓝图节点差异？', 'Apply exactly these blueprint node changes to this chat?'));
        node('small', initializing?t('仅批准此版本一次。清空旧进度并重置已有兼容完成值；不覆盖已有蓝图、不生成剧情或开启功能。保存未知不自动重试或回滚。','One approval for this version. Clear old progress and reset compatible completion; no replacement, story generation or enabling. Unknown saving never auto-retries or rolls back.'):structural ? t('仅批准此版本一次。结构调整会整理各模式／层级进度并清除已有兼容完成信号；删除包含子树。请查看完整差异，保存未知不自动重试或整仓回滚。','One approval for this version. Structure changes reconcile all progress scopes and reset an existing compatible completion signal; deleting includes descendants. Inspect full diff; no automatic retry or store rollback.') : t('仅批准此草稿版本一次。聊天保存可能失败或结果未知；不会自动重试、回滚或修改其他聊天。其他蓝图节点和来源信息保持不变。',
            'One approval for this draft revision. Chat saving may fail or be uncertain; no automatic retry, rollback or changes to other chats. Other node fields and stored progress stay unchanged.'));
        button(initializing?t('创建这份空白蓝图','Create this blank Blueprint'):t('应用这份蓝图节点修改', 'Apply this blueprint node change'), () => controller.approveBlueprintNodeEditApply(action.id), disabled);
        button(initializing?t('取消蓝图创建','Cancel Blueprint creation'):t('取消蓝图节点修改', 'Cancel blueprint node change'), () => controller.cancelBlueprintNodeEditApply(action.id), disabled);
        return;
    }
    if (state.receipts?.some(row => row.operationId === action.id)) return;
    const status = {
        applying: t('正在保存当前聊天；无法可靠取消。', 'Saving this chat; cancellation cannot be guaranteed.'),
        applied_confirmed: t('这次聊天保存已确认。', 'This chat save was confirmed.'),
        partial: t('已写入，但保存后目标又变化；请核对回执。', 'Written, but the target changed after saving; inspect the receipt.'),
        outcome_unknown: initializing?t('空白蓝图已写入内存，保存结果未知；不要自动重试。','The blank Blueprint was written in memory; save outcome is unknown. Do not retry automatically.'):t('蓝图节点已写入内存，保存结果未知；不要自动重试。', 'The blueprint node was written in memory; save outcome is unknown. Do not retry automatically.'),
        not_executed: t('未执行：聊天或草稿基线已变化。', 'Not executed: the chat or draft baseline changed.'),
        cancelled: t('已取消，未执行。', 'Cancelled; not executed.'),
        expired: t('已失效，未执行。', 'Expired; not executed.'),
    };
    node('p', status[action.status] || '').setAttribute('role', 'status');
}
