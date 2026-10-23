/** Narrow asynchronous IDB test double: serialized transactions, atomic commit/abort.
 * Not a browser compatibility or quota implementation. */
export function historyIDB() {
    const tables = new Map(); let version = 0, active = false; const queue = [];
    let failPut = null;
    function pump() { if (!active && queue.length) { active = true; queue.shift()(); } }
    const database = {
        createObjectStore(name) { tables.set(name, new Map()); return { createIndex() {} }; },
        close() {},
        transaction(names, mode) {
            const operations = []; let copies, finished = false, started = false, scheduled = false;
            const finish = abort => {
                if (finished) return; finished = true;
                if (!abort && mode === 'readwrite') for (const name of names) tables.set(name, copies.get(name));
                active = false; (abort ? tx.onabort : tx.oncomplete)?.(); pump();
            };
            function tick() {
                if (!started || scheduled || finished) return;
                scheduled = true; setImmediate(() => {
                    scheduled = false; if (finished) return;
                    if (!operations.length) { finish(false); return; }
                    const { request, operation } = operations.shift();
                    try { request.result = operation(); request.onsuccess?.(); }
                    catch { finish(true); return; }
                    tick();
                });
            }
            const request = operation => { const req = {}; operations.push({ request: req, operation }); tick(); return req; };
            const tx = {
                abort() { finish(true); },
                objectStore(name) {
                    return {
                        get: key => request(() => structuredClone(copies.get(name).get(JSON.stringify(key)))),
                        delete: key => request(() => {
                            if (failPut === name) { failPut = null; throw Error('quota'); }
                            copies.get(name).delete(JSON.stringify(key));
                        }),
                        put: value => request(() => {
                            if (failPut === name) { failPut = null; throw Error('quota'); }
                            copies.get(name).set(JSON.stringify([value.namespace, value.id]), structuredClone(value));
                        }),
                        index: () => ({ getAll: namespace => request(() => [...copies.get(name).values()].filter(v => v.namespace === namespace).map(v => structuredClone(v))) }),
                    };
                },
            };
            queue.push(() => { copies = new Map(names.map(name => [name, new Map([...tables.get(name)].map(([k, v]) => [k, structuredClone(v)]))])); started = true; tick(); });
            pump(); return tx;
        },
    };
    return {
        failNextPut(name) { failPut = name; },
        open(name, requested = 1) {
            const request = {};
            setImmediate(() => {
                if (requested < version) { request.onerror?.(); return; }
                request.result = database;
                if (requested > version) { const oldVersion = version; version = requested; request.onupgradeneeded?.({ oldVersion }); }
                request.onsuccess?.();
            });
            return request;
        },
    };
}
