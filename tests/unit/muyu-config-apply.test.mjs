import test from 'node:test';
import assert from 'node:assert/strict';
import { createConfigWriter } from '../../muyu/host/config-write.js';
import { createConfigActions } from '../../muyu/actions/config-apply.js';
import { previewMemoryConfig, readConfigBaseline } from '../../muyu/modules/config-draft/preview.js';
import { memoryFields } from '../../muyu/modules/config-draft/contracts.js';

function fixture(save = async () => undefined) {
    const settings = { memoryEnabled: false, autoMemoryEnabled: false, autoMemoryInterval: 10, autoMemorySpeakers: false, unrelated: 'keep' };
    const baseline = readConfigBaseline(settings), changes = { autoMemoryInterval: 15 };
    let artifact = { id: 'a', revision: 1, kind: 'config-draft', sessionId: 's', content: { baseline, preview: previewMemoryConfig({ baseline, changes, allowedFields: memoryFields }) } };
    let target = { kind: 'global', userKey: 'one' }, saves = 0;
    const writer = createConfigWriter({ getSettings: () => settings, saveSettings: () => { saves++; return save(); } });
    const actions = createConfigActions({ getArtifact: () => { if (!artifact) throw Error('missing'); return structuredClone(artifact); }, getTarget: () => target, writer,
        validate: () => { assert.deepEqual(readConfigBaseline(settings), baseline); } });
    return { settings, baseline, changes, writer, actions, saves: () => saves, changeArtifact: () => { artifact.revision++; }, removeArtifact: () => { artifact = null; }, changeTarget: () => { target = { ...target, userKey: 'two' }; } };
}
test('Preparation never writes; approval consumes one immutable revision and changes only listed fields', async () => {
    const f = fixture(async () => ({ confirmed: true })), r = f.actions.prepare('a', 1);
    assert.equal(f.saves(), 0); assert.equal(f.settings.autoMemoryInterval, 10);
    r.content.preview.manifest.settings.memoryEnabled = true;
    const promise = f.actions.approve(r.id);
    assert.throws(() => f.actions.approve(r.id), /STALE/);
    const result = await promise; assert.equal(result.status, 'applied_confirmed');
    assert.equal(f.saves(), 1); assert.equal(f.settings.autoMemoryInterval, 15); assert.equal(f.settings.memoryEnabled, false); assert.equal(f.settings.unrelated, 'keep');
    assert.throws(() => f.actions.prepare('a', 1), /CONSUMED/);
});
for (const change of ['changeArtifact', 'removeArtifact', 'changeTarget']) test(`Changed approval identity is rejected: ${change}`, () => {
    const f = fixture(), r = f.actions.prepare('a', 1); f[change]();
    assert.throws(() => f.actions.approve(r.id), /STALE/); assert.equal(f.saves(), 0); assert.equal(f.settings.autoMemoryInterval, 10);
});
test('Configuration change before commit prevents application', () => {
    const f = fixture(), r = f.actions.prepare('a', 1); f.settings.autoMemorySpeakers = true;
    assert.throws(() => f.actions.approve(r.id), /STALE/); assert.equal(f.saves(), 0);
});
test('Final host check catches changes after approval but before execution', async () => {
    const f = fixture(), r = f.actions.prepare('a', 1), done = f.actions.approve(r.id);
    f.settings.autoMemoryInterval = 99;
    assert.equal((await done).status, 'not_executed'); assert.equal(f.saves(), 0); assert.equal(f.settings.autoMemoryInterval, 99);
});
test('No persistence receipt means unconfirmed, not successful persistence', async () => {
    const f = fixture(), r = f.actions.prepare('a', 1);
    assert.equal((await f.actions.approve(r.id)).status, 'applied_unconfirmed');
});
for (const asynchronous of [false, true]) test(`Save failure never rolls back settings (async=${asynchronous})`, async () => {
    const f = fixture(() => { if (asynchronous) return Promise.reject(Error('private server error')); throw Error('private server error'); });
    const r = f.actions.prepare('a', 1), result = await f.actions.approve(r.id);
    assert.equal(result.status, 'applied_unconfirmed'); assert.equal(result.result.saveError, true);
    assert.equal(f.settings.autoMemoryInterval, 15); assert.doesNotMatch(JSON.stringify(result), /private server error/);
});
test('Concurrent edits survive pending save, cancellation and resetting cannot erase an in-flight write', async () => {
    let resolve; const f = fixture(() => new Promise(r => { resolve = r; }));
    const r = f.actions.prepare('a', 1), done = f.actions.approve(r.id); await Promise.resolve();
    assert.equal(f.actions.busy, true); assert.throws(() => f.actions.cancel(r.id), /STALE/); assert.throws(() => f.actions.clear(), /BUSY/);
    f.settings.autoMemoryInterval = 22; f.settings.unrelated = 'new';
    resolve(); const result = await done;
    assert.equal(result.result.changed, true); assert.equal(f.settings.autoMemoryInterval, 22); assert.equal(f.settings.unrelated, 'new');
});
test('Cancelled, expired and unknown approvals never write', () => {
    for (const cancel of [true, false]) { const f = fixture(), r = f.actions.prepare('a', 1); if (cancel) f.actions.cancel(r.id); else f.actions.invalidate(); assert.throws(() => f.actions.approve(r.id), /STALE/); assert.equal(f.saves(), 0); }
    const f = fixture(); assert.throws(() => f.actions.approve('forged'), /STALE/);
});
test('Host port rejects extra fields and stale baseline without writes', async () => {
    const f = fixture(); await assert.rejects(f.writer.apply({ baseline: f.baseline, changes: { unrelated: 'bad' } }));
    f.settings.autoMemorySpeakers = true;
    await assert.rejects(f.writer.apply({ baseline: f.baseline, changes: f.changes }), /STALE_BASELINE/); assert.equal(f.saves(), 0);
});
