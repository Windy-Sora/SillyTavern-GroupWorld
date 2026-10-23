import { validateJson } from '../core/json-contract.js';

export const WEB_TOOL = 'muyu.web.search';
export const WEB_DEFAULTS = Object.freeze({ maxSearches: 3, maxResults: 5, resultBytes: 12000 });
export const WEB_RANGES = Object.freeze({ maxSearches: [1, 8], maxResults: [1, 10], resultBytes: [2000, 24000] });
export const WEB_STATUSES = ['ok', 'empty', 'disabled', 'budget_exceeded', 'unavailable', 'auth_error', 'rate_limit', 'timeout', 'network_error', 'invalid_response'];
const str = maxLength => ({ type: 'string', maxLength });
const obj = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export const webInputSchema = { type: 'object', properties: { query: { type: 'string', maxLength: 600 }, freshness: { type: 'string', enum: ['any', 'day', 'week', 'month', 'year'] } }, required: ['query'], additionalProperties: false };
export const webOutputSchema = obj({ status: { type: 'string', enum: WEB_STATUSES }, provider: { type: 'string', enum: ['brave'] }, query: str(600), fetchedAt: str(40), truncated: { type: 'boolean' }, results: { type: 'array', maxItems: 10, items: obj({ title: str(300), url: str(2000), snippet: str(1200) }) } });
export function validateWebConfig(value) {
    if (!value || Object.keys(value).length !== Object.keys(WEB_DEFAULTS).length) throw Error('WEB_CONFIG_INVALID');
    for (const [key, [min, max]] of Object.entries(WEB_RANGES)) if (!Number.isSafeInteger(value[key]) || value[key] < min || value[key] > max) throw Error('WEB_CONFIG_INVALID');
    return Object.fromEntries(Object.keys(WEB_DEFAULTS).map(key => [key, value[key]]));
}
export const webResult = (status, query = '') => ({ status, provider: 'brave', query, fetchedAt: '', truncated: false, results: [] });
export function validateWebResult(value) {
    if (!value || typeof value !== 'object') throw Error('WEB_RESULT_INVALID');
    const descriptors = Object.getOwnPropertyDescriptors(value), rows = descriptors.results;
    if (!rows || !Object.hasOwn(rows, 'value') || !rows.enumerable || !Array.isArray(rows.value) || rows.value.length > 10) throw Error('WEB_RESULT_INVALID');
    const items = Object.getOwnPropertyDescriptors(rows.value);
    if (Reflect.ownKeys(rows.value).length !== rows.value.length + 1) throw Error('WEB_RESULT_INVALID');
    // Validate the bounded transport envelope and each row before fitting the smaller tool DTO.
    descriptors.results = { ...rows, value: [] };
    const result = validateJson(webOutputSchema, Object.create(Object.getPrototypeOf(value), descriptors));
    for (let i = 0; i < rows.value.length; i++) {
        const item = items[i];
        if (!item || !item.enumerable || !Object.hasOwn(item, 'value')) throw Error('WEB_RESULT_INVALID');
        result.results.push(validateJson(webOutputSchema.properties.results.items, item.value));
    }
    for (const row of result.results) {
        let url; try { url = new URL(row.url); } catch { throw Error('WEB_RESULT_INVALID'); }
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw Error('WEB_RESULT_INVALID');
    }
    if (!['ok', 'empty'].includes(result.status) && result.results.length || result.status === 'empty' && result.results.length) throw Error('WEB_RESULT_INVALID');
    if (webBytes(result) > 131072) throw Error('WEB_RESULT_INVALID');
    return result;
}
export const webBytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
export function fitWebResult(value, limit) {
    const result = validateWebResult(value);
    while (webBytes(result) > limit && result.results.length) {
        const row = result.results.reduce((a, b) => a.snippet.length > b.snippet.length ? a : b);
        if (row.snippet.length > 80) row.snippet = row.snippet.slice(0, Math.floor(row.snippet.length / 2));
        else result.results.pop();
        result.truncated = true;
    }
    if (webBytes(result) > limit || result.status === 'ok' && !result.results.length) return webResult('budget_exceeded', result.query);
    return result;
}
