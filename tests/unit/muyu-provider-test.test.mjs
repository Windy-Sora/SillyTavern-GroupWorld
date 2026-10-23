import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { syntheticWorkerMain } from '../../muyu/providers/synthetic-worker.js';
import { checkedSyntheticReport } from '../../muyu/providers/test-contract.js';
import { createBrowserProviderTester } from '../../muyu/host/provider-test.js';
import { prepareProviderDraft } from '../../muyu/providers/draft.js';
import { createProviderAssetModule } from '../../muyu/modules/provider-assets/index.js';
import { createProviderAssetPort } from '../../muyu/host/provider-assets.js';
import { createSourcePermissions } from '../../muyu/permissions/store.js';
import { projectTaskPlan } from '../../muyu/modules/task-plan/index.js';
import { requiredSources } from '../../muyu/application/capabilities.js';
import { interactionLimit, MAX_CODE_PERMISSIONS } from '../../muyu/interactions/limits.js';

const target = { kind: 'global', userKey: 'synthetic-user' };
const source = 'export function register({registerProvider}) {registerProvider({id:"gold",placeholder:"{{gold}}",render:ctx=>({content:String(ctx.recentMessages.length),data:{fake:true}})});}';
const draft = (code = source) => prepareProviderDraft({ name: 'gold', ids: ['gold'], source: code });
const passed = () => ({ status: 'passed', phase: 'render', rows: ['empty', 'group', 'single'].map(scenario => ({ id: 'gold', scenario, status: 'ok', sample: 'fake', dataSample: '', contentChars: 4 })) });

// Tests real worker isolation/termination and worker contract, NOT browser CSP.
async function execute(code, timeout = 3000) {
    const bootstrap = `const {parentPort, MessageChannel}=require('node:worker_threads');
        globalThis.self={addEventListener(_,fn){parentPort.once('message',data=>{const c=new MessageChannel();c.port1.on('message',r=>{parentPort.postMessage(r);c.port1.close();});fn({data,ports:[c.port2]});});},removeEventListener(){}};
        globalThis.Blob=class {constructor(parts){this.source=parts.join('');}};
        URL.createObjectURL=b=>'data:text/javascript,'+encodeURIComponent(b.source);URL.revokeObjectURL=()=>{};
        (${syntheticWorkerMain.toString()})();`;
    const worker = new Worker(bootstrap, { eval: true });
    try {
        return await new Promise((resolve, reject) => {
            const timer = setTimeout(() => resolve({ status: 'timeout', phase: 'startup', rows: [] }), timeout);
            worker.once('message', value => { clearTimeout(timer); resolve(checkedSyntheticReport(value, ['gold'])); });
            worker.once('error', error => { clearTimeout(timer); reject(error); });
            worker.postMessage({ source: code, ids: ['gold'] });
        });
    } finally { await worker.terminate(); }
}

test('Synthetic worker uses three fake contexts and bounded output without host registrations', async () => {
    const report = await execute(source);
    assert.equal(report.status, 'passed');
    assert.deepEqual(report.rows.map(row => row.sample), ['0', '1', '1']);
    assert.ok(report.rows.every(row => row.dataSample === '{"fake":true}'));
    const optional = await execute(source.replace('render:ctx=>', 'muyuContext:["characterCard","chatMessages"],render:ctx=>'));
    assert.deepEqual(optional.rows.map(row => row.status), ['context_unavailable', 'context_unavailable', 'ok']);
    assert.equal(optional.status, 'passed');
});

test('Synthetic worker reports load/register/render failures and never treats skipped runs as passes', async () => {
    for (const [code, phase] of [
        ['export function register( {', 'load'],
        ['throw Error("private failure"); export function register(deps){}', 'load'],
        ['export function register(deps){}', 'register'],
        [source.replace('id:"gold"', 'id:"other"'), 'register'],
        [source.replace('String(ctx.recentMessages.length)', '42'), 'render'],
        [source.replace('render:ctx=>', 'enabled:false,render:ctx=>'), 'render'],
        [source.replace('render:ctx=>', 'enabled:()=>Promise.resolve(true),render:ctx=>'), 'render'],
        [source.replace('String(ctx.recentMessages.length)', '"x".repeat(131073)'), 'render'],
    ]) {
        const report = await execute(code); assert.equal(report.status, 'failed'); assert.equal(report.phase, phase);
        assert.doesNotMatch(JSON.stringify(report), /private failure/);
    }
    const long = await execute(source.replace('String(ctx.recentMessages.length)', '"x".repeat(1000)'));
    assert.equal(long.rows[0].sample.length, 200); assert.equal(long.rows[0].contentChars, 1000);
});

test('Worker infinite loops are physically terminated by the enclosing runner', async () => {
    assert.equal((await execute('while(true){}; export function register(deps){}', 150)).status, 'timeout');
});

function browserFixture(timeoutMs = 1000) {
    let frame, transferred, removed = false; const posted = [];
    const channels = [];
    class Channel {
        constructor() {
            this.port1 = { close() {}, postMessage(value) { posted.push(value); } };
            this.port2 = { close() {} }; channels.push(this);
        }
    }
    const doc = { body: { append(value) { frame = value; } }, createElement: () => ({ attrs: {}, setAttribute(k,v) { this.attrs[k] = v; },
        contentWindow: { postMessage(value, origin, ports) { transferred = { value, origin, ports }; } }, remove() { removed = true; } }) };
    return { run: createBrowserProviderTester({ doc, Channel, timeoutMs }), get frame() { return frame; }, get transferred() { return transferred; },
        get removed() { return removed; }, posted, reply(value) { channels[0].port1.onmessage({ data: value }); } };
}

test('Browser bridge never embeds candidate source, uses opaque sandbox/CSP and validates replies', async () => {
    const f = browserFixture(); const task = f.run(draft());
    assert.equal(f.frame.attrs.sandbox, 'allow-scripts');
    assert.match(f.frame.srcdoc, /connect-src 'none'/); assert.match(f.frame.srcdoc, /worker-src blob:/);
    assert.ok(!f.frame.srcdoc.includes(source)); assert.equal(f.transferred, undefined);
    f.frame.onload(); assert.equal(f.transferred.value.source, source);
    f.reply(passed()); assert.equal((await task).status, 'passed'); assert.equal(f.removed, true);
    const invalid = browserFixture(), other = invalid.run(draft());
    invalid.reply({ ...passed(), rows: [] }); assert.equal((await other).status, 'failed');
});

test('Browser timeout and abort stop the frame, suppress late startup/results and remove it', async () => {
    const f = browserFixture(5), task = f.run(draft());
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.deepEqual(f.posted, [{ stop: true }]); f.frame.onload(); assert.equal(f.transferred, undefined);
    f.reply(passed()); assert.equal((await task).status, 'timeout'); assert.equal(f.removed, true);
    const g = browserFixture(), abort = new AbortController(), pending = g.run(draft(), { signal: abort.signal });
    abort.abort(); g.reply(passed()); assert.equal((await pending).status, 'cancelled'); assert.equal(g.removed, true);
    const pre = browserFixture(); assert.equal((await pre.run(draft(), { signal: abort.signal })).status, 'cancelled'); assert.equal(pre.frame, undefined);
    const broken = browserFixture(1); assert.equal((await broken.run(draft())).status, 'timeout'); assert.equal(broken.removed, true);
    assert.equal((await createBrowserProviderTester({ doc: null })(draft())).status, 'unavailable');
});

test('Synthetic permission is task-only, excluded from read plans and counted as code', () => {
    const p = createSourcePermissions(), request = { source: 'providerTests', reason: 'Test fake contexts', target, taskId: 't' };
    assert.deepEqual(requiredSources('muyu.provider.test', {}), ['source:providerTests']);
    assert.throws(() => p.grantSource('source:providerTests', target), /INVALID_PERMISSION/);
    assert.throws(() => p.decide(request, 'chat', () => {}), /INVALID_PERMISSION_DECISION/);
    assert.throws(() => p.grantTaskSources(['source:providerTests'], target, 't', () => {}), /INVALID_TASK_SCOPE/);
    p.decide(request, 'task', () => {}); assert.equal(p.allows('source:providerTests', target, 't'), true);
    assert.equal(p.allows('source:providerTests', target, 'next'), false);
    p.forgetTask(target, 't'); assert.equal(p.allows('source:providerTests', target, 't'), false);
    assert.equal(interactionLimit({ codePermissions: MAX_CODE_PERMISSIONS }, { kind: 'permission', source: 'providerTests' }), 'PERMISSION_LIMIT');
    assert.throws(() => projectTaskPlan({ goal: 'test', scope: 'global', sources: ['providerTests'], steps: [{ kind: 'read', title: 'test', detail: 'fake' }], unknowns: [] }, target));
});

test('Synthetic tool binds exact candidate, survives permission transfer and charges results without installing', async () => {
    let calls = 0, bytes = 0;
    const port = createProviderAssetPort({ getSettings: () => ({}), getProviders: () => [], testRunner: async () => { calls++; return passed(); } });
    const m = createProviderAssetModule({ port, charge: (_, count) => { bytes += count; return true; } });
    m.bindRun({ id: 'r', taskId: 't', target });
    const preview = m.handlers['muyu.provider.preview']({ name: 'gold', ids: ['gold'], source }, { runId: 'r', target });
    m.transferRun('r', { id: 'next', taskId: 't', target });
    await assert.rejects(m.handlers['muyu.provider.test']({ candidateId: 'wrong' }, { runId: 'next', target }), /INVALID_PROVIDER_CANDIDATE/);
    const result = JSON.parse((await m.handlers['muyu.provider.test']({ candidateId: preview.candidateId }, { runId: 'next', target })).text);
    assert.equal(result.report.status, 'passed'); assert.equal(result.importApproved, false); assert.equal(result.safetyProven, false);
    assert.match(result.notice, /candidate JavaScript ran in the synthetic Worker/);
    assert.match(result.notice, /preview codeExecuted=false describes that preview only/);
    assert.equal(calls, 1); assert.ok(bytes > 0); m.dispose();
});

test('Report validation rejects duplicate, foreign and false-positive success rows', () => {
    for (const report of [{ ...passed(), rows: [] }, { ...passed(), phase: 'load' },
        { ...passed(), rows: passed().rows.map(row => ({ ...row, status: 'disabled' })) },
        { ...passed(), rows: passed().rows.map(row => ({ ...row, id: 'foreign' })) },
        { ...passed(), rows: [passed().rows[0], passed().rows[0], passed().rows[0]] }]) assert.throws(() => checkedSyntheticReport(report, ['gold']));
});
