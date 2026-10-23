import { validateRecord, summarizeRecord, validHistoryId, historyBytes, HISTORY_LIMITS } from './contract.js';
import { WORLD_BOOK_HISTORY_PREFIX, WORLD_BOOK_HISTORY_KEY, WORLD_BOOK_HISTORY_LIMITS, historyBookName, historyBookHeader, encodeHistoryBook, decodeHistoryBook } from './worldbook-contract.js';

// One page can have multiple stores/controllers. This queue does not lock other devices.
const queues = new Map();
function serialized(namespace, work) {
    const next = (queues.get(namespace) || Promise.resolve()).then(work);
    const tail = next.then(() => {}, () => {});
    queues.set(namespace, tail);
    void tail.then(() => { if (queues.get(namespace) === tail) queues.delete(namespace); });
    return next;
}

/** A repository supplies fresh authenticated ST reads/writes, never cached host objects. */
export function openWorldBookHistoryStore({ namespace, repository, withLock = (_key, run) => run() }) {
    if (!validHistoryId(namespace)) throw Error('HISTORY_INVALID');
    namespace = namespace.toLowerCase();
    if (!repository || ['list', 'load', 'save'].some(method => typeof repository[method] !== 'function') || typeof withLock !== 'function') throw Error('HISTORY_UNAVAILABLE');
    let closed = false, known = null;
    const live = () => { if (closed) throw Error('HISTORY_UNAVAILABLE'); };
    const queue = work => serialized(namespace, () => { live(); return work(); });
    const mutate = work => queue(() => withLock(`gd-muyu-history-worldbook:${namespace}`, async () => { live(); return work(); }));
    async function inventory() {
        live(); const items = await repository.list(); live();
        if (!Array.isArray(items)) throw Error('HISTORY_INVALID');
        const prefix = WORLD_BOOK_HISTORY_PREFIX + namespace + '-', found = new Map();
        for (const item of items) {
            const name = item?.file_id;
            if (typeof name !== 'string' || !name.startsWith(prefix)) continue;
            const header = historyBookHeader(name, item.extensions?.[WORLD_BOOK_HISTORY_KEY], namespace);
            if (found.has(name)) throw Error('HISTORY_INVALID');
            found.set(name, header);
        }
        known = found;
        return found;
    }
    async function load(id, books = null) {
        const name = historyBookName(namespace, id), directory = books || await inventory();
        const data = await repository.load(name); live();
        if (!directory.has(name)) {
            // ST /get represents a missing book as this exact dummy. Its directory
            // can omit unreadable files; never interpret a listing alone as absence.
            if (data && Object.keys(data).length === 1 && data.entries && typeof data.entries === 'object' &&
                !Array.isArray(data.entries) && Object.keys(data.entries).length === 0) return null;
            throw Error('HISTORY_CONFLICT');
        }
        const decoded = await decodeHistoryBook(name, data, namespace); live();
        if (decoded.header.commitId !== directory.get(name).commitId) throw Error('HISTORY_CONFLICT');
        return decoded;
    }
    function capacity(record, books) {
        const active = [...books.values()].filter(row => !row.deleted && row.id !== record.id);
        if (active.length >= HISTORY_LIMITS.sessions || historyBytes(record) > WORLD_BOOK_HISTORY_LIMITS.recordBytes ||
            active.reduce((sum, row) => sum + row.payloadBytes, 0) + historyBytes(record) > WORLD_BOOK_HISTORY_LIMITS.totalBytes) throw Error('HISTORY_CAPACITY');
    }
    async function commit(encoded) {
        live();
        // No fallback or compensating overwrite after an ambiguous HTTP result.
        await repository.save(encoded.name, encoded.data); live();
        const observed = await repository.load(encoded.name); live();
        const verified = await decodeHistoryBook(encoded.name, observed, namespace); live();
        if (JSON.stringify(observed) !== JSON.stringify(encoded.data)) throw Error('HISTORY_CONFLICT');
        known?.set(encoded.name, verified.header);
        return verified.record;
    }
    return {
        kind: 'world-book',
        ...(typeof repository.mergeLegacyHistory === 'function' ? { mergeLegacyHistory(cleanup = false) {
            if (typeof cleanup !== 'boolean') return Promise.reject(Error('HISTORY_INVALID'));
            return mutate(async () => {
                const report = await repository.mergeLegacyHistory({ cleanup, check: live }); live();
                try { await inventory(); } catch (error) { report.error ||= error.message; }
                return report;
            });
        } } : {}),
        assertCapacity(record, reserve, working = []) {
            live(); if (!known) throw Error('HISTORY_UNAVAILABLE');
            if (!Number.isSafeInteger(reserve) || reserve < 0) throw Error('HISTORY_INVALID');
            const sizes = new Map([...known.values()].filter(row => !row.deleted).map(row => [row.id, row.payloadBytes]));
            for (const row of working) sizes.set(row.id, Math.max(sizes.get(row.id) || 0, historyBytes(row)));
            const projected = Math.max(sizes.get(record.id) || 0, historyBytes(record)) + reserve;
            sizes.set(record.id, projected);
            if (sizes.size > HISTORY_LIMITS.sessions || projected > WORLD_BOOK_HISTORY_LIMITS.recordBytes ||
                [...sizes.values()].reduce((sum, bytes) => sum + bytes, 0) > WORLD_BOOK_HISTORY_LIMITS.totalBytes) throw Error('HISTORY_CAPACITY');
        },
        list: () => queue(async () => [...(await inventory()).values()].filter(row => !row.deleted).map(row => structuredClone(row.summary))),
        read: id => queue(async () => (await load(id))?.record ?? null),
        write(value, expectedRevision) {
            const record = validateRecord(value);
            if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER) return Promise.reject(Error('HISTORY_INVALID'));
            return mutate(async () => {
                const books = await inventory(), old = await load(record.id, books);
                if (old?.header.deleted || !old && expectedRevision !== 0) throw Error('HISTORY_DELETED');
                const next = validateRecord({ ...record, revision: expectedRevision + 1 });
                // Retrying an unconfirmed save may find precisely this operation already durable.
                if (old?.header.revision === next.revision && JSON.stringify(old.record) === JSON.stringify(next)) return old.record;
                if ((old?.header.revision ?? 0) !== expectedRevision) throw Error('HISTORY_CONFLICT');
                capacity(next, books);
                const encoded = await encodeHistoryBook({ namespace, record: next, revision: next.revision }); live();
                // Narrow the race after hashing large payloads; ST has no server-side CAS.
                const current = await load(record.id);
                if ((current?.header.commitId ?? null) !== (old?.header.commitId ?? null)) throw Error('HISTORY_CONFLICT');
                return commit(encoded);
            });
        },
        async create(value) { return this.write({ ...value, revision: 0 }, 0); },
        async update(value, revision) { if (!Number.isSafeInteger(revision) || revision < 1) throw Error('HISTORY_CONFLICT'); return this.write(value, revision); },
        remove(id, revision) {
            if (!Number.isSafeInteger(revision) || revision < 1 || revision >= Number.MAX_SAFE_INTEGER) return Promise.reject(Error('HISTORY_CONFLICT'));
            return mutate(async () => {
                const old = await load(id);
                if (!old || old.header.deleted) throw Error('HISTORY_DELETED');
                if (old.header.revision !== revision) throw Error('HISTORY_CONFLICT');
                const encoded = await encodeHistoryBook({ namespace, recordId: old.header.id, revision: revision + 1, deleted: true }); live();
                const current = await load(id);
                if (current?.header.commitId !== old.header.commitId) throw Error('HISTORY_CONFLICT');
                await commit(encoded);
            });
        },
        close() { closed = true; },
    };
}
