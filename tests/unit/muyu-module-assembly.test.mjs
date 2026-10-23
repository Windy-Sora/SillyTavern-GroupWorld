import test from 'node:test';
import assert from 'node:assert/strict';
import { createModuleAssembly } from '../../muyu/modules/assembly.js';
import { createArtifactLeases } from '../../muyu/modules/artifact-leases.js';
import { createToolSelection } from '../../muyu/tools/selection.js';
import { createVariableDraftModule } from '../../muyu/modules/variables/index.js';
import { createTaskBundleModule } from '../../muyu/modules/task-bundle/index.js';
import { createSettingsModule } from '../../muyu/modules/settings/index.js';
import { createVariableDraftPort } from '../../muyu/host/variable-draft.js';
import { createTaskBundleDraftPort } from '../../muyu/host/task-bundle-draft.js';
import { createBuiltins } from '../../muyu/modules/builtins.js';
import { createHostBridge } from '../../muyu/host/bridge.js';

const target = { kind: 'chat', userKey: 'u', chatKey: 'A' };
const identity = id => ({ id, taskId: 'task', target });
const variable = id => ({ action: 'create', id, label: id, initialValue: 0, rule: 'explicit only', autoUpdate: true, injectMode: 'always', updateMode: 'delta' });
const ctx = id => ({ runId: id, target, signal: new AbortController().signal });
function appFor(runId) {
    const artifacts = []; return { artifacts, snapshot: () => ({ runs: [{ id: runId, taskId: 'task', target, status: 'succeeded' }] }),
        createArtifact(value) { const a = structuredClone({ ...value, id: 'artifact:' + artifacts.length, revision: 1 }); artifacts.push(a); return a; },
        getArtifact: id => artifacts.find(a => a.id === id), validateArtifact: () => ({ status: 'passed' }) };
}
function descriptor(id = 'test') {
    const calls = [], toolId = 'muyu.' + id + '.preview';
    const module = { registry: { list: () => [{ id: toolId, effect: 'read' }] }, handlers: { [toolId]: () => {} },
        transferRun: (...args) => calls.push(['transfer', ...args]), forgetRun: id => calls.push(['forget', id]),
        retainArtifacts: values => calls.push(['retain', values]), dispose: () => calls.push(['dispose']), publishDraft() {}, validateSaved() {} };
    return { calls, id, module, bindAssistant: (identity, intent) => calls.push(['bind', identity, intent]), tools: [{ id: toolId, group: null }],
        artifacts: [{ moduleId: id, kind: 'test-draft', actionOwner: 'testActions', tools: [toolId] }] };
}
const options = { capabilityFor: () => ({ effect: 'read', sources: () => [] }), labels: { 'muyu.test.preview': ['测试', 'Test'], 'muyu.future.preview': ['未来', 'Future'] },
    actions: [{ id: 'testActions', scope: 'chat', artifactKinds: ['test-draft'] }] };

test('Unified module descriptor rejects incomplete, duplicated and incompatible tool/action/artifact ownership', () => {
    const cases = [() => [descriptor(), descriptor()], () => { const d = descriptor(); d.tools = []; return [d]; },
        () => { const d = descriptor(); d.module.forgetRun = undefined; return [d]; },
        () => { const d = descriptor(); d.artifacts[0].actionOwner = 'missing'; return [d]; },
        () => { const d = descriptor(); d.artifacts[0].tools = ['missing']; return [d]; },
        () => { const d = descriptor(); d.artifacts.push({ ...d.artifacts[0], moduleId: 'other' }); return [d]; }];
    for (const build of cases) assert.throws(() => createModuleAssembly(build(), options));
    assert.throws(() => createModuleAssembly([descriptor()], { ...options, labels: {} }), /LABEL/);
    assert.throws(() => createModuleAssembly([descriptor()], { ...options, capabilityFor: () => null }), /CAPABILITY/);
});

test('A new descriptor feeds actual tool/candidate/group wiring and lifecycle without granting or executing anything', () => {
    const d = descriptor('future'), assembly = createModuleAssembly([d], options);
    assert.equal(assembly.toolEntries[0].module, d.module); assert.equal(assembly.artifactEntries[0].owner, d.module);
    assert.equal(assembly.toolGroups['muyu.future.preview'], null); assert.deepEqual(d.calls, []);
    d.artifacts[0].tools.push('tamper'); const description = assembly.describe(); description[0].artifacts[0].tools.push('tamper2');
    assert.deepEqual(assembly.describe()[0].artifacts[0].tools, ['muyu.future.preview']);
    assembly.bindAssistant(identity('r'), {}); assembly.transferRun('r', identity('r2')); assembly.forgetRun('r2'); assembly.retainArtifacts([]);
    assembly.dispose(); assembly.dispose(); assert.deepEqual(d.calls.map(c => c[0]), ['bind', 'transfer', 'forget', 'retain', 'dispose']);
    assert.throws(() => assembly.forgetRun('r'), /DISPOSED/);
});

test('Module cleanup visits later owners even when an earlier hook fails', () => {
    const a = descriptor(), b = descriptor('future'); a.module.forgetRun = () => { throw Error('failure'); };
    const assembly = createModuleAssembly([a, b], options);
    assert.throws(() => assembly.forgetRun('r'), /LIFECYCLE/); assert.deepEqual(b.calls, [['forget', 'r']]);
});

test('Exact module group metadata controls selection, retains allowlists and rejects orphan groups', () => {
    const definitions = [{ id: 'muyu.test.preview' }, { id: 'muyu.settings.preview' }];
    const selector = createToolSelection(definitions, ['muyu.test.preview'], { 'muyu.test.preview': { id: 'owned', title: 'Owned' }, 'muyu.settings.preview': null });
    assert.equal(selector.list().groups[0].id, 'owned'); assert.deepEqual(selector.select().map(d => d.id), ['muyu.test.preview']);
    assert.throws(() => createToolSelection(definitions, [], { absent: null }), /INVALID_MODULE_TOOL_GROUP/);
});

test('Artifact leases retain published resources, isolate content and release exact removed/replaced versions once', () => {
    const released = [], leases = createArtifactLeases(c => released.push(c.token));
    const a = { id: 'a', content: { token: 'A' } }, b = { id: 'b', content: { token: 'B' } };
    leases.track(a); leases.track(b); a.content.token = 'tamper';
    leases.retain([{ id: 'a', content: { token: 'A' } }, b]); assert.deepEqual(released, []);
    leases.retain([{ id: 'a', content: { token: 'A' } }, b, { id: 'foreign' }]); assert.deepEqual(released, []);
    leases.retain([{ id: 'a', content: { token: 'new' } }]); assert.deepEqual(released, ['A', 'B']);
    leases.retain([]); leases.clear(); assert.deepEqual(released, ['A', 'B']);
});

for (const kind of ['variable', 'bundle']) test(kind + ' candidates transfer without release; publication moves ownership and removal releases only that artifact', () => {
    const metadata = {}, port = createVariableDraftPort({ getTarget: () => target, getMetadata: () => metadata, extensionKey: 'gd' });
    const bundlePort = createTaskBundleDraftPort({ getTarget: () => target, getSettings: () => ({ memoryEnabled: true }), variableDraftPort: port });
    const ownerPort = kind === 'variable' ? port : bundlePort, external = port.prepare(target, variable('external'));
    const released = [], ownedPort = { ...ownerPort, forget(content) { released.push(content); ownerPort.forget(content); } };
    const module = kind === 'variable' ? createVariableDraftModule({ port: ownedPort }) : createTaskBundleModule({ port: ownedPort });
    const toolId = kind === 'variable' ? 'muyu.variables.preview' : 'muyu.task.preview';
    const args = id => kind === 'variable' ? variable(id) : { variables: [variable(id)] };
    module.bindRun(identity('r')); const old = module.handlers[toolId](args('coins'), ctx('r'));
    const next = module.handlers[toolId](args('gems'), ctx('r')); assert.notEqual(old.candidateId, next.candidateId);
    assert.equal(released.length, 1); assert.throws(() => ownerPort.assertFresh(released[0]), /STALE/);
    module.transferRun('r', identity('r2')); module.forgetRun('r');
    const app = appFor('r2'), artifact = module.publishDraft(app, 'r2', next.candidateId);
    module.forgetRun('r2'); ownerPort.assertFresh(artifact.content);
    module.retainArtifacts(app.artifacts); ownerPort.assertFresh(artifact.content);
    module.retainArtifacts([]); assert.throws(() => ownerPort.assertFresh(artifact.content), /STALE/);
    port.assertFresh(external); module.dispose(); module.dispose(); port.assertFresh(external);
});

for (const kind of ['variable', 'bundle']) test(kind + ' dispose releases only its pending candidates, not shared port tickets', () => {
    let number = 0; const saved = new Map(), forgotten = [];
    const port = { prepare: () => { const content = { token: String(++number), version: 1, module: kind === 'bundle' ? 'task-bundle' : 'variable-draft', variables: [], scripts: [], settings: { preview: {} }, preview: {} }; saved.set(content.token, content); return content; },
        forget: content => { forgotten.push(content.token); saved.delete(content.token); }, clear: () => { throw Error('global clear forbidden'); } };
    const external = port.prepare(), module = kind === 'variable' ? createVariableDraftModule({ port }) : createTaskBundleModule({ port });
    const toolId = kind === 'variable' ? 'muyu.variables.preview' : 'muyu.task.preview'; module.bindRun(identity('r'));
    module.handlers[toolId](kind === 'variable' ? variable('coins') : {}, ctx('r'));
    module.dispose(); module.dispose(); assert.deepEqual(forgotten, ['2']); assert.ok(saved.has(external.token));
});

test('Published settings plans survive Run cleanup and release on artifact deletion without clearing unrelated plans', () => {
    const saved = new Map(), forgotten = []; let count = 0;
    const port = { plan: () => { const value = { id: String(++count), total: 0, counts: [] }; saved.set(value.id, value); return value; },
        assertFresh: value => { if (!saved.has(value.id)) throw Error('stale'); }, forget: value => { forgotten.push(value.id); saved.delete(value.id); }, clear: () => { throw Error('global clear forbidden'); } };
    const external = port.plan(), settings = { memoryMaxEntries: 200 };
    const module = createSettingsModule({ getSettings: () => settings, getTarget: () => target, memoryLimitPort: port });
    module.bindRun(identity('r')); const result = module.handlers['muyu.settings.preview']({ changes: { memoryMaxEntries: 10 } }, ctx('r'));
    module.transferRun('r', identity('r2')); const app = appFor('r2'); const artifact = module.publishDraft(app, 'r2', result.candidateId);
    module.forgetRun('r2'); module.retainArtifacts(app.artifacts); port.assertFresh(artifact.content.memoryPrunePlan);
    module.retainArtifacts([]); assert.deepEqual(forgotten, ['2']); module.dispose(); module.dispose(); port.assertFresh(external);
});

test('Production builtins consume pilot plus read descriptors for exact tools, candidate owners and group policy', () => {
    const builtins = createBuiltins(createHostBridge({ getContext: () => ({ groupId: 'g', chatId: 'A', chatMetadata: {} }), getSettings: () => ({}), extensionKey: 'gd', pageId: 'test' }));
    const rows = builtins.moduleDescriptors(); assert.equal(rows.length, 19);
    assert.deepEqual(rows.map(row => row.id), ['legacy-draft', 'settings', 'variables', 'task-bundle', 'toolbox', 'memory', 'director', 'context', 'history', 'interaction', 'permission', 'providers', 'task-plan', 'profile-draft', 'web', 'service-documents', 'service-pages', 'service-workspace', 'agent-memory']);
    for (const row of rows) for (const id of row.tools) { assert.ok(builtins.registry.get(id)); assert.equal(typeof builtins.handlers[id], 'function'); }
    for (const row of rows) for (const artifact of row.artifacts) for (const id of artifact.tools) assert.equal(builtins.candidateTool(id), true);
    assert.equal(builtins.toolGroups['muyu.variables.preview'], null); assert.equal(builtins.toolGroups['muyu.settings.read'], null);
    assert.equal(builtins.toolGroups['muyu.task.preview'].id, 'config-drafts');
    assert.equal(builtins.toolGroups['muyu.settings.preview'].id, 'config-drafts');
    const selector = createToolSelection(builtins.registry.list(), builtins.tasks.assistant.tools, builtins.toolGroups);
    assert.equal(selector.list().groups.find(row => row.id === 'config-drafts').tools.includes('muyu.task.preview'), true);
    builtins.retainArtifacts([]); builtins.forgetRun('not-bound'); builtins.dispose();
});
