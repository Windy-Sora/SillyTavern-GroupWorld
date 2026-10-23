import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createDocumentService, registerDocuments } = require('../../muyu/server-plugin/documents.cjs');
async function fixture(t) {
    const account = await fs.mkdtemp(path.join(os.tmpdir(), 'muyu-documents-'));
    t.after(() => fs.rm(account, { recursive: true, force: true }));
    const workspace = path.join(account, '.group-director', 'muyu', 'workspace');
    const req = { user: { directories: { root: account } } }, service = createDocumentService();
    const root = async () => (await service.run('roots', req, {})).roots[0];
    const args = async () => { const row = await root(); return { root: row.id, rootRevision: row.revision }; };
    return { account, workspace, req, service, root, args };
}
test('Document roots are account scoped and do not create files, reveal paths or accept request roots', async t => {
    const f = await fixture(t), root = await f.root();
    assert.equal(root.id, 'workspace'); assert.equal(root.revision.length, 64);
    assert.ok(!JSON.stringify(root).includes(f.account));
    await assert.rejects(fs.stat(f.workspace), { code: 'ENOENT' });
    const empty = await f.service.run('list', f.req, { ...await f.args(), offset: 0 }); assert.equal(empty.status, 'empty');
    await assert.rejects(f.service.run('roots', f.req, { root: f.account }), /DOCUMENT_INVALID/);
    await assert.rejects(f.service.run('roots', { query: { root: f.account } }, {}), /IDENTITY_UNAVAILABLE/);
});
test('Literal search returns bounded evidence; long-line and CRLF reads advance without dropping text', async t => {
    const f = await fixture(t); await fs.mkdir(f.workspace, { recursive: true });
    const content = 'needle '.repeat(1400) + '\r\n第二行 😀 needle\r\n最后一行';
    await fs.writeFile(path.join(f.workspace, 'guide.md'), content);
    const base = await f.args(), search = await f.service.run('search', f.req, { ...base, query: 'needle' });
    assert.equal(search.status, 'ok'); assert.equal(search.items[0].line, 1); assert.ok(search.items.every(item => item.snippet.length <= 500));
    let line = 1, column = 0, combined = '', rounds = 0;
    do {
        const page = await f.service.run('read', f.req, { ...base, path: 'guide.md', revision: search.items[0].revision, line, column, maxChars: 1000 });
        combined += page.text; line = page.nextLine; column = page.nextColumn; assert.ok(++rounds < 20);
    } while (line !== -1);
    assert.equal(combined, content.replace(/\r\n/g, '\n'));
    await fs.writeFile(path.join(f.workspace, 'guide.md'), 'changed');
    await assert.rejects(f.service.run('read', f.req, { ...base, path: 'guide.md', revision: search.items[0].revision, line: 1, maxChars: 1000 }), /DOCUMENT_STALE/);
});
test('Traversal, hidden/secret/unsupported files and binary/oversize data are not readable', async t => {
    const f = await fixture(t); await fs.mkdir(f.workspace, { recursive: true }); const base = await f.args();
    for (const name of ['../secret.md', 'C:/secret.md', '/secret.md', 'x\\secret.md', '.env', 'a/../secret.md', 'x:stream', 'a. /secret.md', 'CON.md', 'folder/NUL.txt']) {
        await assert.rejects(f.service.run('read', f.req, { ...base, path: name, revision: '0'.repeat(64), line: 1, maxChars: 1000 }), /DOCUMENT_INVALID/);
    }
    await fs.writeFile(path.join(f.workspace, 'secrets.json'), '{"key":"PRIVATE"}');
    await fs.writeFile(path.join(f.workspace, 'binary.txt'), Buffer.from([1, 0, 2]));
    await fs.writeFile(path.join(f.workspace, 'large.md'), 'x'.repeat(262145));
    const listed = await f.service.run('list', f.req, { ...base, offset: 0 });
    assert.equal(listed.items.length, 0); assert.equal(listed.limited, true); assert.equal(listed.skipped, 2);
    await assert.rejects(f.service.run('read', f.req, { ...base, path: 'secrets.json', revision: '0'.repeat(64), line: 1, maxChars: 1000 }), /UNSUPPORTED/);
});
test('Only server-side configuration registers extra roots; retargeting invalidates root revisions', async t => {
    const f = await fixture(t); await fs.mkdir(f.workspace, { recursive: true });
    const docs = path.join(f.account, 'approved'); await fs.mkdir(docs); await fs.writeFile(path.join(docs, 'rules.md'), 'needle');
    const config = path.join(f.account, '.group-director', 'muyu', 'document-roots.json');
    await fs.writeFile(config, JSON.stringify({ version: 1, roots: [{ id: 'docs', title: 'Docs', path: docs }] }));
    const roots = (await f.service.run('roots', f.req, {})).roots; assert.equal(roots.length, 2); assert.ok(!JSON.stringify(roots).includes(docs));
    const base = { root: roots[1].id, rootRevision: roots[1].revision };
    assert.equal((await f.service.run('search', f.req, { ...base, query: 'needle' })).items.length, 1);
    await fs.writeFile(config, JSON.stringify({ version: 1, roots: [{ id: 'docs', title: 'Docs', path: f.account }] }));
    await assert.rejects(f.service.run('list', f.req, { ...base, offset: 0 }), /DOCUMENT_STALE/);
    await fs.writeFile(config, '{"version":1,"roots":[{"id":"x","title":"X","path":"relative"}]}');
    await assert.rejects(f.service.run('roots', f.req, {}), /DOCUMENT_CONFIG_INVALID/);
});
test('Directory links/junctions cannot escape an approved root', async t => {
    const f = await fixture(t); await fs.mkdir(f.workspace, { recursive: true });
    const outside = path.join(f.account, 'outside'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'secret.md'), 'PRIVATE');
    await fs.symlink(outside, path.join(f.workspace, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    const base = await f.args();
    const list = await f.service.run('list', f.req, { ...base, offset: 0 }); assert.equal(list.items.length, 0);
    await assert.rejects(f.service.run('read', f.req, { ...base, path: 'linked/secret.md', revision: '0'.repeat(64), line: 1, maxChars: 1000 }), /DOCUMENT_UNSUPPORTED/);
});
test('HTTP document routes sanitize errors and honor abort before any document read', async () => {
    const routes = new Map(); registerDocuments({ post: (p, h) => routes.set(p, h) });
    const res = { code: 200, status(code) { this.code = code; return this; }, json(value) { this.value = value; } };
    routes.get('/documents/roots')({ body: {}, query: { root: 'PRIVATE' } }, res);
    await new Promise(resolve => setImmediate(resolve)); assert.equal(res.value.error, 'HISTORY_IDENTITY_UNAVAILABLE');
    const controller = new AbortController(); controller.abort();
    await assert.rejects(createDocumentService().run('roots', { user: { directories: { root: process.cwd() } } }, {}, controller.signal), /DOCUMENT_ABORTED/);
});
test('BUG-3: Unicode lowercase expansion maps search snippets to original UTF-16 positions', async t => {
    const f = await fixture(t); await fs.mkdir(f.workspace, { recursive: true });
    const contents = [
        'İ'.repeat(600) + 'needle',
        '😀İ'.repeat(600) + 'NEEDLE',
        'İ'.repeat(600) + ' ΟΣ',
        'İ'.repeat(600) + '[a+b]',
    ];
    await fs.writeFile(path.join(f.workspace, 'unicode.md'), contents.join('\n'));
    const base = await f.args();
    const search = query => f.service.run('search', f.req, { ...base, query });
    const hits = await search('needle');
    assert.deepEqual(hits.items.map(row => row.line), [1, 2]);
    assert.ok(hits.items.every(row => row.snippet.toLowerCase().includes('needle') && row.snippet.length <= 500));
    const greek = await search('ος');
    assert.equal(greek.items.length, 1); assert.ok(greek.items[0].snippet.includes('ΟΣ'));
    const literal = await search('[a+b]');
    assert.equal(literal.items.length, 1); assert.ok(literal.items[0].snippet.includes('[a+b]'));
    const expansion = await search('i\u0307');
    assert.ok(expansion.items.every(row => row.snippet.includes('İ')));
    const read = await f.service.run('read', f.req, { ...base, path: 'unicode.md', revision: hits.items[0].revision, line: 1, maxChars: 1000 });
    assert.ok(read.text.startsWith(contents[0]));
});
