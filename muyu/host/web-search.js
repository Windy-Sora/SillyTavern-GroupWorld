import { WEB_DEFAULTS, validateWebConfig, validateWebResult, webResult } from '../web/contract.js';

const CREDENTIAL_ID = 'muyu-web-search';
const BASE = '/api/plugins/gd-muyu-history/web';
/** ST-only transport. Credentials are captured privately, never projected to the model or GUI snapshot. */
export function createWebSearchPort({ getSettings, saveSettings, fetcher = globalThis.fetch, getHeaders = () => ({}) }) {
    let sessionKey = '', backend = 'unknown';
    const pending = new Set();
    const key = () => { const value = sessionKey || getSettings().agentConfigs?.[CREDENTIAL_ID]?.apiKey; return typeof value === 'string' && value.length <= 256 && !/[\x00-\x20\x7f]/.test(value) ? value : ''; };
    const config = () => { try { return validateWebConfig(getSettings().muyuWebSearchConfig); } catch { return { ...WEB_DEFAULTS }; } };
    async function request(route, body, signal) {
        const abort = new AbortController(), stop = () => abort.abort();
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; stop(); }, 14000); pending.add(abort);
        signal?.addEventListener('abort', stop, { once: true }); if (signal?.aborted) stop();
        let reader, finished = false;
        try {
            if (abort.signal.aborted) throw Error('WEB_REQUEST_ABORTED');
            const response = await fetcher(BASE + route, { method: body ? 'POST' : 'GET', headers: { ...getHeaders(), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: abort.signal, credentials: 'same-origin', redirect: 'error', cache: 'no-store' });
            if (response.status === 404) throw Error('WEB_BACKEND_MISSING');
            if (!response.ok) throw Error('WEB_BACKEND_UNAVAILABLE');
            if (!(response.headers.get('content-type') || '').includes('application/json') || !response.body) throw Error('WEB_RESULT_INVALID');
            reader = response.body.getReader(); const decoder = new TextDecoder(); let bytes = 0, text = '';
            while (true) { const part = await reader.read(); if (abort.signal.aborted) throw Error('WEB_REQUEST_ABORTED'); if (part.done) { finished = true; break; } bytes += part.value.byteLength; if (bytes > 131072) throw Error('WEB_RESULT_INVALID'); text += decoder.decode(part.value, { stream: true }); }
            try { return JSON.parse(text + decoder.decode()); } catch { throw Error('WEB_RESULT_INVALID'); }
        } catch (error) {
            if (timedOut) throw Error('WEB_TIMEOUT');
            throw error;
        } finally {
            clearTimeout(timer); signal?.removeEventListener('abort', stop); pending.delete(abort);
            if (reader) { if (!finished) await reader.cancel().catch(() => {}); reader.releaseLock(); }
        }
    }
    async function checkInstallation() {
        try { const health = await request('/health'); if (health?.version !== 1 || health?.provider !== 'brave') throw Error('WEB_BACKEND_INCOMPATIBLE'); backend = 'available'; }
        catch (error) { backend = error.message === 'WEB_BACKEND_MISSING' ? 'missing' : error.message === 'WEB_BACKEND_INCOMPATIBLE' ? 'incompatible' : 'unavailable'; throw error; }
    }
    return {
        describe() { return { ...config(), provider: 'brave', hasKey: !!key(), remembered: !!getSettings().agentConfigs?.[CREDENTIAL_ID]?.apiKey, backend }; },
        checkInstallation,
        async check() {
            await checkInstallation();
            if (!key()) throw Error('WEB_KEY_REQUIRED');
        },
        async saveLimits(value) {
            const next = validateWebConfig(value), settings = getSettings(), previous = settings.muyuWebSearchConfig;
            settings.muyuWebSearchConfig = next;
            try { await saveSettings(); }
            catch { if (settings.muyuWebSearchConfig === next) { if (previous === undefined) delete settings.muyuWebSearchConfig; else settings.muyuWebSearchConfig = previous; } throw Error('WEB_CONFIG_SAVE_FAILED'); }
        },
        async save(value) {
            const next = validateWebConfig(value.config);
            if (typeof value.apiKey !== 'string' || value.apiKey.length > 256 || /[\x00-\x20\x7f]/.test(value.apiKey) || typeof value.rememberKey !== 'boolean') throw Error('WEB_CONFIG_INVALID');
            const settings = getSettings(), previous = settings.muyuWebSearchConfig, oldCredential = settings.agentConfigs?.[CREDENTIAL_ID], resolved = value.apiKey || key();
            const credential = value.rememberKey && resolved ? { provider: 'brave', apiKey: resolved } : undefined;
            settings.muyuWebSearchConfig = next; settings.agentConfigs ||= {};
            if (credential) settings.agentConfigs[CREDENTIAL_ID] = credential; else delete settings.agentConfigs[CREDENTIAL_ID];
            try { await saveSettings(); }
            catch { if (settings.muyuWebSearchConfig === next) { if (previous === undefined) delete settings.muyuWebSearchConfig; else settings.muyuWebSearchConfig = previous; } if (settings.agentConfigs[CREDENTIAL_ID] === credential) { if (oldCredential) settings.agentConfigs[CREDENTIAL_ID] = oldCredential; else delete settings.agentConfigs[CREDENTIAL_ID]; } throw Error('WEB_CONFIG_SAVE_FAILED'); }
            sessionKey = resolved;
        },
        async forgetKey() {
            const settings = getSettings(), previous = settings.agentConfigs?.[CREDENTIAL_ID];
            if (previous) { delete settings.agentConfigs[CREDENTIAL_ID]; try { await saveSettings(); } catch { if (!settings.agentConfigs[CREDENTIAL_ID]) settings.agentConfigs[CREDENTIAL_ID] = previous; throw Error('WEB_CONFIG_SAVE_FAILED'); } }
            sessionKey = '';
        },
        capture() {
            const apiKey = key(), limits = config();
            if (!apiKey) throw Error('WEB_KEY_REQUIRED');
            return { limits, async search(args, signal) {
                try {
                    const raw = await request('/search', { ...args, provider: 'brave', apiKey, maxResults: limits.maxResults }, signal);
                    let result; try { result = validateWebResult(raw); } catch { throw Error('WEB_RESULT_INVALID'); }
                    if (result.query !== args.query) throw Error('WEB_RESULT_INVALID'); return result;
                } catch (error) { if (signal?.aborted) throw error; return webResult(error.message === 'WEB_BACKEND_MISSING' ? 'unavailable' : error.message === 'WEB_TIMEOUT' ? 'timeout' : error.message === 'WEB_RESULT_INVALID' ? 'invalid_response' : 'network_error', args.query); }
            } };
        },
        cancel() { for (const abort of pending) abort.abort(); },
    };
}
