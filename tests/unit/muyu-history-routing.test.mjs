import test from 'node:test';
import assert from 'node:assert/strict';
import { openRoutedHistoryStore } from '../../muyu/sessions/routed-store.js';
import { createMemoryHistoryStore } from '../../muyu/sessions/memory-store.js';
import { createSessionLibrary } from '../../muyu/sessions/library.js';
import { createHistoryPort } from '../../muyu/host/history.js';
import { sanitizeImportedSettings } from '../../systems/config-profile-validation.js';

const namespace = '12345678-1234-1234-1234-123456789012', scope = '["assistant","chat","A"]';
const record = () => ({ version: 5, id: crypto.randomUUID(), revision: 0, scope, title: 'saved', createdAt: 1, updatedAt: 1,
    messages: [{ role: 'user', content: 'private', runId: 'r' }], required: [], status: 'succeeded', archived: false, imported: false, receipts: [], contextSummary: null });
async function fixture(targets = ['browser', 'world-book']) {
    const stores = Object.fromEntries(['browser', 'world-book', 'account-settings', 'server'].map(key => { const store = createMemoryHistoryStore(); store.kind = key === 'server' ? 'private-files' : key; return [key, store]; }));
    let selected = targets;
    const router = await openRoutedHistoryStore({ namespace, source: 'browser', getTargets: () => selected, open: async key => stores[key], check: async () => {} });
    return { router, stores, setTargets: values => { selected = values; } };
}

test('Reader lists only its source, writers keep independent revisions and retries do not repeat successful writes', async () => {
    const f = await fixture(), base = await f.stores.browser.create(record());
    let backup = await f.stores['world-book'].create(base);
    for (let n = 0; n < 4; n++) backup = await f.stores['world-book'].update(backup, backup.revision);
    await f.stores['world-book'].create(record());
    assert.equal((await f.router.list()).length, 1); await f.router.read(base.id);
    const desired = { ...base, title: 'new' }, report = await f.router.saveRecord(desired);
    assert.equal(report.complete, true); assert.equal(report.readRecord.revision, 2);
    assert.equal((await f.stores['world-book'].read(base.id)).revision, 6);
    const retry = await f.router.saveRecord(desired); assert.equal(retry.complete, true);
    assert.equal((await f.stores.browser.read(base.id)).revision, 2); assert.equal((await f.stores['world-book'].read(base.id)).revision, 6);
    f.router.close();
});

test('Turning off source writes does not turn off reading or permit manual source mutations', async () => {
    const f = await fixture(['world-book']), base = await f.stores.browser.create(record()); await f.router.read(base.id);
    const report = await f.router.saveRecord({ ...base, title: 'backup only' });
    assert.equal(report.complete, true); assert.equal(report.readSaved, false); assert.equal(report.readRecord, null);
    assert.equal((await f.router.read(base.id)).title, 'saved'); assert.equal((await f.stores['world-book'].read(base.id)).title, 'backup only');
    await assert.rejects(f.router.update(base, base.revision), /HISTORY_WRITE_DISABLED/);
    await assert.rejects(f.router.remove(base.id, base.revision), /HISTORY_WRITE_DISABLED/);
    assert.equal((await f.router.list()).length, 1); f.router.close();
});

test('Partial save reports each location and retries only unconfirmed content', async () => {
    const f = await fixture(['browser', 'world-book', 'server']);
    const create = f.stores['world-book'].create.bind(f.stores['world-book']); let fail = true;
    f.stores['world-book'].create = async value => { if (fail) throw Error('HISTORY_CAPACITY'); return create(value); };
    const desired = record(), first = await f.router.saveRecord(desired);
    assert.equal(first.complete, false); assert.equal(first.anySaved, true);
    assert.equal(first.targets.find(row => row.source === 'world-book').error, 'HISTORY_CAPACITY');
    fail = false; const next = await f.router.saveRecord(desired); assert.equal(next.complete, true);
    assert.equal((await f.stores.browser.read(desired.id)).revision, 1); assert.equal((await f.stores.server.read(desired.id)).revision, 1);
    f.router.close();
});

test('Divergent existing targets and edits while a writer was disabled are never overwritten', async () => {
    const f = await fixture(), base = await f.stores.browser.create(record());
    await f.stores['world-book'].create({ ...base, title: 'other branch' }); await f.router.read(base.id);
    const report = await f.router.saveRecord({ ...base, title: 'next' });
    assert.equal(report.targets.find(row => row.source === 'world-book').error, 'HISTORY_CONFLICT');
    assert.equal((await f.stores['world-book'].read(base.id)).title, 'other branch');
    const fresh = record(); await f.router.saveRecord(fresh); f.setTargets(['browser']);
    const backup = await f.stores['world-book'].read(fresh.id); await f.stores['world-book'].update({ ...backup, title: 'changed while off' }, backup.revision);
    f.setTargets(['browser', 'world-book']);
    const again = await f.router.saveRecord({ ...fresh, title: 'local continuation' });
    assert.equal(again.targets.find(row => row.source === 'world-book').error, 'HISTORY_CONFLICT');
    assert.equal((await f.stores['world-book'].read(fresh.id)).title, 'changed while off'); f.router.close();
});

test('A deleted loaded source is not resurrected and a missing service never becomes another backend', async () => {
    const f = await fixture(['browser']), base = await f.stores.browser.create(record()); await f.router.read(base.id);
    await f.stores.browser.remove(base.id, base.revision);
    assert.equal((await f.router.saveRecord({ ...base, title: 'stale' })).targets[0].error, 'HISTORY_DELETED');
    let browserOpened = 0;
    await assert.rejects(openRoutedHistoryStore({ namespace, source: 'server', open: async key => { if (key === 'browser') browserOpened++; return null; }, getTargets: () => [], check: async () => {} }), /HISTORY_UNAVAILABLE/);
    assert.equal(browserOpened, 0); f.router.close();
});

test('All write switches off still permits listing and reading without changing records', async () => {
    const f = await fixture([]), base = await f.stores.browser.create(record());
    const result = await f.router.saveRecord({ ...base, title: 'not saved' });
    assert.equal(result.anySaved, false); assert.equal(result.complete, false); assert.equal(result.targets.every(row => row.state === 'disabled'), true);
    assert.equal((await f.router.list()).length, 1); assert.equal((await f.router.read(base.id)).title, 'saved'); f.router.close();
});

test('All sixteen write-switch combinations preserve disabled copies and safely catch up confirmed targets when re-enabled', async () => {
    const keys = ['browser', 'account-settings', 'world-book', 'server'], f = await fixture(keys), value = record();
    await f.router.saveRecord(value);
    for (let mask = 0; mask < 16; mask++) {
        const chosen = keys.filter((key, index) => mask & (1 << index)), before = await Promise.all(keys.map(key => f.stores[key].read(value.id)));
        f.setTargets(chosen); const report = await f.router.saveRecord({ ...value, title: 'step ' + mask });
        assert.equal(report.complete, chosen.length > 0);
        for (const [index, key] of keys.entries()) {
            const current = await f.stores[key].read(value.id);
            if (chosen.includes(key)) assert.equal(current.title, 'step ' + mask);
            else assert.deepEqual(current, before[index]);
        }
    }
    f.router.close();
});

test('Lost acknowledgement is verified on retry without another write', async () => {
    const f = await fixture(['browser']), create = f.stores.browser.create.bind(f.stores.browser); let writes = 0;
    f.stores.browser.create = async value => { writes++; await create(value); throw Error('HISTORY_UNAVAILABLE'); };
    const desired = record(); assert.equal((await f.router.saveRecord(desired)).complete, false);
    assert.equal((await f.router.saveRecord(desired)).complete, true); assert.equal(writes, 1); f.router.close();
});

test('Library retry verifies a lost reader acknowledgement instead of mistaking its own saved result for an external edit', async () => {
    const f = await fixture(['browser']), create = f.stores.browser.create.bind(f.stores.browser); let writes = 0;
    f.stores.browser.create = async value => { writes++; await create(value); throw Error('HISTORY_UNAVAILABLE'); };
    const library = createSessionLibrary({ port: { enabled: () => true, open: async () => f.router } }); await library.ready;
    const id = library.create(scope); await library.flush();
    assert.equal(library.snapshot(scope, id).writeReport.readSaved, false);
    await library.retry(); await library.flush();
    const state = library.snapshot(scope, id);
    assert.equal(state.external, null); assert.equal(state.persisted, true); assert.equal(state.dirty, false);
    assert.equal(state.writeReport.readSaved, true); assert.equal(writes, 1); await library.close();
});

test('Library reports backup-only and partial saves without borrowing target revisions for the reader', async () => {
    const f = await fixture(['world-book']), library = createSessionLibrary({ port: { enabled: () => true, open: async () => f.router } }); await library.ready;
    const id = library.create(scope); library.update(id, { title: 'only elsewhere' }); await library.flush();
    const state = library.snapshot(scope, id);
    assert.equal(state.persisted, false); assert.equal(state.dirty, false); assert.equal(state.writeReport.readSaved, false); assert.equal(state.writeReport.complete, true);
    assert.equal(await f.stores.browser.read(id), null); assert.equal((await f.stores['world-book'].read(id)).title, 'only elsewhere');
    await library.refresh(); assert.equal(library.snapshot(scope, id).external, null); await library.close();
});

test('Accepted reload advances writer baselines, while cancelled reload cannot authorize overwriting external changes', async () => {
    const f = await fixture(['browser']), library = createSessionLibrary({ port: { enabled: () => true, open: async () => f.router } }); await library.ready;
    const id = library.create(scope); await library.flush();
    let saved = await f.stores.browser.read(id); await f.stores.browser.update({ ...saved, title: 'external' }, saved.revision);
    await library.refresh(); await library.reload(id);
    library.update(id, { title: 'after accepted reload' }); await library.flush();
    assert.equal((await f.stores.browser.read(id)).title, 'after accepted reload');
    saved = await f.stores.browser.read(id); await f.stores.browser.update({ ...saved, title: 'new external' }, saved.revision);
    await assert.rejects(library.reload(id, { beforeReplace: () => { throw Error('NOT_READY'); } }), /NOT_READY/);
    library.update(id, { title: 'must not overwrite' }); await library.flush();
    assert.equal((await f.stores.browser.read(id)).title, 'new external');
    assert.equal(library.snapshot(scope, id).writeReport.targets[0].error, 'HISTORY_CONFLICT'); await library.close();
});

test('Routing preferences save atomically, roll back on failure and are excluded from configuration imports', async () => {
    const settings = { muyuHistoryStorage: 'world-book' }; let fail = false;
    const port = createHistoryPort({ getAccount: async () => ({ enabled: false }), getSettings: () => settings, saveSettings: async () => { if (fail) throw Error('private'); } });
    await port.setRouting({ readSource: 'browser', writeTargets: ['world-book', 'browser'] });
    assert.deepEqual(port.routing(), { readSource: 'browser', writeTargets: ['browser', 'world-book'] }); fail = true;
    await assert.rejects(port.setRouting({ readSource: 'server', writeTargets: [] }), /HISTORY_SETTINGS_FAILED/);
    assert.equal(settings.muyuHistoryReadSource, 'browser'); assert.deepEqual(settings.muyuHistoryWriteTargets, ['browser', 'world-book']);
    assert.deepEqual(sanitizeImportedSettings({ muyuHistoryReadSource: 'server', muyuHistoryWriteTargets: ['server'] }), {});
});
