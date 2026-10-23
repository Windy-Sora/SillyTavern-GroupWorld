import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistoryPort } from '../../muyu/host/history.js';
import { openStWorldBookHistoryStore } from '../../muyu/host/worldbook-history.js';
import { createSessionLibrary } from '../../muyu/sessions/library.js';
import { createMemoryHistoryStore } from '../../muyu/sessions/memory-store.js';
import { WORLD_BOOK_HISTORY_KEY } from '../../muyu/sessions/worldbook-contract.js';

const sources = ['browser', 'account-settings', 'world-book', 'server'], scope = '["assistant","chat","A"]';
const messages = text => [{ role: 'user', content: text, runId: 'r', origin: 'question' }, { role: 'assistant', content: 'Answer', runId: 'r' }];

/** Real host routing, settings backend and world-book HTTP/codec; only browser and
 * service transports are in-memory substitutes. No ST process or model is involved.
 */
function fixture(readSource = 'browser') {
    const settings = { muyuHistoryEnabled: true, muyuHistoryReadSource: readSource, muyuHistoryWriteTargets: [...sources] };
    const browser = createMemoryHistoryStore(), server = createMemoryHistoryStore(), books = new Map(), requests = [];
    browser.kind = 'browser'; server.kind = 'private-files';
    let worldOffline = false, settingsFail = false, serviceAvailable = true;
    const fetcher = async (url, init) => {
        requests.push(url); if (worldOffline) throw Error('offline');
        assert.equal(init.headers['X-CSRF-Token'], 'test');
        const body = JSON.parse(init.body);
        if (url.endsWith('/list')) return Response.json([...books].map(([file_id, data]) => ({ file_id, extensions: data.extensions })));
        if (url.endsWith('/get')) return Response.json(books.get(body.name) || { entries: {} });
        if (url.endsWith('/edit')) { books.set(body.name, structuredClone(body.data)); return Response.json({ ok: true }); }
        throw Error('Unexpected request');
    };
    const options = { getAccount: async () => ({ enabled: false }), getSettings: () => settings,
        saveSettings: async () => { if (settingsFail) throw Error('settings offline'); },
        openStore: async () => browser, openServer: async () => serviceAvailable ? server : null,
        getHeaders: () => ({ 'X-CSRF-Token': 'test' }), fetcher };
    const open = async source => {
        if (source) settings.muyuHistoryReadSource = source;
        const port = createHistoryPort(options), library = createSessionLibrary({ port }); await library.ready;
        return { port, library };
    };
    return { settings, books, browser, server, requests, open,
        world: () => openStWorldBookHistoryStore({ namespace: [...books.values()][0].extensions[WORLD_BOOK_HISTORY_KEY].namespace,
            fetcher, getHeaders: options.getHeaders, assertIdentity: async () => {} }),
        worldOffline: value => { worldOffline = value; }, settingsFail: value => { settingsFail = value; }, serviceAvailable: value => { serviceAvailable = value; } };
}

for (const source of sources) test(`Save in all locations, reopen ${source}, deduplicate imports and retain changed page-only versions`, async () => {
    const f = fixture(source), first = await f.open();
    const id = first.library.create(scope); first.library.update(id, { title: 'Original', messages: messages('PRIVATE'), status: 'succeeded' }); await first.library.flush();
    assert.equal(first.library.snapshot(scope, id).writeReport.complete, true);
    const text = first.library.export(id), backup = await first.library.import(text); await first.library.flush();
    assert.notEqual(backup, id); assert.equal(first.library.snapshot(scope, backup).writeReport.targets.every(row => row.state === 'saved'), true);
    await first.library.close();
    f.settings.muyuHistoryWriteTargets = [];
    // Every reader sees the same previously saved backup, never a merged index.
    const next = await f.open(source);
    assert.equal(next.library.snapshot(scope).readSource, source);
    assert.equal(await next.library.import(text), backup); await next.library.flush();
    assert.equal(next.library.snapshot(scope).total, 2); assert.equal(next.library.snapshot(scope, backup).importReport.status, 'identical');
    const changed = JSON.parse(text); changed.messages[1].content = 'Edited backup';
    const edited = await next.library.import(JSON.stringify(changed)); await next.library.flush();
    assert.notEqual(edited, backup); assert.equal(next.library.get(edited).imported, true);
    assert.equal(next.library.snapshot(scope, edited).writeReport.anySaved, false);
    assert.throws(() => next.library.assertRoom(edited), /HISTORY_READ_ONLY/);
    assert.equal((await next.library.load(id)).messages[1].content, 'Answer'); await next.library.close();
    const restored = await f.open(source);
    assert.equal(restored.library.meta(edited), null); assert.equal(restored.library.snapshot(scope).total, 2);
    assert.equal(await restored.library.import(text), backup); await restored.library.close();
});

test('Offline world-book and missing service writers do not block healthy saves; recovery is idempotent', async () => {
    const f = fixture(); f.worldOffline(true); f.serviceAvailable(false);
    const { library } = await f.open(); const id = library.create(scope);
    library.update(id, { messages: messages('Retain me'), status: 'succeeded' }); await library.flush();
    let report = library.snapshot(scope, id).writeReport;
    assert.deepEqual(report.targets.map(row => row.state), ['saved', 'saved', 'failed', 'failed']);
    const browserRevision = (await f.browser.read(id)).revision, settingsRevision = f.settings.muyuHistoryData.records[0].revision;
    f.worldOffline(false); f.serviceAvailable(true); await library.retry(); await library.flush();
    report = library.snapshot(scope, id).writeReport; assert.equal(report.complete, true);
    assert.equal((await f.browser.read(id)).revision, browserRevision);
    assert.equal(f.settings.muyuHistoryData.records[0].revision, settingsRevision);
    assert.equal(f.books.size, 1); assert.equal((await f.server.read(id)).messages[0].content, 'Retain me');
    await library.close();
});

test('A failing account-settings save reports only that location and can later catch up without rewriting world books', async () => {
    const f = fixture(), { library } = await f.open(); f.settingsFail(true);
    const id = library.create(scope); library.update(id, { messages: messages('Kept'), status: 'succeeded' }); await library.flush();
    assert.equal(library.snapshot(scope, id).writeReport.targets[1].error, 'HISTORY_SAVE_FAILED');
    assert.equal(f.settings.muyuHistoryData, undefined);
    const before = structuredClone([...f.books.values()]);
    f.settingsFail(false); await library.retry(); await library.flush();
    assert.equal(library.snapshot(scope, id).writeReport.complete, true);
    assert.deepEqual([...f.books.values()], before); assert.equal(f.settings.muyuHistoryData.records[0].messages[0].content, 'Kept');
    await library.close();
});

test('Re-enabling an externally edited world-book writer preserves its branch and reports a conflict', async () => {
    const f = fixture(), { library, port } = await f.open(); const id = library.create(scope);
    library.update(id, { title: 'Base', messages: messages('Base'), status: 'succeeded' }); await library.flush();
    await port.setRouting({ readSource: 'browser', writeTargets: ['browser', 'account-settings', 'server'] });
    const other = f.world(), original = await other.read(id);
    await other.update({ ...original, title: 'Externally edited' }, original.revision); other.close();
    library.update(id, { title: 'Local continuation' }); await library.flush();
    await port.setRouting({ readSource: 'browser', writeTargets: sources });
    // Enabling a writer never backfills a clean record; the next actual save
    // checks that writer's earlier baseline rather than trusting the toggle.
    library.update(id, { title: 'Local continuation' }); await library.flush();
    await library.retry(); await library.flush();
    assert.equal(library.snapshot(scope, id).writeReport.targets[2].error, 'HISTORY_CONFLICT');
    assert.equal((await f.browser.read(id)).title, 'Local continuation');
    const check = f.world(); assert.equal((await check.read(id)).title, 'Externally edited'); check.close();
    await library.close();
});

test('Removing a world-book record only affects the selected reader and cannot be undone by stale page saves', async () => {
    const f = fixture('world-book'), { library } = await f.open(); const id = library.create(scope);
    library.update(id, { title: 'Keep backups', messages: messages('private') }); await library.flush();
    const other = f.world(), record = await other.read(id); await other.remove(id, record.revision); other.close();
    await library.refresh(); assert.equal(library.snapshot(scope, id).external, 'deleted');
    library.update(id, { title: 'Late result' }); await library.flush();
    const world = f.world(); assert.equal(await world.read(id), null); world.close();
    await library.reload(id, { discardLocal: true }); assert.equal(library.meta(id), null);
    assert.equal((await f.browser.read(id)).title, 'Keep backups');
    assert.equal((await f.server.read(id)).title, 'Keep backups');
    assert.equal(f.settings.muyuHistoryData.records[0].title, 'Keep backups'); await library.close();
});

test('World-book corruption aborts duplicate import without creating another archive or altering healthy backups', async () => {
    const f = fixture('world-book'), first = await f.open(); const id = first.library.create(scope);
    first.library.update(id, { title: 'Source', messages: messages('private'), status: 'succeeded' }); await first.library.flush();
    const text = first.library.export(id), backup = await first.library.import(text); await first.library.flush(); await first.library.close();
    const data = [...f.books.values()].find(book => book.extensions[WORLD_BOOK_HISTORY_KEY].records?.some(row => row.header.id === backup));
    assert.ok(data); data.entries[1].content += 'CORRUPT';
    const before = structuredClone([...f.books.values()]), browser = await f.browser.read(backup), next = await f.open();
    await assert.rejects(next.library.import(text), /HISTORY_INVALID|HISTORY_CONFLICT/);
    assert.deepEqual([...f.books.values()], before); assert.deepEqual(await f.browser.read(backup), browser);
    await next.library.close();
});
