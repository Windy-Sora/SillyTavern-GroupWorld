import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuiltins } from '../../muyu/modules/builtins.js';
import { createHostBridge } from '../../muyu/host/bridge.js';
import { createVariableEditorModule } from '../../muyu/modules/variable-editor/index.js';
import { createMemoryEditorModule } from '../../muyu/modules/memory-editor/index.js';
import { createProfileEditorModule } from '../../muyu/modules/profile-editor/index.js';
import { createNpcEditorModule } from '../../muyu/modules/npc-editor/index.js';
import { createDraftRuns } from '../../muyu/modules/draft-runs.js';
import { createToolSelection } from '../../muyu/tools/selection.js';
import { createSelectionEditorModule } from '../../muyu/modules/selection-editor/index.js';
import { createLedgerEditorModule } from '../../muyu/modules/ledger-editor/index.js';
import { createBlueprintNodeEditorModule } from '../../muyu/modules/blueprint-node-editor/index.js';
import { createStPresetModule } from '../../muyu/modules/st-preset-editor/index.js';
import { createCharacterCardModule } from '../../muyu/modules/character-card/index.js';
import { createWorldBookEditorModule } from '../../muyu/modules/worldbook-editor/index.js';

const target = { kind: 'chat', userKey: 'u', chatKey: 'A' };
const identity = id => ({ id, taskId: 'task', target });
function fixture() {
    let next = 0;
    const tickets = new Set(), released = [];
    const port = { preview() { const content = { ticket: String(++next), module: 'test', operation: 'update', warnings: [] }; tickets.add(content.ticket); return content; },
        assertFresh(content) { assert.ok(tickets.has(content.ticket)); },
        release(content) { released.push(content.ticket); tickets.delete(content.ticket); },
        clear() { throw Error('must not clear shared host'); } };
    return { port, tickets, released };
}
for (const [name, factory] of [['variable', createVariableEditorModule], ['memory', createMemoryEditorModule], ['profile', createProfileEditorModule], ['npc', createNpcEditorModule]]) {
    test(name + ' editor transfers leases and disposes only its own candidates and artifacts', () => {
        const { port, tickets, released } = fixture(), foreign = port.preview(), module = factory({ port });
        const tool = 'muyu.' + name + '_editor.preview', ctx = id => ({ runId: id, target });
        const args = { operation: 'update', changesJson: '{}' };
        module.bindRun(identity('r'));
        module.handlers[tool](args, ctx('r'));
        const candidate = module.handlers[tool](args, ctx('r'));
        assert.deepEqual(released, ['2']);
        module.transferRun('r', identity('next')); module.forgetRun('r');
        const app = { snapshot: () => ({ runs: [{ ...identity('next'), status: 'succeeded' }] }),
            createArtifact: value => structuredClone({ ...value, id: 'artifact', revision: 1 }) };
        const artifact = module.publishDraft(app, 'next', candidate.candidateId);
        module.forgetRun('next'); module.retainArtifacts([artifact]);
        assert.ok(tickets.has('3'));
        module.retainArtifacts([{ ...artifact, content: { ...artifact.content, operation: 'delete' } }]);
        assert.deepEqual(released, ['2', '3']);
        module.bindRun(identity('pending')); module.handlers[tool](args, ctx('pending'));
        module.dispose(); module.dispose();
        assert.deepEqual(released, ['2', '3', '4']); assert.ok(tickets.has(foreign.ticket));
    });
}

test('Draft Run publication rejects missing IDs without dropping ownership; deletion releases even without a ticket', () => {
    const released = [], runs = createDraftRuns({ release: content => released.push(content.value) });
    runs.set('r', { candidate: { content: { value: 'candidate' } } });
    assert.throws(() => runs.publish('r', { content: {} }), /INVALID_ARTIFACT_LEASE/);
    assert.ok(runs.has('r'));
    const artifact = { id: 'a', content: { value: 'candidate' } };
    runs.publish('r', artifact); artifact.content.value = 'mutated';
    runs.retainArtifacts([{ id: 'a', content: { value: 'candidate' } }]); assert.deepEqual(released, []);
    runs.retainArtifacts([]); runs.clear(); assert.deepEqual(released, ['candidate']);
});

test('Production consumes optional editor/asset descriptors once and keeps exact groups and candidate aliases', () => {
    const ports = Object.fromEntries(['variableEditor', 'memoryEditor', 'profileEditor', 'npcEditor', 'providerAssets'].map(key => [key, {}]));
    const builtins = createBuiltins(createHostBridge({ getContext: () => ({ groupId: 'g', chatId: 'A', chatMetadata: {} }),
        getSettings: () => ({}), extensionKey: 'gd', pageId: 'test', ...ports }));
    const rows = builtins.moduleDescriptors(); assert.equal(rows.length, 24);
    for (const row of rows) for (const tool of row.tools) { assert.ok(builtins.registry.get(tool)); assert.equal(typeof builtins.handlers[tool], 'function'); }
    for (const row of rows) for (const artifact of row.artifacts) for (const tool of artifact.tools) {
        assert.equal(builtins.candidateTool(tool), true);
        assert.equal(builtins.candidateGroup(tool), artifact.tools[0]);
    }
    assert.equal(builtins.toolGroups['muyu.memory_editor.create_preview'].id, 'memory-editor');
    assert.equal(builtins.registry.get('muyu.provider.test').effect, 'external');
    assert.equal(builtins.candidateTool('muyu.provider.test'), false);
    const selector = createToolSelection(builtins.registry.list(), builtins.tasks.assistant.tools, builtins.toolGroups);
    assert.equal(selector.list().groups.find(row => row.id === 'provider-assets').count, 6);
    builtins.tasks.assistant.bind(identity('r'), {}); // Duplicate bind would throw RUN_CAPACITY.
    builtins.transferRun('r', identity('next'), {});
    builtins.forgetRun('next'); builtins.retainArtifacts([]); builtins.dispose();
});

const nextEditors = [
    ['selection', createSelectionEditorModule], ['ledger_editor', createLedgerEditorModule],
    ['blueprint_node_editor', createBlueprintNodeEditorModule], ['st_preset', createStPresetModule],
    ['character_card', createCharacterCardModule], ['worldbook_editor', createWorldBookEditorModule],
];
for (const [name, factory] of nextEditors) test(name + ' editor keeps transferred artifacts and only releases owned tickets', async () => {
    const { port, tickets, released } = fixture(), foreign = port.preview(), module = factory({ port });
    const tool = 'muyu.' + name + '.preview', ctx = id => ({ runId: id, target });
    const args = { changesJson: '{}' };
    module.bindRun(identity('r'));
    await module.handlers[tool](args, ctx('r'));
    const candidate = await module.handlers[tool](args, ctx('r'));
    assert.deepEqual(released, ['2']);
    module.transferRun('r', identity('next')); module.forgetRun('r');
    const app = { snapshot: () => ({ runs: [{ ...identity('next'), status: 'succeeded' }] }),
        createArtifact: value => structuredClone({ ...value, id: 'artifact', revision: 1 }) };
    const artifact = module.publishDraft(app, 'next', candidate.candidateId);
    module.forgetRun('next'); module.retainArtifacts([{ ...artifact, validation: { structural: 'passed' } }]);
    assert.ok(tickets.has('3'));
    module.retainArtifacts([]); module.retainArtifacts([]);
    module.bindRun(identity('pending')); await module.handlers[tool](args, ctx('pending'));
    module.dispose(); module.dispose();
    assert.deepEqual(released, ['2', '3', '4']); assert.ok(tickets.has(foreign.ticket));
});

for (const [name, factory] of nextEditors.slice(3)) test(name + ' async preview after disposal releases its late ticket without touching other owners', async () => {
    const { port, tickets, released } = fixture(), foreign = port.preview();
    let resolve; const gate = new Promise(done => { resolve = done; }), create = port.preview;
    const module = factory({ port: { ...port, preview: async () => { await gate; return create(); } } });
    module.bindRun(identity('r'));
    const pending = module.handlers['muyu.' + name + '.preview']({ changesJson: '{}' }, { runId: 'r', target });
    const rejected = assert.rejects(pending, /RUN_NOT_BOUND/);
    module.dispose(); resolve(); await rejected; module.dispose();
    assert.deepEqual(released, ['2']); assert.ok(tickets.has(foreign.ticket));
});

test('Full production editor descriptors retain exact scopes, aliases and optional host availability', () => {
    const options = { getContext: () => ({ groupId: 'g', chatId: 'A', chatMetadata: {} }), getSettings: () => ({}), extensionKey: 'gd', pageId: 'test' };
    const ports = Object.fromEntries(['selectionEditor', 'ledgerEditor', 'blueprintNodeEditor', 'stPresetEditor', 'characterCards', 'worldBookEditor',
        'variableEditor', 'memoryEditor', 'profileEditor', 'npcEditor', 'providerAssets'].map(key => [key, {}]));
    const builtins = createBuiltins(createHostBridge({ ...options, ...ports }));
    const rows = builtins.moduleDescriptors(); assert.equal(rows.length, 30);
    for (const row of rows) for (const id of row.tools) { assert.ok(builtins.registry.get(id)); assert.equal(typeof builtins.handlers[id], 'function'); }
    for (const row of rows) for (const artifact of row.artifacts) for (const id of artifact.tools) assert.equal(builtins.candidateGroup(id), artifact.tools[0]);
    for (const name of ['st_preset', 'character_card', 'worldbook_editor', 'selection']) assert.equal(builtins.registry.get('muyu.' + name + '.preview').scope, 'global');
    for (const name of ['blueprint_node_editor', 'ledger_editor']) assert.equal(builtins.registry.get('muyu.' + name + '.preview').scope, 'chat');
    assert.equal(builtins.toolGroups['muyu.blueprint_node_editor.initialize_preview'].id, 'blueprint-editor');
    const selector = createToolSelection(builtins.registry.list(), builtins.tasks.assistant.tools, builtins.toolGroups);
    assert.equal(selector.list().groups.find(group => group.id === 'blueprint-editor').count, 7);
    builtins.tasks.assistant.bind(identity('r'), {});
    builtins.transferRun('r', identity('next'), {}); builtins.forgetRun('next'); builtins.retainArtifacts([]); builtins.dispose();
    const absent = createBuiltins(createHostBridge(options));
    assert.equal(absent.moduleDescriptors().length, 19);
    assert.equal(absent.tasks.assistant.tools.includes('muyu.st_preset.preview'), false);
    assert.equal(Object.hasOwn(absent.toolGroups, 'muyu.st_preset.preview'), false);
    absent.tasks.assistant.bind(identity('r'), {}); absent.forgetRun('r'); absent.dispose();
});
