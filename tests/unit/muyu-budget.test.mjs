import test from 'node:test';
import assert from 'node:assert/strict';
import { RUN_DEFAULTS, validateRunConfig, projectBudget } from '../../muyu/core/budget.js';
import { createRunConfigStore } from '../../muyu/host/run-config.js';
import { startMuyuRun } from '../../muyu/composition.js';
import { createProviderModule } from '../../muyu/modules/providers/index.js';
import { createProcessStore } from '../../muyu/application/process-store.js';
import { formatBudget } from '../../muyu/ui/budget-view.js';
import { identity, registry, toolId, createClock, flush, deferred, scriptedModel, request, call, done, text } from './helpers/muyu-subject.mjs';

function run(steps, extra = {}) {
    const model = scriptedModel(steps), clock = createClock(), events = []; let executions = 0;
    const handle = startMuyuRun({ identity, input: 'test', model, clock, registry: registry(), allowedTools: [toolId], policy: () => true, handlers: { [toolId]: () => ++executions }, finalizeOnLimit: true, onEvent: e => events.push(e), ...extra });
    return { handle, model, clock, events, executions: () => executions };
}

test('Run config validates closed bounds and confirmed persistence rollback', async () => {
    for (const patch of [{ modelCalls: 1 }, { toolCalls: 65 }, { timeMs: 1800001 }, { maxTokens: 0 }, { providerBytes: 16777217 }, { extra: 1 }, { modelCalls: '6' }]) assert.throws(() => validateRunConfig({ ...RUN_DEFAULTS, ...patch }), /INVALID_RUN_CONFIG/);
    const settings = {}; let reject = false;
    const store = createRunConfigStore({ getSettings: () => settings, saveSettings: async () => { if (reject) throw Error('PRIVATE'); } });
    assert.deepEqual(store.read(), RUN_DEFAULTS); await store.save({ ...RUN_DEFAULTS, modelCalls: 10 }); reject = true;
    await assert.rejects(store.save(RUN_DEFAULTS), /RUN_CONFIG_SAVE_FAILED/); assert.equal(store.read().modelCalls, 10);
});

test('Last model call is answer-only and stays inside total model budget', async () => {
    const s = run([[request(call()), done], [text('bounded answer'), done]], { limits: { modelCalls: 2 } });
    const result = await s.handle.completion; await s.handle.drained;
    assert.equal(result.answer, 'bounded answer'); assert.equal(s.executions(), 1); assert.equal(s.model.requests.length, 2);
    assert.equal(s.model.requests[1].finalize, true); assert.match(s.model.requests[1].messages.at(-1).content, /Do not request more tools/);
    assert.equal(result.budget.reason, 'model_calls'); assert.equal(result.budget.modelCalls, 2); assert.equal(s.clock.pending, 0);
});

test('Tool budget closes a batch with paired skipped results and performs only one bounded final answer', async () => {
    const s = run([[request(call('a')), request(call('b')), done], [text('partial'), done]], { limits: { toolCalls: 1 } });
    const r = await s.handle.completion;
    assert.equal(s.executions(), 1); assert.equal(r.answer, 'partial'); assert.equal(r.budget.reason, 'tool_calls');
    const tools = s.model.requests[1].messages.filter(m => m.role === 'tool'); assert.equal(tools.length, 2);
    assert.equal(tools[1].result.effectState, 'not_started'); assert.equal(s.model.requests[1].finalize, true);
});

test('Finalizer that still requests tools fails without executing or adding model calls', async () => {
    const s = run([[request(call('a')), done], [request(call('b')), done]], { limits: { modelCalls: 2 } });
    const r = await s.handle.completion; assert.equal(r.error, 'BUDGET_EXCEEDED'); assert.equal(r.budget.reason, 'model_calls'); assert.equal(s.executions(), 1); assert.equal(s.model.requests.length, 2);
});

test('Provider exhaustion requests bounded closure and reports only byte counts', async () => {
    let exhausted = false;
    const s = run([[request(call()), done], [text('incomplete evidence'), done]], { resourceUsage: () => ({ used: 6000, limit: 6000, exhausted }), handlers: { [toolId]: () => { exhausted = true; return 1; } } });
    const r = await s.handle.completion; assert.equal(r.budget.reason, 'provider_bytes'); assert.equal(r.budget.providerBytes, 6000); assert.equal(s.model.requests[1].finalize, true);
    const m = createProviderModule({ currentTarget: () => identity.target, providerPort: { read: () => ({ text: '中'.repeat(4000), limited: false }) } });
    m.bindRun('r', 6000); const args = { id: 'recentMessages', selector: '', revision: '', offset: 0 };
    m.handlers['muyu.provider.read'](args, { runId: 'r', target: identity.target });
    assert.deepEqual(m.usage('r'), { used: 6000, limit: 6000, exhausted: true }); m.forgetRun('r'); assert.equal(m.usage('r').used, 0);
});

test('Deadline and cancellation never start finalization while upstream is pending', async () => {
    for (const cancel of [false, true]) {
        const gate = deferred(), s = run([async () => { await gate.promise; return [text('late'), done]; }], { limits: { timeMs: 10 } });
        await flush(); if (cancel) s.handle.cancel(); else s.clock.advance(10); await flush();
        const r = await s.handle.completion; assert.equal(r.error, cancel ? 'CANCELLED' : 'TIMEOUT'); assert.equal(r.budget.reason, cancel ? null : 'run_time');
        assert.equal(s.model.requests.length, 1); gate.resolve(); await s.handle.drained;
    }
});

test('Usage projection is closed and missing model token usage is not reported as zero', async () => {
    const s = run([[text('answer'), done]]), r = await s.handle.completion;
    assert.match(formatBudget(r.budget), /Token 用量未知/);
    const safe = projectBudget({ ...r.budget, secret: 'PRIVATE', reason: 'PRIVATE' }); assert.doesNotMatch(JSON.stringify(safe), /PRIVATE/);
    const p = createProcessStore(); p.create(identity.id);
    for (const e of s.events) p.event(identity.id, e);
    assert.equal(p.snapshot(identity.id).budget.modelCalls, 1); assert.equal(p.snapshot(identity.id).budget.usageReports, 0);
});
