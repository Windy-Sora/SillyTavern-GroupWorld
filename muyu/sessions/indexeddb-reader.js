import { validHistoryId, validateRecord, validateSummary } from './contract.js';

/** Existing database only. Aborting a creation transaction leaves no empty DB behind. */
export async function openIndexedHistoryReader({ namespace, indexedDB = globalThis.indexedDB }) {
    if (!validHistoryId(namespace) || !indexedDB) throw Error('HISTORY_UNAVAILABLE');
    const db = await new Promise((resolve, reject) => {
        let request, missing = false, abandoned = false;
        try { request = indexedDB.open('gd-muyu-history-v1'); } catch { reject(Error('HISTORY_UNAVAILABLE')); return; }
        request.onupgradeneeded = () => { missing = true; request.transaction.abort(); };
        request.onerror = () => missing ? resolve(null) : reject(Error('HISTORY_UNAVAILABLE'));
        request.onblocked = () => { abandoned = true; reject(Error('HISTORY_UNAVAILABLE')); };
        request.onsuccess = () => {
            const result = request.result;
            if (missing || abandoned) { result.close(); if (missing) resolve(null); return; }
            if (!['summaries', 'records'].every(name => result.objectStoreNames.contains(name))) { result.close(); reject(Error('HISTORY_VERSION')); return; }
            resolve(result);
        };
    });
    if (!db) return null;
    let closed = false;
    db.onversionchange = () => { closed = true; db.close(); };
    function read(store, work, validate) {
        if (closed) return Promise.reject(Error('HISTORY_UNAVAILABLE'));
        return new Promise((resolve, reject) => {
            let value, error, tx;
            try {
                tx = db.transaction([store], 'readonly');
                const request = work(tx.objectStore(store));
                request.onsuccess = () => { try { value = validate(request.result); } catch (cause) { error = cause; tx.abort(); } };
                tx.oncomplete = () => closed ? reject(Error('HISTORY_UNAVAILABLE')) : resolve(value);
                tx.onerror = tx.onabort = () => reject(error || Error('HISTORY_UNAVAILABLE'));
            } catch { reject(Error('HISTORY_UNAVAILABLE')); }
        });
    }
    return Object.freeze({ kind: 'browser',
        list: () => read('summaries', store => store.index('namespace').getAll(namespace), rows => rows.map(({ namespace: _ignored, ...row }) => validateSummary(row))),
        read: id => read('records', store => store.get([namespace, id]), row => row ? validateRecord(row.record) : null),
        close() { closed = true; db.close(); },
    });
}
