import { validateCheckpoint } from './contract.js';

/** Browser/account-local operational journal, separate from server history DTOs. */
export async function openRecoveryStore({ namespace, indexedDB = globalThis.indexedDB }) {
    if (typeof namespace !== 'string' || !namespace || !indexedDB) throw Error('RECOVERY_UNAVAILABLE');
    const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('gd-muyu-recovery-v1', 1); let abandoned = false;
        req.onupgradeneeded = () => req.result.createObjectStore('checkpoints', { keyPath: ['namespace', 'id'] }).createIndex('namespace', 'namespace');
        req.onerror = () => reject(Error('RECOVERY_UNAVAILABLE'));
        req.onblocked = () => { abandoned = true; reject(Error('RECOVERY_UNAVAILABLE')); };
        req.onsuccess = () => { if (abandoned) req.result.close(); else resolve(req.result); };
    });
    db.onversionchange = () => db.close();
    function transaction(mode, work) {
        return new Promise((resolve, reject) => {
            let result, error; const tx = db.transaction(['checkpoints'], mode);
            const fail = e => { error = e; tx.abort(); };
            tx.oncomplete = () => resolve(result);
            tx.onabort = tx.onerror = () => reject(error || Error('RECOVERY_SAVE_FAILED'));
            try { work(tx.objectStore('checkpoints'), v => { result = v; }, fail); } catch (e) { fail(e); }
        });
    }
    return {
        list: () => transaction('readonly', (table, result, fail) => {
            const req = table.index('namespace').getAll(namespace);
            req.onsuccess = () => { try { result(req.result.map(row => validateCheckpoint(row.record))); } catch (e) { fail(e); } };
        }),
        write(value, revision) {
            const record = validateCheckpoint(value);
            return transaction('readwrite', (table, result, fail) => {
                const req = table.index('namespace').getAll(namespace);
                req.onsuccess = () => {
                    try {
                        const rows = req.result.map(row => validateCheckpoint(row.record)), old = rows.find(row => row.id === record.id);
                        if ((old?.revision || 0) !== revision || (!old && revision !== 0)) throw Error('RECOVERY_CONFLICT');
                        if (!old && rows.length >= 64) throw Error('RECOVERY_CAPACITY');
                        record.revision = revision + 1;
                        if (new TextEncoder().encode(JSON.stringify([...rows.filter(row => row.id !== record.id), record])).length > 2097152) throw Error('RECOVERY_CAPACITY');
                        table.put({ namespace, id: record.id, record }); result(record);
                    } catch (e) { fail(e); }
                };
            });
        },
        remove(id, revision) { return transaction('readwrite', (table, result, fail) => {
            const req = table.get([namespace, id]);
            req.onsuccess = () => { if (!req.result || req.result.record.revision !== revision) { fail(Error('RECOVERY_CONFLICT')); return; } table.delete([namespace, id]); result(true); };
        }); },
        close: () => db.close(),
    };
}
