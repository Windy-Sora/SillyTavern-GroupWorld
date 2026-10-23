import { openWorldBookHistoryStore } from '../sessions/worldbook-store.js';
import { WORLD_BOOK_HISTORY_LIMITS } from '../sessions/worldbook-contract.js';
import { volumeRepository } from '../sessions/worldbook-volume.js';

const MAX_RESPONSE_BYTES = WORLD_BOOK_HISTORY_LIMITS.bookBytes;
/** Native ST storage; opening/listing an empty archive never creates books or activates bindings. */
export function openStWorldBookHistoryStore({ namespace, assertIdentity, fetcher = globalThis.fetch, getHeaders = () => ({}),
    locks = globalThis.navigator?.locks, timeoutMs = 15000, getTargetMiB } = {}) {
    if (typeof assertIdentity !== 'function') throw Error('HISTORY_IDENTITY_UNAVAILABLE');
    if (typeof fetcher !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) throw Error('HISTORY_UNAVAILABLE');
    async function request(route, body, writing = false) {
        await assertIdentity();
        const headers = await getHeaders();
        await assertIdentity();
        const abort = new AbortController(), timer = setTimeout(() => abort.abort(), timeoutMs);
        try {
            const response = await fetcher('/api/worldinfo/' + route, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
                headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: abort.signal });
            await assertIdentity();
            if (!response.ok) throw Error(writing ? 'HISTORY_SAVE_FAILED' : 'HISTORY_UNAVAILABLE');
            const text = await response.text();
            if (new TextEncoder().encode(text).length > MAX_RESPONSE_BYTES) throw Error('HISTORY_CAPACITY');
            let data; try { data = route === 'delete' && text.trim() === 'OK' ? { ok: true } : JSON.parse(text); } catch { throw Error('HISTORY_INVALID'); }
            await assertIdentity();
            if (writing && data?.ok !== true) throw Error('HISTORY_SAVE_FAILED');
            return data;
        } catch (error) {
            if (['HISTORY_IDENTITY_UNAVAILABLE', 'HISTORY_INVALID', 'HISTORY_CAPACITY', 'HISTORY_SAVE_FAILED', 'HISTORY_UNAVAILABLE'].includes(error.message)) throw error;
            throw Error(writing ? 'HISTORY_SAVE_FAILED' : 'HISTORY_UNAVAILABLE');
        } finally { clearTimeout(timer); }
    }
    return openWorldBookHistoryStore({ namespace, repository: volumeRepository(namespace, {
        list: () => request('list', {}),
        load: name => request('get', { name }),
        save: (name, data) => request('edit', { name, data }, true),
        remove: name => request('delete', { name }, true),
    }, { getTargetMiB }), withLock: (key, run) => typeof locks?.request === 'function' ? locks.request(key, { mode: 'exclusive' }, run) : run() });
}
