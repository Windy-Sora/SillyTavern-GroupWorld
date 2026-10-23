import { randomUUID } from '../runtime/crypto.js';
import { HISTORY_LIMITS, historyBytes, validateRecord, summarizeRecord, validateSummary } from './contract.js';
import { importedRecord, historyImportFingerprint, exportHistoryRecord, exportHistoryRecovery, parseHistoryImport } from './exchange.js';
import { MAX_MESSAGE_BYTES } from '../core/context-limits.js';
import { validateReceipt, receiptSources } from '../actions/receipts.js';
import { historyCopyError } from './copy-history.js';
import { jsonKey } from '../core/json-contract.js';

/** Working copies outlive connections. Disk failures never roll back a generated answer. */
export function createSessionLibrary({ port, changed = () => {}, now = Date.now } = {}) {
    const records = new Map(), summaries = new Map(), revisions = new Map(), dirty = new Set(), failures = new Map(), managing = new Set();
    const recoveries = new Map();
    const observed = new Map(), external = new Map();
    const writeReports = new Map();
    let sourceKey = null;
    let copyReport = null, copyingHistory = false, importReport = null;
    let store = null, loading = false, enabled = false, pending = 0, error = null, tail = Promise.resolve(), closed = false;
    const notify = () => { if (!closed) { try { changed(); } catch { /* Views do not own storage. */ } } };
    function enqueue(work) {
        pending++;
        const result = tail.then(work);
        tail = result.catch(() => {}).finally(() => { pending--; notify(); });
        notify(); return result;
    }
    function assertSource() {
        if (store && sourceKey !== null && (store.sourceKey || store.kind || 'legacy') !== sourceKey) throw Error('HISTORY_SOURCE_CHANGED');
    }
    async function persist(record, revision) {
        assertSource();
        const saved = await (revision ? store.update(record, revision) : store.create(record));
        writeReports.delete(record.id); return saved;
    }
    function remember(record) { records.set(record.id, record); summaries.set(record.id, summarizeRecord(record)); }
    function schedule(id) {
        if (!enabled || !store || failures.has(id) || recoveries.has(id) || external.has(id)) return;
        void enqueue(async () => {
            if (!dirty.has(id) || !records.has(id) || failures.has(id) || recoveries.has(id) || external.has(id)) return;
            const record = structuredClone(records.get(id));
            try {
                if (store.saveRecord) {
                    assertSource();
                    const report = await store.saveRecord(record), saved = report.readRecord;
                    const { readRecord, ...publicReport } = report; writeReports.set(id, publicReport);
                    if (saved) {
                        revisions.set(id, saved.revision); observed.set(id, jsonKey(summarizeRecord(saved)));
                        records.get(id).revision = saved.revision;
                    }
                    if (report.complete && JSON.stringify({ ...records.get(id), revision: record.revision }) === JSON.stringify(record)) dirty.delete(id);
                    summaries.set(id, summarizeRecord(records.get(id)));
                    return;
                }
                const saved = await persist(record, revisions.get(id) || 0);
                revisions.set(id, saved.revision);
                observed.set(id, jsonKey(summarizeRecord(saved)));
                if (JSON.stringify(records.get(id)) === JSON.stringify(record)) dirty.delete(id);
                records.get(id).revision = saved.revision;
                summaries.set(id, summarizeRecord(records.get(id)));
            } catch (e) { failures.set(id, e.message); }
        });
    }
    async function connect() {
        const opened = store || await port.open();
        try {
            const nextSource = opened.sourceKey || opened.kind || 'legacy';
            if (sourceKey !== null && sourceKey !== nextSource) throw Error('HISTORY_SOURCE_CHANGED');
            if (store) await opened.retryMigration?.();
            const list = (await opened.list()).map(validateSummary);
            if ((opened.sourceKey || opened.kind || 'legacy') !== nextSource) throw Error('HISTORY_SOURCE_CHANGED');
            if (new Set(list.map(row => row.id)).size !== list.length) throw Error('HISTORY_INVALID');
            const incoming = new Map(list.map(row => [row.id, row]));
            for (const [id] of records) {
                const report = writeReports.get(id), attempted = records.get(id);
                if (store?.confirmRead && report && !report.readSaved && report.targets.some(row => row.source === store.readSource && row.state === 'failed')) {
                    let confirmed = null;
                    try { confirmed = await store.confirmRead(attempted); }
                    catch (error) { if (error.message === 'HISTORY_IDENTITY_UNAVAILABLE') throw error; }
                    if (confirmed && records.get(id) === attempted) {
                        revisions.set(id, confirmed.revision); records.get(id).revision = confirmed.revision;
                        observed.set(id, jsonKey(summarizeRecord(confirmed)));
                        incoming.set(id, summarizeRecord(confirmed));
                        report.readSaved = report.anySaved = true;
                        const target = report.targets.find(row => row.source === store.readSource); target.state = 'saved'; delete target.error;
                        report.complete = report.targets.every(row => row.state !== 'failed');
                        if (report.complete) dirty.delete(id);
                    }
                }
                const row = incoming.get(id), baseline = observed.get(id);
                if (row && (!baseline || jsonKey(row) !== baseline)) external.set(id, 'changed');
                else if (!row && (revisions.get(id) || 0) > 0) external.set(id, 'deleted');
                else external.delete(id);
            }
            if (list.length + [...records.keys()].filter(id => !incoming.has(id)).length > HISTORY_LIMITS.sessions) throw Error('HISTORY_CAPACITY');
            for (const [id] of summaries) if (!records.has(id) && !list.some(r => r.id === id)) { summaries.delete(id); revisions.delete(id); }
            for (const summary of list) if (!records.has(summary.id)) { summaries.set(summary.id, summary); revisions.set(summary.id, summary.revision); }
            store = opened;
            sourceKey = nextSource;
        } catch (e) { if (opened !== store) opened.close(); throw e; }
    }
    const ready = (async () => {
        if (!port?.enabled()) return;
        loading = true;
        try { await connect(); enabled = true; }
        catch (e) { error = e.message; }
        finally { loading = false; notify(); }
    })();
    async function load(id, scope) {
        await ready;
        assertSource();
        const summary = summaries.get(id);
        if (loading || closed || managing.has(id) || !summary || scope !== undefined && summary.scope !== scope) throw Error('HISTORY_SCOPE');
        if (!records.has(id)) {
            if (!store) throw Error('HISTORY_UNAVAILABLE');
            const record = validateRecord(await store.read(id));
            assertSource();
            if (record.scope !== summary.scope || record.id !== id) throw Error('HISTORY_SCOPE');
            if (closed || !summaries.has(id) || managing.has(id)) throw Error('NOT_READY');
            if (!records.has(id)) {
                store.acceptRead?.(id, record);
                revisions.set(id, record.revision);
                observed.set(id, jsonKey(record.revision === summary.revision ? summary : summarizeRecord(record)));
                if (record.status === 'running') record.status = 'interrupted';
                remember(record);
            }
        }
        return structuredClone(records.get(id));
    }
    function add(record) {
        if (loading || closed) throw Error('NOT_READY');
        if (summaries.size >= HISTORY_LIMITS.sessions) throw Error('HISTORY_CAPACITY');
        remember(record); dirty.add(record.id); schedule(record.id); return record.id;
    }
    async function manage(id, patch) {
        await ready;
        if (loading || closed || managing.has(id)) throw Error('NOT_READY');
        if (!records.has(id)) await load(id);
        if (managing.has(id)) throw Error('NOT_READY');
        managing.add(id); notify();
        try {
            return await enqueue(async () => {
                if (closed || !records.has(id)) throw Error('NOT_READY');
                assertSource();
                const revision = revisions.get(id) || 0;
                if (patch === null) {
                    if (revision) {
                        if (!store) store = await port.open();
                        try { await store.remove(id, revision); } catch (e) { if (e.message !== 'HISTORY_DELETED') throw e; }
                    }
                    records.delete(id); summaries.delete(id); revisions.delete(id); dirty.delete(id); failures.delete(id); recoveries.delete(id);
                    observed.delete(id); external.delete(id);
                    writeReports.delete(id);
                    return;
                }
                const fields = { ...patch, updatedAt: now() };
                if (external.has(id)) throw Error(external.get(id) === 'deleted' ? 'HISTORY_DELETED' : 'HISTORY_CONFLICT');
                let saved = null;
                if (enabled || revision) {
                    if (!store) store = await port.open();
                    // Explicit metadata edits with auto-save off must not silently persist draft replies.
                    const base = enabled ? records.get(id) : await store.read(id);
                    if (!base) throw Error('HISTORY_DELETED');
                    saved = await persist(validateRecord({ ...base, ...fields }), revision);
                    revisions.set(id, saved.revision);
                    observed.set(id, jsonKey(summarizeRecord(saved)));
                }
                const next = validateRecord({ ...records.get(id), ...fields, updatedAt: Math.max(fields.updatedAt, records.get(id).updatedAt), revision: saved?.revision ?? records.get(id).revision });
                remember(next); failures.delete(id);
                if (saved && JSON.stringify(next) === JSON.stringify(saved)) dirty.delete(id); else dirty.add(id);
            });
        } catch (e) { failures.set(id, e.message); throw e; }
        finally { managing.delete(id); notify(); }
    }
    return {
        ready, load,
        meta: id => summaries.has(id) ? structuredClone(summaries.get(id)) : null,
        snapshot(scope, id, filters) {
            const current = JSON.parse(scope);
            const items = [...summaries.values()].filter(r => {
                if (!filters) return r.scope === scope;
                const [, kind, chatKey] = JSON.parse(r.scope);
                return (filters.range === 'all' || filters.range === 'global' && kind === 'global' || filters.range === 'current' && kind === 'chat' && chatKey === filters.chatKey)
                    && (filters.archive === 'all' || r.archived === (filters.archive === 'archived'))
                    && (!filters.task || JSON.parse(r.scope)[0] === filters.task)
                    && r.title.toLocaleLowerCase().includes((filters.query || '').trim().toLocaleLowerCase());
            }).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
            const report = writeReports.get(id);
            return { available: !!port, enabled, autoSaveRequested: !!port?.enabled(), backend: store?.kind || 'memory', sourceKey, readSource: store?.readSource || null,
                routed: !!store?.saveRecord, writeTargets: store?.writeTargets?.() || null, writeReport: report && structuredClone(report), canManage: store?.canManage?.() ?? true,
                external: external.get(id) || null, loading, pending, error: recoveries.has(id) ? 'HISTORY_CAPACITY' : failures.get(id) || (external.has(id) ? external.get(id) === 'deleted' ? 'HISTORY_DELETED' : 'HISTORY_CONFLICT' : error),
                dirty: dirty.has(id) || recoveries.has(id), recovery: recoveries.has(id), migration: store?.migration || null, importReport: importReport && { ...importReport }, copyReport: copyReport && { ...copyReport }, copyingHistory, canCopyHistory: typeof store?.copyHistoryFrom === 'function', canMergeLegacyHistory: typeof store?.mergeLegacyHistory === 'function', sessionId: id || '', persisted: (revisions.get(id) || 0) > 0, managing: managing.has(id),
                total: summaries.size, scopeMode: current[0], selected: id ? this.meta(id) : null,
                sessions: items.map(r => ({ id: r.id, title: r.title, scope: r.scope, updatedAt: r.updatedAt, archived: r.archived, imported: r.imported,
                    external: external.get(r.id) || null, status: r.status === 'running' && !records.has(r.id) ? 'interrupted' : r.status })) };
        },
        get: id => records.has(id) ? structuredClone(records.get(id)) : null,
        recoveryMessages: id => recoveries.has(id) ? structuredClone(recoveries.get(id).messages) : null,
        create(scope) { return add(validateRecord({ version: 2, ...(JSON.parse(scope)[0] === 'assistant' ? { version: 5, receipts: [], contextSummary: null } : {}), id: randomUUID(), revision: 0, scope, title: '', createdAt: now(), updatedAt: now(), messages: [], required: [], status: 'idle', archived: false, imported: false })); },
        async import(text) {
            const source = parseHistoryImport(text);
            await ready;
            if (loading || closed || managing.size) throw Error('NOT_READY');
            loading = true; importReport = null; notify();
            try {
                await tail;
                // A failed source read is not an empty library. Never fall back to
                // another backend or add a duplicate using a stale directory.
                if (port) { await connect(); error = null; }
                const fingerprint = await historyImportFingerprint(source);
                const listing = async () => {
                    assertSource();
                    const rows = store ? (await store.list()).map(validateSummary) : [];
                    assertSource();
                    if (rows.length > HISTORY_LIMITS.sessions || new Set(rows.map(r => r.id)).size !== rows.length) throw Error('HISTORY_INVALID');
                    return rows;
                };
                const inventory = rows => JSON.stringify(rows.map(r => [r.id, r.revision, r.bytes, r.title, r.scope, r.count,
                    r.status, r.archived, r.imported, r.createdAt, r.updatedAt, r.version]).sort((a, b) => a[0].localeCompare(b[0])));
                const before = await listing(), candidates = new Map(before.map(row => [row.id, [row]]));
                for (const [id, record] of records) candidates.set(id, [...(candidates.get(id) || []), summarizeRecord(record)]);
                let identical = null;
                for (const [id, summaries] of candidates) {
                    if (!summaries.some(summary => summary.imported && summary.title === source.title && summary.scope === source.scope && summary.count === source.messages.length)) continue;
                    // Fresh bodies for stored candidates; do not advance the loaded
                    // page's baseline or replace an externally edited working copy.
                    const saved = before.some(row => row.id === id) ? validateRecord(await store.read(id)) : null;
                    assertSource();
                    if (saved && saved.id !== id) throw Error('HISTORY_INVALID');
                    const candidate = records.get(id);
                    const pageMatches = candidate?.imported && await historyImportFingerprint(candidate) === fingerprint;
                    const savedMatches = saved?.imported && await historyImportFingerprint(saved) === fingerprint;
                    if (pageMatches || savedMatches) {
                        if (external.has(id) || candidate && !pageMatches || saved && !savedMatches) throw Error('HISTORY_CONFLICT');
                        identical = id; break;
                    }
                }
                const after = await listing();
                if (closed || inventory(before) !== inventory(after)) throw Error('HISTORY_CONFLICT');
                if (identical) {
                    importReport = { id: identical, status: 'identical' };
                    return identical;
                }
                // No await between releasing the local gate and reserving a slot.
                // Same-ID files with changed content always receive a new UUID.
                loading = false;
                const id = add(importedRecord(source, now()));
                importReport = { id, status: 'created' };
                return id;
            } finally { loading = false; notify(); }
        },
        recordReceipt(id, value) {
            const previous = records.get(id); if (!previous || closed || previous.imported || previous.archived) throw Error('NOT_READY');
            const receipt = validateReceipt(value), receipts = previous.receipts || [];
            if (receipts.some(r => r.operationId === receipt.operationId)) return;
            const next = validateRecord({ ...previous, version: Math.max(4, previous.version), receipts: [...receipts, receipt], required: [...new Set([...previous.required, ...(previous.version >= 5 || receipt.version >= 2 ? receiptSources(receipt) : ['diagnostics'])])], updatedAt: now() });
            remember(next); dirty.add(id); schedule(id);
        },
        update(id, patch) {
            const previous = records.get(id); if (!previous || closed) throw Error('NOT_READY');
            // Only runtime-owned fields may be updated by capture/send. Metadata uses manage().
            if (Object.keys(patch).some(k => !['messages', 'status', 'title', 'required', 'contextSummary'].includes(k))) throw Error('HISTORY_INVALID');
            const upgrade = previous.version < 7 && patch.messages?.some(message => message.origin) ? { version: 7, receipts: previous.receipts || [], scopeChanges: previous.scopeChanges || [] } : {};
            const next = validateRecord({ ...previous, ...upgrade, ...patch, updatedAt: now() });
            const recovery = recoveries.get(id);
            if (recovery && patch.messages && JSON.stringify(patch.messages) === JSON.stringify(recovery.messages)) recoveries.delete(id);
            remember(next); dirty.add(id); schedule(id);
        },
        retainRecovery(id, messages, status) {
            const record = records.get(id); if (!record || closed) throw Error('NOT_READY');
            // Separate, bounded emergency backup; never relax the import/disk record contract.
            exportHistoryRecovery(record, messages, status);
            recoveries.set(id, structuredClone({ messages, status })); notify();
        },
        retarget(id, scope) {
            const previous = records.get(id);
            if (!previous || closed || previous.imported || previous.archived) throw Error('NOT_READY');
            const next = validateRecord({ ...previous, version: Math.max(6, previous.version), scope, scopeChanges: [...(previous.scopeChanges || []).slice(-31),
                { from: previous.scope, to: scope, at: now(), messageIndex: previous.messages.length }], updatedAt: now() });
            if (JSON.parse(next.scope)[0] !== JSON.parse(previous.scope)[0]) throw Error('HISTORY_SCOPE');
            remember(next); dirty.add(id); schedule(id);
        },
        rename(id, title) {
            if (typeof title !== 'string' || !title.trim() || title.trim().length > 100) return Promise.reject(Error('HISTORY_TITLE'));
            return manage(id, { title: title.trim() });
        },
        archive(id, value) { if (typeof value !== 'boolean') return Promise.reject(Error('HISTORY_INVALID')); return manage(id, { archived: value }); },
        remove: id => manage(id, null),
        assertRoom(id, input = '') {
            assertSource();
            const record = records.get(id); if (!record) throw Error('HISTORY_SCOPE');
            if (external.has(id)) throw Error(external.get(id) === 'deleted' ? 'HISTORY_DELETED' : 'HISTORY_CONFLICT');
            if (record.archived || record.imported) throw Error('HISTORY_READ_ONLY');
            // Reserve the actual serialized question, a maximum supported answer, a summary
            // replacement and metadata headroom BEFORE committing the runtime queue item.
            const reserve = historyBytes(input) + MAX_MESSAGE_BYTES + 512 * 1024 + 65536;
            if (recoveries.has(id) || record.messages.length > HISTORY_LIMITS.messages - 2 || historyBytes(record) + reserve > HISTORY_LIMITS.recordBytes) throw Error('HISTORY_CAPACITY');
            if (enabled) store?.assertCapacity?.(record, reserve, [...records.values()]);
        },
        async mergeLegacyHistory(cleanup = false) {
            await ready;
            if (typeof cleanup !== 'boolean') throw Error('HISTORY_INVALID');
            if (loading || closed || !store?.mergeLegacyHistory) throw Error('NOT_READY');
            loading = copyingHistory = true;
            copyReport = { source: 'legacy-world-books', cleanup, total: null, copied: 0, identical: 0, conflicts: 0, cleaned: 0, remaining: null, error: null }; notify();
            try {
                await tail;
                if (dirty.size || failures.size || recoveries.size) throw Error('HISTORY_CONFLICT');
                return await enqueue(async () => {
                    copyReport = { ...await store.mergeLegacyHistory(cleanup), source: 'legacy-world-books' };
                    try { await connect(); } catch (error) { copyReport.error ||= error.message; }
                    return { ...copyReport };
                });
            } catch (error) { copyReport.error = error.message; throw error; }
            finally { loading = copyingHistory = false; notify(); }
        },
        async copyHistoryFrom(source) {
            await ready;
            if (loading || closed || !store?.copyHistoryFrom) throw Error('NOT_READY');
            loading = copyingHistory = true; copyReport = null; notify();
            try {
                await tail;
                if (dirty.size || failures.size || recoveries.size) throw Error('HISTORY_CONFLICT');
                return await enqueue(async () => {
                    try { copyReport = { ...await store.copyHistoryFrom(source), source }; }
                    catch (error) {
                        copyReport = { source, total: null, copied: 0, identical: 0, conflicts: 0, remaining: null, error: historyCopyError(error) };
                        throw error;
                    }
                    await connect();
                    return { ...copyReport };
                });
            } finally { loading = copyingHistory = false; notify(); }
        },
        async reload(id, { discardLocal = false, beforeReplace = () => {} } = {}) {
            await ready;
            if (typeof discardLocal !== 'boolean' || typeof beforeReplace !== 'function') throw Error('HISTORY_INVALID');
            if (loading || closed || managing.has(id) || !store || !records.has(id)) throw Error('NOT_READY');
            if ((dirty.has(id) || recoveries.has(id)) && !discardLocal) throw Error('HISTORY_UNSAVED');
            loading = true; notify();
            try {
                await tail;
                assertSource();
                const previous = records.get(id), raw = await store.read(id);
                assertSource();
                const next = raw === null ? null : validateRecord(raw);
                const fresh = (await store.list()).map(validateSummary).find(row => row.id === id);
                assertSource();
                if (closed || records.get(id) !== previous) throw Error('HISTORY_CONFLICT');
                if (next && next.id !== id) throw Error('HISTORY_INVALID');
                if (next ? !fresh || fresh.revision !== next.revision : !!fresh) throw Error('HISTORY_CONFLICT');
                // Runtime owners detach old messages before publishing a new storage baseline.
                beforeReplace();
                store.acceptRead?.(id, next);
                external.delete(id); failures.delete(id); recoveries.delete(id); dirty.delete(id);
                writeReports.delete(id);
                if (next) {
                    observed.set(id, jsonKey(fresh)); revisions.set(id, next.revision);
                    if (next.status === 'running') next.status = 'interrupted';
                    remember(next);
                } else {
                    records.delete(id); summaries.delete(id); revisions.delete(id); observed.delete(id);
                }
                return next && structuredClone(next);
            } finally { loading = false; notify(); }
        },
        async refresh() {
            await ready; if (loading || closed || !port) throw Error('NOT_READY');
            loading = true; error = null; notify();
            try {
                await tail; await connect();
                if (!port.enabled()) enabled = false;
                if (!enabled && port.enabled()) { enabled = true; for (const id of dirty) schedule(id); }
            } catch (e) { error = e.message; throw e; }
            finally { loading = false; notify(); }
        },
        async setEnabled(value) {
            await ready; if (loading || closed || !port || typeof value !== 'boolean') throw Error('NOT_READY');
            loading = true; error = null; notify();
            try {
                await tail;
                await port.setEnabled(value);
                if (value) await connect();
                enabled = value;
                if (enabled) { failures.clear(); for (const id of dirty) schedule(id); }
                // Keep opened read access: disabling automatic saves does not hide/delete old records.
            } catch (e) { error = e.message; throw e; }
            finally { loading = false; notify(); }
        },
        async retry() {
            await ready;
            if (closed || loading || !port || !enabled && !port.enabled()) throw Error('NOT_READY');
            loading = true; error = null; notify();
            try {
                await tail;
                await connect();
                enabled = true;
                failures.clear(); for (const id of dirty) schedule(id); await tail;
            } catch (e) { error = e.message; throw e; }
            finally { loading = false; notify(); }
        },
        export(id, format) { const r = records.get(id); if (!r) throw Error('HISTORY_SCOPE'); const recovery = recoveries.get(id); return recovery ? exportHistoryRecovery(r, recovery.messages, recovery.status, format) : exportHistoryRecord(r, format); },
        async flush() { await ready; await tail; },
        async close() { await ready; await tail; closed = true; store?.close(); },
    };
}
