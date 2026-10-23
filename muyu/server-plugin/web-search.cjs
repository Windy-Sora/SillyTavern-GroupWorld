// Fixed-endpoint search adapter. This module never fetches a model-supplied URL.
const UPSTREAM = 'https://api.search.brave.com/res/v1/web/search';
const { diagnostics } = require('./diagnostics.cjs');
const freshness = { any: '', day: 'pd', week: 'pw', month: 'pm', year: 'py' };
const result = (status, query = '') => ({ status, provider: 'brave', query, fetchedAt: '', truncated: false, results: [] });
const text = (value, limit) => typeof value === 'string' ? value.replace(/<[^>]*>/g, '').slice(0, limit) : '';
function validate(input) {
    if (!input || typeof input !== 'object' || Object.keys(input).some(key => !['provider', 'apiKey', 'query', 'freshness', 'maxResults'].includes(key)) || input.provider !== 'brave' ||
        typeof input.apiKey !== 'string' || !input.apiKey || input.apiKey.length > 256 || /[\x00-\x20\x7f]/.test(input.apiKey) ||
        typeof input.query !== 'string' || input.query.trim().length < 2 || input.query.length > 600 || input.query.trim().split(/\s+/).length > 75 ||
        input.freshness !== undefined && !Object.hasOwn(freshness, input.freshness) || !Number.isSafeInteger(input.maxResults) || input.maxResults < 1 || input.maxResults > 10) throw Error('WEB_REQUEST_INVALID');
}
function normalize(raw, query, maxResults) {
    if (!raw || !Array.isArray(raw.web?.results)) {
        if (raw?.type === 'search' && !raw.web) return result('empty', query);
        return result('invalid_response', query);
    }
    const results = [], seen = new Set();
    for (const row of raw.web.results) {
        let url; try { url = new URL(row.url); } catch { continue; }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 2000 || seen.has(url.href)) continue;
        const title = text(row.title, 300); if (!title) continue;
        seen.add(url.href); results.push({ title, url: url.href, snippet: text(row.description, 1200) });
        if (results.length === maxResults) break;
    }
    return { ...result(results.length ? 'ok' : 'empty', query), fetchedAt: new Date().toISOString(), truncated: raw.web.results.length > results.length, results };
}
function createWebSearchService({ fetcher = globalThis.fetch, timeoutMs = 12000 } = {}) {
    const active = new Map();
    return { async search(input, { signal, account } = {}) {
        validate(input);
        if (typeof account !== 'string' || !account) throw Error('WEB_IDENTITY_UNAVAILABLE');
        if ((active.get(account) || 0) >= 2 || active.size >= 256 && !active.has(account)) return result('rate_limit', input.query);
        active.set(account, (active.get(account) || 0) + 1);
        const abort = new AbortController(), stop = () => abort.abort();
        let timedOut = false, reader, finished = false;
        const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
        signal?.addEventListener('abort', stop, { once: true }); if (signal?.aborted) stop();
        try {
            if (abort.signal.aborted) return result('network_error', input.query);
            const url = new URL(UPSTREAM); url.searchParams.set('q', input.query.trim()); url.searchParams.set('count', String(input.maxResults));
            if (freshness[input.freshness || 'any']) url.searchParams.set('freshness', freshness[input.freshness]);
            const response = await fetcher(url.href, { headers: { Accept: 'application/json', 'X-Subscription-Token': input.apiKey }, signal: abort.signal, redirect: 'error', credentials: 'omit', cache: 'no-store' });
            if (response.body) reader = response.body.getReader();
            if (!response.ok) return result([401, 403].includes(response.status) ? 'auth_error' : response.status === 429 ? 'rate_limit' : 'unavailable', input.query);
            if (!reader || !(response.headers.get('content-type') || '').toLowerCase().includes('application/json')) return result('invalid_response', input.query);
            const decoder = new TextDecoder(); let bytes = 0, body = '';
            while (true) { const part = await reader.read(); if (abort.signal.aborted) throw Error('ABORTED'); if (part.done) { finished = true; break; } bytes += part.value.byteLength; if (bytes > 1048576) return result('invalid_response', input.query); body += decoder.decode(part.value, { stream: true }); }
            let parsed; try { parsed = JSON.parse(body + decoder.decode()); } catch { return result('invalid_response', input.query); }
            return normalize(parsed, input.query, input.maxResults);
        } catch { return result(timedOut ? 'timeout' : 'network_error', input.query); }
        finally {
            clearTimeout(timer); signal?.removeEventListener('abort', stop);
            if (reader) { if (!finished) await reader.cancel().catch(() => {}); reader.releaseLock(); }
            const left = active.get(account) - 1; if (left) active.set(account, left); else active.delete(account);
        }
    } };
}
function registerWebSearch(router, service = createWebSearchService()) {
    router.get('/web/health', (_req, res) => res.json({ version: 1, provider: 'brave' }));
    router.post('/web/search', (req, res) => {
        const started = Date.now();
        const abort = new AbortController(), stop = () => { if (!res.writableEnded) abort.abort(); };
        req.on?.('aborted', stop); res.on?.('close', stop);
        void Promise.resolve().then(() => service.search(req.body, { signal: abort.signal, account: req.user?.directories?.root })).then(value => {
            const code = { auth_error: 'WEB_AUTH_ERROR', rate_limit: 'WEB_RATE_LIMIT', timeout: 'WEB_TIMEOUT', network_error: 'WEB_NETWORK_ERROR', unavailable: 'WEB_UNAVAILABLE', invalid_response: 'WEB_INVALID_RESPONSE' }[value.status];
            if (code && !abort.signal.aborted) diagnostics.record(req, { operation: 'search.request', stage: 'request', code, durationMs: Date.now() - started });
            if (!abort.signal.aborted) res.json(value);
        }, () => { diagnostics.record(req, { operation: 'search.request', stage: 'request', code: 'WEB_REQUEST_INVALID', durationMs: Date.now() - started }); if (!abort.signal.aborted) res.status(400).json({ error: 'WEB_REQUEST_INVALID' }); }).finally(() => { req.off?.('aborted', stop); res.off?.('close', stop); });
    });
}
module.exports = { createWebSearchService, registerWebSearch };
