// Closed, ephemeral service errors. Never retain exceptions, bodies, identifiers or credentials.
const path = require('node:path');
const crypto = require('node:crypto');
const CODES = new Set(['HISTORY_INVALID', 'HISTORY_CONFLICT', 'HISTORY_DELETED', 'HISTORY_CAPACITY', 'HISTORY_UNAVAILABLE',
    'SERVICE_STORAGE_PERMISSION', 'SERVICE_STORAGE_FULL', 'SERVICE_STORAGE_UNAVAILABLE', 'SERVICE_CHECK_BUSY',
    'WEB_AUTH_ERROR', 'WEB_RATE_LIMIT', 'WEB_TIMEOUT', 'WEB_NETWORK_ERROR', 'WEB_UNAVAILABLE', 'WEB_INVALID_RESPONSE', 'WEB_REQUEST_INVALID']);
const OPERATIONS = new Set(['history.list', 'history.read', 'history.write', 'history.delete', 'search.request', 'storage.check']);
const STAGES = new Set(['request', 'prepare', 'write', 'read', 'cleanup']);
function accountKey(req) {
    const root = req.user?.directories?.root;
    if (typeof root !== 'string' || !root.trim() || root.includes('\0')) throw Error('HISTORY_IDENTITY_UNAVAILABLE');
    return crypto.createHash('sha256').update(path.resolve(root)).digest('hex');
}
function createDiagnostics({ now = Date.now } = {}) {
    const accounts = new Map(); let sequence = 0;
    const prune = () => {
        for (const [key, rows] of accounts) {
            const kept = rows.filter(row => now() - row.time < 1800000);
            if (kept.length) accounts.set(key, kept); else accounts.delete(key);
        }
    };
    return {
        record(req, value) {
            let key; try { key = accountKey(req); } catch { return; }
            if (!OPERATIONS.has(value?.operation) || !CODES.has(value?.code) || !STAGES.has(value?.stage)) return;
            prune(); if (!accounts.has(key) && accounts.size >= 256) return;
            const row = { id: ++sequence, time: now(), operation: value.operation, stage: value.stage, code: value.code,
                durationMs: Number.isSafeInteger(value.durationMs) && value.durationMs >= 0 ? Math.min(value.durationMs, 3600000) : 0,
                ...(Number.isInteger(value.httpStatus) && value.httpStatus >= 400 && value.httpStatus <= 599 ? { httpStatus: value.httpStatus } : {}) };
            const rows = accounts.get(key) || []; rows.push(row); if (rows.length > 200) rows.shift(); accounts.set(key, rows);
            // Bound aggregate memory as well as per-account retention.
            while ([...accounts.values()].reduce((n, items) => n + items.length, 0) > 4096) {
                let oldest; for (const entry of accounts) if (!oldest || entry[1][0].id < oldest[1][0].id) oldest = entry;
                oldest[1].shift(); if (!oldest[1].length) accounts.delete(oldest[0]);
            }
        },
        read(req) { const key = accountKey(req); prune(); return { version: 1, capacity: 200, retentionMinutes: 30, records: (accounts.get(key) || []).map(row => ({ ...row })) }; },
        clear(req) { accounts.delete(accountKey(req)); return { version: 1, cleared: true }; },
    };
}
function registerDiagnostics(router, diagnostics) {
    const respond = (req, res, work) => {
        try { res.json(work(req)); }
        catch { res.status(500).json({ error: 'HISTORY_IDENTITY_UNAVAILABLE' }); }
    };
    router.get('/service/diagnostics', (req, res) => respond(req, res, value => diagnostics.read(value)));
    router.post('/service/diagnostics/clear', (req, res) => {
        if (!req.body || Object.keys(req.body).length !== 1 || req.body.confirm !== true) return res.status(400).json({ error: 'SERVICE_CHECK_CONFIRMATION_REQUIRED' });
        respond(req, res, value => diagnostics.clear(value));
    });
}
const diagnostics = createDiagnostics();
module.exports = { createDiagnostics, registerDiagnostics, diagnostics };
