import test from 'node:test';
import assert from 'node:assert/strict';
import { historyIDB } from './helpers/history-idb.mjs';
import { openRecoveryStore } from '../../muyu/recovery/indexeddb-store.js';
import { createRecoveryJournal } from '../../muyu/recovery/journal.js';
import { validateCheckpoint } from '../../muyu/recovery/contract.js';
import { createHistoryPort } from '../../muyu/host/history.js';
import { createConfigActions } from '../../muyu/actions/config-apply.js';
import { createTaskBundleWriter } from '../../muyu/host/task-bundle-write.js';

function fixture() {
    const indexedDB = historyIDB(); let enabled = true;
    const port = { enabled: () => enabled, openRecovery: () => openRecoveryStore({ namespace: 'account', indexedDB }) };
    const journal = createRecoveryJournal({ port, owner: () => 'conversation' });
    const artifact = { id: 'draft', revision: 1, kind: 'config-draft', sessionId: 'runtime', content: {
        baseline: { autoMemoryInterval: 10 }, requestedChanges: { autoMemoryInterval: 15 },
        preview: { contractVersion: 1, diff: [{ field: 'autoMemoryInterval', before: '10', after: '15' }] },
        token: 'must-not-persist', privateKey: 'must-not-persist',
    } };
    let calls = 0;
    const actions = createConfigActions({ getArtifact: () => artifact, validate: () => {}, getTarget: () => ({ kind: 'global', userKey: 'page-secret' }),
        writer: { apply: async () => { calls++; return { status: 'applied_unconfirmed' }; } }, checkpoint: journal.checkpoint });
    return { indexedDB, port, journal, actions, artifact, get calls() { return calls; }, disable: () => { enabled = false; } };
}

test('Config checkpoints survive a fresh journal without executable drafts, grants or page authority', async () => {
    const f = fixture(), action = f.actions.prepare('draft', 1);
    assert.equal((await f.actions.approve(action.id)).status, 'applied_unconfirmed');
    const restored = createRecoveryJournal({ port: f.port }); await restored.refresh();
    const rows = restored.snapshot('conversation').records;
    assert.equal(rows.length, 1); assert.equal(rows[0].status, 'applied_unconfirmed');
    assert.equal(rows[0].revision, 2); assert.equal(f.calls, 1);
    assert.doesNotMatch(JSON.stringify(rows), /must-not-persist|page-secret|requestedChanges|privateKey/);
    assert.equal(rows[0].proposal.diff[0].before, '10');
    assert.equal(rows[0].receipt.diff[0].after, '15');
    assert.throws(() => validateCheckpoint({ ...rows[0], grants: ['all'] }));
    assert.throws(() => f.actions.approve(action.id), /ACTION_STALE/);
    await restored.remove(action.id); assert.deepEqual(restored.snapshot('conversation').records, []);
});

test('Initial quota failure prevents side effects; disabled history never opens recovery storage', async () => {
    const f = fixture(); await f.journal.refresh(); f.indexedDB.failNextPut('checkpoints');
    const action = f.actions.prepare('draft', 1);
    assert.equal((await f.actions.approve(action.id)).status, 'not_executed'); assert.equal(f.calls, 0);
    const disabled = fixture(); disabled.disable();
    const other = disabled.actions.prepare('draft', 1); await disabled.actions.approve(other.id);
    assert.equal(disabled.calls, 1); assert.deepEqual(disabled.journal.snapshot('conversation').records, []);
});

test('Result checkpoint failure retains actual outcome and a conservative durable unfinished record', async () => {
    const f = fixture(); let n = 0;
    const actions = createConfigActions({ getArtifact: () => f.artifact, validate: () => {}, getTarget: () => ({ kind: 'global' }),
        writer: { apply: async () => ({ status: 'applied_unconfirmed' }) },
        checkpoint: async record => { if (++n === 2) f.indexedDB.failNextPut('checkpoints'); await f.journal.checkpoint(record); } });
    const action = actions.prepare('draft', 1), result = await actions.approve(action.id);
    assert.equal(result.status, 'applied_unconfirmed'); assert.equal(result.checkpointFailed, true);
    const restored = createRecoveryJournal({ port: f.port }); await restored.refresh();
    assert.equal(restored.snapshot('conversation').records[0].status, 'applying');
});

test('CAS rejects two tabs overwriting the same checkpoint; namespace isolates accounts', async () => {
    const f = fixture(); const action = f.actions.prepare('draft', 1);
    await f.journal.checkpoint({ ...action, status: 'applying' });
    const store = await f.port.openRecovery(), value = (await store.list())[0];
    await store.write(value, value.revision);
    await assert.rejects(store.write(value, value.revision), /RECOVERY_CONFLICT/);
    const other = await openRecoveryStore({ namespace: 'other', indexedDB: f.indexedDB }); assert.deepEqual(await other.list(), []);
});

test('History host guards recovery writes and reads after an account switch', async () => {
    let account = { enabled: false };
    const port = createHistoryPort({ getAccount: () => account, getSettings: () => ({ muyuHistoryEnabled: true }),
        openRecovery: async () => ({ list: async () => [], write: async () => { throw Error('must not run'); }, close() {} }) });
    const store = await port.openRecovery(); account = { enabled: true, handle: 'other', created: 1 };
    await assert.rejects(store.list(), /HISTORY_IDENTITY_UNAVAILABLE/);
    await assert.rejects(store.write({}, 0), /HISTORY_IDENTITY_UNAVAILABLE/);
});

test('A target changed during checkpoint flushing is revalidated before the writer can run', async () => {
    const f = fixture(); let target = { kind: 'global', userKey: 'first' }, calls = 0;
    const actions = createConfigActions({ getArtifact: () => f.artifact, validate: () => {}, getTarget: () => target,
        writer: { apply: async () => { calls++; return { status: 'applied_unconfirmed' }; } },
        checkpoint: async record => { await f.journal.checkpoint(record); target = { kind: 'global', userKey: 'second' }; } });
    const action = actions.prepare('draft', 1), result = await actions.approve(action.id);
    assert.equal(result.status, 'not_executed'); assert.equal(calls, 0);
});

test('Capacity refuses new records without silently evicting uncertain checkpoints', async () => {
    const f = fixture(), action = f.actions.prepare('draft', 1); await f.journal.checkpoint({ ...action, status: 'applying' });
    const store = await f.port.openRecovery(), base = (await store.list())[0];
    for (let i = 1; i < 64; i++) {
        const id = 'apply:' + i;
        await store.write({ ...base, id, revision: 0, proposal: { ...base.proposal, operationId: id } }, 0);
    }
    const id = 'apply:overflow';
    await assert.rejects(store.write({ ...base, id, revision: 0, proposal: { ...base.proposal, operationId: id } }, 0), /RECOVERY_CAPACITY/);
    assert.equal((await store.list()).length, 64);
    await store.remove('apply:1', 1);
    await store.write({ ...base, id, revision: 0, proposal: { ...base.proposal, operationId: id } }, 0);
    assert.equal((await store.list()).length, 64);
});

function bundleFixture(checkpoint, apply = async () => ({ status: 'applied_confirmed' })) {
    const content = { target: { kind: 'chat', chatKey: 'A' }, variables: [{ preview: { id: 'gold' } }, { preview: { id: 'debt' } }], settings: null };
    let calls = 0, forgotten = false;
    const writer = createTaskBundleWriter({ draftPort: { assertFresh() {}, forget() { forgotten = true; } }, getTarget: () => content.target,
        variableWriter: { async apply(row) { calls++; return apply(row); } } });
    return { run: () => writer.apply(content, { checkpoint }), get calls() { return calls; }, get forgotten() { return forgotten; } };
}

test('Bundle stops after confirmed first step when its result checkpoint fails, without rollback', async () => {
    let n = 0;
    const f = bundleFixture(async () => { if (++n === 2) throw Error('quota'); });
    const result = await f.run();
    assert.equal(f.calls, 1); assert.equal(f.forgotten, true); assert.equal(result.status, 'partial'); assert.equal(result.checkpointFailed, true);
    assert.deepEqual(result.steps.map(s => s.status), ['applied_confirmed', 'not_started']);
});

test('Bundle checkpoints mark an uncertain dispatch before its body, and never run when prewrite flush fails', async () => {
    const snapshots = []; let release;
    const f = bundleFixture(async rows => { snapshots.push(structuredClone(rows)); }, () => new Promise(resolve => { release = resolve; }));
    const pending = f.run(); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(snapshots[0].map(s => s.status), ['applying', 'not_started']);
    release({ status: 'outcome_unknown' }); const result = await pending;
    assert.equal(result.status, 'outcome_unknown'); assert.equal(f.calls, 1);
    const blocked = bundleFixture(async () => { throw Error('quota'); });
    assert.equal((await blocked.run()).status, 'not_executed'); assert.equal(blocked.calls, 0);
});
