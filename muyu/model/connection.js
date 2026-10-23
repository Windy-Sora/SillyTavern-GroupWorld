/** Explicit full endpoint; never guess /v1 or silently switch providers. */
import { RUN_DEFAULTS } from '../core/budget.js';
export function validateConnection(config) {
    const { endpoint, apiKey, model, profile = 'chat-completions', supportsTools = false, allowLocalHttp = false, maxTokens = RUN_DEFAULTS.maxTokens, thinking = profile === 'deepseek', reasoningEffort = 'high' } = config;
    let url;
    try { url = new URL(endpoint); } catch { throw new TypeError('Invalid model endpoint'); }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(allowLocalHttp === true && local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/chat/completions')) throw new TypeError('Invalid model endpoint');
    if (typeof apiKey !== 'string' || !apiKey.trim() || apiKey.length > 4096 || /[\r\n]/.test(apiKey)) throw new TypeError('Invalid model credential');
    if (typeof model !== 'string' || !model.trim() || model.length > 128) throw new TypeError('Invalid model name');
    if (!['chat-completions', 'deepseek'].includes(profile) || typeof thinking !== 'boolean' || (thinking && profile !== 'deepseek') || !['low', 'high', 'max'].includes(reasoningEffort) || typeof supportsTools !== 'boolean' || !Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 32768) throw new TypeError('Invalid model options');
    return Object.freeze({ endpoint: url.href, apiKey, model, profile, supportsTools, maxTokens, thinking, reasoningEffort });
}
