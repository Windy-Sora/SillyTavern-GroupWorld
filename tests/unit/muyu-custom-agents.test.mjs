import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomAgentSystem } from '../../systems/custom-agent-system.js';
import { createCustomAgentPort } from '../../muyu/host/custom-agents.js';
import { createCustomAgentModule } from '../../muyu/modules/custom-agents/index.js';
import { createCustomAgentActions } from '../../muyu/actions/custom-agent-save.js';
import { actionReceipt, validateReceipt, receiptContext, receiptSources } from '../../muyu/actions/receipts.js';
import { requiredSources } from '../../muyu/application/capabilities.js';
import { renderCustomAgentSave } from '../../muyu/ui/custom-agent-save-view.js';
import { configurationCoverage } from '../../muyu/config/coverage.js';
const gate = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function fixture(saveSettings = async () => {}) {
    const settings = {}, providers = new Map(), metadata = {};
    let calls = 0, chatReads = 0;
    const getProviders = () => [...providers.values()];
    const system = createCustomAgentSystem({ settings, saveSettings, EXT_KEY: 'gd', getChatMetadata: () => { chatReads++; return metadata; }, getChat: () => [],
        registerProvider: p => providers.set(p.id, p), unregisterProvider: id => providers.delete(id), getProviders,
        renderPrompt: () => { calls++; }, createCaller: () => { calls++; }, generateRaw: () => { calls++; } });
    const port = createCustomAgentPort({ getSettings: () => settings, getProviders, system });
    return { settings, system, port, providers, metadata, getProviders, calls: () => calls, chatReads: () => chatReads };
}
const definition = { name: '金币助手', providerName: 'coins_agent', prompt: 'PRIVATE_PROMPT', schema: '{"gold":0}' };
const create = port => port.preview({ operation: 'create', changes: definition });
test('Custom Agent preview is definition-only, defaults disabled and rejects malformed or connection fields', () => {
    const f = fixture(); assert.deepEqual(f.port.list().items, []);
    const draft = create(f.port); assert.equal(draft.next.enabled, false); assert.equal(draft.next.autoEnabled, false);
    assert.deepEqual(f.settings, {}); assert.equal(f.chatReads(), 0); assert.equal(f.calls(), 0);
    for (const changes of [null, [], { ...definition, id: 'forged' }, { ...definition, apiKey: 'secret' }, { ...definition, enabled: 'true' },
        { ...definition, autoInterval: 201 }, { ...definition, schema: '[]' }, { ...definition, providerName: 'a b' }, { ...definition, order: -1 }, { ...definition, prompt: 'x'.repeat(12001) }]) {
        assert.throws(() => f.port.preview({ operation: 'create', changes }));
    }
    assert.deepEqual(requiredSources('muyu.agents.preview'), ['source:customAgentAssets']);
    const row = configurationCoverage().find(r => r.key === 'customAgents'); assert.equal(row.status, 'special-editor-supported'); assert.equal(row.writer, 'muyu/host/custom-agents.js');
});
test('Custom Agent CRUD preserves omitted fields, synchronizes owned Provider and retains chat results', async () => {
    const f = fixture(); const result = await f.port.save(create(f.port)); assert.equal(result.status, 'saved_unconfirmed');
    const row = f.port.list().items[0]; assert.equal(f.providers.size, 0);
    const enable = f.port.preview({ operation: 'update', id: row.id, revision: row.revision, changes: { enabled: true, autoEnabled: true } });
    assert.equal(enable.next.prompt, definition.prompt); assert.match(enable.warnings.join(''), /费用/);
    const saved = await f.port.save(enable); assert.equal(saved.autoEnabled, true); assert.equal(f.providers.get('coins_agent')._gdOwnerId, row.id);
    assert.equal(f.calls(), 0); assert.equal(f.chatReads(), 0);
    const next = f.port.list().items[0]; const off = f.port.preview({ operation: 'update', id: next.id, revision: next.revision, changes: { enabled: false } });
    assert.equal(off.next.autoEnabled, false); await f.port.save(off); assert.equal(f.providers.size, 0);
    f.metadata.gd = { _caData: { [row.id]: { data: 'retained' } } };
    const last = f.port.list().items[0]; await f.port.save(f.port.preview({ operation: 'delete', id: last.id, revision: last.revision }));
    assert.equal(f.settings.customAgents.length, 0); assert.equal(f.metadata.gd._caData[row.id].data, 'retained'); assert.equal(f.chatReads(), 0);
});
test('Custom Agent refuses system Provider collisions even disabled, and own-name races before saving', async () => {
    const f = fixture(); f.providers.set('coins_agent', { id: 'coins_agent', _gdOwner: 'builtin' });
    assert.throws(() => create(f.port), /CONFLICT/);
    f.providers.clear(); const draft = create(f.port);
    f.providers.set('coins_agent', { id: 'coins_agent', _gdOwner: 'group-director/custom-agent', _gdOwnerId: 'other' });
    await assert.rejects(f.port.save(draft), /CONFLICT/); assert.equal(f.settings.customAgents, undefined);
    f.providers.clear(); await f.port.save(draft); assert.throws(() => create(f.port), /EXISTS/);
});
test('Custom Agent stale revisions reject in-place and same-content replacement; reads paginate without connection data', async () => {
    const f = fixture(); await f.system.add({ ...definition, prompt: 'x'.repeat(40000) });
    let row = f.port.list().items[0]; assert.equal(f.port.read(row.id, row.revision).nextOffset, 8000);
    assert.throws(() => f.port.preview({ operation: 'delete', id: row.id, revision: row.revision }), /limit|UNSUPPORTED/);
    f.settings.customAgents[0].prompt = 'short'; assert.throws(() => f.port.read(row.id, row.revision), /STALE/);
    row = f.port.list().items[0]; f.settings.customAgents[0] = { ...f.settings.customAgents[0] }; assert.throws(() => f.port.read(row.id, row.revision), /STALE/);
    f.settings.customAgents[0].apiKey = 'PRIVATE_CONNECTION'; row = f.port.list().items[0]; assert.doesNotMatch(f.port.read(row.id, row.revision).text, /PRIVATE_CONNECTION|apiKey/);
    assert.throws(() => f.port.preview({ operation: 'update', id: row.id, revision: row.revision, changes: { enabled: true } }), /UNSUPPORTED/);
    const module = createCustomAgentModule({ port: f.port, charge: () => false });
    assert.throws(() => module.handlers['muyu.agents.read']({ id: row.id, revision: row.revision, offset: 0 }, { runId: 'r' }), /BUDGET/);
});
test('Custom Agent approved mutation revalidates inside the shared queue', async () => {
    let hold = false; const started = gate(), wait = gate(), f = fixture(() => { if (hold) { started.resolve(); return wait.promise; } });
    await f.port.save(create(f.port)); hold = true;
    const blocking = f.system.add({ name: 'other', providerName: 'other' }); await started.promise;
    const row = f.port.list().items[0], draft = f.port.preview({ operation: 'update', id: row.id, revision: row.revision, changes: { prompt: 'proposed' } });
    const saving = f.port.save(draft); f.settings.customAgents[0].prompt = 'concurrent'; wait.resolve(); await blocking;
    await assert.rejects(saving, /STALE/); assert.equal(f.settings.customAgents[0].prompt, 'concurrent');
});
test('Custom Agent failed save rolls back only attempted fields, preserving concurrent edits', async () => {
    let hold = false; const started = gate(), wait = gate(), f = fixture(() => { if (hold) { started.resolve(); return wait.promise; } });
    await f.port.save(create(f.port)); await f.system.add({ name: 'other', providerName: 'other' });
    const row = f.port.list().items[0], draft = f.port.preview({ operation: 'update', id: row.id, revision: row.revision, changes: { prompt: 'proposed', order: 5, enabled: true } });
    hold = true; const saving = f.port.save(draft); await started.promise;
    f.settings.customAgents[0].prompt = 'concurrent'; f.settings.customAgents[1].name = 'other edited'; wait.reject(Error('save failed'));
    assert.equal((await saving).status, 'outcome_unknown'); assert.equal(f.settings.customAgents[0].prompt, 'concurrent');
    assert.equal(f.settings.customAgents[0].order, 0); assert.equal(f.settings.customAgents[1].name, 'other edited'); assert.equal(f.providers.size, 0);
});
test('Custom Agent concurrent successful save does not claim exact proposal remains current', async () => {
    let hold = false; const started = gate(), wait = gate(), f = fixture(() => { if (hold) { started.resolve(); return wait.promise; } });
    await f.port.save(create(f.port)); const row = f.port.list().items[0];
    const draft = f.port.preview({ operation: 'update', id: row.id, revision: row.revision, changes: { prompt: 'proposed' } });
    hold = true; const saving = f.port.save(draft); await started.promise; f.settings.customAgents[0].prompt = 'concurrent'; wait.resolve();
    assert.equal((await saving).status, 'outcome_unknown');
});
test('Custom Agent exact approval is one-shot; v10 receipt/history omit prompt/schema', async () => {
    const f = fixture(), content = create(f.port), artifact = { id: 'a', revision: 1, sessionId: 's', kind: 'custom-agent-draft', content };
    const actions = createCustomAgentActions({ getArtifact: () => artifact, validate: () => f.port.assertDraft(content), getTarget: () => ({ kind: 'global', userKey: 'u' }), writer: f.port });
    const approval = actions.prepare('a', 1); assert.equal(f.settings.customAgents, undefined);
    const action = await actions.approve(approval.id); assert.equal(action.status, 'saved_unconfirmed'); assert.throws(() => actions.approve(approval.id), /STALE/);
    const receipt = actionReceipt(action); assert.equal(receipt.version, 10); assert.deepEqual(validateReceipt(receipt), receipt); assert.deepEqual(receiptSources(receipt), []);
    assert.doesNotMatch(JSON.stringify(receipt), /PRIVATE_PROMPT|schema|gold/); assert.match(receiptContext([receipt]), /Custom Agent/);
});
test('Custom Agent settings replacement refuses a stale system, cancelled actions never save', async () => {
    const f = fixture(), replacement = {};
    const port = createCustomAgentPort({ getSettings: () => replacement, system: f.system, getProviders: f.getProviders });
    await assert.rejects(port.save(create(port)), /STALE/); assert.deepEqual(f.settings, {});
    const content = create(f.port), artifact = { id: 'a', revision: 1, sessionId: 's', kind: 'custom-agent-draft', content };
    const actions = createCustomAgentActions({ getArtifact: () => artifact, validate: () => {}, getTarget: () => ({ kind: 'global' }), writer: f.port });
    const approval = actions.prepare('a', 1); actions.cancel(approval.id); assert.throws(() => actions.approve(approval.id), /STALE/);
    assert.equal(actionReceipt(actions.list()[0]).status, 'cancelled'); assert.deepEqual(f.settings, {});
});
test('Custom Agent module clears obsolete candidates and transfers only exact task/target', () => {
    const f = fixture(), module = createCustomAgentModule({ port: f.port }), target = { kind: 'global' };
    module.bindRun({ id: 'r', taskId: 't', target });
    const result = module.handlers['muyu.agents.preview']({ operation: 'create', changesJson: JSON.stringify(definition) }, { runId: 'r', target });
    assert.throws(() => module.transferRun('r', { id: 'r2', taskId: 'other', target }), /TRANSFER/);
    module.transferRun('r', { id: 'r2', taskId: 't', target });
    assert.throws(() => module.handlers['muyu.agents.preview']({ operation: 'create', changesJson: '{}' }, { runId: 'r2', target }));
    assert.throws(() => module.publishDraft({ snapshot: () => ({ runs: [{ id: 'r2', taskId: 't', target, status: 'succeeded' }] }) }, 'r2', result.candidateId), /CANDIDATE/);
});
test('Custom Agent confirmation shows complete definitions as plain text with future model cost warning', () => {
    const f = fixture(), content = f.port.preview({ operation: 'create', changes: { ...definition, enabled: true, autoEnabled: true, prompt: '<script>not executable</script>' } });
    const doc = { createElement: tag => ({ tag, children: [], append(el) { this.children.push(el); } }) }, card = doc.createElement('div'); let approved = 0;
    renderCustomAgentSave({ doc, card, artifact: { id: 'a', revision: 1, content }, state: { canSaveCustomAgent: true, customAgentActions: [{ id: 'b', artifactId: 'a', revision: 1, status: 'pending' }] }, controller: { approveCustomAgentSave() { approved++; } }, act: fn => fn(), lang: 'en' });
    assert.ok(card.children.some(el => String(el.textContent).includes('future automatic model calls'))); assert.equal(approved, 0);
    card.children.find(el => el.textContent === 'Confirm this operation').onclick(); assert.equal(approved, 1);
});
