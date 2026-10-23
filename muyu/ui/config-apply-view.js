export function renderConfigApply({ doc, card, artifact, state, controller, act, lang }) {
    const t = (zh, en) => lang === 'en' ? en : zh;
    const node = (tag, text) => { const e = doc.createElement(tag); e.textContent = text; card.append(e); return e; };
    const button = (text, fn, disabled = false) => { const e = node('button', text); e.type = 'button'; e.className = 'menu_button'; e.disabled = disabled; e.onclick = () => act(fn); return e; };
    if (!state.canApplyConfig) return;
    const r = state.configActions?.find(a => a.artifactId === artifact.id && a.revision === artifact.revision);
    const disabled = state.busy || state.resetting;
    if (!r) {
        button(t('查看并应用', 'Review and apply'), () => controller.prepareConfigApply(artifact.id, artifact.revision), disabled || !artifact.content.preview.diff.length); return;
    }
    if (r.status === 'pending') {
        node('strong', t('确认应用上方这份修改？', 'Apply exactly the changes above?'));
        node('p', t('影响所有聊天。修改模式、Prompt或自动功能可能影响后续生成及费用。未列出的字段不修改。', 'Affects all chats. Mode, prompt or automation changes may affect future generation and costs. Unlisted fields stay unchanged.'));
        const proposed = artifact.content.preview.manifest?.settings || {};
        if (proposed.postSpeechMessageEnabled === true) node('strong', t('消息后策略启用后，每条合格角色消息可能增加一次模型调用，并可能执行已注册的 Capability（包括用户扩展）。', 'Enabling the per-message policy may add one model call per eligible character message and execute registered Capabilities, including user extensions.'));
        if (proposed.postSpeechRoundEnabled === true) node('strong', t('轮次后策略启用后，每个合格轮次可能增加一次模型调用，并可能执行已注册的 Capability（包括用户扩展）。', 'Enabling the per-round policy may add one model call per eligible round and execute registered Capabilities, including user extensions.'));
        node('small', t('只批准此版本一次。保存开始后无法保证取消；不会自动回滚，也不提供一键撤销。', 'Approves this revision once. Saving cannot reliably be cancelled; no automatic rollback or one-click undo.'));
        if (artifact.content.memoryPrunePlan) node('strong', t(`当前聊天预计删除 ${artifact.content.memoryPrunePlan.total} 条最旧记忆；全局设置与聊天裁剪会分别保存，可能部分完成。`, `This chat may lose ${artifact.content.memoryPrunePlan.total} oldest memories. Global settings and chat pruning save separately and may partially complete.`));
        if (artifact.content.completionVariablePlan) node('strong', t(`先在当前聊天创建 ${artifact.content.completionVariablePlan.newId}=false 并确认保存，再保存全局名称；旧变量保留。其他聊天不会立即迁移。`, `First create and confirm ${artifact.content.completionVariablePlan.newId}=false in this chat, then save the global name. The old variable stays; other chats are not migrated immediately.`));
        if (artifact.content.blueprintTogglePlan) {
            const p = artifact.content.blueprintTogglePlan;
            node('strong', p.operation === 'none' ? t('当前聊天没有完成变量：仅关闭全局蓝图开关，不创建变量。', 'No completion variable in this chat: only disable the global switch; do not create a variable.') :
                t(`当前聊天完成变量 ${p.variableId}：${p.before.stored ? String(p.before.value) : '无存储值'} → false。先保存聊天变量，再保存全局蓝图开关，可能部分完成。`, `Current-chat completion variable ${p.variableId}: ${p.before.stored ? String(p.before.value) : 'no stored value'} → false. Chat and global settings save separately; partial completion is possible.`));
            if (p.enableAutoUpdate || p.useManualInjection) node('p', t('此变量同时改为自动更新、手动注入；不修改规则正文。', 'This variable will use automatic updates and manual injection; rule text stays unchanged.'));
            node('small', t('不修改蓝图正文及进度，不修改其他聊天变量。启用后已有自动续写规则可能带来后续模型调用。', 'Blueprint content, progress and other chats stay unchanged. Existing auto-continuation settings may cause future model calls.'));
        }
        button(t('应用这份修改', 'Apply these changes'), () => controller.approveConfigApply(r.id), disabled);
        button(t('取消应用', 'Cancel application'), () => controller.cancelConfigApply(r.id), disabled);
        return;
    }
    const labels = {
        applying: t('正在应用并请求保存；此时不能撤回。', 'Applying and requesting save; cannot undo at this point.'),
        applied_confirmed: t('本次修改保存已确认。', 'Save confirmed for this modification.'),
        applied_unconfirmed: t('本次已更新内存配置，持久化保存未确认；请检查酒馆保存状态。不要直接刷新，以免丢失未保存内容。', 'In-memory settings updated; persistence unconfirmed. Check ST save status. Do not reload and risk losing unsaved data.'),
        partial: t('部分完成：请查看下方分步回执；不会自动重试或回滚。', 'Partially completed: inspect the step-by-step receipt below. No automatic retry or rollback.'),
        not_executed: t('未执行：配置或草稿已变化，请重新生成预览。', 'Not executed: settings or draft changed. Generate a fresh preview.'),
        outcome_unknown: t('执行结果不确定，请检查实际配置；不会自动重试或回滚。', 'Outcome uncertain. Check actual settings; no automatic retry or rollback.'),
        cancelled: t('已取消，未执行。', 'Cancelled; not executed.'), expired: t('批准请求已失效，未执行。', 'Approval expired; not executed.'),
    };
    const receipt = state.receipts?.find(value => value.operationId === r.id);
    // The panel already points to the receipt below; keep a single result body.
    if (receipt) return;
    node('p', labels[r.status] || '').setAttribute('role', 'status');
    if (r.result?.saveError) node('small', t('保存调用返回异常；配置可能仍在内存中生效。', 'Save call reported an error; settings may still be active in memory.'));
    if (r.result?.changed) node('small', t('等待保存期间配置又发生变化；未覆盖后续编辑。', 'Settings changed again while saving; later edits were not overwritten.'));
}
