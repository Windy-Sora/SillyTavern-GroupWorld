import { validateRecord, validateSummary } from './contract.js';

/** Private ST server-plugin store. A missing plugin returns null so browser history remains usable. */
export async function openServerHistoryStore({ namespace, fetcher = globalThis.fetch, headers = () => ({}) } = {}) {
    if (typeof fetcher !== 'function') return null;
    const base = '/api/plugins/gd-muyu-history';
    async function request(method, route, body) {
        let response;
        try { response = await fetcher(`${base}${route}`, { method, headers: { ...headers(), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
        catch { throw Error('HISTORY_UNAVAILABLE'); }
        if (route === '/health' && response.status === 404) return null;
        let value; try { value = await response.json(); } catch { throw Error('HISTORY_UNAVAILABLE'); }
        if (!response.ok) throw Error(['HISTORY_CONFLICT', 'HISTORY_DELETED', 'HISTORY_CAPACITY', 'HISTORY_INVALID', 'HISTORY_IDENTITY_UNAVAILABLE'].includes(value?.error) ? value.error : 'HISTORY_UNAVAILABLE');
        return value;
    }
    const health = await request('GET', '/health');
    if (!health) return null;
    if (health.version !== 1) throw Error('HISTORY_UNAVAILABLE');
    const query = `?namespace=${encodeURIComponent(namespace)}`;
    const item = id => `/records/${encodeURIComponent(id)}${query}`;
    return {
        kind: 'private-files',
        async list() { const rows = await request('GET', `/records${query}`); if (!Array.isArray(rows)) throw Error('HISTORY_INVALID'); return rows.map(validateSummary); },
        async read(id) { const row = await request('GET', item(id)); return row == null ? null : validateRecord(row); },
        async write(record, expectedRevision) { return validateRecord(await request('PUT', item(record.id), { record: validateRecord(record), expectedRevision })); },
        create(record) { return this.write(record, 0); },
        update(record, revision) { return this.write(record, revision); },
        remove(id, revision) { return request('DELETE', item(id), { revision }); },
        close() {},
    };
}
