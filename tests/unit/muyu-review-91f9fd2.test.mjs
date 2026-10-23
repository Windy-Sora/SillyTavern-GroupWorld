import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { actionReceipt, receiptContext, validateReceipt, receiptStatuses } from '../../muyu/actions/receipts.js';
import { createDraftRuns } from '../../muyu/modules/draft-runs.js';
import { createMemoryEditorPort } from '../../muyu/host/memory-editor.js';
import { createHostBridge } from '../../muyu/host/bridge.js';
import { createMuyuController } from '../../muyu/application/controller.js';
import { scriptedModel, text, done, flush } from './helpers/muyu-subject.mjs';

const contents = [
    { module: 'memory-editor', operation: 'update', character: 'Alice', index: 0 },
    { module: 'profile-editor', operation: 'update', character: 'Alice' },
    { module: 'npc-editor', operation: 'update', selector: 'npc-0' },
    { module: 'blueprint-node-editor', selector: 'node-0' },
    { module: 'ledger-editor', operation: 'update', selector: 'ledger-0' },
    { module: 'selection-editor', kind: 'worldbooks' },
    { module: 'blueprint-node-editor', operation: 'move', completion: { before: { exists: false } } },
    { module: 'memory-editor', operation: 'create', character: 'Alice', index: 0 },
    { module: 'blueprint-node-editor', operation: 'initialize', completion: { before: { exists: false } } },
    { module: 'profile-editor', operation: 'create' },
];
for (const [i, content] of contents.entries()) test(`BUG-91F-01 v${21 + i} legal terminal receipts serialize without diff`, () => {
    for (const status of receiptStatuses) {
        const receipt = actionReceipt({ id: 'op', artifactId: 'artifact', revision: 1, status, content, result: { chatSave: 'confirmed', settingsSave: 'confirmed' } });
        assert.equal(validateReceipt(receipt).version, 21 + i);
        const context = receiptContext([receipt]);
        assert.match(context, /historical reference only/);
        assert.match(context, new RegExp('"version":' + (21 + i)));
        assert.doesNotMatch(context, /"diff":/);
    }
});

test('BUG-91F-02 draft tickets survive transfer/publication, not replacement/cancellation/deletion', () => {
    const released = [], runs = createDraftRuns({ release: c => released.push(c.ticket) });
    const candidate = ticket => ({ candidate: { content: { ticket } } });
    runs.set('a', candidate('old')); runs.discardCandidate('a');
    runs.get('a').candidate = candidate('keep').candidate;
    const moved = runs.take('a'); runs.set('b', moved);
    assert.deepEqual(released, ['old']);
    runs.publish('b', { id: 'draft', content: { ticket: 'keep' } }); runs.delete('b');
    runs.set('c', candidate('cancel')); runs.delete('c');
    runs.retainArtifacts([{ id: 'draft', content: { ticket: 'keep' } }]);
    assert.deepEqual(released, ['old', 'cancel']);
    runs.retainArtifacts([]); runs.retainArtifacts([]);
    assert.deepEqual(released, ['old', 'cancel', 'keep']);
    runs.set('d', candidate('dispose')); runs.clear();
    assert.equal(released.at(-1), 'dispose');
});

for (const [name, factory, toolId, args] of [
    ['memory-editor', 'createMemoryEditorModule', 'muyu.memory_editor.preview', { changesJson: '{}' }],
    ['profile-editor', 'createProfileEditorModule', 'muyu.profile_editor.preview', { changesJson: '{}' }],
    ['npc-editor', 'createNpcEditorModule', 'muyu.npc_editor.preview', { changesJson: '{}' }],
    ['blueprint-node-editor', 'createBlueprintNodeEditorModule', 'muyu.blueprint_node_editor.preview', { changesJson: '{}' }],
    ['ledger-editor', 'createLedgerEditorModule', 'muyu.ledger_editor.preview', { changesJson: '{}' }],
    ['selection-editor', 'createSelectionEditorModule', 'muyu.selection.preview', { changesJson: '{}' }],
    ['variable-editor', 'createVariableEditorModule', 'muyu.variable_editor.preview', { changesJson: '{}' }],
    ['profile-library-chat', 'createProfileLibraryChatModule', 'muyu.library_chat.capture_preview', { name: 'fixture' }],
    ['npc-library-chat', 'createNpcLibraryChatModule', 'muyu.npc_library_chat.capture_preview', { name: 'fixture' }],
    ['blueprint-library-chat', 'createBlueprintLibraryChatModule', 'muyu.blueprint_library_chat.capture_preview', { name: 'fixture' }],
]) test(`BUG-91F-02 ${name} module releases only orphan tickets`, async () => {
    const { [factory]: create } = await import(`../../muyu/modules/${name}/index.js`);
    const live = new Set(), released = []; let serial = 0;
    const make = () => { const ticket = 't' + serial++; live.add(ticket); return { ticket, operation: 'update', warnings: [], count: 1, skipped: [], unmatched: [] }; };
    const port = { preview: make, capture: make, assertFresh: c => assert.ok(live.has(c.ticket)), release: c => { released.push(c.ticket); live.delete(c.ticket); }, clear() {}, clearPlans() {} };
    const module = create({ port }), target = { kind: 'chat', chatKey: 'A' };
    const identity = id => ({ id, taskId: 'task', target });
    module.bindRun(identity('one'));
    module.handlers[toolId](args, { runId: 'one', target });
    const response = module.handlers[toolId](args, { runId: 'one', target });
    assert.deepEqual(released, ['t0']); module.transferRun('one', identity('two')); assert.ok(live.has('t1'));
    const app = { snapshot: () => ({ runs: [{ ...identity('two'), status: 'succeeded' }] }), createArtifact: value => ({ ...value, id: 'draft', revision: 1 }) };
    const artifact = module.publishDraft(app, 'two', response.candidateId); module.forgetRun('two');
    module.retainArtifacts([artifact]); assert.ok(live.has('t1'));
    module.bindRun(identity('three')); module.handlers[toolId](args, { runId: 'three', target }); module.forgetRun('three');
    assert.deepEqual(released, ['t0', 't2']); module.retainArtifacts([]); assert.equal(live.size, 0);
    module.dispose();
});

test('BUG-91F-02 ticket-level host release preserves another approvable memory draft', () => {
    const f = controllerFixture(() => scriptedModel([])), target = f.host.currentTarget(), row = f.port.list(target).items[0];
    const prepare = event => f.port.preview(target, { ...row, operation: 'update', index: 0, changes: { event } });
    const kept = prepare('Keep');
    for (let i = 0; i < 80; i++) { const orphan = prepare('Discard'); f.port.release(orphan); assert.throws(() => f.port.assertFresh(orphan), /STALE/); }
    f.port.assertFresh(kept); f.port.release(kept);
    return f.controller.dispose();
});

function controllerFixture(model) {
    const metadata = { gd: { charMemories: { 'a.png': [{ event: 'Original' }] } } }, events = new EventEmitter();
    const ctx = { groupId: 'g', chatId: 'A', groups: [{ id: 'g', members: ['a.png'] }], chat: [], chatMetadata: metadata,
        eventSource: events, eventTypes: { CHAT_CHANGED: 'chat' } };
    let host, saves = 0;
    const port = createMemoryEditorPort({ getTarget: () => host.currentTarget(), getMetadata: () => metadata,
        getCharacters: () => [{ avatar: 'a.png', name: 'Alice' }], extensionKey: 'gd', saveChatConfirmed: async () => { saves++; } });
    host = createHostBridge({ getContext: () => ctx, getSettings: () => ({}), extensionKey: 'gd', pageId: 'regression', memoryEditor: port });
    const controller = createMuyuController({ host, createModel: () => model(port, host) });
    return { controller, port, host, metadata, get saves() { return saves; } };
}
const settle = async () => { for (let i = 0; i < 20; i++) await flush(); };
const enable = async c => { await c.configure({ endpoint: 'https://example.invalid/chat/completions', apiKey: 'SYNTHETIC', model: 'fake' }); c.setMode('assistant'); c.setFullAccess(true, { confirmed: true }); };
const previewCall = (port, host, n, apply = false) => {
    const row = port.list(host.currentTarget()).items[0];
    return { type: 'tool_call_complete', call: { toolId: 'muyu.memory_editor.preview', version: 1, callId: 'edit' + n,
        args: { operation: 'update', character: row.character, revision: row.revision, index: 0, changesJson: '{"event":"Changed"}', ...(apply ? { apply: true } : {}) } } };
};
test('BUG-91F-01 actual memory edit receipt permits consecutive ordinary follow-up requests', async () => {
    let model;
    const f = controllerFixture((port, host) => model = scriptedModel([
        () => [previewCall(port, host, 0, true), done], [text('Changed.'), done], [text('Hello.'), done], [text('Again.'), done],
    ]));
    try {
        await enable(f.controller); f.controller.setInput('Edit memory'); f.controller.send(); await settle();
        assert.equal(f.saves, 1); assert.equal(f.controller.snapshot().receipts.at(-1).version, 21);
        for (let i = 0; i < 2; i++) { f.controller.setInput('Hello'); f.controller.send(); await settle(); assert.equal(f.controller.snapshot().runs.at(-1).status, 'succeeded'); }
        assert.equal(model.requests.length, 4); assert.equal(f.metadata.gd.charMemories['a.png'][0].event, 'Changed');
    } finally { await f.controller.dispose(); }
});
for (const stop of [true, false]) test(`BUG-91F-02 70 ${stop ? 'cancelled candidates' : 'deleted sessions with published drafts'} do not exhaust host capacity`, async () => {
    let calls = 0, secondCalls = 0;
    const f = controllerFixture((port, host) => ({ async *run(_input, { signal }) {
        const n = calls++;
        if (n % 2 === 0) { yield previewCall(port, host, n); yield done; }
        else if (stop) { secondCalls++; await new Promise((_, reject) => { if (signal.aborted) return reject(Error('stopped')); signal.addEventListener('abort', () => reject(Error('stopped')), { once: true }); }); }
        else { yield text('Preview ready.'); yield done; }
    } }));
    try {
        await enable(f.controller);
        for (let i = 0; i < 70; i++) {
            const id = f.controller.newSession(); f.controller.setInput('Preview only'); f.controller.send();
            if (stop) {
                for (let j = 0; j < 100 && secondCalls <= i; j++) await flush();
                assert.equal(secondCalls, i + 1); f.controller.stop();
            }
            await settle();
            const state = f.controller.snapshot();
            assert.equal(state.artifacts.length, stop ? 0 : 1);
            if (!stop) f.port.assertFresh(state.artifacts[0].content);
            await f.controller.deleteSession(id); await settle();
        }
        assert.equal(calls, 140); assert.equal(f.saves, 0); assert.equal(f.metadata.gd.charMemories['a.png'][0].event, 'Original');
    } finally { await f.controller.dispose(); }
});
