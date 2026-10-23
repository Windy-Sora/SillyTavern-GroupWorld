import test from 'node:test';
import assert from 'node:assert/strict';
import { createActionAssembly } from '../../muyu/actions/assembly.js';
import { createBuiltinActions } from '../../muyu/actions/builtins.js';
import { createApprovedActions } from '../../muyu/actions/coordinator.js';

function fake() {
    const calls = [];
    return { calls, busy: false, list: () => [], prepare() { calls.push('prepare'); }, approve() { calls.push('approve'); },
        cancel() {}, invalidate() { calls.push('invalidate'); }, drain() { calls.push('drain'); }, clear() { calls.push('clear'); } };
}
const entry = (id, coordinator = fake(), artifactKinds = [id], scope = 'chat') => ({ id, coordinator, artifactKinds, scope });

test('Action assembly rejects missing hooks, duplicate IDs/kinds/owners, invalid scope and overflow before lifecycle calls', () => {
    const owner = fake();
    for (const entries of [null, [], [entry('a'), entry('a')], [entry('a'), entry('b', fake(), ['a'])],
        [entry('a', owner), entry('b', owner)], [entry('a', fake(), ['a', 'a'])], [entry('a', { ...fake(), drain: undefined })],
        [entry('a', fake(), [], 'chat')], [entry('a', fake(), ['a'], 'unknown')],
        Array.from({ length: 65 }, (_, i) => entry(String(i)))]) assert.throws(() => createActionAssembly(entries));
    assert.deepEqual(owner.calls, []);
});

test('New action owner participates in lookup, receipts, busy and cleanup without controller branches or implicit approval', async () => {
    const first = fake(), extension = fake(); extension.list = () => [{ id: 'future:1', status: 'partial' }];
    const source = [entry('existing', first), entry('future', extension, ['future-draft', 'future-edit'])];
    const assembly = createActionAssembly(source);
    source[1].artifactKinds.push('injected'); source.pop();
    assert.equal(assembly.get('future'), extension); assert.equal(assembly.forKind('future-edit'), extension);
    assert.throws(() => assembly.forKind('injected'), /UNKNOWN_ACTION_KIND/);
    assert.throws(() => assembly.forKind('unknown'), /UNKNOWN_ACTION_KIND/);
    assert.throws(() => assembly.get('unknown'), /UNKNOWN_ACTION_OWNER/);
    const metadata = assembly.describe(); metadata[1].artifactKinds.push('tamper');
    assert.throws(() => assembly.forKind('tamper'), /UNKNOWN_ACTION_KIND/);
    assert.deepEqual(assembly.list(), [{ id: 'future:1', status: 'partial' }]);
    extension.busy = true; assert.equal(assembly.busy, true);
    assert.throws(() => assembly.clear(), /ACTION_BUSY/); assert.deepEqual(first.calls, []);
    extension.busy = false; assembly.invalidate(); assembly.invalidate(); await assembly.drain(); assembly.clear(); assembly.clear();
    assert.deepEqual(extension.calls, ['invalidate', 'invalidate', 'drain', 'clear', 'clear']);
    assert.deepEqual(first.calls, extension.calls);
});

test('Lifecycle failure does not omit later owners; drain waits for all physical work before rejecting', async () => {
    let release, settled = false;
    const bad = fake(), slow = fake();
    bad.invalidate = () => { throw Error('bad invalidation'); }; bad.drain = () => { throw Error('bad drain'); };
    slow.drain = () => new Promise(resolve => { release = resolve; });
    const assembly = createActionAssembly([entry('bad', bad), entry('slow', slow)]);
    assert.throws(() => assembly.invalidate(), /ACTION_LIFECYCLE_FAILED/); assert.deepEqual(slow.calls, ['invalidate']);
    const draining = assembly.drain().finally(() => { settled = true; });
    const rejected = assert.rejects(draining, /ACTION_DRAIN_FAILED/);
    await Promise.resolve(); await Promise.resolve(); assert.equal(settled, false);
    release(); await rejected; assert.equal(settled, true);
});

test('Invalidation expires pending approvals but cannot cancel or forget an already dispatched write', async () => {
    let release, writes = 0;
    const artifact = { id: 'draft', kind: 'test', revision: 1, sessionId: 's', content: { value: 1 } };
    const owner = createApprovedActions({ getArtifact: () => artifact, getTarget: () => ({ kind: 'global' }), contract: {
        idPrefix: 'test:', matchesArtifact: () => true, validate() {}, notExecuted: () => false,
        execute: () => { writes++; return new Promise(resolve => { release = resolve; }); }, resultStatus: result => result.status,
    } });
    const assembly = createActionAssembly([entry('test', owner)]);
    const pending = owner.prepare('draft', 1); assembly.invalidate(); assembly.invalidate();
    assert.equal(owner.list()[0].status, 'expired'); assert.throws(() => owner.approve(pending.id), /ACTION_STALE/);
    assembly.clear(); const active = owner.prepare('draft', 1); const applying = owner.approve(active.id);
    await Promise.resolve(); assembly.invalidate(); assert.equal(assembly.busy, true); assert.equal(writes, 1);
    assert.throws(() => assembly.clear(), /ACTION_BUSY/);
    let drained = false; const waiting = assembly.drain().then(() => { drained = true; }); await Promise.resolve();
    assert.equal(drained, false); release({ status: 'partial' }); await applying; await waiting;
    assert.equal(assembly.list()[0].status, 'partial'); assert.equal(writes, 1);
    assembly.clear(); assert.deepEqual(assembly.list(), []);
});

test('Builtin assembly maps all 25 coordinators explicitly and rejects unknown kinds rather than falling back to bundles', () => {
    const assembly = createBuiltinActions({ host: { globalTarget: { kind: 'global' }, currentTarget: () => ({ kind: 'chat', chatKey: 'A' }) }, getArtifact: () => null, validate() {} });
    assert.equal(assembly.describe().length, 25);
    assert.equal(new Set(assembly.describe().flatMap(row => row.artifactKinds)).size, 26);
    assert.equal(assembly.forKind('variable-draft'), assembly.forKind('variable-editor-draft'));
    assert.equal(assembly.forKind('task-bundle'), assembly.get('bundleActions'));
    assert.equal(assembly.describe().find(row => row.id === 'stPresetActions').scope, 'global');
    assert.equal(assembly.describe().find(row => row.id === 'variableActions').scope, 'chat');
    assert.throws(() => assembly.forKind('task-bundle-unknown'), /UNKNOWN_ACTION_KIND/);
    assert.deepEqual(assembly.list(), []);
    assembly.invalidate(); assembly.clear(); assert.deepEqual(assembly.list(), []);
});

test('Migrated config, variables and bundle owners retain targets, exact validation, writers and result semantics', async () => {
    for (const [id, kind, content, scope, status] of [
        ['actions', 'config-draft', { preview: { diff: [{ field: 'autoMemoryInterval', after: 15 }], manifest: { settings: { autoMemoryInterval: 15 } } }, baseline: { autoMemoryInterval: 10 } }, 'global', 'applied_unconfirmed'],
        ['variableActions', 'variable-draft', { preview: { diff: [{ field: 'coins' }] } }, 'chat', 'applied_confirmed'],
        ['bundleActions', 'task-bundle', { module: 'task-bundle' }, 'chat', 'partial'],
    ]) {
        let writes = 0, validations = 0, current = { kind: 'chat', chatKey: 'A' };
        const artifact = { id: 'draft', kind, revision: 1, sessionId: 's', content };
        const writer = { apply: async () => { writes++; return { status }; } };
        const assembly = createBuiltinActions({ host: { globalTarget: { kind: 'global' }, currentTarget: () => current,
            configWriter: writer, variableWriter: writer, bundleWriter: writer }, getArtifact: () => artifact, validate() { validations++; } });
        const owner = assembly.get(id), record = owner.prepare('draft', 1);
        assert.equal(record.target.kind, scope); assert.equal(writes, 0);
        const result = await owner.approve(record.id); assert.equal(result.status, status); assert.equal(writes, 1);
        assert.ok(validations >= 3); assert.throws(() => owner.approve(record.id), /ACTION_STALE/);
        assembly.clear(); const stale = owner.prepare('draft', 1);
        if (scope === 'chat') current = { kind: 'chat', chatKey: 'B' }; else artifact.revision = 2;
        assert.throws(() => owner.approve(stale.id), /ACTION_STALE/); assert.equal(writes, 1);
    }
});
