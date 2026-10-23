import test from 'node:test';
import assert from 'node:assert/strict';
import { createScriptExecutorSystem } from '../../systems/script-executor-system.js';
import { createScriptExecutorPort } from '../../muyu/host/script-executors.js';
import { createScriptExecutorModule } from '../../muyu/modules/script-executors/index.js';
import { createScriptActions } from '../../muyu/actions/script-save.js';
import { actionReceipt, validateReceipt, receiptContext } from '../../muyu/actions/receipts.js';
import { requiredSources } from '../../muyu/application/capabilities.js';
import { renderScriptSave } from '../../muyu/ui/script-save-view.js';
const gate = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function fixture(saveSettings = async () => {}) {
    const settings = { scriptExecutors: [] };
    const system = createScriptExecutorSystem({ settings, saveSettings });
    const port = createScriptExecutorPort({ getSettings: () => settings, system });
    return { settings, system, port };
}
const create = port => port.preview({ operation: 'create', changes: { name: '金币脚本', code: 'globalThis.__scriptProbe++;' } });
const fillScripts = (f, count) => { f.settings.scriptExecutors = Array.from({ length: count }, (_, i) => ({ id: 's' + i, name: 'Saved ' + i, enabled: false, code: '' })); };
test('BUG-91F-03 script creation permits 256th, refuses 257th without save or execution', async () => {
    let saves = 0; const f = fixture(async () => { saves++; }); fillScripts(f, 255);
    assert.equal((await f.port.save(create(f.port))).status, 'saved_unconfirmed');
    assert.equal(f.settings.scriptExecutors.length, 256);
    assert.throws(() => create(f.port), /SCRIPT_ASSET_CAPACITY/);
    assert.equal(saves, 1); assert.equal(f.port.list().items.length, 32);
});
test('BUG-91F-03 script mutation queue rechecks capacity after approval', async () => {
    let saves = 0; const f = fixture(async () => { saves++; }); fillScripts(f, 255);
    const draft = create(f.port);
    const blocker = gate(), started = gate();
    f.system = createScriptExecutorSystem({ settings: f.settings, saveSettings: async () => { started.resolve(); await blocker.promise; } });
    const port = createScriptExecutorPort({ getSettings: () => f.settings, system: f.system });
    const other = f.system.mutateApproved({ operation: 'create', definition: { name: 'Queued other', enabled: false, code: '' }, validate() {} });
    await started.promise;
    const pending = port.save(draft); blocker.resolve(); await other;
    await assert.rejects(pending, /SCRIPT_ASSET_CAPACITY/);
    assert.equal(f.settings.scriptExecutors.length, 256); assert.equal(saves, 0);
});
test('BUG-91F-03 over-limit legacy script collection remains readable and deletable', async () => {
    const f = fixture(); fillScripts(f, 257);
    const row = f.port.list().items[0]; assert.ok(f.port.read(row.id, row.revision).text);
    await f.port.save(f.port.preview({ operation: 'delete', id: row.id, revision: row.revision, changes: {} }));
    assert.equal(f.settings.scriptExecutors.length, 256); assert.equal(f.port.list().items.length, 32);
});
test('Script preview never runs or saves code, defaults off, and rejects invalid fields', () => {
    const f = fixture(); globalThis.__scriptProbe = 0;
    const content = create(f.port);
    assert.equal(content.next.enabled, false); assert.equal(f.settings.scriptExecutors.length, 0); assert.equal(globalThis.__scriptProbe, 0);
    delete globalThis.__scriptProbe;
    for (const changes of [{ name: 'x', priority: 101 }, { name: 'x', triggerOn: 'unknown' }, { name: 'x', params: [{ key: '__proto__' }] }, { name: 'x', id: 'forge' }, { name: 'x', enabled: 'true' }]) assert.throws(() => f.port.preview({ operation: 'create', changes }));
});
test('Script create/update/delete reuse saved definitions, preserve unspecified fields and never actively execute', async () => {
    const f = fixture(); const result = await f.port.save(create(f.port));
    assert.equal(result.status, 'saved_unconfirmed');
    const row = f.port.list().items[0];
    const draft = f.port.preview({ operation: 'update', id: row.id, revision: row.revision, changes: { enabled: true } });
    assert.equal(draft.next.code, 'globalThis.__scriptProbe++;'); assert.match(draft.warnings.join(''), /自动执行/);
    assert.equal((await f.port.save(draft)).enabled, true);
    const next = f.port.list().items[0];
    await f.port.save(f.port.preview({ operation: 'delete', id: next.id, revision: next.revision }));
    assert.equal(f.settings.scriptExecutors.length, 0);
});
test('Script read paginates large definitions, detects in-place edits and charges shared bytes', async () => {
    const f = fixture(); await f.system.add({ name: 'large', code: 'a'.repeat(40000), enabled: false });
    const row = f.port.list().items[0]; assert.equal(f.port.read(row.id, row.revision).nextOffset, 8000);
    assert.throws(() => f.port.preview({ operation: 'update', id: row.id, revision: row.revision, changes: { enabled: false } }));
    const module = createScriptExecutorModule({ port: f.port, charge: () => false });
    assert.throws(() => module.handlers['muyu.scripts.read']({ id: row.id, revision: row.revision, offset: 0 }, { runId: 'r' }), /BUDGET/);
    f.settings.scriptExecutors[0].priority++;
    assert.throws(() => f.port.read(row.id, row.revision), /STALE/);
    assert.deepEqual(requiredSources('muyu.scripts.preview'), ['source:scriptAssets']);
});
test('Script queued approval revalidates after preceding GUI mutation, before any write', async () => {
    const wait = gate(), f = fixture(); await f.system.add({ name: 'x', enabled: false });
    const row = f.port.list().items[0], draft = f.port.preview({ operation: 'update', id: row.id, revision: row.revision, changes: { enabled: true } });
    let validateCalls = 0;
    const blocking = f.system.mutateApproved({ operation: 'update', id: row.id, definition: { ...f.settings.scriptExecutors[0], code: 'edited' }, validate: () => { validateCalls++; } });
    await blocking;
    await assert.rejects(f.port.save(draft), /STALE/);
    assert.equal(validateCalls, 1); assert.equal(f.settings.scriptExecutors[0].enabled, false);
    wait.resolve();
});
test('Script queue validation occurs after approval was enqueued', async () => {
    let hold = false; const wait = gate(), started = gate(), f = fixture(() => { if (hold) { started.resolve(); return wait.promise; } });
    await f.system.add({ name: 'other', enabled: false }); await f.system.add({ name: 'target', enabled: false });
    const target = f.port.list().items[1], draft = f.port.preview({ operation: 'update', id: target.id, revision: target.revision, changes: { code: 'new' } });
    hold = true; const before = f.system.update(f.settings.scriptExecutors[0].id, { priority: 3 }); await started.promise;
    const saving = f.port.save(draft);
    f.settings.scriptExecutors[1].code = 'concurrent';
    wait.resolve(); await before; await assert.rejects(saving, /STALE/);
    assert.equal(f.settings.scriptExecutors[1].code, 'concurrent');
});
test('Script save failure preserves concurrent target edits and unrelated assets', async () => {
    let hold = false; const wait = gate(), started = gate(), f = fixture(() => { if (hold) { started.resolve(); return wait.promise; } });
    await f.system.add({ name: 'x', enabled: false }); await f.system.add({ name: 'other', enabled: false });
    const row = f.port.list().items[0], draft = f.port.preview({ operation: 'update', id: row.id, revision: row.revision, changes: { code: 'proposal', priority: 5 } });
    hold = true; const saving = f.port.save(draft); await started.promise;
    f.settings.scriptExecutors[0].code = 'concurrent'; f.settings.scriptExecutors[1].name = 'other edited';
    wait.reject(Error('save')); assert.equal((await saving).status, 'outcome_unknown');
    assert.equal(f.settings.scriptExecutors[0].code, 'concurrent'); assert.equal(f.settings.scriptExecutors[0].priority, 0); assert.equal(f.settings.scriptExecutors[1].name, 'other edited');
});
test('Script success with concurrent mutation reports unknown rather than exact save success', async () => {
    let hold = false; const wait = gate(), started = gate(), f = fixture(() => { if (hold) { started.resolve(); return wait.promise; } });
    await f.system.add({ name: 'x', enabled: false });
    const row = f.port.list().items[0], draft = f.port.preview({ operation: 'update', id: row.id, revision: row.revision, changes: { code: 'proposal' } });
    hold = true; const saving = f.port.save(draft); await started.promise; f.settings.scriptExecutors[0].code = 'concurrent'; wait.resolve();
    assert.equal((await saving).status, 'outcome_unknown');
});
test('Script action exact approval is one-shot; v8 receipt omits code and replay parameters', async () => {
    const f = fixture(), content = create(f.port), artifact = { id: 'a', revision: 1, sessionId: 's', kind: 'script-draft', content };
    const target = { kind: 'global', userKey: 'u' }, actions = createScriptActions({ getArtifact: () => artifact, validate: () => f.port.assertDraft(content), getTarget: () => target, writer: f.port });
    const approval = actions.prepare('a', 1); assert.equal(f.settings.scriptExecutors.length, 0);
    const action = await actions.approve(approval.id); assert.equal(action.status, 'saved_unconfirmed');
    assert.throws(() => actions.approve(approval.id), /STALE/);
    const receipt = actionReceipt(action); assert.equal(receipt.version, 8); assert.deepEqual(validateReceipt(receipt), receipt);
    assert.doesNotMatch(JSON.stringify(receipt), /__scriptProbe|params|code/); assert.match(receiptContext([receipt]), /脚本执行器|Script Executor/);
});
test('Script confirmation shows full definitions as text and warns about enabled event execution', () => {
    const doc = { createElement: tag => ({ tag, children: [], append(el) { this.children.push(el); } }) }, card = doc.createElement('div');
    const f = fixture(), content = f.port.preview({ operation: 'create', changes: { name: 'x', code: '<script>', enabled: true } });
    let approved = 0;
    renderScriptSave({ doc, card, artifact: { id: 'a', revision: 1, content }, state: { canSaveScript: true, scriptActions: [{ id: 'b', artifactId: 'a', revision: 1, status: 'pending' }] }, controller: { approveScriptSave() { approved++; } }, act: fn => fn(), lang: 'en' });
    assert.ok(card.children.some(el => String(el.textContent).includes('future matching events'))); assert.equal(approved, 0);
    card.children.find(el => el.textContent === 'Confirm this operation').onclick(); assert.equal(approved, 1);
});

test('Script version rejects same-content object replacement, duplicate IDs and changed create names', async () => {
    const f = fixture(); await f.system.add({ name: 'x', enabled: false });
    const row = f.port.list().items[0]; f.settings.scriptExecutors[0] = { ...f.settings.scriptExecutors[0] };
    assert.throws(() => f.port.read(row.id, row.revision), /STALE/);
    const next = f.port.list().items[0]; f.settings.scriptExecutors.push({ ...f.settings.scriptExecutors[0] });
    assert.throws(() => f.port.preview({ operation: 'delete', id: next.id, revision: next.revision }), /STALE/);
    assert.throws(() => f.port.preview({ operation: 'create', changes: { name: 'x' } }), /EXISTS/);
});
test('Script pending approval cancellation prevents saving and leaves no replayable receipt code', () => {
    const f = fixture(), content = create(f.port), artifact = { id: 'a', revision: 1, sessionId: 's', kind: 'script-draft', content };
    const actions = createScriptActions({ getArtifact: () => artifact, validate: () => f.port.assertDraft(content), getTarget: () => ({ kind: 'global' }), writer: f.port });
    const approval = actions.prepare('a', 1); actions.cancel(approval.id);
    assert.throws(() => actions.approve(approval.id), /STALE/); assert.equal(f.settings.scriptExecutors.length, 0);
    assert.equal(actionReceipt(actions.list()[0]).status, 'cancelled');
});
test('Script settings replacement refuses a stale business-system instance before write', async () => {
    const f = fixture(), replacement = { scriptExecutors: [] };
    const port = createScriptExecutorPort({ getSettings: () => replacement, system: f.system });
    await assert.rejects(port.save(create(port)), /STALE/);
    assert.equal(replacement.scriptExecutors.length, 0); assert.equal(f.settings.scriptExecutors.length, 0);
});
test('Script module publishes only current candidate and failed preview invalidates prior candidate', () => {
    const f = fixture(), module = createScriptExecutorModule({ port: f.port }), target = { kind: 'global' };
    module.bindRun({ id: 'r', taskId: 't', target });
    const ctx = { runId: 'r', target }, result = module.handlers['muyu.scripts.preview']({ operation: 'create', changesJson: '{"name":"x"}' }, ctx);
    assert.throws(() => module.handlers['muyu.scripts.preview']({ operation: 'create', changesJson: '{}' }, ctx));
    assert.throws(() => module.publishDraft({ snapshot: () => ({ runs: [{ id: 'r', taskId: 't', target, status: 'succeeded' }] }) }, 'r', result.candidateId), /INVALID_CANDIDATE/);
});
