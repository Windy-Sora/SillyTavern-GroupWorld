import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistoryPort, historyStorageChoice } from '../../muyu/host/history.js';
import { createSessionLibrary } from '../../muyu/sessions/library.js';
import { createMemoryHistoryStore } from '../../muyu/sessions/memory-store.js';
import { historyScope } from '../../muyu/sessions/contract.js';
import { DEFAULT_SETTINGS } from '../../settings.js';
import { createConfigProfileSubject } from './helpers/config-profile-subject.mjs';
import { sanitizeImportedSettings } from '../../systems/config-profile-validation.js';
import { encodeHistoryBook } from '../../muyu/sessions/worldbook-contract.js';

const scope = historyScope('assistant', { kind: 'chat', chatKey: 'A' });
for (const sourceChoice of ['browser', 'account-settings', 'server']) test(`Explicit production migration copies ${sourceChoice} history through native world-book APIs only on request`, async () => {
    const f = fixture(), source = createMemoryHistoryStore(); let closes = 0;
    const record = await source.create({ version: 5, id: '10000000-0000-4000-8000-000000000001', revision: 0, scope, title: 'old', createdAt: 1, updatedAt: 1,
        messages: [{ role: 'user', content: 'private saved conversation', runId: 'r' }], required: ['source:memoryConfig'], status: 'succeeded', archived: false, imported: false, receipts: [], contextSummary: null });
    source.close = () => { closes++; };
    f.options.openStore = async () => source;
    f.options.openServer = async () => source;
    const store = await f.open().open();
    assert.equal(f.books.size, 0);
    // Seed another conversation to obtain the production namespace without bypassing identity derivation.
    await store.create({ ...record, id: '20000000-0000-4000-8000-000000000002' });
    const namespace = [...f.books.values()][0].extensions.gdMuyuHistory.namespace;
    f.settings.muyuHistoryData = { version: 1, namespace, records: [record] };
    const oldSettings = structuredClone(f.settings), oldSource = await source.read(record.id);
    const report = await store.copyHistoryFrom(sourceChoice);
    assert.equal(report.copied, 1); assert.equal(report.remaining, 0);
    assert.deepEqual(await store.read(record.id), record);
    assert.deepEqual(f.settings, oldSettings); assert.deepEqual(await source.read(record.id), oldSource);
    assert.equal((await store.copyHistoryFrom(sourceChoice)).identical, 1);
    if (sourceChoice !== 'account-settings') assert.equal(closes, 2);
    await assert.rejects(store.copyHistoryFrom('auto'), /HISTORY_INVALID/);
    store.close();
});

test('Missing service plugin during explicit copy does not fall back to another source', async () => {
    const f = fixture(); f.options.openServer = async () => null;
    const store = await f.open().open();
    await assert.rejects(store.copyHistoryFrom('server'), /HISTORY_UNAVAILABLE/);
    assert.equal(f.books.size, 0); store.close();
});
function fixture(settings = { muyuHistoryEnabled: true, muyuHistoryStorage: 'world-book' }) {
    const books = new Map(), requests = []; let account = { enabled: false }, save = async () => {}, online = true;
    const options = { getAccount: async () => account, getSettings: () => settings, saveSettings: () => save(),
        openServer: async () => { throw Error('Server backend must not be contacted'); },
        openStore: async () => { throw Error('IndexedDB must not be contacted'); },
        getHeaders: () => ({ 'X-CSRF-Token': 'local-test' }), fetcher: async (url, init) => {
            requests.push(url); if (!online) throw Error('offline');
            const body = JSON.parse(init.body);
            if (url.endsWith('/list')) return Response.json([...books].map(([file_id, data]) => ({ file_id, extensions: data.extensions })));
            if (url.endsWith('/get')) return Response.json(books.get(body.name) || { entries: {} });
            if (url.endsWith('/edit')) { books.set(body.name, structuredClone(body.data)); return Response.json({ ok: true }); }
            if (url.endsWith('/delete')) { books.delete(body.name); return new Response('OK', { status: 200 }); }
            throw Error('Unexpected endpoint');
        } };
    return { settings, books, requests, options, open: () => createHistoryPort(options),
        setAccount: value => { account = value; }, setSave: value => { save = value; }, setOnline: value => { online = value; } };
}

test('Storage choice preserves old account opt-in and defaults to auto without creating books', () => {
    assert.equal(DEFAULT_SETTINGS.muyuHistoryStorage, null);
    assert.equal(historyStorageChoice(DEFAULT_SETTINGS), 'auto');
    assert.equal(historyStorageChoice({ ...DEFAULT_SETTINGS, muyuHistoryAccountStorage: true }), 'account-settings');
    assert.equal(historyStorageChoice({ muyuHistoryStorage: 'auto', muyuHistoryAccountStorage: true }), 'auto');
    const f = fixture(); f.open(); assert.deepEqual(f.requests, []);
});

test('Production history port uses only native world-book storage and restores a conversation after reopening', async () => {
    const f = fixture(), library = createSessionLibrary({ port: f.open() }); await library.ready;
    assert.equal(library.snapshot(scope).backend, 'world-book'); assert.equal(f.books.size, 0);
    const id = library.create(scope); library.update(id, { messages: [{ role: 'user', content: 'PRIVATE', runId: 'r' }], status: 'succeeded' });
    await library.flush(); assert.equal(f.books.size, 1);
    await library.close();
    const reopened = createSessionLibrary({ port: f.open() }); await reopened.ready;
    assert.equal((await reopened.load(id)).messages[0].content, 'PRIVATE');
    assert.equal(reopened.snapshot(scope, id).persisted, true);
    assert.ok(f.requests.every(url => url.startsWith('/api/worldinfo/')));
    await reopened.close();
});

test('Saving another choice changes only the next port, never migrates or switches an open store', async () => {
    const f = fixture(), port = f.open(), store = await port.open(); await store.list();
    await port.setStorage('account-settings');
    assert.equal(port.storageChoice(), 'account-settings'); assert.equal(port.activeStorage(), 'world-book');
    assert.equal((await port.open()).kind, 'world-book');
    assert.equal((await f.open().open()).kind, 'account-settings');
    assert.equal(f.books.size, 0); assert.equal(f.settings.muyuHistoryData, undefined);
    await assert.rejects(port.setStorage('unknown'), /HISTORY_INVALID/);
});

test('Failed storage preference save restores both the new and legacy options', async () => {
    const f = fixture({ muyuHistoryEnabled: true, muyuHistoryAccountStorage: true }), port = f.open();
    f.setSave(async () => { throw Error('Save rejected'); });
    await assert.rejects(port.setStorage('world-book'), /HISTORY_SETTINGS_FAILED/);
    assert.equal(f.settings.muyuHistoryStorage, undefined); assert.equal(f.settings.muyuHistoryAccountStorage, true);
    assert.equal(port.activeStorage(), 'account-settings');
});

test('World-book failures retain the selected backend and retry can persist without IndexedDB', async () => {
    const f = fixture(); f.setOnline(false);
    const port = f.open(), library = createSessionLibrary({ port }); await library.ready;
    assert.equal(library.snapshot(scope).error, 'HISTORY_UNAVAILABLE'); assert.equal(port.activeStorage(), 'world-book');
    const id = library.create(scope); library.update(id, { messages: [{ role: 'user', content: 'Keep this', runId: 'r' }], status: 'idle' });
    f.setOnline(true); await library.retry(); await library.flush();
    assert.equal(library.snapshot(scope, id).backend, 'world-book'); assert.equal(library.snapshot(scope, id).dirty, false);
    assert.equal(f.books.size, 1); await library.close();
});

test('World-book storage refuses other accounts and invalid preferences without falling back', async () => {
    const f = fixture(), store = await f.open().open();
    f.setAccount({ enabled: true, handle: 'B', created: 1 });
    await assert.rejects(store.list(), /HISTORY_IDENTITY_UNAVAILABLE/); assert.deepEqual(f.requests, []);
    f.settings.muyuHistoryStorage = 'unknown';
    await assert.rejects(f.open().open(), /HISTORY_INVALID/); assert.deepEqual(f.requests, []);
});

test('Explicit world-book selection leaves existing browser and account records untouched', async () => {
    const f = fixture(); f.settings.muyuHistoryData = { privateBackup: 'OLD' };
    let browserOpened = 0, serverOpened = 0;
    const port = createHistoryPort({ ...f.options, openStore: async () => { browserOpened++; return createMemoryHistoryStore(); },
        openServer: async () => { serverOpened++; return null; } });
    const store = await port.open(); assert.deepEqual(await store.list(), []);
    assert.equal(browserOpened, 0); assert.equal(serverOpened, 0); assert.deepEqual(f.settings.muyuHistoryData, { privateBackup: 'OLD' });
});

test('Story profiles cannot export, import or change the private storage choice', async t => {
    const previous = globalThis.document;
    globalThis.document = { createElement: () => ({ click() {} }), body: { appendChild() {}, removeChild() {} } };
    t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
    const f = createConfigProfileSubject({ muyuHistoryStorage: 'world-book', muyuHistoryVolumeMiB: 12 });
    const saved = f.subject.saveCurrentAsProfile('Story', '', { agentsTools: true, contextLedger: true });
    assert.equal(Object.hasOwn(saved.settings, 'muyuHistoryStorage'), false);
    assert.equal(Object.hasOwn(saved.settings, 'muyuHistoryVolumeMiB'), false);
    saved.settings.muyuHistoryStorage = 'auto';
    saved.settings.muyuHistoryVolumeMiB = 1;
    assert.doesNotMatch(JSON.stringify(f.subject.exportProfileAsJson(saved.id)), /muyuHistoryStorage/);
    assert.doesNotMatch(JSON.stringify(f.subject.exportProfileAsJson(saved.id)), /muyuHistoryVolumeMiB/);
    await f.subject.applyProfile(saved.id); assert.equal(f.settings.muyuHistoryStorage, 'world-book');
    assert.equal(f.settings.muyuHistoryVolumeMiB, 12);
    assert.deepEqual(sanitizeImportedSettings({ muyuHistoryStorage: 'account-settings', muyuHistoryVolumeMiB: 1 }), {});
});

test('Volume target persists automatically, is read live by opened stores, and rolls back on save failure', async () => {
    const f = fixture(), port = f.open();
    assert.equal(port.worldBookTargetMiB(), 8);
    await port.setWorldBookTargetMiB(1); assert.equal(f.settings.muyuHistoryVolumeMiB, 1);
    const store = await port.open();
    const make = () => ({ version: 7, id: crypto.randomUUID(), revision: 0, scope, title: 'Large', createdAt: 1, updatedAt: 1,
        messages: [{ role: 'user', content: 'x'.repeat(600000), runId: 'r' }], required: [], status: 'succeeded', archived: false, imported: false, receipts: [], contextSummary: null, scopeChanges: [] });
    await store.create(make()); await store.create(make()); assert.equal(f.books.size, 2);
    await port.setWorldBookTargetMiB(16); await store.create(make()); assert.equal(f.books.size, 2);
    await assert.rejects(port.setWorldBookTargetMiB(17), /HISTORY_INVALID/);
    f.options.saveSettings = async () => { throw Error('offline'); };
    const failing = createHistoryPort(f.options);
    await assert.rejects(failing.setWorldBookTargetMiB(2), /HISTORY_SETTINGS_FAILED/);
    assert.equal(f.settings.muyuHistoryVolumeMiB, 16);
    store.close();
});

test('Production port exposes explicit consolidation and confirmed cleanup without a service plugin', async () => {
    const f = fixture(), seed = await f.open().open();
    const value = { version: 7, id: crypto.randomUUID(), revision: 0, scope, title: 'seed', createdAt: 1, updatedAt: 1,
        messages: [], required: [], status: 'succeeded', archived: false, imported: false, receipts: [], contextSummary: null, scopeChanges: [] };
    await seed.create(value); seed.close();
    const namespace = [...f.books.values()][0].extensions.gdMuyuHistory.namespace;
    const old = { ...value, id: crypto.randomUUID(), revision: 7, title: 'Original', messages: [{ role: 'user', content: 'OLD_PRIVATE', runId: 'r' }] };
    const encoded = await encodeHistoryBook({ namespace, record: old, revision: 7 }); f.books.set(encoded.name, encoded.data);
    const library = createSessionLibrary({ port: f.open() }); await library.ready;
    assert.equal(library.snapshot(scope).canMergeLegacyHistory, true);
    assert.deepEqual(await library.load(old.id), old);
    const report = await library.mergeLegacyHistory();
    assert.equal(report.copied, 1); assert.equal(report.error, null);
    assert.deepEqual(library.get(old.id), old); assert.ok(f.books.has(encoded.name));
    assert.equal(library.snapshot(scope).copyReport.source, 'legacy-world-books');
    assert.equal(f.requests.some(url => url.endsWith('/delete')), false);
    const cleaned = await library.mergeLegacyHistory(true);
    assert.equal(cleaned.cleaned, 1); assert.equal(cleaned.error, null); assert.equal(f.books.has(encoded.name), false);
    assert.deepEqual(await library.load(old.id), old);
    await library.close();
    const reopened = await f.open().open(); assert.deepEqual(await reopened.read(old.id), old);
    f.settings.muyuHistoryWriteTargets = [];
    await assert.rejects(reopened.mergeLegacyHistory(), /HISTORY_WRITE_DISABLED/);
    reopened.close();
});

test('Consolidation refuses unsaved page changes and never silently replaces a working copy', async () => {
    const f = fixture(), library = createSessionLibrary({ port: f.open() }); await library.ready;
    const id = library.create(scope); await library.flush(); await library.setEnabled(false);
    library.update(id, { title: 'Keep unsaved', messages: [{ role: 'user', content: 'UNSAVED', runId: 'r' }] });
    const before = structuredClone([...f.books]);
    await assert.rejects(library.mergeLegacyHistory(), /HISTORY_CONFLICT/);
    assert.deepEqual([...f.books], before); assert.equal(library.get(id).title, 'Keep unsaved');
    assert.equal(library.snapshot(scope).copyReport.error, 'HISTORY_CONFLICT');
    await library.close();
});
