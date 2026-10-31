import { sha256 } from '../runtime/crypto.js';
import { assertActive } from '../core/execution.js';
import { HISTORY_LIMITS, validateRecord, validateSummary, summarizeRecord } from '../sessions/contract.js';
import { HISTORY_SOURCES } from '../sessions/routed-store.js';
import { openIndexedHistoryReader } from '../sessions/indexeddb-reader.js';
import { openSettingsHistoryStore } from '../sessions/settings-store.js';

/** Explicit-source inspection only. Never uses the routed store, changes routing or restores a session. */
export function createArchiveInspectionPort({ getIdentity, getSettings, openBrowser = openIndexedHistoryReader, openServer, openWorldBook, fetcher, getHeaders }) {
    async function inspect(source, signal, select) {
        if (!HISTORY_SOURCES.includes(source)) throw Error('HISTORY_INVALID');
        assertActive(signal);
        const owner = getSettings(), identity = await getIdentity();
        const check = async () => { assertActive(signal); if (owner !== getSettings() || await getIdentity() !== identity || owner !== getSettings()) throw Error('HISTORY_IDENTITY_UNAVAILABLE'); assertActive(signal); };
        const digest = await sha256('gd-muyu-history-v1:' + identity);
        const hex = [...new Uint8Array(digest)].slice(0, 16).map(n => n.toString(16).padStart(2, '0')).join('');
        const namespace = hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
        await check();
        // Every network operation is a read. Defend against an accidental writer
        // call in a reused backend as well as in the model-facing module.
        const readFetch = typeof fetcher === 'function' ? async (url, options = {}) => {
            const method = options.method || 'GET';
            const allowed = typeof url === 'string' && (method === 'GET' && /^\/api\/plugins\/gd-muyu-history\/(?:health|records(?:\/[0-9a-f-]+)?(?:\?namespace=[0-9a-f-]+)?)$/i.test(url) || method === 'POST' && /^\/api\/worldinfo\/(?:list|get)$/.test(url));
            if (!allowed) throw Error('HISTORY_READ_ONLY');
            await check();
            const abort = new AbortController(), stop = () => abort.abort();
            signal?.addEventListener('abort', stop, { once: true });
            const timer = setTimeout(stop, 12000);
            try {
                const response = await fetcher(url, { ...options, signal: abort.signal }); await check();
                // Read and bound the body before clearing the deadline. Do not
                // return a body whose consumption can run beyond cancellation.
                const text = await response.text(); await check();
                if (new TextEncoder().encode(text).length > 72 * 1024 * 1024) throw Error('HISTORY_CAPACITY');
                return { ok: response.ok, status: response.status, text: async () => text, json: async () => JSON.parse(text) };
            } finally { clearTimeout(timer); signal?.removeEventListener('abort', stop); }
        } : null;
        let store;
        try {
            if (source === 'browser') store = await openBrowser({ namespace });
            else if (source === 'account-settings') store = openSettingsHistoryStore({ namespace, getSettings, saveSettings: async () => { throw Error('HISTORY_READ_ONLY'); } });
            else if (source === 'server') store = await openServer({ namespace, fetcher: readFetch, headers: getHeaders });
            else store = await openWorldBook({ namespace, fetcher: readFetch, getHeaders, assertIdentity: check });
            await check();
            if (!store) return { owner, identity, state: source === 'browser' ? 'absent' : 'unavailable', rows: [] };
            const values = await store.list(); await check();
            if (!Array.isArray(values) || values.length > HISTORY_LIMITS.sessions) throw Error('HISTORY_CAPACITY');
            const rows = values.map(validateSummary).sort((a, b) => a.id.localeCompare(b.id));
            if (new Set(rows.map(row => row.id)).size !== rows.length) throw Error('HISTORY_INVALID');
            let verified = null;
            if (select) {
                const id = select(rows);
                const raw = await store.read(id); await check();
                if (!raw) throw Error('HISTORY_CONFLICT');
                const record = validateRecord(raw), summary = summarizeRecord(record), expected = rows.find(row => row.id === id);
                if (!expected || Object.keys(summary).some(key => summary[key] !== expected[key])) throw Error('HISTORY_CONFLICT');
                verified = { messageCount: record.messages.length, hasContextSummary: record.contextSummary !== null,
                    receiptCount: record.receipts?.length || 0, protection: 'historical only; no grants, tasks or receipts restored' };
            }
            await check();
            return { owner, identity, state: 'available', rows, verified };
        } finally { store?.close(); }
    }
    return Object.freeze({ inspect });
}
