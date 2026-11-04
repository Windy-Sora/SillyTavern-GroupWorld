/** Fixed user-owned text slots, never an arbitrary setting/path or a system-instruction dump. */
export const SELF_TEXT_ITEMS = Object.freeze(['configured-instructions', 'effective-instructions', 'draft-instructions', 'configured-connection', 'draft-connection']);

/** Defense in depth for text intentionally shared with a model, not a general secret detector. */
export function sanitizeSelfText(value, secrets = []) {
    let text = typeof value === 'string' ? value : '';
    for (const secret of secrets) if (typeof secret === 'string' && secret) {
        for (const spelling of new Set([secret, encodeURIComponent(secret)])) text = text.split(spelling).join('[REDACTED]');
    }
    return text.replace(/\b(?:sk-|sk_)[a-zA-Z0-9_-]{8,}/g, '[REDACTED]')
        .replace(/\b(Bearer\s+)[^\s"'<>]+/gi, '$1[REDACTED]')
        .replace(/((?:api[_ -]?key|access[_ -]?token|authorization|password|secret)\s*["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi, '$1[REDACTED]')
        .replace(/https?:\/\/[^\s"'<>]+/gi, raw => {
            try { const url = new URL(raw); url.username = ''; url.password = ''; url.search = ''; url.hash = ''; return url.href; }
            catch { return '[REDACTED URL]'; }
        });
}

/** Credential fields are never copied; URL credentials, query and fragment are omitted. */
export function projectConnectionText(value, secrets = []) {
    if (!value || typeof value !== 'object') return null;
    return sanitizeSelfText(JSON.stringify({ source: value.source === 'st' ? 'st' : 'independent',
        endpoint: typeof value.endpoint === 'string' ? sanitizeSelfText(value.endpoint, secrets).slice(0, 4096) : null,
        model: typeof value.model === 'string' ? sanitizeSelfText(value.model, secrets).slice(0, 256) : null,
        profile: ['deepseek', 'chat-completions', 'responses'].includes(value.profile) ? value.profile : null,
        thinking: typeof value.thinking === 'boolean' ? value.thinking : null,
        reasoningEffort: ['low', 'medium', 'high', 'xhigh', 'max'].includes(value.reasoningEffort) ? value.reasoningEffort : null }), secrets);
}
