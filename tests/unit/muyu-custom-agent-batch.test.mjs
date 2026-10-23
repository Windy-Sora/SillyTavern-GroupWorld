import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomAgentSystem } from '../../systems/custom-agent-system.js';
import { createCustomAgentPort } from '../../muyu/host/custom-agents.js';
import { createCustomAgentModule } from '../../muyu/modules/custom-agents/index.js';
import { createCustomAgentActions } from '../../muyu/actions/custom-agent-save.js';
import { actionReceipt, validateReceipt, receiptSources, receiptContext } from '../../muyu/actions/receipts.js';
import { requiredSources } from '../../muyu/application/capabilities.js';
import { renderCustomAgentSave } from '../../muyu/ui/custom-agent-save-view.js';

const gate = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const agent = (name, extra = {}) => ({ name, providerName: name, prompt: 'PRIVATE_' + name, ...extra });
const create = name => ({ operation: 'create', changes: agent(name) });
const exported = (...agents) => ({ type: 'custom-agent-export', version: 1, agents });
function fixture() {
    const settings = {}, registry = new Map(), metadata = { retained: 'result' };
    let save = async () => {}, saves = 0, renders = 0;
    const getProviders = () => [...registry.values()];
    const system = createCustomAgentSystem({ settings, saveSettings: () => { saves++; return save(); }, getProviders,
        registerProvider: p => registry.set(p.id, p), unregisterProvider: id => registry.delete(id),
        getChatMetadata: () => { throw Error('must not read chat'); }, getChat: () => [], EXT_KEY: 'gd',
        renderPrompt: () => { renders++; }, createCaller: () => { renders++; } });
    const port = createCustomAgentPort({ getSettings: () => settings, system, getProviders });
    return { settings, port, system, registry, metadata, saves: () => saves, renders: () => renders, onSave(fn) { save = fn; } };
}
test('Custom Agent batch validates all entries before mutation and saves multiple definitions once', async () => {
    const f = fixture(); const content = f.port.previewBatch([create('a'), create('b')]);
    assert.equal(f.saves(), 0); assert.equal(f.settings.customAgents, undefined);
    assert.equal((await f.port.save(content)).status, 'saved_unconfirmed'); assert.equal(f.saves(), 1); assert.equal(f.renders(), 0);
    const rows = f.port.list().items;
    const update = f.port.previewBatch(rows.map(row => ({ operation: 'update', id: row.id, revision: row.revision, changes: { order: 7 } })));
    assert.equal((await f.port.save(update)).status, 'saved_unconfirmed'); assert.equal(f.saves(), 2);
    assert.deepEqual(f.settings.customAgents.map(row => row.order), [7, 7]);
    assert.deepEqual(f.settings.customAgents.map(row => row.prompt), ['PRIVATE_a', 'PRIVATE_b']);
    assert.deepEqual(f.metadata, { retained: 'result' });
    assert.throws(() => f.port.previewBatch([create('c'), { operation: 'create', changes: { name: 'broken' } }]));
    assert.equal(f.saves(), 2); assert.equal(f.settings.customAgents.length, 2);
});
test('Custom Agent batch refuses duplicate targets, duplicate names, implicit name swaps and oversized envelopes', async () => {
    const f = fixture(); await f.port.save(f.port.previewBatch([create('a'), create('b')]));
    const [a, b] = f.port.list().items;
    assert.throws(() => f.port.previewBatch([create('c'), create('c')]), /BATCH/);
    assert.throws(() => f.port.previewBatch([{ operation: 'delete', id: a.id, revision: a.revision }, { operation: 'update', id: a.id, revision: a.revision, changes: { order: 1 } }]), /BATCH/);
    assert.throws(() => f.port.previewBatch([{ operation: 'update', id: a.id, revision: a.revision, changes: { providerName: 'b' } }, { operation: 'update', id: b.id, revision: b.revision, changes: { providerName: 'a' } }]), /EXISTS/);
    for (const input of [[], Array.from({ length: 7 }, (_, i) => create('x' + i)), [{ ...create('c'), allowCode: true }]]) assert.throws(() => f.port.previewBatch(input), /BATCH/);
    assert.throws(() => f.port.previewBatch(['x', 'y', 'z'].map(name => ({ operation: 'create', changes: agent(name, { prompt: 'p'.repeat(10000) }) }))), /byte limit|TOO_LARGE/);
    assert.equal(f.settings.customAgents.length, 2);
});
test('Custom Agent imports default off, require explicit conflict behavior and preserve overwritten identity/results', async () => {
    const f = fixture(); await f.system.add(agent('a', { enabled: true, autoEnabled: true }));
    const id = f.settings.customAgents[0].id;
    const file = exported(agent('a', { enabled: true, autoEnabled: true, prompt: 'replacement' }), agent('b', { enabled: true, autoEnabled: true }));
    assert.throws(() => f.port.previewImport(file), /EXISTS/);
    const skipped = f.port.previewImport(file, 'skip'); assert.deepEqual(skipped.skipped, ['a']); assert.equal(skipped.entries.length, 1);
    assert.equal(skipped.entries[0].next.enabled, false);
    const replace = f.port.previewImport(file, 'replace'); assert.equal(replace.origin, 'import');
    assert.equal(replace.entries[0].previous.enabled, true); assert.equal(replace.entries[0].next.enabled, false); assert.equal(replace.entries[0].next.autoEnabled, false);
    await f.port.save(replace); assert.equal(f.saves(), 2); assert.equal(f.settings.customAgents[0].id, id); assert.equal(f.settings.customAgents[0].prompt, 'replacement');
    assert.equal(f.registry.size, 0); assert.deepEqual(f.metadata, { retained: 'result' }); assert.equal(f.renders(), 0);
    assert.throws(() => f.port.previewImport(file, 'skip'), /NO_CHANGES/);
});
test('Custom Agent import closed format rejects secrets, forged IDs, unsupported versions, duplicate names and system collisions', () => {
    const f = fixture();
    for (const file of [exported(), { ...exported(agent('a')), version: 2 }, { ...exported(agent('a')), apiKey: 'secret' },
        exported(agent('a', { apiKey: 'secret' })), exported(agent('a', { id: 'system' })), exported(agent('a'), agent('a')),
        exported(agent('a', { schema: '[]' })), exported(agent('a', { autoInterval: 201 }))]) assert.throws(() => f.port.previewImport(file));
    f.registry.set('a', { id: 'a', _gdOwner: 'system' }); assert.throws(() => f.port.previewImport(exported(agent('a'))), /CONFLICT/);
    assert.equal(f.settings.customAgents, undefined); assert.equal(f.saves(), 0);
});
test('Custom Agent batch preflights every stale revision and registry conflict before the first write', async () => {
    const f = fixture(); await f.port.save(f.port.previewBatch([create('a'), create('b')]));
    const rows = f.port.list().items;
    const draft = f.port.previewBatch(rows.map(row => ({ operation: 'update', id: row.id, revision: row.revision, changes: { prompt: 'proposed' } })));
    f.settings.customAgents[1].prompt = 'concurrent'; await assert.rejects(f.port.save(draft), /STALE/);
    assert.equal(f.settings.customAgents[0].prompt, 'PRIVATE_a'); assert.equal(f.saves(), 1);
    const creations = f.port.previewBatch([create('c'), create('d')]); f.registry.set('d', { id: 'd', _gdOwner: 'system' });
    await assert.rejects(f.port.save(creations), /CONFLICT/); assert.equal(f.settings.customAgents.length, 2);
});
test('Custom Agent batch revalidates inside business mutation queue', async () => {
    const f = fixture(), started = gate(), wait = gate();
    await f.port.save(f.port.previewBatch([create('a'), create('b')]));
    f.onSave(() => { started.resolve(); return wait.promise; });
    const blocking = f.system.add(agent('other')); await started.promise;
    const draft = f.port.previewBatch(f.port.list().items.slice(0, 2).map(row => ({ operation: 'update', id: row.id, revision: row.revision, changes: { order: 3 } })));
    const saving = f.port.save(draft); f.settings.customAgents[1].order = 8; wait.resolve(); await blocking;
    await assert.rejects(saving, /STALE/); assert.deepEqual(f.settings.customAgents.slice(0, 2).map(row => row.order), [0, 8]);
});
test('Custom Agent failed batch rolls back attempted fields without erasing concurrent edits or unrelated additions', async () => {
    const f = fixture(), started = gate(), wait = gate();
    await f.port.save(f.port.previewBatch([create('a'), create('b')]));
    const [a, b] = f.port.list().items;
    const draft = f.port.previewBatch([{ operation: 'update', id: a.id, revision: a.revision, changes: { prompt: 'proposed', order: 4 } }, { operation: 'delete', id: b.id, revision: b.revision }, create('c')]);
    f.onSave(() => { started.resolve(); return wait.promise; }); const saving = f.port.save(draft); await started.promise;
    f.settings.customAgents[0].prompt = 'concurrent'; f.settings.customAgents.push({ ...agent('other'), id: 'ca_other', enabled: false, autoEnabled: false, autoInterval: 10, order: 0 });
    wait.reject(Error('save failed')); assert.equal((await saving).status, 'outcome_unknown');
    assert.equal(f.settings.customAgents.find(row => row.id === a.id).prompt, 'concurrent'); assert.equal(f.settings.customAgents.find(row => row.id === a.id).order, 0);
    assert.ok(f.settings.customAgents.some(row => row.id === b.id)); assert.ok(f.settings.customAgents.some(row => row.id === 'ca_other')); assert.equal(f.settings.customAgents.some(row => row.providerName === 'c'), false);
});
test('Custom Agent batch reports unknown on concurrent edit during a successful save', async () => {
    const f = fixture(), started = gate(), wait = gate(); f.onSave(() => { started.resolve(); return wait.promise; });
    const saving = f.port.save(f.port.previewBatch([create('a'), create('b')])); await started.promise;
    f.settings.customAgents[1].prompt = 'concurrent'; wait.resolve(); assert.equal((await saving).status, 'outcome_unknown');
});
test('Custom Agent import batch exact approval produces a non-replayable v11 receipt and is one-shot', async () => {
    const f = fixture(), content = f.port.previewImport(exported(agent('a'), agent('b'))), artifact = { id: 'a', revision: 1, sessionId: 's', kind: 'custom-agent-draft', content };
    const actions = createCustomAgentActions({ getArtifact: () => artifact, validate: () => f.port.assertDraft(content), getTarget: () => ({ kind: 'global' }), writer: f.port });
    const approval = actions.prepare('a', 1); assert.equal(f.saves(), 0);
    const result = await actions.approve(approval.id); assert.equal(result.status, 'saved_unconfirmed'); assert.equal(f.saves(), 1);
    assert.throws(() => actions.approve(approval.id), /STALE/);
    const receipt = actionReceipt(result); assert.equal(receipt.version, 11); assert.equal(receipt.items.length, 2); assert.deepEqual(validateReceipt(receipt), receipt);
    assert.deepEqual(receiptSources(receipt), []); assert.doesNotMatch(JSON.stringify(receipt), /PRIVATE_|schema|prompt/); assert.match(receiptContext([receipt]), /Custom Agent batch/);
    assert.throws(() => validateReceipt({ ...receipt, items: [] }), /RECEIPT/);
});
test('Custom Agent batch cancellation writes nothing and tampered import enablement cannot bypass review', () => {
    const f = fixture(), content = f.port.previewImport(exported(agent('a')));
    const forged = structuredClone(content); forged.entries[0].next.enabled = true; assert.throws(() => f.port.assertDraft(forged), /BATCH/);
    const artifact = { id: 'a', revision: 1, sessionId: 's', kind: 'custom-agent-draft', content };
    const actions = createCustomAgentActions({ getArtifact: () => artifact, validate: () => f.port.assertDraft(content), getTarget: () => ({ kind: 'global' }), writer: f.port });
    const approval = actions.prepare('a', 1); actions.cancel(approval.id); assert.throws(() => actions.approve(approval.id), /STALE/);
    assert.equal(actionReceipt(actions.list()[0]).status, 'cancelled'); assert.equal(f.saves(), 0);
});
test('Custom Agent batch/import share candidate lifecycle; failed all-skipped import invalidates an earlier candidate', async () => {
    const f = fixture(); await f.system.add(agent('a'));
    const module = createCustomAgentModule({ port: f.port }), target = { kind: 'global' }; module.bindRun({ id: 'r', taskId: 't', target });
    const ctx = { runId: 'r', target }, candidate = module.handlers['muyu.agents.batch_preview']({ requestsJson: JSON.stringify([create('b')]) }, ctx);
    const skipped = module.handlers['muyu.agents.import_preview']({ exportJson: JSON.stringify(exported(agent('a'))), conflict: 'skip', apply: true }, ctx);
    assert.equal(skipped.candidateId, ''); assert.equal(skipped.applyRequested, undefined); assert.equal(JSON.parse(skipped.text).state, 'no_changes');
    assert.throws(() => module.publishDraft({ snapshot: () => ({ runs: [{ id: 'r', taskId: 't', target, status: 'succeeded' }] }) }, 'r', candidate.candidateId), /CANDIDATE/);
    for (const id of ['muyu.agents.batch_preview', 'muyu.agents.import_preview']) assert.deepEqual(requiredSources(id), ['source:customAgentAssets']);
});
test('Custom Agent batch UI exposes every complete diff and all skipped definitions with one confirm control', () => {
    const f = fixture(), content = f.port.previewBatch([create('a'), create('b')]);
    const doc = { createElement: tag => ({ tag, children: [], append(el) { this.children.push(el); } }) }, card = doc.createElement('div'); let approved = 0;
    renderCustomAgentSave({ doc, card, artifact: { id: 'a', revision: 1, content }, state: { canSaveCustomAgent: true, customAgentActions: [{ id: 'b', artifactId: 'a', revision: 1, status: 'pending' }] }, controller: { approveCustomAgentSave() { approved++; } }, act: fn => fn(), lang: 'en' });
    assert.equal(card.children.filter(el => el.tag === 'details' && el.open).length, 2);
    const buttons = card.children.filter(el => el.textContent === 'Confirm this operation'); assert.equal(buttons.length, 1); assert.equal(approved, 0); buttons[0].onclick(); assert.equal(approved, 1);
});
