import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { scriptWorkerMain } from '../../muyu/scripts/synthetic-worker.js';
import { checkedScriptReport } from '../../muyu/scripts/test-contract.js';
import { createBrowserScriptTester } from '../../muyu/host/script-test.js';
import { normalizeScriptExecutor } from '../../systems/script-executor-validation.js';
import { createScriptExecutorSystem } from '../../systems/script-executor-system.js';
import { createScriptExecutorPort } from '../../muyu/host/script-executors.js';
import { createScriptExecutorModule } from '../../muyu/modules/script-executors/index.js';
import { createTaskBundleDraftPort } from '../../muyu/host/task-bundle-draft.js';
import { createTaskBundleWriter } from '../../muyu/host/task-bundle-write.js';
import { createTaskBundleActions } from '../../muyu/actions/task-bundle-apply.js';
import { actionReceipt, validateReceipt, receiptSources, receiptContext, receiptText } from '../../muyu/actions/receipts.js';
import { requiredSources } from '../../muyu/application/capabilities.js';
import { createSourcePermissions } from '../../muyu/permissions/store.js';
import { projectTaskPlan } from '../../muyu/modules/task-plan/index.js';
const target = { kind: 'chat', userKey: 'p', chatKey: 'A' };
const definition = patch => normalizeScriptExecutor({ name: 'test', triggerOn: 'all', enabled: false, ...patch });
async function execute(patch, timeoutMs = 2000) {
    const input = definition(patch);
    const bootstrap = `const {parentPort,MessageChannel}=require('node:worker_threads');
        globalThis.self={addEventListener(_,fn){parentPort.once('message',data=>{const c=new MessageChannel();c.port1.on('message',r=>{parentPort.postMessage(r);c.port1.close();});fn({data,ports:[c.port2]});});},removeEventListener(){}};
        globalThis.Blob=class {constructor(parts){this.source=parts.join('');}};
        URL.createObjectURL=b=>'data:text/javascript,'+encodeURIComponent(b.source);URL.revokeObjectURL=()=>{};
        (${scriptWorkerMain.toString()})();`;
    const worker = new Worker(bootstrap, { eval: true, env: {}, resourceLimits: { maxOldGenerationSizeMb: 64 } });
    try { return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve({ status: 'timeout', phase: 'startup', rows: [] }), timeoutMs);
        worker.once('message', report => { clearTimeout(timer); try { resolve(checkedScriptReport(report, input)); } catch (e) { reject(e); } });
        worker.once('error', error => { clearTimeout(timer); reject(error); });
        worker.postMessage(input);
    }); } finally { await worker.terminate(); }
}
test('Script Worker tests all selected phases even for disabled drafts with synthetic-only data', async () => {
    const report = await execute({ returnMode: 'shared', code: 'if(ctx.decision) ctx.decision.reason="test"; return {gold:(ctx.shared.gold||0)+1};' });
    assert.equal(report.status, 'passed'); assert.equal(report.rows.length, 9);
    assert.deepEqual(report.rows.slice(0,3).map(row => JSON.parse(row.sample).shared.gold), [1,2,3]);
    const single = await execute({ triggerOn: 'message', code: 'return ctx.getContext().chat.length;' });
    assert.equal(single.rows.length, 3); assert.equal(single.status, 'passed');
});
test('Script Worker retains literal rendered parameters and catches compile/output errors without raw details', async () => {
    const params = [{ key: 'x', type: 'string', label: 'x', default: '{{privateProvider}}' }];
    const report = await execute({ renderParams: true, params, returnMode: 'shared', code: 'return {x:ctx.params.x};' });
    assert.ok(report.rows.every(row => row.sample.includes('{{privateProvider}}')));
    for (const [patch, phase] of [[{ code: 'return {' }, 'compile'], [{ code: 'throw Error("SECRET_DETAIL")' }, 'execute'], [{ returnMode: 'shared', code: 'return new Map()' }, 'execute'], [{ returnMode: 'shared', code: 'return {x:"a".repeat(9000)}' }, 'execute']]) {
        const result = await execute(patch); assert.equal(result.status, 'failed'); assert.equal(result.phase, phase); assert.doesNotMatch(JSON.stringify(result), /SECRET_DETAIL/);
    }
});
test('Script Worker enforces read-only decision snapshots and terminates infinite loops', async () => {
    assert.equal((await execute({ code: 'if(ctx.decisionSnapshot) ctx.decisionSnapshot.decision.reason="changed";' })).status, 'failed');
    assert.equal((await execute({ code: 'while(true){}' }, 150)).status, 'timeout');
});
test('Script reports reject missing, duplicate or wrong-stage passes', () => {
    const input = definition({ triggerOn: 'message' });
    const rows = ['empty','group','single'].map(scenario => ({ scenario, stage: 'message', status: 'ok', sample: '', resultChars: 0 }));
    assert.equal(checkedScriptReport({ status:'passed', phase:'execute', rows }, input).status, 'passed');
    for (const bad of [[], [rows[0],rows[0],rows[2]], rows.map(row=>({...row,stage:'decision'})), rows.map(row=>({...row,status:'failed'}))]) assert.throws(()=>checkedScriptReport({status:'passed',phase:'execute',rows:bad},input));
});
test('Browser script runner keeps candidate out of iframe HTML and validates isolated results', async () => {
    let frame, posted, channel;
    class Channel { constructor() { channel=this; this.port1={close(){},postMessage(){}};this.port2={close(){}}; } }
    const doc={body:{append(f){frame=f;}},createElement(){return {setAttribute(){},remove(){},contentWindow:{postMessage(value){posted=value;}}};}};
    const run=createBrowserScriptTester({doc,Channel}), task=run(definition({code:'return "SOURCE_SENTINEL";'}));
    assert.ok(!frame.srcdoc.includes('SOURCE_SENTINEL')); assert.match(frame.srcdoc,/connect-src 'none'/); assert.doesNotMatch(frame.srcdoc.split('<script>')[0],/unsafe-eval/);
    frame.onload(); assert.match(posted.code,/SOURCE_SENTINEL/);
    channel.port1.onmessage({data:{status:'passed',phase:'execute',rows:[]}});
    assert.equal((await task).status,'failed');
});
test('Script test consent is task-only and never granted by a read plan', () => {
    const permissions=createSourcePermissions();
    assert.deepEqual(requiredSources('muyu.scripts.test'),['source:scriptTests']);
    assert.throws(()=>permissions.grant('source:scriptTests',target));
    assert.throws(()=>permissions.resolve(target,'t',{source:'scriptTests',reason:'test'},'chat'));
    assert.throws(()=>projectTaskPlan({goal:'test',scope:'mixed',sources:['scriptTests'],steps:[{kind:'code',title:'test',detail:'test'}],unknowns:[]},target));
});
test('Script test exact candidate survives permission transfer, charges output and never saves', async () => {
    const settings={scriptExecutors:[]}, system=createScriptExecutorSystem({settings,saveSettings(){}});
    const port=createScriptExecutorPort({getSettings:()=>settings,system,testRunner: async content => ({status:'passed',phase:'execute',rows:['empty','group','single'].flatMap(scenario=>['message','round'].map(stage=>({scenario,stage,status:'ok',sample:'{}',resultChars:2})))})});
    let charged=0;const module=createScriptExecutorModule({port,charge:(_,bytes)=>{charged+=bytes;return true;}});
    module.bindRun({id:'r',taskId:'t',target}); const ctx={runId:'r',target};
    const candidate=module.handlers['muyu.scripts.preview']({operation:'create',changesJson:'{"name":"x"}'},ctx);
    module.transferRun('r',{id:'r2',taskId:'t',target});
    const result=await module.handlers['muyu.scripts.test']({candidateId:candidate.candidateId},{runId:'r2',target});
    assert.equal(JSON.parse(result.text).saveApproved,false);assert.ok(charged>0);assert.equal(settings.scriptExecutors.length,0);
    await assert.rejects(module.handlers['muyu.scripts.test']({candidateId:'other'},{runId:'r2',target}),/INVALID/);
});
const request = (name, enabled=false) => ({operation:'create',changesJson:JSON.stringify({name,enabled,code:'return {gold:10};'})});
function bundleFixture(saveSettings = async()=>{}, saveScript = null) {
    let current=target;
    const settings={scriptExecutors:[],memoryEnabled:true},system=createScriptExecutorSystem({settings,saveSettings});
    const scriptPort=createScriptExecutorPort({getSettings:()=>settings,system});
    const draftPort=createTaskBundleDraftPort({getTarget:()=>current,getSettings:()=>settings,scriptPort});
    const writer=createTaskBundleWriter({draftPort,getTarget:()=>current,scriptWriter:saveScript||scriptPort});
    return {settings,system,scriptPort,draftPort,writer,switchChat(){current={...target,chatKey:'B'};}};
}
test('One script bundle approval saves first exact definition, stops at unconfirmed save and records remaining steps', async () => {
    const f=bundleFixture(),content=f.draftPort.prepare(target,{scripts:[request('first',true),request('second')]});
    const artifact={id:'a',revision:1,sessionId:'s',kind:'task-bundle',content};
    const actions=createTaskBundleActions({getArtifact:()=>artifact,validate:()=>f.draftPort.assertFresh(content),getTarget:()=>target,writer:f.writer});
    const approval=actions.prepare('a',1);assert.equal(f.settings.scriptExecutors.length,0);
    const action=await actions.approve(approval.id);assert.equal(action.status,'applied_unconfirmed');
    assert.deepEqual(action.result.steps.map(row=>row.status),['saved_unconfirmed','not_started']);assert.equal(f.settings.scriptExecutors.length,1);
    assert.equal(f.settings.scriptExecutors[0].enabled,true);assert.throws(()=>actions.approve(approval.id));
    const receipt=actionReceipt(action);assert.equal(receipt.version,9);assert.deepEqual(validateReceipt(receipt),receipt);
    assert.deepEqual(receiptSources(receipt),[]);assert.doesNotMatch(JSON.stringify(receipt),/gold:10|changesJson|code/);
    assert.match(receiptContext([receipt]),/definitionSave/);assert.match(receiptText(receipt),/脚本/);
});
test('Script bundles validate all targets before first dispatch, reject duplicate targets/names and refuse stale definitions', async () => {
    const f=bundleFixture();await f.system.add({name:'user',enabled:false});const row=f.scriptPort.list().items[0];
    const update={operation:'update',id:row.id,revision:row.revision,changesJson:'{"priority":5}'};
    assert.throws(()=>f.draftPort.prepare(target,{scripts:[update,update]}),/INVALID/);
    assert.throws(()=>f.draftPort.prepare(target,{scripts:[request('new'),request('new')]}),/INVALID/);
    const content=f.draftPort.prepare(target,{scripts:[request('first'),update]});
    f.settings.scriptExecutors[0].priority=1;
    await assert.rejects(f.writer.apply(content),/STALE/);assert.equal(f.settings.scriptExecutors.length,1);
});
test('Script bundle stops on chat switch between confirmed steps and never retries failures', async () => {
    let writes=0,f;const writer={async save(){writes++;f.switchChat();return {status:'applied_confirmed',persistence:'unconfirmed',id:'se'};}};
    f=bundleFixture(undefined,writer);const content=f.draftPort.prepare(target,{scripts:[request('first'),request('second')]});
    const result=await f.writer.apply(content);assert.equal(result.status,'partial');assert.equal(writes,1);
    assert.deepEqual(result.steps.map(row=>row.status),['applied_confirmed','not_executed']);
    await assert.rejects(f.writer.apply(content),/STALE/);assert.equal(writes,1);
});
test('Script-only task preview read dependencies do not request ordinary settings or variable sources', () => {
    assert.deepEqual(requiredSources('muyu.task.preview',{scripts:[request('x')]}),['source:scriptAssets']);
});

test('Mixed bundle executes variable then settings then script, and stops only after the unconfirmed script save', async () => {
    const order=[],settings={memoryEnabled:true}, script={module:'script-executor',operation:'create',id:'',baseRevision:'',previous:null,next:{name:'x',enabled:true,code:'SECRET_CODE'},warnings:[]};
    const variablePort={prepare:()=>({preview:{id:'gold',diff:[]}}),assertFresh(){},forget(){}};
    const scriptPort={preview:()=>script,assertDraft(){}};
    const draftPort=createTaskBundleDraftPort({getTarget:()=>target,getSettings:()=>settings,variableDraftPort:variablePort,scriptPort});
    const content=draftPort.prepare(target,{variables:[{action:'create',id:'gold',label:'Gold',initialValue:0,rule:'explicit',autoUpdate:true,injectMode:'always',updateMode:'delta'}],settings:{memoryEnabled:false},scripts:[request('x')]});
    const writer=createTaskBundleWriter({draftPort,getTarget:()=>target,
        variableWriter:{async apply(){order.push('variable');return {status:'applied_confirmed',chatSave:'confirmed'};}},
        configWriter:{async apply(){order.push('settings');return {status:'applied_confirmed'};}},
        scriptWriter:{async save(){order.push('script');return {status:'saved_unconfirmed',persistence:'unconfirmed',id:'se_x'};}}});
    const result=await writer.apply(content);assert.deepEqual(order,['variable','settings','script']);assert.equal(result.status,'partial');
    const receipt=actionReceipt({id:'op',artifactId:'a',revision:1,content,status:result.status,result});
    assert.equal(receipt.version,9);assert.deepEqual(receiptSources(receipt),['source:variables','source:memoryConfig']);assert.doesNotMatch(JSON.stringify(receipt),/SECRET_CODE/);
    const invalid=structuredClone(receipt);delete invalid.steps[2].script;assert.throws(()=>validateReceipt(invalid));
});
test('Script test results arriving after candidate replacement are rejected rather than attached to new code', async () => {
    let resolve;
    const pending=new Promise(r=>{resolve=r;}),port={preview:({changes})=>({module:'script-executor',operation:'create',id:'',baseRevision:'',previous:null,next:changes,warnings:[]}),test:()=>pending};
    const module=createScriptExecutorModule({port}),ctx={runId:'r',target};module.bindRun({id:'r',taskId:'t',target});
    const candidate=module.handlers['muyu.scripts.preview']({operation:'create',changesJson:'{"name":"old"}'},ctx);
    const testResult=module.handlers['muyu.scripts.test']({candidateId:candidate.candidateId},ctx);
    module.handlers['muyu.scripts.preview']({operation:'create',changesJson:'{"name":"new"}'},ctx);
    resolve({status:'failed',phase:'compile',rows:[]});await assert.rejects(testResult,/STALE/);
});
