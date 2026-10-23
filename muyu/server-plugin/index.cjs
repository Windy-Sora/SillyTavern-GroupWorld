// Optional SillyTavern server plugin. Install under ST/plugins/gd-muyu-history.
// Conversation data is deliberately outside either web-served extension directory.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { registerWebSearch } = require('./web-search.cjs');
const { registerDocuments } = require('./documents.cjs');
const { registerPages } = require('./web-page.cjs');
const { registerWorkspace } = require('./workspace.cjs');
const { registerServiceStatus } = require('./service-status.cjs');
const { diagnostics, registerDiagnostics } = require('./diagnostics.cjs');

const info = { id: 'gd-muyu-history', name: 'Group Director Muyu Services', description: 'Private Muyu conversation files and optional web search' };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const maxBytes = 32 * 1024 * 1024;
const fields = new Set(['version', 'id', 'revision', 'scope', 'title', 'createdAt', 'updatedAt', 'messages', 'required', 'status', 'archived', 'imported', 'contextSummary', 'receipts', 'scopeChanges']);
const queues = new Map();
function directory(req) {
    const root = req.user?.directories?.root;
    if (typeof root !== 'string' || !root.trim() || root.includes('\0')) throw Error('HISTORY_IDENTITY_UNAVAILABLE');
    const namespace = req.query?.namespace;
    if (typeof namespace !== 'string' || !uuid.test(namespace)) throw Error('HISTORY_INVALID');
    return path.join(path.resolve(root), '.group-director', 'muyu', 'history', namespace);
}
function file(dir, id) {
    if (typeof id !== 'string' || !uuid.test(id)) throw Error('HISTORY_INVALID');
    return path.join(dir, `${id}.json`);
}
function check(record, id) {
    if (!record || typeof record !== 'object' || Array.isArray(record) || record.id !== id || Object.keys(record).some(key => !fields.has(key)) ||
        ![1, 2, 3, 4, 5, 6, 7].includes(record.version) || !Number.isSafeInteger(record.revision) || record.revision < 0 ||
        typeof record.scope !== 'string' || record.scope.length > 4096 || typeof record.title !== 'string' || record.title.length > 100 ||
        !Array.isArray(record.messages) || record.messages.length > 4096 || record.messages.some(message => !message ||
            Object.keys(message).some(key => !['role', 'content', 'runId', ...(record.version >= 7 ? ['origin'] : [])].includes(key)) ||
            !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || Buffer.byteLength(JSON.stringify(message.content), 'utf8') > 2 * 1024 * 1024 ||
            typeof message.runId !== 'string' || message.runId.length > 150 ||
            Object.hasOwn(message, 'origin') && (message.role !== 'user' || !['question', 'continuation'].includes(message.origin))) ||
        !Array.isArray(record.required) || record.required.length > 128 || record.required.some(value => typeof value !== 'string' || value.length > 200) ||
        typeof record.status !== 'string' ||
        Buffer.byteLength(JSON.stringify(record), 'utf8') > maxBytes) throw Error('HISTORY_INVALID');
    return record;
}
async function stored(dir, id) {
    try {
        const value = JSON.parse(await fs.readFile(file(dir, id), 'utf8'));
        if (value?.deleted === true && value.id === id && Object.keys(value).sort().join(',') === 'deleted,id') return value;
        return check(value, id);
    }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function read(dir, id) { const value = await stored(dir, id); return value?.deleted ? null : value; }
async function replace(dir, id, value) {
    await fs.mkdir(dir, { recursive: true });
    const temporary = path.join(dir, `${id}.${crypto.randomUUID()}.tmp`);
    try { await fs.writeFile(temporary, JSON.stringify(value), { flag: 'wx' }); await fs.rename(temporary, file(dir, id)); }
    finally { await fs.unlink(temporary).catch(() => {}); }
}
function summary(record) {
    const { messages, required, contextSummary, receipts, scopeChanges, ...metadata } = record;
    return { ...metadata, count: messages.length, bytes: Buffer.byteLength(JSON.stringify(record), 'utf8') };
}
function serialized(key, work) {
    // Windows path aliases must share a queue without moving existing history folders.
    key = path.resolve(key);
    if (process.platform === 'win32') key = key.toLowerCase();
    const previous = queues.get(key) || Promise.resolve();
    const result = previous.catch(() => {}).then(work);
    const tail = result.catch(() => {});
    queues.set(key, tail);
    void tail.finally(() => { if (queues.get(key) === tail) queues.delete(key); });
    return result;
}
function createFileStore(dir) {
    return {
        async list() {
            let names;
            try { names = await fs.readdir(dir); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
            const rows = [];
            for (const name of names) if (uuid.test(name.slice(0, -5)) && name.endsWith('.json')) {
                const record = await read(dir, name.slice(0, -5)); if (record) rows.push(summary(record));
            }
            return rows;
        },
        read: id => read(dir, id),
        async write(record, expectedRevision) {
            const id = record?.id; file(dir, id);
            if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw Error('HISTORY_INVALID');
            return serialized(dir, async () => {
                const old = await stored(dir, id);
                if (old?.deleted) throw Error('HISTORY_DELETED');
                if (!old && expectedRevision !== 0) throw Error('HISTORY_DELETED');
                if ((old?.revision || 0) !== expectedRevision) throw Error('HISTORY_CONFLICT');
                const next = check({ ...record, revision: expectedRevision + 1 }, id);
                const listed = await this.list();
                if (!old && listed.length >= 64) throw Error('HISTORY_CAPACITY');
                if (listed.filter(row => row.id !== id).reduce((sum, row) => sum + row.bytes, 0) + summary(next).bytes > 256 * 1024 * 1024) throw Error('HISTORY_CAPACITY');
                await replace(dir, id, next);
                return next;
            });
        },
        create(record) { return this.write(record, 0); },
        update(record, revision) { return this.write(record, revision); },
        async remove(id, revision) {
            return serialized(dir, async () => {
                const old = await read(dir, id);
                if (!old) throw Error('HISTORY_DELETED');
                if (old.revision !== revision) throw Error('HISTORY_CONFLICT');
                // Keep only an ID marker so an untouched browser backup cannot resurrect this history.
                await replace(dir, id, { id, deleted: true }); return true;
            });
        },
    };
}
function respond(res, work, req, operation) {
    const started = Date.now();
    Promise.resolve().then(work).then(value => res.json(value), error => {
        const message = String(error?.message || '');
        const code = ['HISTORY_INVALID', 'HISTORY_CONFLICT', 'HISTORY_DELETED', 'HISTORY_CAPACITY', 'HISTORY_IDENTITY_UNAVAILABLE'].includes(message) ? message : 'HISTORY_UNAVAILABLE';
        const diagnosticCode = ['EACCES', 'EPERM', 'EROFS'].includes(error?.code) ? 'SERVICE_STORAGE_PERMISSION' : error?.code === 'ENOSPC' ? 'SERVICE_STORAGE_FULL' : code;
        diagnostics.record(req, { operation, stage: 'request', code: diagnosticCode, durationMs: Date.now() - started });
        res.status(code === 'HISTORY_CONFLICT' || code === 'HISTORY_DELETED' ? 409 : code === 'HISTORY_INVALID' ? 400 : 500).json({ error: code });
    });
}
function init(router) {
    registerWebSearch(router);
    registerDocuments(router);
    registerPages(router);
    registerWorkspace(router);
    registerServiceStatus(router, { records: 64, recordBytes: maxBytes, totalBytes: 256 * 1024 * 1024, messages: 4096 });
    registerDiagnostics(router, diagnostics);
    router.get('/health', (_req, res) => res.json({ version: 1 }));
    router.get('/records', (req, res) => respond(res, () => createFileStore(directory(req)).list(), req, 'history.list'));
    router.get('/records/:id', (req, res) => respond(res, () => createFileStore(directory(req)).read(req.params.id), req, 'history.read'));
    router.put('/records/:id', (req, res) => respond(res, () => {
        const dir = directory(req), store = createFileStore(dir);
        if (req.body?.record?.id !== req.params.id) throw Error('HISTORY_INVALID');
        return store.write(req.body.record, req.body.expectedRevision);
    }, req, 'history.write'));
    router.delete('/records/:id', (req, res) => respond(res, () => createFileStore(directory(req)).remove(req.params.id, req.body?.revision), req, 'history.delete'));
}
module.exports = { info, init, createFileStore };
