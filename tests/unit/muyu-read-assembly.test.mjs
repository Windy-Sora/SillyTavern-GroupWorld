import test from 'node:test';
import assert from 'node:assert/strict';
import { createModuleAssembly } from '../../muyu/modules/assembly.js';
import { createBuiltins } from '../../muyu/modules/builtins.js';
import { createHostBridge } from '../../muyu/host/bridge.js';
import { createSkillPort } from '../../muyu/host/skills.js';
import { skillEditorPackage } from '../../muyu/skills/editor.js';

const target = { kind: 'chat', userKey: 'u', chatKey: 'A' };
const identity = (id, taskId = 'task') => ({ id, taskId, target });
const context = runId => ({ runId, target, signal: new AbortController().signal });
function fixture(extra = {}) {
    const bridge = createHostBridge({ getContext: () => ({ groupId: 'g', chatId: 'A', chatMetadata: {}, chat: [] }),
        getSettings: () => ({}), extensionKey: 'gd', pageId: 'test', ...extra });
    const actualTarget = bridge.currentTarget();
    return { builtins: createBuiltins(bridge), target: actualTarget,
        identity: (id, taskId = 'task') => ({ id, taskId, target: actualTarget }),
        ctx: id => ({ ...context(id), target: actualTarget }) };
}
test('Read/control descriptors preserve exact base tools, scopes and separate reports from candidates', () => {
    const { builtins } = fixture();
    const rows = builtins.moduleDescriptors().slice(4, 11);
    assert.deepEqual(rows.map(r => r.id), ['toolbox', 'memory', 'director', 'context', 'history', 'interaction', 'permission']);
    for (const row of rows) {
        assert.deepEqual(row.artifacts, []); assert.equal(row.taskLifecycle, false);
        for (const id of row.tools) {
            assert.equal(builtins.toolGroups[id], null); assert.equal(builtins.candidateTool(id), false);
            assert.equal(builtins.registry.get(id).effect, 'read'); assert.equal(typeof builtins.handlers[id], 'function');
        }
    }
    assert.deepEqual(rows.filter(r => r.reports.length).map(r => r.reports), [
        [{ toolId: 'muyu.memory.inspect', kind: 'report' }], [{ toolId: 'muyu.director.inspect', kind: 'report' }],
    ]);
    assert.equal(builtins.registry.get('muyu.memory.inspect').scope, 'chat');
    assert.equal(builtins.registry.get('muyu.history.read').scope, 'global');
    assert.equal(builtins.skillGuides('r'), null); builtins.dispose();
});

function reportDescriptor(id, publishReport = () => {}) {
    return { id, module: { registry: { list: () => [{ id, effect: 'read' }] }, handlers: { [id]() {} },
        transferRun() {}, forgetRun() {}, retainArtifacts() {}, dispose() {}, publishReport },
        bindAssistant: null, tools: [{ id, group: null }], artifacts: [], reports: [{ toolId: id, kind: 'report' }] };
}
const reportOptions = { capabilityFor: () => ({ effect: 'read', sources: () => [] }), labels: { a: ['甲', 'A'], b: ['乙', 'B'] }, actions: [] };
test('Report descriptors reject missing, duplicate or draft-like report outlets', () => {
    for (const mutate of [d => { d.reports = {}; }, d => { d.reports[0].toolId = 'missing'; },
        d => { d.reports[0].kind = 'config-draft'; }, d => { delete d.module.publishReport; },
        d => { d.reports.push({ ...d.reports[0] }); }]) {
        const d = reportDescriptor('a'); mutate(d); assert.throws(() => createModuleAssembly([d], reportOptions));
    }
});
test('Report publication is gated by completed tool IDs and isolates failed owners', () => {
    const calls = []; const assembly = createModuleAssembly([
        reportDescriptor('a', () => { calls.push('a'); throw Error('stale'); }), reportDescriptor('b', () => calls.push('b')),
    ], reportOptions);
    assembly.publishReports({}, 'r', new Set(['other'])); assert.deepEqual(calls, []);
    assert.throws(() => assembly.publishReports({}, 'r', new Set(['a', 'b'])), /PUBLICATION_FAILED/);
    assert.deepEqual(calls, ['a', 'b']); assert.deepEqual(assembly.artifactEntries, []);
    const description = assembly.describe(); description[0].reports[0].toolId = 'tamper';
    assert.equal(assembly.describe()[0].reports[0].toolId, 'a');
    assembly.dispose(); assert.throws(() => assembly.publishReports({}, 'r', new Set()), /DISPOSED/);
});
for (const name of ['memory', 'director']) test(name + ' production report moves with Run and cannot publish after cleanup', () => {
    const f = fixture(), b = f.builtins, artifacts = [];
    b.handlers['muyu.' + name + '.inspect']({}, f.ctx('r'));
    b.transferRun('r', f.identity('next'), {});
    const app = { snapshot: () => ({ runs: [{ ...f.identity('next'), status: 'succeeded' }] }),
        createArtifact: value => { artifacts.push(value); return value; } };
    const intent = { completedTools: new Set(['muyu.' + name + '.inspect']) };
    assert.equal(b.tasks.assistant.publish(app, 'next', intent).notice, null);
    assert.equal(artifacts.length, 1); assert.equal(artifacts[0].kind, 'report');
    b.forgetRun('next');
    assert.equal(b.tasks.assistant.publish(app, 'next', intent).notice, 'RESULT_NEEDS_REVIEW');
    assert.equal(artifacts.length, 1); b.dispose();
});

async function skillFixture() {
    const settings = {}, port = createSkillPort({ getSettings: () => settings, saveSettings: async () => {}, loadBuiltins: async () => [] });
    await port.ready(); await port.save(port.preview({ operation: 'create', expectedRevision: 0, enabled: true,
        package: skillEditorPackage({ name: 'example', description: 'Review', body: 'Use real contracts.', modelInvocable: true, resources: [] }) }));
    const f = fixture({ skills: port });
    return { ...f, port, query: { id: 'user:example', revision: '1', path: 'SKILL.md' } };
}
test('Skill runtime binds once, remains base-only and keeps the fixed snapshot through Run and plan continuation', async () => {
    const f = await skillFixture(), b = f.builtins;
    const row = b.moduleDescriptors().find(r => r.id === 'skill-runtime'); assert.ok(row.taskLifecycle);
    assert.deepEqual(row.artifacts, []); assert.equal(b.toolGroups['muyu.skills.load'], null);
    assert.equal(b.toolGroups['muyu.skills.preview'].id, 'skills');
    b.bindBudget('r', 1000000); b.tasks.assistant.bind(f.identity('r'), { selectedSkill: f.query });
    await b.skillGuides('r').prepare(); assert.equal(b.skillUsage('r').length, 1);
    b.bindBudget('next', 1000000, 'r'); b.transferRun('r', f.identity('next'), {}); b.forgetRun('r');
    assert.equal(b.skillUsage('next')[0].revision, '1');
    assert.equal(b.parkSkillRun('next', { id: 'plan', kind: 'task-plan', taskId: 'task' }), true); b.forgetRun('next');
    b.retainArtifacts([{ id: 'plan', kind: 'task-plan', taskId: 'task' }]);
    await f.port.save(f.port.preview({ operation: 'delete', id: f.query.id, revision: 1, expectedRevision: 1 }));
    b.bindBudget('approved', 1000000); b.tasks.assistant.bind(f.identity('approved'), {});
    await b.skillGuides('approved').prepare(); assert.equal(b.skillUsage('approved')[0].revision, '1');
    b.forgetRun('approved'); b.forgetTask('task'); b.dispose();
});
for (const cleanup of ['forgetTask', 'retainArtifacts', 'dispose']) test('Skill parked documents are retired by ' + cleanup + ' without clearing shared storage', async () => {
    const f = await skillFixture(); let b = f.builtins;
    b.bindBudget('r', 1000000); b.tasks.assistant.bind(f.identity('r'), { selectedSkill: f.query }); await b.skillGuides('r').prepare();
    b.parkSkillRun('r', { id: 'plan', kind: 'task-plan', taskId: 'task' }); b.forgetRun('r');
    if (cleanup === 'retainArtifacts') b.retainArtifacts([]); else if (cleanup === 'forgetTask') b.forgetTask('task');
    else { b.dispose(); b = fixture({ skills: f.port }).builtins; }
    b.bindBudget('fresh', 1000000); b.tasks.assistant.bind(f.identity('fresh'), {});
    assert.deepEqual(b.skillUsage('fresh'), []); assert.equal((await f.port.catalog()).entries.length, 1);
    b.dispose();
});
