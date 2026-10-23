import test from 'node:test';
import assert from 'node:assert/strict';
import { createExecutionTasks } from '../../muyu/modules/execution-tasks.js';
import { createModuleAssembly } from '../../muyu/modules/assembly.js';
import { createBuiltins } from '../../muyu/modules/builtins.js';
import { createHostBridge } from '../../muyu/host/bridge.js';
import { createScriptExecutorModule } from '../../muyu/modules/script-executors/index.js';
import { createCustomAgentModule } from '../../muyu/modules/custom-agents/index.js';
import { createMemoryGenerationModule } from '../../muyu/modules/memory-generation/index.js';
import { createProfileGenerationModule } from '../../muyu/modules/profile-generation/index.js';
import { createNpcGenerationModule } from '../../muyu/modules/npc-generation/index.js';
import { createGenerationBatchModule } from '../../muyu/modules/generation-batch/index.js';

const target = { kind: 'chat', userKey: 'u', chatKey: 'A' };
const identity = (id, taskId = 'task') => ({ id, taskId, target });
const context = runId => ({ runId, target, signal: new AbortController().signal });
for (const [prefix, factory, prepare] of [
    ['scripts', createScriptExecutorModule, 'prepare_execution'], ['agents', createCustomAgentModule, 'prepare_execution'],
    ['memory_generation', createMemoryGenerationModule, 'prepare'], ['profile_generation', createProfileGenerationModule, 'prepare'],
    ['npc_generation', createNpcGenerationModule, 'prepare'], ['generation_batch', createGenerationBatchModule, 'prepare'],
]) test(prefix + ' task tickets survive Run continuation and only owned tasks are retired', async () => {
    const saved = new Set(['foreign']), forgotten = [];
    const port = { prepareExecution(_args, ctx) { saved.add(ctx.taskId); return { executionId: 'ticket', maximumModelCalls: 1 }; },
        execute(_id, ctx) { assert.ok(saved.has(ctx.taskId)); return { status: 'trial_completed' }; },
        describeExecution: () => ({ maximumModelCalls: 1 }),
        forgetExecutions(id) { forgotten.push(id); saved.delete(id); }, clearExecutions() { throw Error('global clearing forbidden'); } };
    const module = factory({ port, charge: () => true }); module.bindRun(identity('r'));
    module.handlers['muyu.' + prefix + '.' + prepare]({}, context('r'));
    module.transferRun('r', identity('next')); module.forgetRun('r');
    const result = await module.handlers['muyu.' + prefix + '.execute']({ executionId: 'ticket', maxModelCalls: 1 }, context('next'));
    assert.equal(JSON.parse(result.text).status, 'trial_completed');
    module.forgetRun('next'); assert.ok(saved.has('task')); assert.deepEqual(forgotten, []);
    module.forgetTask('task'); module.forgetTask('task'); module.forgetTask('foreign');
    assert.deepEqual(forgotten, ['task']); assert.ok(saved.has('foreign'));
    module.bindRun(identity('pending', 'pending-task')); module.handlers['muyu.' + prefix + '.' + prepare]({}, context('pending'));
    module.dispose(); module.dispose(); assert.deepEqual(forgotten, ['task', 'pending-task']); assert.ok(saved.has('foreign'));
});

test('Task cleanup tracks failed preparations and visits all owned tasks while allowing failed cleanup retry', () => {
    const retired = []; let fail = true;
    const owned = createExecutionTasks({ prepareExecution() { throw Error('allocated then failed'); },
        forgetExecutions(id) { if (id === 'a' && fail) throw Error('cleanup failed'); retired.push(id); } });
    for (const taskId of ['a', 'b']) assert.throws(() => owned.prepare({}, { taskId }), /allocated/);
    assert.throws(() => owned.clear(), /CLEANUP_FAILED/); assert.deepEqual(retired, ['b']);
    fail = false; owned.clear(); owned.clear(); assert.deepEqual(retired, ['b', 'a']);
});

test('No-artifact execution descriptors require explicit task hooks and cleanup reaches every declared owner', () => {
    const calls = [];
    const descriptor = id => ({ id, module: { registry: { list: () => [{ id, effect: 'external' }] }, handlers: { [id]() {} },
        transferRun() {}, forgetRun() {}, retainArtifacts() {}, dispose() {}, forgetTask(task) { calls.push([id, task]); if (id === 'a') throw Error('failed'); } },
        bindAssistant: null, taskLifecycle: true, tools: [{ id, group: null }], artifacts: [] });
    const options = { capabilityFor: () => ({ effect: 'external', sources: () => [] }), labels: { a: ['甲', 'A'], b: ['乙', 'B'] }, actions: [] };
    const invalid = descriptor('a'); delete invalid.module.forgetTask;
    assert.throws(() => createModuleAssembly([invalid], options), /DESCRIPTOR/);
    const assembly = createModuleAssembly([descriptor('a'), descriptor('b')], options);
    assert.equal(assembly.artifactEntries.length, 0); assert.equal(assembly.describe()[0].taskLifecycle, true);
    assert.throws(() => assembly.forgetTask('task'), /LIFECYCLE/); assert.deepEqual(calls, [['a', 'task'], ['b', 'task']]);
});

test('Production consumes execution and read owners without treating execution as draft publication or extending approval', () => {
    const options = { getContext: () => ({ groupId: 'g', chatId: 'A', chatMetadata: {} }), getSettings: () => ({}), extensionKey: 'gd', pageId: 'test' };
    const ports = Object.fromEntries(['selectionEditor', 'ledgerEditor', 'blueprintNodeEditor', 'stPresetEditor', 'characterCards', 'worldBookEditor', 'variableEditor', 'memoryEditor', 'profileEditor', 'npcEditor', 'providerAssets',
        'customPrompts', 'skills', 'profileLibraries', 'npcLibraries', 'blueprintLibraries', 'profileLibraryChat', 'npcLibraryChat', 'blueprintLibraryChat',
        'scriptExecutors', 'customAgents', 'generationBatch', 'memoryGeneration', 'profileGeneration', 'npcGeneration'].map(key => [key, {}]));
    const builtins = createBuiltins(createHostBridge({ ...options, ...ports }));
    const rows = builtins.moduleDescriptors(); assert.equal(rows.length, 44); assert.equal(rows.filter(row => row.taskLifecycle).length, 8);
    for (const row of rows) for (const id of row.tools) { assert.ok(builtins.registry.get(id)); assert.equal(typeof builtins.handlers[id], 'function'); }
    for (const prefix of ['scripts', 'agents', 'generation_batch', 'memory_generation', 'profile_generation', 'npc_generation']) {
        assert.equal(builtins.registry.get('muyu.' + prefix + '.execute').effect, 'external');
        assert.equal(builtins.candidateTool('muyu.' + prefix + '.execute'), false);
    }
    assert.equal(builtins.candidateGroup('muyu.agents.batch_preview'), 'muyu.agents.preview');
    builtins.tasks.assistant.bind(identity('r'), {}); builtins.transferRun('r', identity('next'), {});
    builtins.forgetRun('next'); builtins.forgetTask('task'); builtins.dispose();
});
