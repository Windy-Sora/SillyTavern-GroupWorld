import { validateRecord, summarizeRecord, historyBytes, validHistoryId, HISTORY_LIMITS } from './contract.js';
import { serializeSettings, waitSettingsWrites } from '../storage/settings-queue.js';

// Settings are saved as one document. These smaller limits protect the host settings file.
export const SETTINGS_HISTORY_LIMITS = Object.freeze({ recordBytes: 8 * 1024 * 1024, totalBytes: 32 * 1024 * 1024 });

/** Optional account settings backend, not chat metadata or a filesystem writer. */
export function openSettingsHistoryStore({ namespace, getSettings, saveSettings }) {
    if (!validHistoryId(namespace)) throw Error('HISTORY_INVALID');
    const owner = getSettings(); let closed = false;
    function live() {
        if (closed) throw Error('HISTORY_UNAVAILABLE');
        if (getSettings() !== owner) throw Error('HISTORY_IDENTITY_UNAVAILABLE');
    }
    function readData() {
        live();
        const data = owner.muyuHistoryData;
        if (data == null) return { version: 1, namespace, records: [] };
        if (data.version !== 1) throw Error('HISTORY_VERSION');
        if (Object.keys(data).sort().join(',') !== 'namespace,records,version' || data.namespace !== namespace || !Array.isArray(data.records)) throw Error('HISTORY_INVALID');
        if (data.records.length > HISTORY_LIMITS.sessions || historyBytes(data) > SETTINGS_HISTORY_LIMITS.totalBytes) throw Error('HISTORY_CAPACITY');
        const records = data.records.map(validateRecord);
        if (new Set(records.map(r => r.id)).size !== records.length) throw Error('HISTORY_INVALID');
        if (records.some(r => historyBytes(r) > SETTINGS_HISTORY_LIMITS.recordBytes)) throw Error('HISTORY_CAPACITY');
        return { version: 1, namespace, records };
    }
    function mutate(work) {
        live();
        return serializeSettings(owner, async () => {
            const data = readData(), result = work(data);
            if (data.records.length > HISTORY_LIMITS.sessions || historyBytes(data) > SETTINGS_HISTORY_LIMITS.totalBytes) throw Error('HISTORY_CAPACITY');
            const previous = owner.muyuHistoryData;
            owner.muyuHistoryData = data;
            try {
                await saveSettings(); live();
                if (owner.muyuHistoryData !== data) throw Error('HISTORY_CONFLICT');
                return result;
            } catch (error) {
                // Never overwrite a concurrent replacement. The host save outcome may be unknown.
                if (owner.muyuHistoryData === data) {
                    if (previous === undefined) delete owner.muyuHistoryData;
                    else owner.muyuHistoryData = previous;
                }
                throw Error(['HISTORY_CONFLICT', 'HISTORY_IDENTITY_UNAVAILABLE'].includes(error.message) ? error.message : 'HISTORY_SAVE_FAILED');
            }
        });
    }
    async function settledData() {
        await waitSettingsWrites(owner);
        return readData();
    }
    return {
        kind: 'account-settings',
        assertCapacity(record, reserve, working = []) {
            const data = readData(), sizes = new Map(data.records.map(row => [row.id, historyBytes(row)]));
            for (const row of working) sizes.set(row.id, Math.max(sizes.get(row.id) || 0, historyBytes(row)));
            const projected = Math.max(sizes.get(record.id) || 0, historyBytes(record)) + reserve;
            if (projected > SETTINGS_HISTORY_LIMITS.recordBytes) throw Error('HISTORY_CAPACITY');
            sizes.set(record.id, projected);
            const envelope = historyBytes({ version: 1, namespace, records: [] });
            if (sizes.size > HISTORY_LIMITS.sessions || envelope + Math.max(0, sizes.size - 1) + [...sizes.values()].reduce((sum, size) => sum + size, 0) > SETTINGS_HISTORY_LIMITS.totalBytes) throw Error('HISTORY_CAPACITY');
        },
        async list() { return (await settledData()).records.map(summarizeRecord); },
        async read(id) { return (await settledData()).records.find(r => r.id === id) || null; },
        write(value, expectedRevision) {
            const record = validateRecord(value);
            if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw Error('HISTORY_INVALID');
            if (historyBytes(record) > SETTINGS_HISTORY_LIMITS.recordBytes) throw Error('HISTORY_CAPACITY');
            return mutate(data => {
                const index = data.records.findIndex(r => r.id === record.id), old = data.records[index];
                if (!old && expectedRevision !== 0) throw Error('HISTORY_DELETED');
                if ((old?.revision ?? 0) !== expectedRevision) throw Error('HISTORY_CONFLICT');
                const next = { ...record, revision: expectedRevision + 1 };
                if (historyBytes(next) > SETTINGS_HISTORY_LIMITS.recordBytes) throw Error('HISTORY_CAPACITY');
                if (old) data.records[index] = next; else data.records.push(next);
                return structuredClone(next);
            });
        },
        async create(value) { return this.write({ ...value, revision: 0 }, 0); },
        async update(value, revision) { if (!Number.isSafeInteger(revision) || revision < 1) throw Error('HISTORY_CONFLICT'); return this.write(value, revision); },
        remove(id, revision) {
            return mutate(data => {
                const index = data.records.findIndex(r => r.id === id);
                if (index < 0) throw Error('HISTORY_DELETED');
                if (data.records[index].revision !== revision) throw Error('HISTORY_CONFLICT');
                data.records.splice(index, 1);
            });
        },
        close() { closed = true; },
    };
}
