/** The review is the authorization boundary; task-plan read approval never reaches this action. */
export function renderTaskBundleApply({ doc, card, artifact, state, controller, act, lang }) {
    const t = (zh, en) => lang === 'en' ? en : zh;
    const node = (tag, value) => { const element = doc.createElement(tag); element.textContent = value; card.append(element); return element; };
    const button = (label, fn) => { const element = node('button', label); element.type = 'button'; element.className = 'menu_button'; element.disabled = state.busy || state.resetting; element.onclick = () => act(fn); return element; };
    if (!state.canApplyBundle) return;
    const action = state.bundleActions?.find(row => row.artifactId === artifact.id && row.revision === artifact.revision);
    if (!action) { button(t('审阅并应用整单', 'Review and apply bundle'), () => controller.prepareBundleApply(artifact.id, artifact.revision)); return; }
    if (action.status === 'pending') {
        node('strong', t('确认只执行上方列出的精确差异？', 'Execute only the exact changes listed above?'));
        node('small', t('仅批准这份草稿版本一次。先逐项保存当前聊天变量，再保存全局配置，最后保存脚本定义；启用脚本允许后续事件自动执行。失败或保存结果未知即停止，剩余步骤不执行。不同保存域不能原子回滚，也不会自动重试。',
            'One approval for this exact draft. Current-chat variables save first, then global settings, then script definitions. Enabled scripts allow future automatic event execution. Failed or uncertain saves stop remaining steps. The save domains are not atomic; no automatic retry or rollback.'));
        button(t('批准并执行整单', 'Approve and run bundle'), () => controller.approveBundleApply(action.id));
        button(t('取消整单', 'Cancel bundle'), () => controller.cancelBundleApply(action.id));
    } else if (!state.receipts?.some(row => row.operationId === action.id)) {
        node('p', action.status === 'applying' ? t('正在逐步执行与确认保存…', 'Executing and confirming saves…') :
            t('执行已结束；逐步结果见历史回执。', 'Execution ended; inspect the per-step historical receipt.')).setAttribute('role', 'status');
    }
}
