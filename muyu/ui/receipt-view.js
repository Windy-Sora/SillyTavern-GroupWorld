import { receiptText } from '../actions/receipts.js';
import { configLabel, configValue } from '../config/presentation.js';
import { renderConfigDiff } from './config-diff-view.js';
import { receiptPresentation, receiptNeedsReview, receiptSummary } from './receipt-presentation.js';
import { patchReadonly } from './readonly-dom.js';

/** Historical facts. Disclosure and navigation do not authorize or execute. */
export function createReceiptView({ doc, parent, controller, act, lang, locateArtifact }) {
    const root = doc.createElement('section'); parent.append(root); root.className = 'gd-muyu-receipts';
    const t = (zh, en) => lang === 'en' ? en : zh;
    const node = (tag, text, parent) => { const el = doc.createElement(tag); el.textContent = text; if (parent) parent.append(el); return el; };
    node('h4', t('操作回执 · 历史结果', 'Operation receipts · Historical results'), root);
    const warning = node('p', '', root), body = node('div', '', root);
    node('small', t('历史结果，不代表当前配置或授权。解释使用模型预算；核对只读取，不重新应用。', 'Historical results, not current settings or permission. Explanation uses model budget; checking reads without reapplying.'), root);
    const labels = { queued: ['等待解释', 'Explanation queued'], running: ['正在解释', 'Explaining'], cancelling: ['正在停止解释', 'Stopping explanation'], succeeded: ['解释完成', 'Explanation complete'], failed: ['解释失败，可重试', 'Explanation failed; retry available'], cancelled: ['解释已取消', 'Explanation cancelled'], interrupted: ['解释已中断', 'Explanation interrupted'], yielded: ['解释已暂停', 'Explanation paused'] };
    const entries = new Map(), defaults = new WeakMap(); let disposed = false, viewIdentity;
    const children = element => Array.from(element.children || []);
    const descendants = element => [element, ...children(element).flatMap(descendants)];
    const stamp = state => JSON.stringify([state.viewKey, state.viewToken, state.connection, state.receipts, state.artifacts, state.receiptExplanations, state.configChecks, state.busy, state.resetting, state.readOnly, state.switchedChat, state.enabled, state.context?.omitHistory, state.permissions, state.sourceGrants, state.canReadConfig, state.canCheckReceipts]);
    function remove(entry) { entry.active = false; for (const el of descendants(entry.root)) if ((el.tagName || el.tag || '').toLowerCase() === 'button') el.disabled = true; entry.root.remove(); }
    function clear() { for (const entry of entries.values()) remove(entry); entries.clear(); }
    return { reviewTarget: root,
        render(state) {
            if (disposed) return;
            const identity = JSON.stringify([state.viewKey, state.viewToken]);
            if (identity !== viewIdentity) { clear(); viewIdentity = identity; }
            root.hidden = !state.receipts?.length;
            warning.textContent = state.receiptRecordFailed ? t('部分回执未能加入历史；操作不会重试。请复制保留当前结果。', 'Some receipts could not be recorded; operations will not retry. Copy these results for safekeeping.') : '';
            warning.hidden = !state.receiptRecordFailed;
            const signature = stamp(state), retained = new Set();
            for (const receipt of state.receipts || []) {
                if (retained.has(receipt.operationId)) continue;
                const index = retained.size; retained.add(receipt.operationId);
                let entry = entries.get(receipt.operationId);
                if (!entry) { entry = { root: doc.createElement('details'), active: true, generation: 0, signature: null }; entries.set(receipt.operationId, entry); }
                if (entry.signature !== signature) {
                    const generation = ++entry.generation, card = doc.createElement('details'); card.className = 'gd-muyu-artifact gd-muyu-receipt';
                    const checkIssue = ['different', 'unknown'].includes(state.configChecks?.[receipt.operationId]?.state);
                    const explanationIssue = state.receiptExplanations?.[receipt.operationId] === 'failed';
                    card.open = receiptNeedsReview(receipt) || checkIssue || explanationIssue;
                    card.setAttribute('data-state', card.open ? 'warning' : 'ended');
                    node('summary', t('操作回执', 'Operation receipt') + ' · ' + receiptSummary(receipt, lang)
                        + (checkIssue ? t(' · 当前值核对需注意', ' · Current-value check needs attention') : '')
                        + (explanationIssue ? t(' · 解释失败，不改变原结果', ' · Explanation failed; original result unchanged') : ''), card);
                    const content = node('div', '', card), presentation = receiptPresentation(receipt);
                    if (!presentation.supported) node('p', t('暂不支持显示此版本的回执；不会提供操作入口。', 'This receipt version is not supported here; no action is offered.'), content);
                    else {
                        node('p', receiptText(receipt, lang), content).setAttribute('style', 'white-space: pre-wrap');
                        for (const diff of presentation.diffs) renderConfigDiff({ doc, parent: content, diff, lang, technicalOnly: true });
                        if (presentation.fields) { const details = node('details', '', content); node('summary', t('技术详情 · 原始字段', 'Technical details · raw fields'), details); node('p', presentation.fields.join(', '), details); }
                        const actions = node('div', '', content); actions.className = 'gd-muyu-receipt-actions';
                        const status = state.receiptExplanations?.[receipt.operationId];
                        if (status) node('small', t(...(labels[status] || ['解释状态未知', 'Explanation status unknown'])) + t('；不改变操作结果', '; does not change the operation result'), actions).setAttribute('role', 'status');
                        const check = state.configChecks?.[receipt.operationId];
                        if (check) {
                            const checks = { reading: ['正在核对', 'Checking'], matched: ['读取时与提议值一致', 'Matched proposed values at read time'], different: ['读取时与提议值不一致', 'Different from proposed values at read time'], unknown: ['无法核对', 'Unable to verify'], permission_required: ['尚未核对：需要配置读取授权', 'Not checked: settings read permission required'] };
                            node('p', t(...(checks[check.state] || checks.unknown)) + (check.readAt ? ' · ' + check.readAt : ''), actions).setAttribute('role', 'status');
                            for (const field of check.fields) node('small', `${configLabel(field.field, lang)}：${configValue(field.field, field.actual, lang, { serialized: true })} · ${t('提议', 'proposed')} ${configValue(field.field, field.expected, lang, { serialized: true })}`, actions);
                            node('small', t('仅是读取时的内存值，不证明持久化，也不改变原回执。', 'In-memory values at read time only; not proof of persistence. Original receipt unchanged.'), actions);
                        }
                        const button = (text, fn, disabled = false) => { const el = node('button', text, actions); el.type = 'button'; el.className = 'menu_button'; el.disabled = !!disabled; el.onclick = fn; return el; };
                        if (locateArtifact && state.artifacts?.some(a => a.id === receipt.artifactId && a.revision === receipt.revision)) button(t('查看原始草稿', 'View original draft'), () => locateArtifact(receipt.artifactId, receipt.revision));
                        if (!state.readOnly && !state.switchedChat && presentation.config) {
                            button(t('让暮羽解释结果', 'Ask Muyu to explain'), () => act(() => controller.explainReceipt(receipt.operationId)), state.busy || state.resetting || !state.enabled || state.context?.omitHistory || !(state.canReadConfig ?? state.permissions?.diagnostics));
                            button(t('核对当前配置', 'Check current settings'), () => act(() => controller.checkReceipt(receipt.operationId)), state.busy || state.resetting || !state.enabled || !(state.canCheckReceipts?.[receipt.operationId] ?? state.canReadConfig ?? state.permissions?.diagnostics));
                        }
                    }
                    for (const el of descendants(card)) {
                        if (!el.onclick) continue; const handler = el.onclick, disabled = el.disabled;
                        el.onclick = () => { if (disposed || !entry.active || entry.generation !== generation || disabled || stamp(controller.snapshot()) !== entry.signature) return; return handler(); };
                    }
                    patchReadonly(entry.root, card, defaults); entry.signature = signature;
                }
                if (body.children[index] !== entry.root) body.insertBefore(entry.root, body.children[index] || null);
            }
            for (const [id, entry] of entries) if (!retained.has(id)) { remove(entry); entries.delete(id); }
        },
        find(id) { return !disposed && entries.get(id)?.active ? entries.get(id).root : null; },
        dispose() { if (disposed) return; disposed = true; clear(); root.remove(); },
    };
}
