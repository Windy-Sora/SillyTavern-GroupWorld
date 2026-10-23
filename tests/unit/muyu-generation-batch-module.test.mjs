import test from 'node:test';
import assert from 'node:assert/strict';
import { createGenerationBatchModule } from '../../muyu/modules/generation-batch/index.js';
import { createPermissions } from '../../muyu/application/permissions.js';
import { assistantToolAccess, permissionApprovalCurrent, requiredSources, toolAvailableInMode } from '../../muyu/application/capabilities.js';
import { generationBatchExecutionSource, validatePermission } from '../../muyu/permissions/contract.js';
import { validateJson } from '../../muyu/core/json-contract.js';
import { createBuiltins } from '../../muyu/modules/builtins.js';
import { projectTaskPlan } from '../../muyu/modules/task-plan/index.js';
import { importedRecord, parseHistoryImport } from '../../muyu/sessions/exchange.js';

const target = { kind: 'chat', userKey: 'test', chatKey: 'A' }, id = '01234567-89ab-cdef-0123-456789abcdef';
const steps = [{ kind: 'memory', mode: 'save', character: 'memory-character:0', revision: 'rev' }, { kind: 'npc', mode: 'trial', revision: 'rev', count: 2 }];
function fixture(accept = true) {
    const calls = { prepare: 0, execute: 0, charge: [], forgotten: [], clear: 0 };
    const port = { prepareExecution: () => { calls.prepare++; return { executionId: id, steps, maximumModelCalls: 2 }; }, describeExecution: () => ({ executionId: id, steps, maximumModelCalls: 2 }),
        execute: async () => { calls.execute++; return { status: 'completed', completed: 2, steps: [], historicalExecutionOnly: true }; }, forgetExecutions: t => calls.forgotten.push(t), clearExecutions: () => { calls.clear++; } };
    const module = createGenerationBatchModule({ port, charge: (_run, bytes) => { calls.charge.push(bytes); return accept; } });
    const identity = { id: 'r', taskId: 't', target }, ctx = { runId: 'r', target };
    module.bindRun(identity); return { module, port, calls, identity, ctx, execute: { executionId: id, maxModelCalls: 2 } };
}
const access = (f, p, targetValue = target) => assistantToolAccess(f.module.registry.get('muyu.generation_batch.execute'), f.execute, targetValue, 't', p, null, null, null, null, null, null, f.port);
test('batch has closed schemas, explicit effects, selected read dependencies and exact execution source', () => {
    const f = fixture(); assert.equal(f.module.registry.list().length, 2);
    assert.deepEqual(requiredSources('muyu.generation_batch.prepare', { steps }), ['source:memoryGenerationTargets', 'source:npcGenerationState']);
    assert.deepEqual(requiredSources('muyu.generation_batch.prepare', { steps: [steps[0], steps[0]] }), ['source:memoryGenerationTargets']);
    assert.equal(requiredSources('muyu.generation_batch.prepare', { steps: [] }), null);
    assert.deepEqual(requiredSources('muyu.generation_batch.execute', f.execute), [generationBatchExecutionSource(id)]);
    for (const d of f.module.registry.list()) { assert.equal(d.scope, 'chat'); assert.equal(d.inputSchema.additionalProperties, false); assert.equal(d.effect, d.id.endsWith('.execute') ? 'external' : 'read'); }
});
for (const args of [{ steps: [{ ...steps[0], kind: 'blueprint' }] }, { steps: Array(9).fill(steps[0]) }, { steps: [{ ...steps[0], target: 'B' }] }, { steps, target: 'B' }, { steps: [{ ...steps[0], mode: 'overwrite' }] }]) test('batch input rejects unsupported or oversized scope '+JSON.stringify(args), () => {
    assert.throws(() => validateJson(fixture().module.registry.get('muyu.generation_batch.prepare').inputSchema, args));
});
test('prepare is pure and charges only its returned descriptor', () => {
    const f = fixture(), out = f.module.handlers['muyu.generation_batch.prepare']({ steps }, f.ctx);
    assert.equal(f.calls.prepare, 1); assert.equal(f.calls.execute, 0); assert.equal(f.calls.charge[0], new TextEncoder().encode(out.text).length);
});

test('advertised alternatives enforce the same per-kind count/character contract as the private port', () => {
    const schema = fixture().module.registry.get('muyu.generation_batch.prepare').inputSchema;
    for (const kind of ['memory', 'profile']) {
        const step = { kind, mode: 'trial', revision: 'r', character: kind + '-character:0' };
        validateJson(schema, { steps: [step] });
        assert.throws(() => validateJson(schema, { steps: [{ ...step, count: 1 }] }), /alternative mismatch/);
        const { character, ...missing } = step;
        assert.throws(() => validateJson(schema, { steps: [missing] }), /alternative mismatch/);
    }
    validateJson(schema, { steps: [{ kind: 'npc', mode: 'trial', revision: 'r', count: 1 }] });
    validateJson(schema, { steps: [{ kind: 'npc', mode: 'trial', revision: 'r' }] });
    assert.throws(() => validateJson(schema, { steps: [{ kind: 'npc', mode: 'trial', revision: 'r', character: 'npc-character:0' }] }), /alternative mismatch/);
});

test('closed pure preparation errors report not_started and permit argument correction without retrying execution', () => {
    for (const code of ['INVALID_GENERATION_BATCH', 'DUPLICATE_GENERATION_BATCH_STEP']) {
        const f = fixture(); f.port.prepareExecution = () => { throw Error(code); };
        const output = f.module.handlers['muyu.generation_batch.prepare']({ steps }, f.ctx);
        validateJson(f.module.registry.get('muyu.generation_batch.prepare').outputSchema, output);
        const result = JSON.parse(output.text);
        assert.equal(result.status, 'not_started'); assert.equal(result.code, code);
        assert.match(result.correction, /memory\/profile require character and forbid count/);
        assert.equal(f.calls.execute, 0);
    }
    const f = fixture(); f.port.prepareExecution = () => { throw Error('PRIVATE_UNEXPECTED_EXCEPTION'); };
    assert.throws(() => f.module.handlers['muyu.generation_batch.prepare']({ steps }, f.ctx), /PRIVATE_UNEXPECTED_EXCEPTION/);
});
test('one aggregate result reservation precedes execution, duplicates reuse the result without extra charge', async () => {
    const f = fixture(); const [a,b] = await Promise.all([f.module.handlers['muyu.generation_batch.execute'](f.execute,f.ctx), f.module.handlers['muyu.generation_batch.execute'](f.execute,f.ctx)]);
    assert.deepEqual(a,b); assert.equal(f.calls.execute,1); assert.deepEqual(f.calls.charge,[24000]); validateJson(f.module.registry.get('muyu.generation_batch.execute').outputSchema,a);
});
test('insufficient aggregate result budget prevents every business effect', async () => {
    const f = fixture(false), out = await f.module.handlers['muyu.generation_batch.execute'](f.execute,f.ctx);
    assert.equal(JSON.parse(out.text).code,'RESULT_BUDGET_EXCEEDED'); assert.equal(f.calls.execute,0);
});
for (const maxModelCalls of [1,0,9,1.5]) test('whole proposal business maximum must fit explicit budget '+maxModelCalls, async () => {
    const f=fixture(),out=await f.module.handlers['muyu.generation_batch.execute']({...f.execute,maxModelCalls},f.ctx);
    assert.equal(JSON.parse(out.text).code,'BUSINESS_MODEL_BUDGET_EXCEEDED'); assert.equal(f.calls.execute,0); assert.deepEqual(f.calls.charge,[]);
});
test('unbound run, changed target and stale ticket cannot execute', async () => {
    const f=fixture(); await assert.rejects(f.module.handlers['muyu.generation_batch.execute'](f.execute,{...f.ctx,runId:'other'}),/RUN_NOT_BOUND/);
    await assert.rejects(f.module.handlers['muyu.generation_batch.execute'](f.execute,{...f.ctx,target:{...target,chatKey:'B'}}),/RUN_NOT_BOUND/);
    f.port.describeExecution=()=>null; assert.equal(JSON.parse((await f.module.handlers['muyu.generation_batch.execute'](f.execute,f.ctx)).text).code,'STALE_GENERATION_BATCH'); assert.equal(f.calls.execute,0);
});
test('lifecycle transfers only the same bound task and clears tickets and result cache', async () => {
    const f=fixture(); f.module.transferRun('missing',{id:'next',taskId:'other',target}); assert.throws(()=>f.module.transferRun('r',{id:'next',taskId:'other',target}),/RUN_NOT_BOUND/);
    f.module.transferRun('r',{...f.identity,id:'next'}); await f.module.handlers['muyu.generation_batch.execute'](f.execute,{...f.ctx,runId:'next'});
    f.module.forgetTask('t'); f.module.forgetRun('next'); f.module.dispose(); assert.deepEqual(f.calls.forgotten,['t']); assert.equal(f.calls.clear,0);
});
test('read and single-ticket approvals never grant an entire generation batch', () => {
    const f=fixture(),p=createPermissions(); for(const source of ['source:memoryGenerationTargets','source:npcGenerationState'])p.grantSource(source,target);
    p.decide({source:'npcExecution',executionId:id,reason:'single',target,taskId:'t'},'task',()=>{});
    assert.equal(access(f,p).decision,'permission_required'); assert.deepEqual(access(f,p).missingSources,[generationBatchExecutionSource(id)]);
});
test('batch approval is exact task-only, cannot be made persistent or granted by readonly plan', () => {
    const p=createPermissions(),r={source:'generationBatchExecution',executionId:id,reason:'batch',target,taskId:'t'};
    validatePermission({source:r.source,executionId:id,reason:'batch'}); assert.throws(()=>p.decide(r,'chat',()=>{}),/INVALID_PERMISSION_DECISION/);
    assert.throws(()=>p.grantSource('source:generationBatchExecution',target),/INVALID_PERMISSION/);
    assert.throws(()=>projectTaskPlan({goal:'generate',scope:'current-chat',sources:['generationBatchExecution'],steps:[{kind:'read',title:'read',detail:'run'}],unknowns:[]},target));
    p.decide(r,'task',()=>{}); assert.equal(p.allows(generationBatchExecutionSource(id),target,'t'),true);
    assert.equal(p.allows(generationBatchExecutionSource(id),target,'other'),false); assert.equal(p.allows(generationBatchExecutionSource(crypto.randomUUID()),target,'t'),false);
    assert.equal(p.allows(generationBatchExecutionSource(id),{...target,chatKey:'B'},'t'),false); assert.equal(p.sourceGrants(target).length,0);
    p.forgetTask(target,'t'); assert.equal(p.allows(generationBatchExecutionSource(id),target,'t'),false);
});
test('denial is distinct from missing permission; full access still checks current host ticket', () => {
    const f=fixture(),p=createPermissions();p.decide({source:'generationBatchExecution',executionId:id,reason:'run',target,taskId:'t'},'deny',()=>{});
    assert.equal(access(f,p).decision,'user_denied'); assert.equal(access(f,createPermissions({fullAccess:()=>true})).decision,true);
    f.port.describeExecution=()=>null; assert.equal(access(f,createPermissions({fullAccess:()=>true})).decision,'target_unavailable');
    assert.equal(permissionApprovalCurrent({source:'generationBatchExecution',executionId:id,target},null,null,null,null,null,null,f.port),false);
});
test('batch tools are optional and hidden in legacy read-only modes', () => {
    const f=fixture(),host={memoryPorts:{extensionKey:'gd',getTarget:()=>target,getSettings:()=>({}),getMetadata:()=>({}),getGroup:()=>null,getMessageCount:()=>0},getSettings:()=>({}),configTarget:()=>target,currentTarget:()=>target};
    for(const port of [null,f.port]){const builtins=createBuiltins({...host,generationBatch:port});assert.equal(builtins.registry.list().filter(d=>d.id.startsWith('muyu.generation_batch.')).length,port?2:0);builtins.dispose();}
    for(const d of f.module.registry.list()){assert.equal(toolAvailableInMode(d.id,'assistant'),true);for(const mode of ['memory','director','chat','draft'])assert.equal(toolAvailableInMode(d.id,mode),false);}
});
test('batch history validates provenance but import never restores executable tickets or permission', () => {
    const record={version:7,id:crypto.randomUUID(),revision:0,scope:'["assistant","chat","A"]',title:'Batch',createdAt:1,updatedAt:1,messages:[{role:'assistant',content:'Historical partial result',runId:'old'}],required:[generationBatchExecutionSource(id)],status:'succeeded',archived:false,imported:false,contextSummary:null,receipts:[],scopeChanges:[]};
    const parsed=parseHistoryImport(JSON.stringify(record));assert.deepEqual(parsed.required,record.required); assert.equal(importedRecord(parsed).required.includes(generationBatchExecutionSource(id)),false);
    assert.throws(()=>parseHistoryImport(JSON.stringify({...record,tickets:[{executionId:id}]})),/HISTORY_INVALID/);
});
