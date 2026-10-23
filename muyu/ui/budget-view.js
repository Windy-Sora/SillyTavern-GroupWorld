export function budgetReasonLabel(reason, lang = 'zh') {
    const labels = { model_calls: ['模型调用上限', 'Model-call limit'], tool_calls: ['工具调用上限', 'Tool-call limit'], corrections: ['参数纠错上限', 'Argument-correction limit'], tool_batch: ['单次工具批量上限', 'Tool-batch limit'], provider_bytes: ['资料读取预算', 'Provider byte budget'], run_time: ['单轮总超时', 'Run deadline'], model_output: ['模型输出截断', 'Model output truncated'] };
    return labels[reason]?.[lang === 'en' ? 1 : 0] || (lang === 'en' ? 'Unknown' : '未知');
}
export function formatBudget(b, lang = 'zh') {
    if (!b) return lang === 'en' ? 'No run usage yet.' : '暂无本轮用量。';
    const en = lang === 'en', t = (zh, english) => en ? english : zh;
    return [
        `${t('模型', 'Model')} ${b.modelCalls}/${b.modelLimit} · ${t('工具', 'Tools')} ${b.toolCalls}/${b.toolLimit} · ${t('纠错', 'Corrections')} ${b.corrections}/${b.correctionLimit}`,
        `${t('耗时', 'Elapsed')} ${(b.elapsedMs / 1000).toFixed(1)}/${b.timeLimitMs / 1000}s · ${t('资料', 'Data')} ${b.providerBytes}/${b.providerLimit} B`,
        `${t('单次输出上限', 'Output limit per call')} ${b.maxTokens} tokens`,
        b.usageReports ? `${t('服务商报告输入/输出', 'Reported input/output')} ${b.inputTokens}/${b.outputTokens} tokens (${b.usageReports}/${b.modelCalls} ${t('次调用有报告；非上下文窗口大小', 'calls reported; not context-window size')})` : t('实际 Token 用量未知（服务未报告或请求未完成）', 'Actual token usage unknown (not reported or request unfinished)'),
        b.reason ? `${t('限制原因', 'Limit reason')}: ${budgetReasonLabel(b.reason, lang)}${b.finalizing ? t('；已进入预算内收尾，不代表调查完整', '; bounded finalization, not a complete investigation') : ''}` : '',
    ].filter(Boolean).join('\n');
}
