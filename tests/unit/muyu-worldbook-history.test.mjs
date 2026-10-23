import test from 'node:test';
import assert from 'node:assert/strict';
import { openWorldBookHistoryStore } from '../../muyu/sessions/worldbook-store.js';
import { openStWorldBookHistoryStore } from '../../muyu/host/worldbook-history.js';
import { createSessionLibrary } from '../../muyu/sessions/library.js';
import { historyScope, validateRecord } from '../../muyu/sessions/contract.js';
import { WORLD_BOOK_HISTORY_KEY as KEY, WORLD_BOOK_HISTORY_LIMITS as LIMITS, historyBookName, isHistoryBookName,
    encodeHistoryBook, decodeHistoryBook } from '../../muyu/sessions/worldbook-contract.js';

const namespace = '12345678-1234-1234-1234-123456789012';
const scope = historyScope('assistant', { kind: 'chat', chatKey: 'A' });
const record = () => validateRecord({ version: 7, id: crypto.randomUUID(), revision: 0, scope, title: 'Private title', createdAt: 1, updatedAt: 2,
    messages: [{ role: 'user', content: '私人对话 {{getvar::gold}} <script>text only</script>', runId: 'r', origin: 'question' },
        { role: 'assistant', content: 'Answer', runId: 'r' }], required: [], status: 'succeeded', archived: false, imported: false, contextSummary: null, receipts: [], scopeChanges: [] });
const clone = value => structuredClone(value);
test('Archive opens with bilingual purpose, privacy, deletion and management instructions', async () => {
    const value = { ...record(), revision: 1 }, encoded = await encodeHistoryBook({ namespace, record: value, revision: 1 });
    const first = encoded.data.entries[0];
    assert.match(first.comment, /^00.*暮羽.*删除警告.*READ FIRST/);
    for (const text of ['不是剧情世界书', '每本对应一份', '明文', '不要改名', '删除整本', '删除任何数据条目', '不会因此撤销', '历史侧栏', '备份', 'NOT story lore', 'Deleting the book', 'Plaintext']) assert.ok(first.content.includes(text), text);
    assert.equal(first.disable, true); assert.equal(first.constant, false);
    assert.equal(first.content.includes(value.title), false);
    assert.deepEqual((await decodeHistoryBook(encoded.name, encoded.data, namespace)).record, value);
    const deleted = await encodeHistoryBook({ namespace, recordId: value.id, revision: 2, deleted: true });
    assert.equal(Object.keys(deleted.data.entries).length, 1);
    for (const text of ['保护标记', '不含会话正文', '防复活保护', 'resurrection protection', 'NO conversation body']) assert.ok(deleted.data.entries[0].content.includes(text), text);
    assert.equal((await decodeHistoryBook(deleted.name, deleted.data, namespace)).record, null);
});

for (const deleted of [false, true]) test(`Updated notices remain compatible with exact legacy archives (deleted=${deleted})`, async () => {
    const value = { ...record(), revision: 1 };
    const encoded = await encodeHistoryBook({ namespace, record: value, recordId: value.id, revision: 1, deleted });
    for (const [key, row] of Object.entries(encoded.data.entries)) row.comment = Number(key) ? `Muyu archive data ${key}` : 'Muyu archive — disabled / 暮羽存档，请勿启用';
    encoded.data.entries[0].content = '暮羽对话存档，由插件自动维护，无需启用或绑定。删除会丢失相应历史。 / Muyu conversation archive. Do not enable or bind; managed by the extension. Deleting it loses this history.';
    assert.deepEqual((await decodeHistoryBook(encoded.name, encoded.data, namespace)).record, deleted ? null : value);
    encoded.data.entries[0].content = 'arbitrary replacement';
    await assert.rejects(decodeHistoryBook(encoded.name, encoded.data, namespace), /HISTORY_INVALID/);
});
function fixture() {
    const books = new Map(), calls = [];
    const repository = {
        async list() { calls.push('list'); return [...books].map(([file_id, data]) => ({ file_id, name: file_id, extensions: clone(data.extensions || {}) })); },
        async load(name) { calls.push('load'); return clone(books.get(name) || { entries: {} }); },
        async save(name, data) { calls.push('save'); books.set(name, clone(data)); },
    };
    const open = (options = {}) => openWorldBookHistoryStore({ namespace, repository, ...options });
    return { books, calls, repository, open };
}

test('World-book archive persists and restores complete versioned records, with metadata-only listing', async () => {
    const f = fixture(), store = f.open(), input = record();
    const saved = await store.create(input);
    assert.equal(saved.revision, 1); assert.equal(input.revision, 0); assert.equal(f.books.size, 1);
    const reopened = f.open(); f.calls.length = 0;
    const [summary] = await reopened.list();
    assert.equal(summary.id, saved.id); assert.equal(summary.count, 2); assert.equal('messages' in summary, false);
    assert.deepEqual(f.calls, ['list']);
    const copy = await reopened.read(input.id); assert.deepEqual(copy, saved);
    copy.messages[0].content = 'changed local copy'; assert.deepEqual(await reopened.read(input.id), saved);
    const updated = await reopened.update({ ...saved, title: 'Renamed', archived: true }, 1);
    assert.equal(updated.revision, 2); assert.equal((await f.open().read(saved.id)).archived, true);
});

test('All archive entries are inert and long Unicode data splits and round-trips without losing text', async () => {
    const f = fixture(), input = record(); input.messages[0].content = '羽🦉'.repeat(60000);
    const saved = await f.open().create(input), name = historyBookName(namespace, input.id), data = f.books.get(name);
    assert.ok(Object.keys(data.entries).length > 2); assert.equal(isHistoryBookName(name), true);
    for (const entry of Object.values(data.entries)) {
        assert.equal(entry.disable, true); assert.equal(entry.constant, false);
        assert.deepEqual(entry.key, []); assert.deepEqual(entry.keysecondary, []);
        assert.equal(entry.excludeRecursion, true); assert.equal(entry.preventRecursion, true);
    }
    assert.deepEqual((await decodeHistoryBook(name, data, namespace)).record, saved);
});

test('Independent conversations occupy separate books; ordinary and other-account resources stay unchanged', async () => {
    const f = fixture(), ordinary = { entries: { 0: { content: 'Lore', disable: false } } };
    f.books.set('Ordinary world', clone(ordinary));
    const other = '87654321-4321-4321-4321-210987654321', foreign = await encodeHistoryBook({ namespace: other, record: { ...record(), revision: 1 }, revision: 1 });
    f.books.set(foreign.name, foreign.data);
    const first = await f.open().create(record()), second = await f.open().create(record());
    const secondBefore = clone(f.books.get(historyBookName(namespace, second.id)));
    await f.open().update({ ...first, title: 'Updated' }, first.revision);
    assert.equal((await f.open().list()).length, 2);
    assert.deepEqual(f.books.get('Ordinary world'), ordinary);
    assert.deepEqual(f.books.get(foreign.name), foreign.data);
    assert.deepEqual(f.books.get(historyBookName(namespace, second.id)), secondBefore);
});

test('Reserved-name collisions and malformed ownership never authorize overwriting a world book', async () => {
    const f = fixture(), input = record(), name = historyBookName(namespace, input.id), ordinary = { entries: { 0: { content: 'Do not erase' } } };
    f.books.set(name, ordinary);
    await assert.rejects(f.open().create(input), /HISTORY_INVALID/);
    assert.deepEqual(f.books.get(name), ordinary); assert.equal(f.calls.includes('save'), false);
    assert.throws(() => historyBookName(namespace, '../escape'), /HISTORY_INVALID/);
    assert.equal(isHistoryBookName('GD-Muyu-History-v1-not-an-id'), false);
});

test('A missing directory item is probed before creation, protecting omitted or unreadable files', async () => {
    const f = fixture(), input = record(), name = historyBookName(namespace, input.id);
    f.books.set(name, { entries: { 0: { content: 'directory omitted this resource' } } });
    f.repository.list = async () => [];
    await assert.rejects(f.open().create(input), /HISTORY_CONFLICT/);
    assert.equal(f.calls.includes('save'), false);
    f.repository.load = async () => { throw Error('HISTORY_UNAVAILABLE'); };
    await assert.rejects(f.open().create(input), /HISTORY_UNAVAILABLE/);
    assert.equal(f.calls.includes('save'), false);
});

for (const mutation of ['enabled', 'keyword', 'extra-entry', 'chunk', 'summary', 'version', 'foreign-namespace']) {
    test(`Invalid archive (${mutation}) is rejected before an update or removal`, async () => {
        const f = fixture(), store = f.open(), saved = await store.create(record()), name = historyBookName(namespace, saved.id);
        const data = f.books.get(name);
        if (mutation === 'enabled') data.entries[1].disable = false;
        if (mutation === 'keyword') data.entries[1].key = ['activate'];
        if (mutation === 'extra-entry') data.entries[99] = { content: 'unexpected user addition' };
        if (mutation === 'chunk') data.entries[1].content += 'x';
        if (mutation === 'summary') data.extensions[KEY].summary.title = 'Forged metadata';
        if (mutation === 'version') data.extensions[KEY].version = 99;
        if (mutation === 'foreign-namespace') data.extensions[KEY].namespace = crypto.randomUUID();
        const before = clone(data); f.calls.length = 0;
        await assert.rejects(store.update({ ...saved, title: 'No' }, saved.revision), /HISTORY_(INVALID|VERSION)/);
        await assert.rejects(store.remove(saved.id, saved.revision), /HISTORY_(INVALID|VERSION)/);
        assert.equal(f.calls.includes('save'), false); assert.deepEqual(f.books.get(name), before);
    });
}

test('Sequential device changes reject stale revisions and deletion removes text without allowing resurrection', async () => {
    const f = fixture(), a = f.open(), b = f.open(), saved = await a.create(record());
    const updated = await b.update({ ...saved, title: 'Other device' }, 1);
    await assert.rejects(a.update({ ...saved, title: 'Stale' }, 1), /HISTORY_CONFLICT/);
    await assert.rejects(a.remove(saved.id, 1), /HISTORY_CONFLICT/);
    await b.remove(saved.id, updated.revision);
    const text = JSON.stringify(f.books.get(historyBookName(namespace, saved.id)));
    assert.ok(!text.includes('Private title')); assert.ok(!text.includes('私人对话')); assert.ok(!text.includes('Other device'));
    assert.equal(await a.read(saved.id), null); assert.deepEqual(await f.open().list(), []);
    await assert.rejects(a.update(saved, 1), /HISTORY_DELETED/);
    await assert.rejects(a.create(saved), /HISTORY_DELETED/);
    await assert.rejects(a.remove(saved.id, updated.revision), /HISTORY_DELETED/);
});

test('Same-page store instances serialize edits and do not swallow a failure in the queue', async () => {
    const f = fixture(), saved = await f.open().create(record());
    const results = await Promise.allSettled([f.open().update({ ...saved, title: 'A' }, 1), f.open().update({ ...saved, title: 'B' }, 1)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.find(r => r.status === 'rejected').reason.message, 'HISTORY_CONFLICT');
    const winner = await f.open().read(saved.id);
    assert.equal((await f.open().update({ ...winner, title: 'C' }, winner.revision)).revision, 3);
});

test('A change between directory listing and body read fails closed', async () => {
    const f = fixture(), saved = await f.open().create(record()), load = f.repository.load;
    f.repository.load = async name => { const value = await load(name); value.extensions[KEY].commitId = crypto.randomUUID(); return value; };
    await assert.rejects(f.open().read(saved.id), /HISTORY_CONFLICT/);
});

test('Network failure before saving retains the old record and permits a fresh retry', async () => {
    const f = fixture(), saved = await f.open().create(record()), save = f.repository.save;
    f.repository.save = async () => { throw Error('HISTORY_SAVE_FAILED'); };
    await assert.rejects(f.open().update({ ...saved, title: 'Retry' }, 1), /HISTORY_SAVE_FAILED/);
    assert.deepEqual(await f.open().read(saved.id), saved);
    f.repository.save = save;
    assert.equal((await f.open().update({ ...saved, title: 'Retry' }, 1)).revision, 2);
});

test('A lost save acknowledgement is confirmed on exact retry without another write', async () => {
    const f = fixture(), store = f.open(), input = record(), save = f.repository.save;
    f.repository.save = async (name, data) => { await save(name, data); throw Error('HISTORY_SAVE_FAILED'); };
    await assert.rejects(store.create(input), /HISTORY_SAVE_FAILED/);
    f.calls.length = 0;
    const saved = await store.create(input);
    assert.equal(saved.revision, 1); assert.equal(f.calls.includes('save'), false);
    await assert.rejects(store.create({ ...input, title: 'Different content' }), /HISTORY_CONFLICT/);
});

test('A successful edit response is not confirmation if the server retained different content', async () => {
    const f = fixture(), saved = await f.open().create(record());
    f.repository.save = async () => {};
    await assert.rejects(f.open().update({ ...saved, title: 'Not written' }, 1), /HISTORY_CONFLICT/);
    assert.deepEqual(await f.open().read(saved.id), saved);
});

test('Library preserves unsaved answers after storage failure and retry persists the working copy', async () => {
    const f = fixture(), store = f.open(), library = createSessionLibrary({ port: { enabled: () => true, open: async () => store } });
    await library.ready;
    const id = library.create(scope); await library.flush();
    const save = f.repository.save;
    f.repository.save = async () => { throw Error('HISTORY_SAVE_FAILED'); };
    library.update(id, { messages: record().messages, status: 'succeeded' }); await library.flush();
    assert.equal(library.get(id).messages.length, 2); assert.equal((await store.read(id)).messages.length, 0);
    assert.equal(library.snapshot(scope, id).error, 'HISTORY_SAVE_FAILED');
    assert.match(library.export(id), /Answer/);
    f.repository.save = save; await library.retry(); await library.flush();
    assert.equal((await store.read(id)).messages.length, 2); await library.close();
});

test('World-book capacity preflight accounts for saved and unsaved records', async () => {
    const f = fixture(), store = f.open(), input = record(); await store.list();
    assert.throws(() => store.assertCapacity(input, LIMITS.recordBytes), /HISTORY_CAPACITY/);
    const working = Array.from({ length: 64 }, () => record());
    assert.throws(() => store.assertCapacity(input, 0, working), /HISTORY_CAPACITY/);
    const large = record(); large.messages = Array.from({ length: 9 }, () => ({ role: 'user', content: 'x'.repeat(1024 * 1024 - 1000), runId: 'r' }));
    await assert.rejects(store.create(large), /HISTORY_CAPACITY/); assert.equal(f.calls.includes('save'), false);
});

test('Account total capacity is checked using other saved conversations, not only the active body', async () => {
    const f = fixture(), input = record();
    // Directory summaries are the capacity inventory; loading every archived body is unnecessary.
    for (let i = 0; i < 9; i++) {
        const encoded = await encodeHistoryBook({ namespace, record: { ...record(), revision: 1 }, revision: 1 });
        encoded.data.extensions[KEY].payloadBytes = 8 * 1024 * 1024;
        encoded.data.extensions[KEY].summary.bytes = 8 * 1024 * 1024;
        f.books.set(encoded.name, encoded.data);
    }
    const store = f.open(); await store.list();
    assert.throws(() => store.assertCapacity(input, 0), /HISTORY_CAPACITY/);
    await assert.rejects(store.create(input), /HISTORY_CAPACITY/);
    assert.equal(f.calls.includes('save'), false);
});

test('Failed read-back leaves the result unconfirmed; exact retry validates the durable record', async () => {
    const f = fixture(), store = f.open(), input = record(), load = f.repository.load, save = f.repository.save;
    let written = false;
    f.repository.save = async (...args) => { await save(...args); written = true; };
    f.repository.load = async name => { if (written) throw Error('HISTORY_UNAVAILABLE'); return load(name); };
    await assert.rejects(store.create(input), /HISTORY_UNAVAILABLE/);
    f.repository.load = load; f.calls.length = 0;
    assert.equal((await store.create(input)).revision, 1); assert.equal(f.calls.includes('save'), false);
});

test('A lost deletion acknowledgement leaves a text-free tombstone and never recreates history', async () => {
    const f = fixture(), store = f.open(), saved = await store.create(record()), save = f.repository.save;
    f.repository.save = async (...args) => { await save(...args); throw Error('HISTORY_SAVE_FAILED'); };
    await assert.rejects(store.remove(saved.id, 1), /HISTORY_SAVE_FAILED/);
    assert.equal(await store.read(saved.id), null);
    await assert.rejects(store.remove(saved.id, 1), /HISTORY_DELETED/);
    await assert.rejects(store.create(saved), /HISTORY_DELETED/);
    assert.ok(!JSON.stringify([...f.books.values()]).includes('私人对话'));
});

test('Archive count capacity is enforced at save, and deleted markers do not consume active slots', async () => {
    const f = fixture(), store = f.open(), saved = [];
    for (let i = 0; i < 64; i++) saved.push(await store.create(record()));
    await assert.rejects(store.create(record()), /HISTORY_CAPACITY/);
    await store.remove(saved[0].id, 1);
    await store.create(record()); assert.equal((await store.list()).length, 64);
});

function httpFixture(options = {}) {
    const f = fixture(), requests = []; let identity = 'account-A';
    const fetcher = async (url, init) => {
        const route = url.split('/').at(-1), body = JSON.parse(init.body); requests.push({ url, init, body });
        if (options.intercept) { const response = await options.intercept({ route, body, f }); if (response) return response; }
        if (route === 'list') return Response.json(await f.repository.list());
        if (route === 'get') return Response.json(await f.repository.load(body.name));
        if (route === 'edit') { await f.repository.save(body.name, body.data); return Response.json({ ok: true }); }
        throw Error('Unexpected request');
    };
    return { ...f, requests, switchAccount: () => { identity = 'account-B'; },
        open: (overrides = {}) => openStWorldBookHistoryStore({ namespace, fetcher, getHeaders: () => ({ 'X-CSRF-Token': 'local-token' }),
            assertIdentity: async () => { if (identity !== 'account-A') throw Error('HISTORY_IDENTITY_UNAVAILABLE'); }, locks: null, ...overrides }) };
}

test('ST adapter uses native authenticated world-info endpoints and fresh HTTP verification, with no plugin API', async () => {
    const f = httpFixture(), store = f.open(), saved = await store.create(record());
    assert.deepEqual(await f.open().read(saved.id), saved);
    assert.ok(f.requests.length > 3);
    for (const { url, init } of f.requests) {
        assert.match(url, /^\/api\/worldinfo\/(list|get|edit)$/);
        assert.equal(init.cache, 'no-store'); assert.equal(init.credentials, 'same-origin'); assert.equal(init.method, 'POST');
        assert.equal(init.headers['X-CSRF-Token'], 'local-token'); assert.ok(init.signal);
    }
    await store.remove(saved.id, 1);
    assert.ok(f.requests.every(r => !r.url.endsWith('/delete')));
});

for (const response of ['http-error', 'false-ok', 'invalid-json']) {
    test(`ST adapter does not accept edit ${response} as a confirmed save`, async () => {
        const f = httpFixture({ intercept: ({ route }) => route !== 'edit' ? null : response === 'http-error' ? new Response('internal details', { status: 500 }) :
            response === 'false-ok' ? Response.json({ ok: false }) : new Response('not-json') });
        await assert.rejects(f.open().create(record()), /HISTORY_(SAVE_FAILED|INVALID)/);
        assert.equal(f.books.size, 0);
    });
}

test('Identity changes during header preparation prevent writes to another account', async () => {
    const f = httpFixture();
    const store = f.open({ getHeaders: async () => { f.switchAccount(); return {}; } });
    await assert.rejects(store.list(), /HISTORY_IDENTITY_UNAVAILABLE/);
    assert.equal(f.requests.length, 0);
    assert.throws(() => openStWorldBookHistoryStore({ namespace }), /HISTORY_IDENTITY_UNAVAILABLE/);
});

test('Identity changes during a response do not expose that response as history', async () => {
    const f = httpFixture({ intercept: () => { f.switchAccount(); return Response.json([]); } });
    await assert.rejects(f.open().list(), /HISTORY_IDENTITY_UNAVAILABLE/);
});

test('Web Locks are optional; when available, mutations request a namespace-scoped lock', async () => {
    const names = [], f = httpFixture();
    await f.open({ locks: { request: async (key, options, run) => { names.push([key, options.mode]); return run(); } } }).create(record());
    assert.deepEqual(names, [[`gd-muyu-history-worldbook:${namespace}`, 'exclusive']]);
});

test('ST timeouts abort pending fetches, and a closed store refuses new operations', async () => {
    const f = httpFixture(), store = f.open({ timeoutMs: 100, fetcher: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Error('timeout')), { once: true })) });
    await assert.rejects(store.list(), /HISTORY_UNAVAILABLE/);
    store.close(); await assert.rejects(store.list(), /HISTORY_UNAVAILABLE/);
});
