import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuiltins } from '../../muyu/modules/builtins.js';
import { createHostBridge } from '../../muyu/host/bridge.js';
import { createToolSelection } from '../../muyu/tools/selection.js';
import { createSkillModule } from '../../muyu/modules/skills/index.js';
import { createCustomPromptModule } from '../../muyu/modules/custom-prompts/index.js';
import { createProfileLibraryModule } from '../../muyu/modules/profile-libraries/index.js';
import { createNpcLibraryModule } from '../../muyu/modules/npc-libraries/index.js';
import { createBlueprintLibraryModule } from '../../muyu/modules/blueprint-libraries/index.js';
import { createProfileLibraryChatModule } from '../../muyu/modules/profile-library-chat/index.js';
import { createNpcLibraryChatModule } from '../../muyu/modules/npc-library-chat/index.js';
import { createBlueprintLibraryChatModule } from '../../muyu/modules/blueprint-library-chat/index.js';

const target = { kind: 'chat', userKey: 'u', chatKey: 'A' };
const identity = id => ({ id, taskId: 'task', target });
const context = runId => ({ runId, target, signal: new AbortController().signal });
function appFor(id) {
    const artifacts = [];
    return { artifacts, snapshot: () => ({ runs: [{ ...identity(id), status: 'succeeded' }] }),
        createArtifact: value => { const artifact = structuredClone({ ...value, id: 'artifact', revision: 1 }); artifacts.push(artifact); return artifact; },
        getArtifact: () => artifacts[0], validateArtifact: () => 'validated' };
}
const leaseModules = [
    ['skills', createSkillModule, 'preview', { requestJson: '{}' }],
    ['library_chat', createProfileLibraryChatModule, 'capture_preview', { name: 'Example' }],
    ['npc_library_chat', createNpcLibraryChatModule, 'capture_preview', { name: 'Example' }],
    ['blueprint_library_chat', createBlueprintLibraryChatModule, 'capture_preview', { name: 'Example' }],
];
for (const [prefix, factory, name, args] of leaseModules) test(prefix + ' publishes owned leases, retains them across Run cleanup and leaves foreign tickets intact', async () => {
    let next = 0; const tickets = new Set(), released = [];
    const preview = () => { const content = { ticket: String(++next), operation: 'create', name: 'Example', count: 1, warnings: [] }; tickets.add(content.ticket); return content; };
    const port = { ready: async () => {}, preview, capture: preview,
        assertFresh: content => assert.ok(tickets.has(content.ticket)), release: content => { released.push(content.ticket); tickets.delete(content.ticket); },
        clear: () => { throw Error('foreign clear'); }, clearPlans: () => { throw Error('foreign clearPlans'); } };
    const foreign = preview(), module = factory({ port }), tool = 'muyu.' + prefix + '.' + name;
    module.bindRun(identity('r'));
    await module.handlers[tool](args, context('r'));
    const result = await module.handlers[tool](args, context('r')); assert.deepEqual(released, ['2']);
    module.transferRun('r', identity('next')); module.forgetRun('r');
    const app = appFor('next'), artifact = module.publishDraft(app, 'next', result.candidateId);
    module.forgetRun('next'); module.retainArtifacts(app.artifacts); assert.ok(tickets.has('3'));
    module.retainArtifacts([{ ...artifact, content: { ...artifact.content, name: 'Replaced' } }]); assert.deepEqual(released, ['2', '3']);
    module.bindRun(identity('pending')); await module.handlers[tool](args, context('pending'));
    module.dispose(); module.dispose(); assert.deepEqual(released, ['2', '3', '4']); assert.ok(tickets.has(foreign.ticket));
});

for (const [prefix, factory] of [['prompts', createCustomPromptModule], ['libraries', createProfileLibraryModule], ['npc_libraries', createNpcLibraryModule], ['blueprint_libraries', createBlueprintLibraryModule]]) {
    test(prefix + ' plain DTO publication does not invent resource leases or clear host assets', () => {
        const port = { preview: () => ({ operation: 'create', next: { name: 'Example' }, warnings: [] }), assertDraft() {},
            clear() { throw Error('not a lease'); }, release() { throw Error('not a lease'); } };
        const module = factory({ port }); module.bindRun(identity('r'));
        const result = module.handlers['muyu.' + prefix + '.preview']({ operation: 'create', changesJson: '{}' }, context('r'));
        module.transferRun('r', identity('next')); const app = appFor('next');
        module.publishDraft(app, 'next', result.candidateId); module.forgetRun('next');
        module.retainArtifacts([]); assert.equal(module.validateSaved(app, 'artifact', 1), 'validated');
        module.dispose(); module.dispose();
    });
}

test('Skill ready wait cannot create a ticket after disposal', async () => {
    let resolve, previews = 0; const ready = new Promise(done => { resolve = done; });
    const module = createSkillModule({ port: { ready: () => ready, preview: () => { previews++; }, clear() { throw Error('foreign clear'); } } });
    module.bindRun(identity('r'));
    const pending = module.handlers['muyu.skills.preview']({ requestJson: '{}' }, context('r'));
    const rejected = assert.rejects(pending, /RUN_NOT_BOUND/); module.dispose(); resolve(); await rejected;
    assert.equal(previews, 0);
});

for (const [prefix, factory] of [['library_chat', createProfileLibraryChatModule], ['npc_library_chat', createNpcLibraryChatModule]]) {
    test(prefix + ' no-change preview releases an older candidate and never creates a new artifact', () => {
        const released = [], module = factory({ port: { capture: () => ({ ticket: 'old', warnings: [] }),
            prepareApply: () => { throw Error('LIBRARY_NO_CHANGES'); }, release: content => released.push(content.ticket) } });
        module.bindRun(identity('r'));
        module.handlers['muyu.' + prefix + '.capture_preview']({ name: 'Example' }, context('r'));
        const result = module.handlers['muyu.' + prefix + '.apply_preview']({ id: 'package', revision: '1' }, context('r'));
        assert.equal(result.candidateId, ''); assert.equal(JSON.parse(result.text).writesStarted, false);
        assert.throws(() => module.publishDraft(appFor('r'), 'r', 'old'), /INVALID_CANDIDATE_SOURCE/);
        module.dispose(); assert.deepEqual(released, ['old']);
    });
}

test('Production consumes asset and read owners, preserves Prompt batch alias and isolates Skill management from runtime activation', () => {
    const options = { getContext: () => ({ groupId: 'g', chatId: 'A', chatMetadata: {} }), getSettings: () => ({}), extensionKey: 'gd', pageId: 'test' };
    const ports = Object.fromEntries(['selectionEditor', 'ledgerEditor', 'blueprintNodeEditor', 'stPresetEditor', 'characterCards', 'worldBookEditor', 'variableEditor', 'memoryEditor', 'profileEditor', 'npcEditor', 'providerAssets',
        'customPrompts', 'skills', 'profileLibraries', 'npcLibraries', 'blueprintLibraries', 'profileLibraryChat', 'npcLibraryChat', 'blueprintLibraryChat'].map(key => [key, {}]));
    const builtins = createBuiltins(createHostBridge({ ...options, ...ports }));
    const rows = builtins.moduleDescriptors(); assert.equal(rows.length, 38);
    for (const row of rows) for (const id of row.tools) { assert.ok(builtins.registry.get(id)); assert.equal(typeof builtins.handlers[id], 'function'); }
    for (const row of rows) for (const artifact of row.artifacts) for (const id of artifact.tools) assert.equal(builtins.candidateGroup(id), artifact.tools[0]);
    assert.equal(builtins.candidateGroup('muyu.prompts.preview'), 'muyu.prompts.batch_preview');
    assert.equal(builtins.candidateTool('muyu.prompts.export'), false);
    assert.equal(builtins.toolGroups['muyu.skills.preview'].id, 'skills');
    assert.equal(Object.hasOwn(builtins.toolGroups, 'muyu.skills.load'), false);
    const groups = createToolSelection(builtins.registry.list(), builtins.tasks.assistant.tools, builtins.toolGroups).list().groups;
    assert.equal(groups.find(group => group.id === 'prompts').count, 6);
    assert.equal(groups.find(group => group.id === 'library-chat').count, 2);
    builtins.tasks.assistant.bind(identity('r'), {}); builtins.transferRun('r', identity('next'), {});
    builtins.forgetRun('next'); builtins.retainArtifacts([]); builtins.dispose();
    const absent = createBuiltins(createHostBridge(options)); assert.equal(absent.moduleDescriptors().length, 19);
    assert.equal(absent.tasks.assistant.tools.includes('muyu.prompts.preview'), false); absent.dispose();
});
