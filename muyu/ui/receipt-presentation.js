import { receiptProtocol, receiptProtocolDescriptors } from '../actions/receipt-protocol.js';
// The wire registry owns support and presentation flags, never read/write authority.
export const receiptPresentationDescriptors = () => receiptProtocolDescriptors().map(({ version, config, technical }) => ({ version, config, technical }));
export function receiptPresentation(receipt) {
    const row = receiptProtocol(receipt?.version);
    if (!row) return { supported: false, config: false, diffs: [], fields: null };
    return { supported: true, config: row.config,
        diffs: row.technical === 'diff' ? [receipt.diff] : row.technical === 'settings-steps' ? receipt.steps.filter(step => step.kind === 'settings').map(step => step.diff) : [],
        fields: row.technical === 'profile-fields' ? receipt.fields : null };
}

const resultLabels = {
    cancelled: ['已取消 · 未执行', 'Cancelled · not executed'], expired: ['批准已失效 · 未执行', 'Approval expired · not executed'],
    not_executed: ['未执行', 'Not executed'], applied_confirmed: ['当时已应用 · 保存已确认', 'Applied at the time · save confirmed'],
    saved_confirmed: ['当时已保存 · 保存已确认', 'Saved at the time · save confirmed'],
    applied_unconfirmed: ['当时已更新内存 · 保存未确认', 'Memory updated at the time · save unconfirmed'],
    saved_unconfirmed: ['已请求保存 · 持久化未确认', 'Save requested · persistence unconfirmed'],
    partial: ['部分完成 · 需核对', 'Partially completed · review needed'], outcome_unknown: ['结果未知 · 需核对', 'Outcome unknown · review needed'],
};
export function receiptNeedsReview(receipt) {
    if (!receiptPresentation(receipt).supported || !Object.hasOwn(resultLabels, receipt.status)) return true;
    const rows = [receipt, ...(receipt.steps || []), receipt.memoryPrune, receipt.blueprintToggle, receipt.completionVariable].filter(Boolean);
    return rows.some(row => row.saveError || row.changed || ['partial', 'outcome_unknown', 'applied_unconfirmed', 'saved_unconfirmed'].includes(row.status)
        || ['settingsSave', 'chatSave', 'resourceSave', 'persistence'].some(field => ['error', 'unknown', 'unconfirmed'].includes(row[field])));
}
export function receiptSummary(receipt, lang = 'zh') {
    if (!receiptProtocol(receipt?.version)) return lang === 'en' ? 'Unsupported receipt version · review needed' : '不支持的回执版本 · 需核对';
    const label = resultLabels[receipt.status] || ['结果需核对', 'Result needs review'];
    return label[lang === 'en' ? 1 : 0] + (receiptNeedsReview(receipt) && ['applied_confirmed', 'saved_confirmed', 'not_executed', 'cancelled', 'expired'].includes(receipt.status)
        ? (lang === 'en' ? ' · Additional save/change warnings' : ' · 另有保存或变化警告') : '');
}
