// Optional service introspection. Never accepts paths or returns host identity/secrets.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { diagnostics } = require('./diagnostics.cjs');
const SERVICE_VERSION = '0.6.0';
function userRoot(req) {
    const root = req.user?.directories?.root;
    if (typeof root !== 'string' || !root.trim() || root.includes('\0')) throw Error('HISTORY_IDENTITY_UNAVAILABLE');
    return path.resolve(root);
}
const safeError = error => error?.message === 'HISTORY_IDENTITY_UNAVAILABLE' ? error.message :
    ['EACCES', 'EPERM', 'EROFS'].includes(error?.code) ? 'SERVICE_STORAGE_PERMISSION' :
    error?.code === 'ENOSPC' ? 'SERVICE_STORAGE_FULL' : 'SERVICE_STORAGE_UNAVAILABLE';
async function checkStorage(req, io = fs) {
    const root = userRoot(req);
    const dir = path.join(root, '.group-director', 'muyu', 'history', '.service-probes');
    let temporary, stage = 'prepare', cleanup = 'not_needed', error = null;
    try {
        await io.mkdir(dir, { recursive: true });
        temporary = await io.mkdtemp(path.join(dir, 'probe-'));
        const file = path.join(temporary, 'check.txt'), value = crypto.randomUUID();
        stage = 'write'; await io.writeFile(file, value, { flag: 'wx' });
        stage = 'read'; if (await io.readFile(file, 'utf8') !== value) throw Error('MISMATCH');
    } catch (cause) { error = safeError(cause); }
    finally {
        if (temporary) {
            try { await io.rm(temporary, { recursive: true, force: true }); cleanup = 'complete'; }
            catch (cause) { if (!error) { error = safeError(cause); stage = 'cleanup'; } cleanup = 'failed'; }
        }
    }
    return { version: 1, status: error ? 'failed' : 'ok', stage: error ? stage : 'complete', cleanup, ...(error ? { error } : {}) };
}
function registerServiceStatus(router, limits) {
    const active = new Set();
    router.get('/service/status', (req, res) => {
        try {
            userRoot(req);
            res.json({ version: 1, serviceVersion: SERVICE_VERSION,
                capabilities: { history: 1, search: 1, storageCheck: 1, diagnostics: 1 }, toolProtocols: { documentSearch: 1, webFetch: 1, workspaceWrite: 1, jsonValidate: 1 }, limits });
        } catch (error) { res.status(500).json({ error: safeError(error) }); }
    });
    router.post('/service/storage-check', (req, res) => {
        if (!req.body || Object.keys(req.body).length !== 1 || req.body.confirm !== true) return res.status(400).json({ error: 'SERVICE_CHECK_CONFIRMATION_REQUIRED' });
        let account;
        try { account = userRoot(req); }
        catch (error) { return res.status(500).json({ error: safeError(error) }); }
        if (active.has(account) || active.size >= 256) return res.status(429).json({ error: 'SERVICE_CHECK_BUSY' });
        active.add(account);
        const started = Date.now();
        void checkStorage(req).then(value => {
            if (value.status === 'failed') diagnostics.record(req, { operation: 'storage.check', stage: value.stage, code: value.error, durationMs: Date.now() - started });
            res.json(value);
        }, error => { diagnostics.record(req, { operation: 'storage.check', stage: 'request', code: safeError(error), durationMs: Date.now() - started }); res.status(500).json({ error: safeError(error) }); }).finally(() => active.delete(account));
    });
}
module.exports = { registerServiceStatus, checkStorage };
