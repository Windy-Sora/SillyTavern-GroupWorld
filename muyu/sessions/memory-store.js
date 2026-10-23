import { validateRecord, summarizeRecord, HISTORY_LIMITS } from './contract.js';

/** Same compare-and-swap contract as IndexedDB; useful for isolated tests and temporary stores. */
export function createMemoryHistoryStore() {
    const records = new Map();
    return {
        async list() { return [...records.values()].map(summarizeRecord); },
        async read(id) { return records.has(id) ? structuredClone(records.get(id)) : null; },
        async write(value, expectedRevision) {
            const record = validateRecord(value), old = records.get(record.id);
            if (!old && expectedRevision !== 0) throw Error('HISTORY_DELETED');
            if ((old?.revision ?? 0) !== expectedRevision) throw Error('HISTORY_CONFLICT');
            if (!old && records.size >= HISTORY_LIMITS.sessions) throw Error('HISTORY_CAPACITY');
            record.revision = expectedRevision + 1;
            const bytes = [...records.values()].filter(r => r.id !== record.id).reduce((n, r) => n + summarizeRecord(r).bytes, 0) + summarizeRecord(record).bytes;
            if (bytes > HISTORY_LIMITS.totalBytes) throw Error('HISTORY_CAPACITY');
            records.set(record.id, record); return structuredClone(record);
        },
        async create(value) { return this.write({ ...value, revision: 0 }, 0); },
        async update(value, revision) { if (!Number.isSafeInteger(revision) || revision < 1) throw Error('HISTORY_CONFLICT'); return this.write(value, revision); },
        async remove(id, revision) {
            const old = records.get(id); if (!old) throw Error('HISTORY_DELETED');
            if (old.revision !== revision) throw Error('HISTORY_CONFLICT');
            records.delete(id);
        },
        close() {},
    };
}
