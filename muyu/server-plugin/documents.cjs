// Account-scoped, bounded text reads only. Never accepts a root path from HTTP.
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const LIMITS = { fileBytes: 262144, entries: 4096, files: 512, depth: 8, roots: 8, timeMs: 6000 };
const extensions = new Set(['.md', '.txt', '.json', '.js', '.mjs', '.cjs', '.css', '.html']);
const deniedNames = /^(?:secrets|settings|credentials|config|document-roots)(?:\.|$)/i;
const errorCodes = new Set(['DOCUMENT_INVALID', 'DOCUMENT_ROOT_UNAVAILABLE', 'DOCUMENT_NOT_FOUND', 'DOCUMENT_UNSUPPORTED', 'DOCUMENT_TOO_LARGE', 'DOCUMENT_STALE', 'DOCUMENT_ABORTED', 'DOCUMENT_TIMEOUT', 'DOCUMENT_BUSY', 'DOCUMENT_CONFIG_INVALID', 'HISTORY_IDENTITY_UNAVAILABLE']);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function failure(code) { throw Error(code); }
function userRoot(req) {
    const value = req.user?.directories?.root;
    if (typeof value !== 'string' || !value.trim() || value.includes('\0')) failure('HISTORY_IDENTITY_UNAVAILABLE');
    return path.resolve(value);
}
function relative(value) {
    if (typeof value !== 'string' || !value || value.length > 300 || /[\\:\x00-\x1f\x7f]/.test(value) ||
        value.startsWith('/') || value.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.') || /[. ]$/.test(part) ||
            /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) failure('DOCUMENT_INVALID');
    return value;
}
const permitted = name => extensions.has(path.extname(name).toLowerCase()) && !deniedNames.test(path.basename(name));
const inside = (root, target) => { const rel = path.relative(root, target); return rel === '' || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep)); };
function active(signal, deadline) {
    if (signal?.aborted) failure('DOCUMENT_ABORTED');
    if (Date.now() > deadline) failure('DOCUMENT_TIMEOUT');
}
async function canonical(directory) {
    const absolute = path.resolve(directory); let current = path.parse(absolute).root;
    for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
        current = path.join(current, part); const component = await fs.lstat(current);
        if (component.isSymbolicLink() || !component.isDirectory()) failure('DOCUMENT_ROOT_UNAVAILABLE');
    }
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) failure('DOCUMENT_ROOT_UNAVAILABLE');
    return fs.realpath(directory);
}
async function resolveFile(root, name) {
    relative(name);
    let current = root;
    for (const part of name.split('/')) {
        current = path.join(current, part);
        const stat = await fs.lstat(current);
        if (stat.isSymbolicLink() || !inside(root, await fs.realpath(current))) failure('DOCUMENT_UNSUPPORTED');
    }
    return current;
}
async function readText(root, name, signal, deadline) {
    if (!permitted(name)) failure('DOCUMENT_UNSUPPORTED');
    active(signal, deadline);
    let file;
    try { file = await resolveFile(root, name); } catch (error) { if (error.code === 'ENOENT') failure('DOCUMENT_NOT_FOUND'); throw error; }
    const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
        const before = await handle.stat();
        if (!before.isFile()) failure('DOCUMENT_UNSUPPORTED');
        if (before.size > LIMITS.fileBytes) failure('DOCUMENT_TOO_LARGE');
        const buffer = Buffer.alloc(before.size + 1);
        let size = 0;
        while (size < buffer.length) {
            active(signal, deadline);
            const read = await handle.read(buffer, size, buffer.length - size, size);
            if (!read.bytesRead) break;
            size += read.bytesRead;
        }
        if (size > LIMITS.fileBytes) failure('DOCUMENT_TOO_LARGE');
        const after = await handle.stat();
        if (size !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) failure('DOCUMENT_STALE');
        await resolveFile(root, name); // Reject a path moved/replaced outside the approved root while reading.
        const current = await fs.stat(file);
        if (current.dev !== after.dev || current.ino !== after.ino || current.size !== after.size || current.mtimeMs !== after.mtimeMs) failure('DOCUMENT_STALE');
        active(signal, deadline);
        const bytes = buffer.subarray(0, size);
        if (bytes.includes(0)) failure('DOCUMENT_UNSUPPORTED');
        let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { failure('DOCUMENT_UNSUPPORTED'); }
        return { text, revision: hash(bytes), bytes };
    } finally { await handle.close(); }
}
async function roots(req) {
    const account = userRoot(req);
    const rows = [{ id: 'workspace', title: 'Muyu workspace', path: path.join(account, '.group-director', 'muyu', 'workspace') }];
    // Only an administrator with filesystem access can register additional read-only roots.
    const configDir = path.join(account, '.group-director', 'muyu');
    await canonical(account);
    let config;
    // Configuration is not a model-readable document. Check each component without the public path grammar.
    const configFile = path.join(configDir, 'document-roots.json');
    try {
        for (const directory of [account, path.join(account, '.group-director'), configDir]) {
            const stat = await fs.lstat(directory); if (stat.isSymbolicLink() || !stat.isDirectory()) failure('DOCUMENT_CONFIG_INVALID');
        }
        const stat = await fs.lstat(configFile);
        if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 16384) failure('DOCUMENT_CONFIG_INVALID');
        const handle = await fs.open(configFile, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
        try {
            const bytes = Buffer.alloc(16385); const read = await handle.read(bytes, 0, bytes.length, 0);
            if (read.bytesRead > 16384) failure('DOCUMENT_CONFIG_INVALID');
            config = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, read.bytesRead)));
        } finally { await handle.close(); }
    } catch (error) { if (error.code !== 'ENOENT') failure('DOCUMENT_CONFIG_INVALID'); }
    if (config !== undefined) {
        if (!config || config.version !== 1 || Object.keys(config).some(key => !['version', 'roots'].includes(key)) || !Array.isArray(config.roots) || config.roots.length > LIMITS.roots) failure('DOCUMENT_CONFIG_INVALID');
        for (const row of config.roots) {
            if (!row || Object.keys(row).some(key => !['id', 'title', 'path'].includes(key)) || typeof row.id !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(row.id) || rows.some(item => item.id === row.id) ||
                typeof row.title !== 'string' || !row.title.trim() || row.title.length > 80 || typeof row.path !== 'string' || !path.isAbsolute(row.path) || row.path.includes('\0')) failure('DOCUMENT_CONFIG_INVALID');
            rows.push({ id: row.id, title: row.title, path: row.path });
        }
    }
    return rows.map(row => ({ ...row, revision: hash(row.id + '\0' + path.resolve(row.path)) }));
}
async function rootFor(req, input) {
    const rows = await roots(req), root = rows.find(row => row.id === input.root);
    if (!root) failure('DOCUMENT_ROOT_UNAVAILABLE');
    if (root.revision !== input.rootRevision) failure('DOCUMENT_STALE');
    try {
        // Account-private components may not be redirected via links/junctions either.
        if (root.id === 'workspace') {
            const account = userRoot(req);
            for (const dir of [account, path.join(account, '.group-director'), path.join(account, '.group-director', 'muyu')]) {
                const stat = await fs.lstat(dir); if (stat.isSymbolicLink() || !stat.isDirectory()) failure('DOCUMENT_ROOT_UNAVAILABLE');
            }
        }
        return { ...root, path: await canonical(root.path) };
    } catch (error) {
        if (error.code === 'ENOENT' && root.id === 'workspace') return { ...root, missing: true };
        failure('DOCUMENT_ROOT_UNAVAILABLE');
    }
}
async function inventory(root, signal, deadline) {
    const files = [], stack = [{ name: '', depth: 0 }]; let entries = 0, limited = false;
    while (stack.length) {
        active(signal, deadline); const current = stack.pop();
        const directory = current.name ? await resolveFile(root, current.name) : root;
        const handle = await fs.opendir(directory);
        for await (const entry of handle) {
            active(signal, deadline);
            if (++entries > LIMITS.entries) { limited = true; break; }
            if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.isSymbolicLink()) continue;
            const name = current.name ? current.name + '/' + entry.name : entry.name;
            try { relative(name); } catch { continue; }
            if (entry.isDirectory()) { if (current.depth < LIMITS.depth) stack.push({ name, depth: current.depth + 1 }); else limited = true; }
            else if (entry.isFile() && permitted(name)) { files.push(name); if (files.length >= LIMITS.files) { limited = true; break; } }
        }
        if (entries > LIMITS.entries || files.length >= LIMITS.files) break;
    }
    files.sort(); return { files, limited };
}
function validate(operation, input) {
    const allowed = { roots: [], list: ['root', 'rootRevision', 'offset'], search: ['root', 'rootRevision', 'query'], read: ['root', 'rootRevision', 'path', 'revision', 'line', 'column', 'maxChars'] }[operation];
    if (!allowed || !input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) failure('DOCUMENT_INVALID');
    if (operation === 'roots') return;
    if (typeof input.root !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(input.root) || typeof input.rootRevision !== 'string' || !/^[0-9a-f]{64}$/.test(input.rootRevision)) failure('DOCUMENT_INVALID');
    if (operation === 'list' && (!Number.isInteger(input.offset) || input.offset < 0 || input.offset > LIMITS.files)) failure('DOCUMENT_INVALID');
    if (operation === 'search' && (typeof input.query !== 'string' || input.query.trim().length < 2 || input.query.length > 120)) failure('DOCUMENT_INVALID');
    if (operation === 'read' && (typeof input.revision !== 'string' || !/^[0-9a-f]{64}$/.test(input.revision) || !Number.isInteger(input.line) || input.line < 1 || input.line > LIMITS.fileBytes || !Number.isInteger(input.maxChars) || input.maxChars < 2 || input.maxChars > 8000)) failure('DOCUMENT_INVALID');
    if (operation === 'read') relative(input.path);
    if (operation === 'read' && input.column !== undefined && (!Number.isInteger(input.column) || input.column < 0 || input.column > LIMITS.fileBytes)) failure('DOCUMENT_INVALID');
}
function createDocumentService() {
    const counts = new Map();
    return { async run(operation, req, input, signal) {
        validate(operation, input); const account = userRoot(req);
        if ((counts.get(account) || 0) >= 2 || counts.size >= 256 && !counts.has(account)) failure('DOCUMENT_BUSY');
        counts.set(account, (counts.get(account) || 0) + 1);
        const deadline = Date.now() + LIMITS.timeMs;
        try {
            active(signal, deadline);
            if (operation === 'roots') return { version: 1, status: 'ok', roots: (await roots(req)).map(({ id, title, revision }) => ({ id, title, revision })) };
            const root = await rootFor(req, input); active(signal, deadline);
            if (root.missing) return { version: 1, status: 'empty', root: root.id, items: [], limited: false, nextOffset: -1 };
            if (operation === 'read') {
                const saved = await readText(root.path, input.path, signal, deadline);
                if (saved.revision !== input.revision) failure('DOCUMENT_STALE');
                const normalized = saved.text.replace(/\r\n/g, '\n'), lines = normalized.split('\n'), column = input.column || 0;
                if (input.line > lines.length || column > lines[input.line - 1].length) failure('DOCUMENT_INVALID');
                const start = lines.slice(0, input.line - 1).reduce((sum, line) => sum + line.length + 1, 0) + column;
                if (/[\uDC00-\uDFFF]/.test(normalized.charAt(start))) failure('DOCUMENT_INVALID');
                let end = Math.min(normalized.length, start + input.maxChars);
                if (end < normalized.length && /[\uD800-\uDBFF]/.test(normalized.charAt(end - 1))) end--;
                const text = normalized.slice(start, end), parts = text.split('\n'), limited = end < normalized.length;
                return { version: 1, status: 'ok', root: root.id, path: input.path, revision: saved.revision, line: input.line, column, text,
                    nextLine: limited ? input.line + parts.length - 1 : -1,
                    nextColumn: limited ? parts.length > 1 ? parts[parts.length - 1].length : column + text.length : 0, limited };
            }
            const listing = await inventory(root.path, signal, deadline);
            const items = []; let skipped = 0, scanned = 0, limited = listing.limited;
            const candidates = operation === 'list' ? listing.files.slice(input.offset, input.offset + 30) : listing.files;
            for (const name of candidates) {
                active(signal, deadline);
                let saved; try { saved = await readText(root.path, name, signal, deadline); }
                catch (error) { if (['DOCUMENT_ABORTED', 'DOCUMENT_TIMEOUT'].includes(error.message)) throw error; skipped++; limited = true; continue; }
                scanned++;
                if (operation === 'list') items.push({ path: name, revision: saved.revision });
                else {
                    const lines = saved.text.split(/\r?\n/), query = input.query.trim().toLowerCase();
                    for (let i = 0; i < lines.length; i++) {
                        const line = lines[i], folded = line.toLowerCase(), hit = folded.indexOf(query);
                        if (hit < 0) continue;
                        let originalHit = hit;
                        if (folded.length !== line.length) {
                            // Lowercase expansion (e.g. İ -> i + combining dot) shifts
                            // UTF-16 offsets. Match the whole line to retain contextual
                            // casing, then map the hit back to the original text.
                            let offset = 0, foldedOffset = 0;
                            for (const character of line) {
                                const width = character.toLowerCase().length;
                                if (foldedOffset + width > hit) { originalHit = offset; break; }
                                foldedOffset += width; offset += character.length;
                            }
                        }
                        items.push({ path: name, revision: saved.revision, line: i + 1, snippet: line.slice(Math.max(0, originalHit - 100), originalHit + 400) });
                        if (items.length >= 20) { limited = true; break; }
                    }
                    if (items.length >= 20) break;
                }
            }
            const end = operation === 'list' ? input.offset + candidates.length : listing.files.length;
            return { version: 1, status: items.length ? 'ok' : 'empty', root: root.id, items, scanned, skipped,
                limited: limited || operation === 'list' && end < listing.files.length,
                nextOffset: operation === 'list' && end < listing.files.length ? end : -1 };
        } finally { const count = counts.get(account) - 1; if (count) counts.set(account, count); else counts.delete(account); }
    } };
}
function registerDocuments(router, service = createDocumentService()) {
    for (const operation of ['roots', 'list', 'search', 'read']) router.post('/documents/' + operation, (req, res) => {
        const abort = new AbortController(), stop = () => { if (!res.writableEnded) abort.abort(); };
        req.on?.('aborted', stop); res.on?.('close', stop);
        void service.run(operation, req, req.body, abort.signal).then(value => { if (!abort.signal.aborted) res.json(value); }, error => {
            const code = errorCodes.has(error?.message) ? error.message : 'DOCUMENT_ROOT_UNAVAILABLE';
            if (!abort.signal.aborted) res.status(code === 'DOCUMENT_BUSY' ? 429 : code === 'DOCUMENT_INVALID' ? 400 : 409).json({ error: code });
        }).finally(() => { req.off?.('aborted', stop); res.off?.('close', stop); });
    });
}
module.exports = { createDocumentService, registerDocuments, LIMITS,
    fileSafety: Object.freeze({ canonical, relative, readText, userRoot }) };
