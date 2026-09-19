export function getProfileSummaryEditValue(profile) {
    return typeof profile?.summary === 'string' ? profile.summary : '';
}

export function formatProfileSummary(profile, lang, escapeHtml) {
    return [
        escapeHtml(getProfileSummaryEditValue(profile)),
        profile?.tags && (lang === 'zh' ? '标签：' : 'Tags: ') + escapeHtml([].concat(profile.tags).join(', ')),
        profile?.motivation && (lang === 'zh' ? '动机：' : 'Motivation: ') + escapeHtml(profile.motivation),
    ].filter(Boolean).join('<br>');
}
