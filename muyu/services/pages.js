import { validateJson } from '../core/json-contract.js';
export const PAGE_ERRORS = Object.freeze(['PAGE_INVALID', 'PAGE_BLOCKED', 'PAGE_DNS_FAILED', 'PAGE_NETWORK_ERROR', 'PAGE_TIMEOUT', 'PAGE_ABORTED', 'PAGE_TOO_LARGE', 'PAGE_UNSUPPORTED', 'PAGE_REDIRECT_LIMIT', 'PAGE_HTTP_ERROR', 'PAGE_BUSY']);
export function projectPageResult(value) {
    try {
        const data = validateJson({ type: 'object', additionalProperties: false, required: ['version', 'status', 'url', 'fetchedAt', 'title', 'text', 'limited'], properties: {
            version: { type: 'integer', enum: [1] }, status: { type: 'string', enum: ['ok'] },
            url: { type: 'string', maxLength: 2000 }, fetchedAt: { type: 'string', maxLength: 40 },
            title: { type: 'string', maxLength: 240 }, text: { type: 'string', maxLength: 24000 }, limited: { type: 'boolean' },
        } }, value);
        const url = new URL(data.url);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port ||
            /[\x00-\x20\x7f\\]/.test(data.url) || !Number.isFinite(Date.parse(data.fetchedAt))) throw Error();
        return data;
    } catch { throw Error('SERVICE_INCOMPATIBLE'); }
}
