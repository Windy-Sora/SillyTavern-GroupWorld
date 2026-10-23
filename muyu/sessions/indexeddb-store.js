import { validateRecord, summarizeRecord, validateSummary, HISTORY_LIMITS, validHistoryId } from './contract.js';

/** Metadata and body updates commit atomically. No network, new dependency or ST core changes. */
export async function openIndexedHistoryStore({ namespace, indexedDB = globalThis.indexedDB }) {
    if (!validHistoryId(namespace) || !indexedDB) throw Error('HISTORY_UNAVAILABLE');
    const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('gd-muyu-history-v1', 3); let abandoned = false;
        request.onupgradeneeded = event => {
            if ((event?.oldVersion || 0) >= 1) return;
            for (const name of ['summaries', 'records']) request.result.createObjectStore(name, { keyPath: ['namespace', 'id'] }).createIndex('namespace', 'namespace');
        };
        request.onerror = () => reject(Error('HISTORY_UNAVAILABLE'));
        request.onblocked = () => { abandoned = true; reject(Error('HISTORY_UNAVAILABLE')); };
        request.onsuccess = () => { if (abandoned) request.result.close(); else resolve(request.result); };
    });
    db.onversionchange = () => db.close();
    function transaction(mode, work) {
        return new Promise((resolve, reject) => {
            let result, error;
            const tx = db.transaction(['summaries', 'records'], mode);
            const fail = e => { error = e; tx.abort(); };
            tx.oncomplete = () => resolve(result);
            tx.onabort = tx.onerror = () => reject(error || Error('HISTORY_SAVE_FAILED'));
            try { work(tx, value => { result = value; }, fail); } catch (e) { fail(e); }
        });
    }
    return {
        kind: 'browser',
        list: () => transaction('readonly', (tx, result) => {
            const req = tx.objectStore('summaries').index('namespace').getAll(namespace);
            req.onsuccess = () => result(req.result.map(({ namespace: ignored, ...summary }) => summary));
        }),
        read: id => transaction('readonly', (tx, result, fail) => {
            const req = tx.objectStore('records').get([namespace, id]);
            req.onsuccess = () => { try { result(req.result ? validateRecord(req.result.record) : null); } catch (e) { fail(e); } };
        }),
        write: (value, expectedRevision) => {
            const record = validateRecord(value);
            return transaction('readwrite', (tx, result, fail) => {
                const summaries = tx.objectStore('summaries'), req = summaries.index('namespace').getAll(namespace);
                req.onsuccess = () => {
                    try {
                        const rows = req.result.map(({ namespace: ignored, ...summary }) => validateSummary(summary));
                        const old = rows.find(r => r.id === record.id);
                        if (!old && expectedRevision !== 0) throw Error('HISTORY_DELETED');
                        if ((old?.revision ?? 0) !== expectedRevision) throw Error('HISTORY_CONFLICT');
                        if (!old && rows.length >= HISTORY_LIMITS.sessions) throw Error('HISTORY_CAPACITY');
                        record.revision = expectedRevision + 1;
                        const summary = summarizeRecord(record);
                        if (rows.filter(r => r.id !== record.id).reduce((n, r) => n + r.bytes, 0) + summary.bytes > HISTORY_LIMITS.totalBytes) throw Error('HISTORY_CAPACITY');
                        tx.objectStore('records').put({ namespace, id: record.id, record });
                        summaries.put({ namespace, ...summary }); result(record);
                    } catch (e) { fail(e); }
                };
            });
        },
        async create(value) { return this.write({ ...value, revision: 0 }, 0); },
        async update(value, revision) { if (!Number.isSafeInteger(revision) || revision < 1) throw Error('HISTORY_CONFLICT'); return this.write(value, revision); },
        remove: (id, revision) => transaction('readwrite', (tx, result, fail) => {
            const summaries = tx.objectStore('summaries'), req = summaries.get([namespace, id]);
            req.onsuccess = () => {
                try {
                    if (!req.result) throw Error('HISTORY_DELETED');
                    const { namespace: ignored, ...summary } = req.result;
                    if (validateSummary(summary).revision !== revision) throw Error('HISTORY_CONFLICT');
                    summaries.delete([namespace, id]); tx.objectStore('records').delete([namespace, id]); result(true);
                } catch (e) { fail(e); }
            };
        }),
        close: () => db.close(),
    };
}
