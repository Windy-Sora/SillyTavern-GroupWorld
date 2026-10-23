import { receiptText, validateReceipt } from '../actions/receipts.js';
import { renderConfigDiff } from './config-diff-view.js';

/** Historical evidence with separately reviewed local recovery/undo; never automatic replay. */
export function createCheckpointView({ doc, parent, controller, act, lang }) {
    const root = doc.createElement('details'); root.className = 'gd-muyu-artifact'; parent.append(root);
    const t = (zh, en) => lang === 'en' ? en : zh;
    let signature = '';
    return { reviewTarget: root, render(state) {
        const data = state.checkpoints;
        root.hidden = !data?.enabled || (!data.error && !data.records.length);
        if (root.hidden) return;
        const next = JSON.stringify([data, state.busy, state.resetting]); if (signature === next) return; signature = next;
        root.replaceChildren();
        const node = (tag, text, target = root) => { const el = doc.createElement(tag); el.textContent = text; target.append(el); return el; };
        node('summary', t('操作检查点 · 本地恢复记录', 'Operation checkpoints · Local recovery records'));
        node('small', t('历史记录不代表当前状态或授权。不会自动重跑；剩余修改或普通配置撤回均须本地核对、单独确认。特殊副作用、整单及结果不确定的操作暂不支持撤回。记录留在本浏览器，不随服务端对话同步。', 'Historical records are not current state or permission. No automatic replay. Remaining changes or ordinary settings undo require local verification and separate approval. Side effects, bundles and uncertain outcomes cannot be undone here. Records stay in this browser, not server history.'));
        if (data.error) node('p', t('检查点存储失败。未开始的写入已停止；已经执行的操作不会自动撤回，请核对实际状态。', 'Checkpoint storage failed. Unstarted writes were stopped; executed operations are not automatically undone. Verify actual state.'));
        const refresh = node('button', t('重新读取记录', 'Reload records')); refresh.type = 'button'; refresh.className = 'menu_button'; refresh.disabled = state.busy || state.resetting;
        refresh.onclick = () => act(() => controller.refreshCheckpoints());
        if (data.preview) {
            const p = data.preview, review = node('section', '');
            node('h4', p.mode === 'undo' ? t('撤回预览 · 普通全局配置', 'Undo preview · Ordinary global settings') : t('本地核对后的剩余步骤预览', 'Remaining steps after local verification'), review);
            node('p', p.state !== 'ready' ? t('以下为本次提议差异，不代表当前值或执行成功；实际结果见新检查点。', 'These are the proposed differences, not current values or proof of success. See the new checkpoint for actual results.') : p.mode === 'undo' ? t('尚未撤回。仅将列出的字段恢复到原值，影响所有聊天；确认前会再次核对，不覆盖后来修改。撤回也是一次保存，不保证一定成功。', 'Not undone. Only listed fields will be restored to prior values, affecting all chats. Rechecked before dispatch; later edits are not overwritten. Undo is another save and can fail.') : t('尚未应用。不会重做已完成步骤，也不会向模型发送核对资料；请再次确认本份差异。', 'Not applied. Completed steps are not repeated and verification data is not sent to a model. Confirm these new differences.'), review);
            if (p.diff.length) renderConfigDiff({ doc, parent: review, diff: p.diff, lang });
            if (p.settingsDiff.length) renderConfigDiff({ doc, parent: review, diff: p.settingsDiff, lang });
            for (const step of p.steps) { node('p', t('变量：', 'Variable: ') + step.id, review); node('pre', JSON.stringify(step.diff, null, 2), review).setAttribute('style', 'white-space: pre-wrap; overflow-wrap: anywhere'); }
            if (p.state === 'ready') {
                const approve = node('button', p.mode === 'undo' ? t('确认撤回这些配置字段', 'Confirm undo of these settings') : t('批准并执行这份剩余修改', 'Approve and execute these remaining changes'), review); approve.type = 'button'; approve.className = 'menu_button'; approve.disabled = state.busy || state.resetting;
                approve.onclick = () => act(() => controller.approveCheckpointRecovery(p.id));
            } else node('p', t('本次执行已结束；请查看新的检查点结果，不代表保存一定成功。', 'This attempt has ended. Review its new checkpoint result; persistence may be unconfirmed.'), review);
            const cancel = node('button', t('关闭恢复预览', 'Close recovery preview'), review); cancel.type = 'button'; cancel.className = 'menu_button'; cancel.disabled = state.busy || state.resetting;
            cancel.onclick = () => act(() => controller.cancelCheckpointRecovery());
        }
        for (const row of [...data.records].sort((a, b) => b.updatedAt - a.updatedAt)) {
            const card = node('details', '');
            node('summary', `${row.kind === 'config' ? t('配置操作', 'Configuration operation') : t('整单操作', 'Task bundle')} · ${new Date(row.updatedAt).toLocaleString()}`, card);
            if (row.conversationId !== data.conversationId) node('small', t('来自其他暮羽对话；不是当前聊天的操作。', 'From another Muyu conversation, not an operation in the current chat.'), card);
            if (row.recordingFailed) node('p', t('执行期间检查点保存曾失败，未开始的步骤已停止；下面是最后成功记录的结果，不表示操作被撤回。', 'Checkpoint saving failed during execution; unstarted steps were stopped. The last successfully recorded result is below; operations were not undone.'), card);
            if (row.continuedBy) node('p', t('此记录已交给新的恢复／撤回操作，不可重复执行：', 'This record was handed to a recovery/undo attempt and cannot be executed twice: ') + row.continuedBy, card);
            else if (row.version === 2 && row.kind === 'config' && row.intent && row.status === 'applied_confirmed' && !row.receipt?.changed && !row.receipt?.saveError) {
                const undo = node('button', t('核对并预览撤回配置', 'Verify and preview settings undo'), card); undo.type = 'button'; undo.className = 'menu_button'; undo.disabled = state.busy || state.resetting;
                undo.onclick = () => act(() => controller.prepareCheckpointUndo(row.id));
            }
            else if (row.version === 2 && row.intent && !['applied_confirmed', 'saved_confirmed'].includes(row.status)) {
                const prepare = node('button', t('本地核对并生成剩余预览', 'Verify locally and preview remaining steps'), card); prepare.type = 'button'; prepare.className = 'menu_button'; prepare.disabled = state.busy || state.resetting;
                prepare.onclick = () => act(() => controller.prepareCheckpointRecovery(row.id));
            } else if (!row.intent && !['applied_confirmed', 'saved_confirmed'].includes(row.status)) node('small', t('旧记录或特殊操作缺少完整恢复资料，请重新提出需求；不会从截断回执猜测并执行。', 'Legacy or special operation without complete recovery data. Submit a fresh request; truncated receipts are never guessed into executable changes.'), card);
            if (row.status === 'applying') node('p', t('未记录到最终结果；若任务已中断，应视为结果不确定。请先核对，不要直接重复执行。', 'No final result recorded. If interrupted, treat outcome as unknown. Verify before repeating.'), card);
            else if (row.receipt) node('p', receiptText(validateReceipt(row.receipt), lang), card).setAttribute('style', 'white-space: pre-wrap; overflow-wrap: anywhere');
            const labels = { not_started: ['尚未开始', 'Not started'], applying: ['结果未确认', 'Outcome unconfirmed'], not_executed: ['未执行', 'Not executed'], applied_confirmed: ['已应用，保存已确认', 'Applied, save confirmed'], applied_unconfirmed: ['已应用，保存未确认', 'Applied, save unconfirmed'], saved_confirmed: ['已保存', 'Saved'], saved_unconfirmed: ['保存未确认', 'Save unconfirmed'], partial: ['部分完成', 'Partially completed'], outcome_unknown: ['结果不确定', 'Outcome unknown'] };
            for (const step of row.steps) node('p', `${step.kind === 'settings' ? t('全局配置', 'Global settings') : step.kind === 'variable' ? t('变量', 'Variable') : t('脚本', 'Script')} · ${step.id} · ${t(...labels[step.status])}`, card);
            const proposal = validateReceipt(row.proposal);
            node('small', t('以下仅为原提议，不证明执行或保存：', 'Original proposal only, not proof of execution or persistence:'), card);
            if (proposal.diff) renderConfigDiff({ doc, parent: card, diff: proposal.diff, lang });
            for (const step of proposal.steps || []) {
                const details = node('details', '', card);
                node('summary', step.kind === 'settings' ? t('全局配置提议', 'Proposed global settings') : step.kind === 'variable' ? t('变量提议：', 'Proposed variable: ') + step.id : t('脚本提议：', 'Proposed script: ') + step.script.name, details);
                if (step.kind === 'settings') renderConfigDiff({ doc, parent: details, diff: step.diff, lang });
                else node('pre', JSON.stringify(step.diff.length ? step.diff : step.script, null, 2), details).setAttribute('style', 'white-space: pre-wrap; overflow-wrap: anywhere');
            }
            const remove = node('button', t('删除此恢复记录（不撤回操作）', 'Delete recovery record (does not undo)'), card);
            remove.type = 'button'; remove.className = 'menu_button'; remove.disabled = state.busy || state.resetting;
            remove.onclick = () => act(() => controller.removeCheckpoint(row.id));
        }
    } };
}
