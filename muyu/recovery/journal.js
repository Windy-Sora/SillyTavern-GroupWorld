import { copyJson } from '../core/json-contract.js';
import { actionReceipt } from '../actions/receipts.js';
import { validateCheckpoint } from './contract.js';
import { recoveryIntent } from './intent.js';

export function createRecoveryJournal({ port, owner = () => '', changed = () => {} }) {
    let store = null, opening = null, records = [], error = false, closed = false;
    const notify = () => { try { changed(); } catch { /* UI observers cannot alter durable writes. */ } };
    const enabled = () => !!port?.openRecovery && port.enabled();
    async function open() {
        if (closed) throw Error('RECOVERY_CLOSED');
        if (!enabled()) return null;
        if (store) return store;
        if (!opening) opening = (async () => {
            const next = await port.openRecovery();
            try { const rows = await next.list(); if (closed) throw Error('RECOVERY_CLOSED'); records = rows; store = next; return store; }
            catch (e) { next.close(); throw e; }
        })().finally(() => { opening = null; });
        return opening;
    }
    async function update(record, steps = null, conversationId = '', parentId = '') {
        try {
            const db = await open(); if (!db) return;
            const previous = records.find(row => row.id === record.id);
            const kind = record.id.startsWith('bundle-apply:') ? 'bundle' : 'config';
            const value = validateCheckpoint({ version: previous?.version || 2, id: record.id,
                conversationId: previous?.conversationId || conversationId || owner(record) || '',
                kind,
                scope: previous?.scope || JSON.stringify([record.target.kind, record.target.chatKey || null]),
                revision: previous?.revision || 0, updatedAt: Date.now(), status: record.status,
                recordingFailed: record.checkpointFailed === true || record.result?.checkpointFailed === true,
                steps: (steps || previous?.steps || []).map(({ kind, id, status }) => ({ kind, id, status })),
                proposal: previous?.proposal || actionReceipt({ ...record, status: 'not_executed', result: null }),
                receipt: record.status === 'applying' ? null : actionReceipt(record),
                ...(previous?.version === 1 ? {} : { intent: previous ? previous.intent : recoveryIntent(record.content, kind), continuedBy: previous?.continuedBy || '', parentId: previous?.parentId || parentId }),
            });
            const saved = await db.write(value, value.revision);
            records = [...records.filter(row => row.id !== saved.id), saved]; error = false; notify();
        } catch (e) { if (e.message === 'HISTORY_IDENTITY_UNAVAILABLE') { records = []; store?.close(); store = null; } error = true; notify(); throw Error('RECOVERY_SAVE_FAILED'); }
    }
    return Object.freeze({
        checkpoint: update,
        async get(id) { const db = await open(); if (!db) throw Error('RECOVERY_UNAVAILABLE'); const rows = await db.list(); records = rows; const row = rows.find(r => r.id === id); if (!row) throw Error('RECOVERY_STALE'); return copyJson(row); },
        async claim(id, revision, childId) {
            const row = await this.get(id);
            if (row.version !== 2 || row.revision !== revision || row.continuedBy || !row.intent) throw Error('RECOVERY_STALE');
            const saved = await store.write(validateCheckpoint({ ...row, continuedBy: childId, updatedAt: Date.now() }), revision);
            records = [...records.filter(r => r.id !== id), saved]; notify(); return copyJson(saved);
        },
        async refresh() { try { const db = await open(); records = db ? await db.list() : []; error = false; } catch { records = []; store?.close(); store = null; error = true; } notify(); },
        snapshot(conversationId) { return { enabled: enabled(), error, conversationId: conversationId || '', records: enabled() ? records.map(copyJson) : [] }; },
        async remove(id) { const db = await open(); if (!db) throw Error('RECOVERY_UNAVAILABLE'); const row = records.find(r => r.id === id); if (!row) throw Error('RECOVERY_STALE'); await db.remove(id, row.revision); records = records.filter(r => r.id !== id); notify(); },
        async close() { closed = true; try { await opening; } catch { /* Opening already reported failure. */ } store?.close(); store = null; records = []; },
    });
}
