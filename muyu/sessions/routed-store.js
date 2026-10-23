import { validateRecord } from './contract.js';
import { sha256 } from '../runtime/crypto.js';
import { historyCopyError, copyHistory } from './copy-history.js';

export const HISTORY_SOURCES = Object.freeze(['browser', 'account-settings', 'world-book', 'server']);
export function historyTargets(value) {
    if (!Array.isArray(value) || value.length > HISTORY_SOURCES.length || new Set(value).size !== value.length || value.some(key => !HISTORY_SOURCES.includes(key))) throw Error('HISTORY_INVALID');
    return HISTORY_SOURCES.filter(key => value.includes(key));
}
function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    return value;
}
async function fingerprint(value) {
    const bytes = await sha256(JSON.stringify(canonical({ ...validateRecord(value), revision: 0 })));
    return [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, '0')).join('');
}

/** One explicit reader, independent optional writers. Never returns a fictitious shared revision. */
export async function openRoutedHistoryStore({ source, namespace, open, getTargets, check }) {
    if (!HISTORY_SOURCES.includes(source)) throw Error('HISTORY_INVALID');
    let closed = false, tail = Promise.resolve();
    const stores = new Map(), baselines = new Map(), confirmed = new Map(), observations = new Map();
    async function live() { if (closed) throw Error('HISTORY_UNAVAILABLE'); await check(); if (closed) throw Error('HISTORY_UNAVAILABLE'); }
    async function backend(key) {
        await live();
        if (!stores.has(key)) stores.set(key, Promise.resolve().then(() => open(key)).then(async store => {
            if (!store) throw Error('HISTORY_UNAVAILABLE');
            try { await live(); return store; } catch (error) { store.close(); throw error; }
        }).catch(error => { stores.delete(key); throw error; }));
        return stores.get(key);
    }
    const reader = await backend(source);
    const targets = () => historyTargets(getTargets());
    const writable = () => { if (!targets().includes(source)) throw Error('HISTORY_WRITE_DISABLED'); };
    async function readFrom(key, id) {
        const store = await backend(key), value = await store.read(id); await live();
        return value == null ? null : validateRecord(value);
    }
    async function read(id) {
        const value = await readFrom(source, id);
        if (value) {
            const observation = { revision: value.revision, hash: await fingerprint(value) }; observations.set(id, observation);
            if (!baselines.has(id)) { baselines.set(id, observation.hash); known(source).set(id, observation); }
        }
        await live(); return value;
    }
    function known(key) { if (!confirmed.has(key)) confirmed.set(key, new Map()); return confirmed.get(key); }
    async function saveOne(key, record, desired) {
        try {
            const store = await backend(key), current = await readFrom(key, record.id);
            const hash = current && await fingerprint(current), prior = known(key).get(record.id);
            await live();
            if (hash === desired) {
                known(key).set(record.id, { revision: current.revision, hash });
                return { source: key, state: 'saved', unchanged: true, record: current };
            }
            if (current ? prior ? current.revision !== prior.revision || hash !== prior.hash : hash !== baselines.get(record.id) : !!prior || key === source && baselines.has(record.id)) throw Error(current ? 'HISTORY_CONFLICT' : 'HISTORY_DELETED');
            const saved = validateRecord(await (current ? store.update(record, current.revision) : store.create({ ...record, revision: 0 })));
            await live();
            if (saved.id !== record.id || await fingerprint(saved) !== desired) throw Error('HISTORY_SAVE_FAILED');
            known(key).set(record.id, { revision: saved.revision, hash: desired });
            return { source: key, state: 'saved', record: saved };
        } catch (error) {
            return { source: key, state: 'failed', error: ['HISTORY_CONFLICT', 'HISTORY_DELETED'].includes(error.message) ? error.message : historyCopyError(error) };
        }
    }
    function serialized(work) { const result = tail.then(work); tail = result.catch(() => {}); return result; }
    async function direct(value, revision) {
        writable(); await live();
        const record = validateRecord(await reader.write(value, revision)); await live();
        const hash = await fingerprint(record); await live(); baselines.set(record.id, hash); known(source).set(record.id, { revision: record.revision, hash });
        return record;
    }
    return {
        kind: reader.kind || (source === 'server' ? 'private-files' : source), readSource: source,
        sourceKey: JSON.stringify([namespace, reader.kind || (source === 'server' ? 'private-files' : source)]),
        writeTargets: targets, canManage: () => targets().includes(source),
        ...(reader.assertCapacity ? { assertCapacity(...args) { if (targets().length === 1 && targets()[0] === source) reader.assertCapacity(...args); } } : {}),
        async list() { await live(); const rows = await reader.list(); await live(); return rows; }, read,
        acceptRead(id, value) {
            if (!value) { baselines.delete(id); known(source).delete(id); observations.delete(id); return; }
            const observation = observations.get(id);
            if (!observation || observation.revision !== value.revision) throw Error('HISTORY_CONFLICT');
            baselines.set(id, observation.hash); known(source).set(id, observation);
        },
        async confirmRead(value) {
            const current = await readFrom(source, value.id);
            const equal = current && await fingerprint(current) === await fingerprint(value); await live();
            if (!equal) return null;
            const hash = await fingerprint(current); await live(); baselines.set(current.id, hash); known(source).set(current.id, { revision: current.revision, hash });
            return current;
        },
        saveRecord(value) {
            const record = validateRecord(value);
            return serialized(async () => {
                await live(); const requested = targets(), desired = await fingerprint(record);
                const outcomes = await Promise.all(requested.map(key => saveOne(key, record, desired)));
                const readRecord = outcomes.find(row => row.source === source && row.state === 'saved')?.record || null;
                if (readRecord) baselines.set(record.id, desired);
                return { complete: requested.length > 0 && outcomes.every(row => row.state === 'saved'), anySaved: outcomes.some(row => row.state === 'saved'),
                    readSaved: !!readRecord, readRecord, targets: HISTORY_SOURCES.map(key => {
                        const outcome = outcomes.find(row => row.source === key);
                        return outcome ? { source: key, state: outcome.state, ...(outcome.error ? { error: outcome.error } : {}) } : { source: key, state: 'disabled' };
                    }) };
            });
        },
        write: (value, revision) => serialized(() => direct(value, revision)),
        create(value) { return this.write({ ...value, revision: 0 }, 0); },
        update(value, revision) { if (!Number.isSafeInteger(revision) || revision < 1) return Promise.reject(Error('HISTORY_CONFLICT')); return this.write(value, revision); },
        remove(id, revision) { return serialized(async () => { writable(); await live(); await reader.remove(id, revision); await live(); baselines.delete(id); known(source).delete(id); }); },
        ...(source === 'world-book' ? { copyHistoryFrom(key) { return serialized(async () => {
            writable(); if (!HISTORY_SOURCES.includes(key) || key === source) throw Error('HISTORY_INVALID');
            let old;
            try { await live(); old = await open(key); if (!old) throw Error('HISTORY_UNAVAILABLE'); return await copyHistory({ source: old, target: reader, check: live }); }
            finally { old?.close(); }
        }); } } : {}),
        ...(source === 'world-book' && typeof reader.mergeLegacyHistory === 'function' ? { mergeLegacyHistory(cleanup = false) {
            return serialized(async () => { writable(); await live(); const report = await reader.mergeLegacyHistory(cleanup); await live(); return report; });
        } } : {}),
        close() { closed = true; for (const promise of stores.values()) void promise.then(store => store.close(), () => {}); },
    };
}
