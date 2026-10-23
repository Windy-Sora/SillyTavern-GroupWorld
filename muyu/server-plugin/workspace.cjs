// Workspace writes are separate from document reads. No model-facing write tool yet.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { fileSafety } = require('./documents.cjs');
const { canonical, relative, readText, userRoot } = fileSafety;
const LIMITS = Object.freeze({ bytes: 65536, files: 64, totalBytes: 8388608, backups: 20, previews: 128, perAccount: 8, ttlMs: 300000 });
const CODES = ['WORKSPACE_INVALID', 'WORKSPACE_CONFLICT', 'WORKSPACE_UNAVAILABLE', 'WORKSPACE_BUSY',
    'WORKSPACE_CAPACITY', 'WORKSPACE_PREVIEW_EXPIRED', 'WORKSPACE_ABORTED', 'HISTORY_IDENTITY_UNAVAILABLE'];
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = code => { throw Error(code); };
function active(signal) { if (signal?.aborted) fail('WORKSPACE_ABORTED'); }
function shape(input, keys) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !keys.includes(key))) fail('WORKSPACE_INVALID');
}
function filename(name) {
    try { relative(name); } catch { fail('WORKSPACE_INVALID'); }
    // Flat, non-executable user documents only, not extension/config/library assets.
    if (name.includes('/') || !/\.(?:md|txt|json)$/i.test(name) ||
        /^(?:secrets|settings|credentials|config|document-roots)(?:\.|$)/i.test(name)) fail('WORKSPACE_INVALID');
    return name;
}
function content(text) {
    if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > LIMITS.bytes ||
        /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text) || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text)) fail('WORKSPACE_INVALID');
}
function validateJson(text) {
    content(text);
    let value; try { value = JSON.parse(text); } catch { return { version: 1, valid: false, reason: 'JSON_SYNTAX' }; }
    const stack = [[value, 0]]; let nodes = 0;
    while (stack.length) {
        const [item, depth] = stack.pop();
        if (++nodes > 10000 || depth > 64) return { version: 1, valid: false, reason: 'JSON_COMPLEXITY' };
        if (item && typeof item === 'object') for (const key of Object.keys(item)) {
            if (['__proto__', 'constructor', 'prototype'].includes(key)) return { version: 1, valid: false, reason: 'JSON_UNSAFE_KEY' };
            stack.push([item[key], depth + 1]);
        }
        else if (typeof item === 'number' && !Number.isFinite(item)) return { version: 1, valid: false, reason: 'JSON_NUMBER' };
    }
    return { version: 1, valid: true, reason: 'SYNTAX_ONLY' };
}
async function directories(account, create) {
    let dir = await canonical(account);
    for (const part of ['.group-director', 'muyu', 'workspace']) {
        dir = path.join(dir, part);
        if (create) await fs.mkdir(dir).catch(error => { if (error.code !== 'EEXIST') throw error; });
        try { dir = await canonical(dir); }
        catch (error) { if (!create && error.code === 'ENOENT') return null; throw error; }
    }
    return dir;
}
async function snapshot(dir, name, signal) {
    if (!dir) return null;
    try { return await readText(dir, name, signal, Date.now() + 6000); }
    catch (error) { if (error.message === 'DOCUMENT_NOT_FOUND') return null; throw error; }
}
async function quota(dir, name, bytes) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    if (entries.length > 4096) fail('WORKSPACE_CAPACITY');
    // Resolve the actual entry spelling: case aliases on Windows are updates,
    // while separately named files on case-sensitive filesystems still count.
    const target = await fs.realpath(path.join(dir, name)).catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
    });
    const existingName = target ? path.basename(target) : null;
    let count = 0, total = bytes;
    for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        if (entry.name !== existingName) {
            const stat = await fs.lstat(path.join(dir, entry.name));
            if (stat.isSymbolicLink() || !stat.isFile()) fail('WORKSPACE_UNAVAILABLE');
            count++; total += stat.size;
        }
    }
    if (count + 1 > LIMITS.files || total > LIMITS.totalBytes) fail('WORKSPACE_CAPACITY');
}
async function backup(dir, previous) {
    if (!previous) return null;
    const store = path.join(path.dirname(dir), 'workspace-backups');
    await fs.mkdir(store).catch(error => { if (error.code !== 'EEXIST') throw error; });
    await canonical(store);
    const names = (await fs.readdir(store)).filter(name => /^[0-9]{13}-[0-9a-f-]{36}\.bak$/.test(name)).sort();
    // Only prune service-generated backups, never user-named files or arbitrary directories.
    for (const name of names.slice(0, Math.max(0, names.length - LIMITS.backups + 1))) {
        const stat = await fs.lstat(path.join(store, name));
        if (!stat.isFile() || stat.isSymbolicLink()) fail('WORKSPACE_UNAVAILABLE');
        await fs.unlink(path.join(store, name));
    }
    const id = Date.now() + '-' + crypto.randomUUID() + '.bak';
    const handle = await fs.open(path.join(store, id), 'wx', 0o600);
    try { await handle.writeFile(previous.bytes); await handle.sync(); }
    finally { await handle.close(); }
    return id;
}
function createWorkspaceService({ now = Date.now } = {}) {
    const previews = new Map(), busy = new Set();
    function expire() { for (const [id, row] of previews) if (row.expiresAt <= now()) previews.delete(id); }
    return { async run(operation, req, input, signal) {
        const account = userRoot(req);
        active(signal);
        if (operation === 'validate') { shape(input, ['text']); return validateJson(input.text); }
        shape(input, operation === 'preview' ? ['path', 'expectedRevision', 'text'] : ['previewId']);
        if (!['preview', 'apply'].includes(operation)) fail('WORKSPACE_INVALID');
        expire();
        if (operation === 'preview') {
            filename(input.path); content(input.text);
            if (input.expectedRevision !== null && (typeof input.expectedRevision !== 'string' || !/^[0-9a-f]{64}$/.test(input.expectedRevision))) fail('WORKSPACE_INVALID');
            if (/\.json$/i.test(input.path) && !validateJson(input.text).valid) fail('WORKSPACE_INVALID');
        } else if (typeof input.previewId !== 'string' || !/^[0-9a-f-]{36}$/.test(input.previewId)) fail('WORKSPACE_INVALID');
        if (busy.has(account) || busy.size >= 256) fail('WORKSPACE_BUSY');
        busy.add(account);
        let temp, committed = false, commitAttempted = false;
        try {
            if (operation === 'preview') {
                if (previews.size >= LIMITS.previews || [...previews.values()].filter(row => row.account === account).length >= LIMITS.perAccount) fail('WORKSPACE_CAPACITY');
                const dir = await directories(account, false), old = await snapshot(dir, input.path, signal);
                if ((old?.revision ?? null) !== input.expectedRevision) fail('WORKSPACE_CONFLICT');
                if (Buffer.byteLength(JSON.stringify({ before: old?.text || '', after: input.text })) > 20000) fail('WORKSPACE_CAPACITY');
                const previewId = crypto.randomUUID(), expiresAt = now() + LIMITS.ttlMs;
                active(signal);
                previews.set(previewId, { account, ...input, expiresAt });
                return { version: 1, status: 'preview', previewId, path: input.path, expectedRevision: input.expectedRevision,
                    revision: hash(input.text), bytes: Buffer.byteLength(input.text), expiresAt, operation: old ? 'update' : 'create', beforeText: old?.text || '' };
            }
            const row = previews.get(input.previewId);
            // Another account cannot consume or learn the existence of this proposal.
            if (!row || row.account !== account) fail('WORKSPACE_PREVIEW_EXPIRED');
            const dir = await directories(account, true), old = await snapshot(dir, row.path, signal);
            if ((old?.revision ?? null) !== row.expectedRevision) { previews.delete(input.previewId); fail('WORKSPACE_CONFLICT'); }
            await quota(dir, row.path, Buffer.byteLength(row.text));
            active(signal);
            const backupId = await backup(dir, old);
            temp = path.join(dir, '.write-' + crypto.randomUUID() + '.tmp');
            const handle = await fs.open(temp, 'wx', 0o600);
            try { await handle.writeFile(row.text, 'utf8'); await handle.sync(); } finally { await handle.close(); }
            // Revalidate after all asynchronous preparation; never overwrite an observed new version.
            await canonical(dir);
            const current = await snapshot(dir, row.path, signal);
            if ((current?.revision ?? null) !== row.expectedRevision) { previews.delete(input.previewId); fail('WORKSPACE_CONFLICT'); }
            active(signal);
            previews.delete(input.previewId); // One-use, also on an ambiguous filesystem failure.
            const target = path.join(dir, row.path);
            commitAttempted = true;
            if (old) await fs.rename(temp, target);
            else await fs.link(temp, target); // Atomic create-without-clobber, unlike rename.
            committed = true;
            // Cancellation after commit must not turn a real write into "not started".
            const saved = await snapshot(dir, row.path);
            const verified = saved?.revision === hash(row.text);
            return { version: 1, status: verified ? 'written' : 'outcome_unknown',
                path: row.path, revision: hash(row.text), backupId, persistence: verified ? 'file_synced' : 'unknown' };
        } catch (error) {
            if (committed) return { version: 1, status: 'outcome_unknown', persistence: 'unknown' };
            if (error.code === 'EEXIST') fail('WORKSPACE_CONFLICT');
            if (commitAttempted) return { version: 1, status: 'outcome_unknown', persistence: 'unknown' };
            if (CODES.includes(error.message)) throw error;
            if (error.message === 'DOCUMENT_ABORTED') fail('WORKSPACE_ABORTED');
            fail('WORKSPACE_UNAVAILABLE');
        } finally {
            if (temp) await fs.unlink(temp).catch(() => {});
            busy.delete(account);
        }
    } };
}
function registerWorkspace(router, service = createWorkspaceService()) {
    for (const operation of ['preview', 'apply', 'validate']) router.post('/workspace/' + operation, (req, res) => {
        const abort = new AbortController(), stop = () => { if (!res.writableEnded) abort.abort(); };
        req.on?.('aborted', stop); res.on?.('close', stop);
        void service.run(operation, req, req.body, abort.signal).then(value => { if (!abort.signal.aborted) res.json(value); }, error => {
            const code = CODES.includes(error?.message) ? error.message : 'WORKSPACE_UNAVAILABLE';
            if (!abort.signal.aborted) res.status(code === 'WORKSPACE_INVALID' ? 400 : code === 'WORKSPACE_BUSY' ? 429 : 409).json({ error: code });
        }).finally(() => { req.off?.('aborted', stop); res.off?.('close', stop); });
    });
}
module.exports = { createWorkspaceService, registerWorkspace, validateJson, LIMITS };
