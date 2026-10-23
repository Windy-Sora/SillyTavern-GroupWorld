import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTEXT_DEFAULTS, estimateTokens, measurePayload, validateContextConfig, projectCoverage } from '../../muyu/context/policy.js';
import { planContext, fingerprint, summaryCandidate, usableSummary, completeTurns, summaryMessage } from '../../muyu/context/planner.js';
import { bytes, MAX_REQUEST_BYTES, MAX_CONTEXT_MESSAGES, MAX_MESSAGE_BYTES } from '../../muyu/context/policy.js';
import { compactionRequest, collectSummary, summaryReduces } from '../../muyu/context/compaction.js';
import { MAX_SUMMARY_BYTES, validSummaryText } from '../../muyu/context/summary-contract.js';
import { compactionPressure, createCompactionBreaker } from '../../muyu/context/auto-compaction.js';
import { ExecutionError } from '../../muyu/core/execution.js';
import { createHistoryModule } from '../../muyu/modules/history/index.js';
import { copyJson } from '../../muyu/core/json-contract.js';
import { createContextConfigStore } from '../../muyu/host/context-config.js';
import { validateRecord, summarizeRecord } from '../../muyu/sessions/contract.js';
import { startMuyuRun } from '../../muyu/composition.js';
import { createProcessStore } from '../../muyu/application/process-store.js';
import { composeInstructions } from '../../muyu/instructions/compose.js';
import { createSessionLibrary } from '../../muyu/sessions/library.js';
import { createMemoryHistoryStore } from '../../muyu/sessions/memory-store.js';
import { importedRecord, parseHistoryImport, exportHistoryRecord } from '../../muyu/sessions/exchange.js';
import { identity, registry, toolId, createClock, flush, deferred, scriptedModel, request, call, done, text } from './helpers/muyu-subject.mjs';

const history = (count = 8) => Array.from({ length: count }, (_, i) => [{ role: 'user', content: `Q${i}`, runId: String(i) }, { role: 'assistant', content: `A${i}`, runId: String(i) }]).flat();
const config = { ...CONTEXT_DEFAULTS, inputTokens: 32000, recentTurns: 2 };

test('BUG-CTX-2: incremental summary sizing matches complete serialized requests at budget boundaries', () => {
    const source = history(14);
    for (let i = 0; i < source.length; i++) source[i].content = ['', 'ASCII', '中文\\"\n', '🦉'][i % 4].repeat(1100);
    source.splice(4, 0, { role: 'user', content: 'unfinished correction', runId: 'cancelled' });
    const previous = { through: 2, fingerprint: fingerprint(source.slice(0, 2)), text: 'Earlier summary 🦉', createdAt: 1 };
    for (const inputTokens of [4096, 9000, 32000, null]) for (const prior of [null, previous]) {
        const cfg = { ...config, inputTokens }, start = prior ? prior.through : 0;
        const turns = completeTurns(source.slice(start));
        const limit = Math.floor(Math.min(inputTokens ?? MAX_REQUEST_BYTES / 2, MAX_REQUEST_BYTES / 2) * .1);
        let oldCount = turns.length;
        for (let n = 1; n <= turns.length; n++) {
            const boundary = n === turns.length ? start : start + turns[turns.length - n - 1].end;
            const suffix = source.slice(boundary).map(({ role, content }) => ({ role, content }));
            if (estimateTokens(suffix) > limit || suffix.length > MAX_CONTEXT_MESSAGES - 256 || suffix.some(m => bytes(m.content) > MAX_MESSAGE_BYTES)) break;
            oldCount = turns.length - n;
        }
        if (oldCount === 0) oldCount = Math.max(1, turns.length - cfg.recentTurns);
        const old = turns.slice(0, oldCount);
        const selected = prior ? [summaryMessage(prior.text)] : [];
        let through = 0, cursor = 0;
        for (const turn of old) {
            const increment = source.slice(start + cursor, start + turn.end).map(({ role, content }) => ({ role, content }));
            const request = compactionRequest({ messages: [...selected, ...increment] }, inputTokens);
            if (request.messages.length > MAX_CONTEXT_MESSAGES || request.messages.some(m => bytes(m.content) > MAX_MESSAGE_BYTES)
                || (inputTokens === null ? bytes(request) > MAX_REQUEST_BYTES * .98 : estimateTokens(request) > inputTokens * .98)) break;
            selected.push(...increment); cursor = turn.end; through = start + turn.end;
        }
        assert.deepEqual(summaryCandidate(source, cfg, prior), through ? { through, fingerprint: fingerprint(source.slice(0, through)), messages: selected } : null);
    }
});

test('Large history retains a budget-sized raw suffix beyond the old two-turn cap', () => {
    const source = history(30);
    source.forEach(m => { m.content += '🦉正文'.repeat(100); });
    const small = summaryCandidate(source, { ...config, inputTokens: 64000 });
    const large = summaryCandidate(source, { ...config, inputTokens: 128000 });
    assert.ok(large.through < small.through);
    const suffix = source.slice(large.through).map(({ role, content }) => ({ role, content }));
    assert.ok(suffix.length > 4); assert.ok(estimateTokens(suffix) <= 12800);
    assert.ok(estimateTokens(source.slice(large.through - 2).map(({ role, content }) => ({ role, content }))) > 12800);
    assert.equal(large.through % 2, 0);
});

test('Short manual histories honor the recent-turn reference without the former two-turn ceiling', () => {
    const source = history(16);
    const candidate = summaryCandidate(source, { ...config, recentTurns: 12 });
    assert.equal(candidate.through, 8);
    assert.equal(source.slice(candidate.through).length, 24);
    assert.equal(summaryCandidate(history(1), config).through, 2);
});

test('Raw suffix sizing includes orphan corrections and never claims them as summarized', () => {
    const source = history(6);
    source.splice(10, 0, { role: 'user', content: 'correction'.repeat(1000), runId: 'cancelled' });
    const candidate = summaryCandidate(source, config);
    assert.equal(candidate.through, source.length);
    assert.deepEqual(candidate.messages, source.map(({ role, content }) => ({ role, content })));
    const trailing = [...history(6), { role: 'user', content: 'cancelled'.repeat(1000), runId: 'cancelled' }];
    const next = summaryCandidate(trailing, config);
    assert.equal(next.through, 12);
    assert.equal(trailing.slice(next.through)[0].content, trailing.at(-1).content);
});

test('Rolling summary keeps a recent raw suffix even when the complete old-summary tail is blocked', () => {
    const source = history(30); source.forEach(m => { m.content += '中'.repeat(700); });
    const prior = { through: 2, fingerprint: fingerprint(source.slice(0, 2)), text: 'old reference', createdAt: 1 };
    assert.equal(planContext(source, prior, config).historyBlocked, true);
    const candidate = summaryCandidate(source, config, prior);
    assert.ok(candidate.through > prior.through && candidate.through < source.length);
    assert.match(candidate.messages[0].content, /old reference/);
    assert.deepEqual(candidate.messages.slice(1), source.slice(2, candidate.through).map(({ role, content }) => ({ role, content })));
    assert.equal(candidate.fingerprint, fingerprint(source.slice(0, candidate.through)));
});

test('Transport-only retention is byte-bounded and a giant oldest turn cannot be skipped', () => {
    const source = history(30); source.forEach(m => { m.content += 'x'.repeat(30000); });
    const candidate = summaryCandidate(source, { ...config, inputTokens: null });
    assert.ok(candidate.through > 0 && candidate.through < source.length - 4);
    const raw = source.slice(candidate.through).map(({ role, content }) => ({ role, content }));
    assert.ok(bytes(raw) <= MAX_REQUEST_BYTES * .1);
    source[1].content = 'x'.repeat(MAX_REQUEST_BYTES);
    assert.equal(summaryCandidate(source, { ...config, inputTokens: null }), null);
});

test('History transport defaults to automatic, upgrades old settings and persists approval independently', async () => {
    const legacy = { inputTokens: 64000, recentTurns: 5, autoSummary: false };
    assert.deepEqual(validateContextConfig(legacy), { ...legacy, historyAuthorization: 'auto', summaryTokens: 16384, summaryTimeMs: 300000 });
    for (const value of ['invalid', null, true]) assert.throws(() => validateContextConfig({ ...legacy, historyAuthorization: value }));
    const settings = { muyuContextConfig: legacy }; let fail = false;
    const store = createContextConfigStore({ getSettings: () => settings, saveSettings: async () => { if (fail) throw Error('save failed'); } });
    assert.equal(store.read().historyAuthorization, 'auto'); assert.equal(store.read().inputTokens, 64000);
    const approval = { ...store.read(), historyAuthorization: 'ask' }; await store.save(approval);
    assert.deepEqual(store.read(), approval);
    fail = true; await assert.rejects(store.save({ ...approval, historyAuthorization: 'auto' }), /CONTEXT_CONFIG_SAVE_FAILED/);
    assert.deepEqual(store.read(), approval);
});
function run(steps, extra = {}) {
    const model = scriptedModel(steps), clock = createClock(), events = [];
    const handle = startMuyuRun({ identity, input: 'current', model, clock, registry: registry(), allowedTools: [toolId], policy: () => true, handlers: { [toolId]: () => 1 }, contextConfig: config, onEvent: e => events.push(e), ...extra });
    return { handle, model, clock, events };
}
const candidate = () => { const messages = history(), c = summaryCandidate(messages, config); return { ...c, tail: planContext(messages.slice(c.through), null, config).messages }; };

test('History compaction never summarizes Task Skill bodies and reprojects full guides after summarizing', async () => {
    const guides = [{ role: 'user', content: 'CURRENT TASK SKILL GUIDE\nPRIVATE_FULL_SKILL' }];
    const s = run([[text('Earlier task summary'), done], [text('Current answer'), done]], {
        previousMessages: planContext(history(), null, config).messages, compaction: candidate(),
        taskGuidePort: { prepare: async () => {}, project: () => guides },
    });
    const result = await s.handle.completion; assert.equal(result.answer, 'Current answer');
    assert.doesNotMatch(JSON.stringify(s.model.requests[0]), /PRIVATE_FULL_SKILL/);
    assert.match(JSON.stringify(s.model.requests[1].taskGuides), /PRIVATE_FULL_SKILL/);
    assert.doesNotMatch(JSON.stringify(result.messages), /PRIVATE_FULL_SKILL/);
});

test('Automatic pressure follows complete measured input and transport budgets, not history turn count', () => {
    assert.equal(compactionPressure({ estimatedTokens: 25599, requestBytes: 100 }, config), false);
    assert.equal(compactionPressure({ estimatedTokens: 25600, requestBytes: 100 }, config), true);
    assert.equal(compactionPressure({ estimatedTokens: 1000000, requestBytes: 100 }, { ...config, inputTokens: null }), false);
    assert.equal(compactionPressure({ estimatedTokens: 1, requestBytes: Math.ceil(MAX_REQUEST_BYTES * .8) }, { ...config, inputTokens: null }), true);
});

test('Compaction breaker isolates scope, caps failure counts and rejects stale connection/budget results', () => {
    const breaker = createCompactionBreaker(), epoch = breaker.epoch();
    assert.deepEqual(breaker.status(undefined, undefined), { failures: 0, blocked: false });
    for (let i = 0; i < 4; i++) breaker.record('A', 'scope1', false, epoch);
    assert.deepEqual(breaker.status('A', 'scope1'), { failures: 3, blocked: true });
    assert.equal(breaker.status('B', 'scope1').failures, 0); assert.equal(breaker.status('A', 'scope2').failures, 0);
    breaker.record('A', 'scope1', true, epoch); assert.equal(breaker.status('A', 'scope1').blocked, false);
    breaker.record('A', 'scope1', false, epoch); breaker.reset('A'); assert.equal(breaker.status('A', 'scope1').failures, 0);
    breaker.clear(); breaker.record('A', 'scope1', false, epoch); assert.equal(breaker.status('A', 'scope1').failures, 0);
});

test('Adapter-only overhead triggers lazy compaction before the first request; low pressure and opt-out do not', async () => {
    for (const enabled of [false, true]) for (const high of [false, true]) {
        let preparations = 0;
        const summarizing = enabled && high, saved = [];
        const model = scriptedModel(summarizing ? [[text('summary'), done], [text('answer'), done]] : [[text('answer'), done]]);
        model.inspect = req => ({ ...measurePayload(req), estimatedTokens: req.tools.length && high ? 26000 : 100 });
        const s = run([], { model, previousMessages: planContext(history(), null, config).messages, contextConfig: { ...config, autoSummary: enabled }, prepareCompaction: () => { preparations++; return candidate(); }, onSummary: value => saved.push(value) });
        assert.equal((await s.handle.completion).answer, 'answer'); await s.handle.drained;
        assert.equal(preparations, summarizing ? 1 : 0); assert.equal(saved.length, summarizing ? 1 : 0);
        assert.equal(model.requests.length, summarizing ? 2 : 1);
        if (summarizing) assert.deepEqual(model.requests[0].tools, []);
    }
});

test('Blocked automatic compaction never pays for another summary or trims a hard-limit history', async () => {
    for (const over of [false, true]) {
        let prepared = 0;
        const model = scriptedModel([[text('answer'), done]]);
        model.inspect = req => ({ ...measurePayload(req), estimatedTokens: over ? 40000 : 26000 });
        const previousMessages = planContext(history(), null, config).messages;
        const s = run([], { model, previousMessages, contextConfig: { ...config, autoSummary: true }, autoCompactionBlocked: true, prepareCompaction: () => { prepared++; return candidate(); } });
        const result = await s.handle.completion; await s.handle.drained;
        assert.equal(prepared, 0); assert.equal(model.requests.length, over ? 0 : 1);
        if (over) assert.equal(result.error, 'AUTO_COMPACTION_BLOCKED');
        else { assert.equal(result.answer, 'answer'); assert.deepEqual(model.requests[0].messages.slice(0, previousMessages.length), previousMessages); }
    }
});

test('High-pressure failed summary does not silently trim originals when the complete request is over budget', async () => {
    const model = scriptedModel([() => { throw Error('summary failed'); }]);
    model.inspect = req => ({ ...measurePayload(req), estimatedTokens: req.tools.length ? 40000 : 100 });
    const s = run([], { model, previousMessages: planContext(history(), null, config).messages, contextConfig: { ...config, autoSummary: true }, prepareCompaction: candidate });
    assert.equal((await s.handle.completion).error, 'CONTEXT_INCOMPLETE'); await s.handle.drained;
    assert.equal(model.requests.length, 1); assert.deepEqual(model.requests[0].tools, []);
});

test('Summary budgets upgrade legacy settings, persist custom values and reject invalid limits', async () => {
    for (const summaryTokens of [1024, 8192, 32768]) assert.equal(validateContextConfig({ ...config, summaryTokens }).summaryTokens, summaryTokens);
    for (const summaryTokens of [null, undefined, 0, 1023, 32769, 1.5, '8192', NaN]) assert.throws(() => validateContextConfig({ ...config, summaryTokens }));
    assert.throws(() => validateContextConfig({ ...config, unknownSummaryOption: 1 }));
    const settings = { muyuContextConfig: { inputTokens: 32000, recentTurns: 12, autoSummary: false, summaryTokens: 16384 } };
    const store = createContextConfigStore({ getSettings: () => settings, saveSettings: async () => {} });
    assert.equal(store.read().inputTokens, 32000); assert.equal(store.read().summaryTokens, 16384);
    await store.save({ ...store.read(), summaryTokens: 32768 }); assert.equal(store.read().summaryTokens, 32768);
});

test('Summary receiver and archive share exact escaped UTF-8 bounds, including split Unicode deltas', async () => {
    const archive = original => importedRecord({ version: 3, id: crypto.randomUUID(), revision: 0, scope: JSON.stringify(['chat', 'chat', 'A']), title: 'summary', createdAt: 1, updatedAt: 1, messages: original, required: [], status: 'idle', archived: false, imported: false, contextSummary: null }, 1);
    const receive = async chunks => {
        const model = { async *run() { for (const chunk of chunks) yield text(chunk); yield done; } };
        return collectSummary(model, {}, { signal: new AbortController().signal, context: {}, onUsage: () => {} });
    };
    for (const value of ['猫'.repeat(7000), 'x'.repeat(MAX_SUMMARY_BYTES - 2), 'aa' + '\n'.repeat((MAX_SUMMARY_BYTES - 4) / 2)]) {
        assert.equal(validSummaryText(value), true); assert.equal(await receive([value]), value);
        const original = history(2), archived = archive(original);
        archived.contextSummary = { through: 2, fingerprint: fingerprint(original.slice(0, 2)), text: value, createdAt: 1 };
        assert.equal(validateRecord(archived).contextSummary.text, value);
        assert.equal(parseHistoryImport(exportHistoryRecord(archived)).contextSummary.text, value);
    }
    assert.equal(await receive(['🦉'.slice(0, 1), '🦉'.slice(1)]), '🦉');
    assert.equal(await receive(Array.from({ length: 3000 }, () => '猫')), '猫'.repeat(3000));
    for (const value of ['x'.repeat(MAX_SUMMARY_BYTES - 1), '猫'.repeat(Math.ceil(MAX_SUMMARY_BYTES / 3)), 'aa' + '\n'.repeat(MAX_SUMMARY_BYTES / 2)]) {
        assert.equal(validSummaryText(value), false);
        await assert.rejects(receive([value]), e => e.code === 'SUMMARY_TOO_LARGE');
        const original = history(2), archived = archive(original);
        archived.contextSummary = { through: 2, fingerprint: fingerprint(original.slice(0, 2)), text: value, createdAt: 1 };
        assert.throws(() => validateRecord(archived), /HISTORY_INVALID/);
    }
});

test('Long task handoffs exceed the old 6000-character limit without losing originals or exceeding the output budget', async () => {
    const source = history(4); source.forEach(m => { m.content += ' context'.repeat(2000); });
    const cfg = { ...config, inputTokens: 128000, summaryTokens: 32768 }, c = summaryCandidate(source, cfg);
    const handoff = 'confirmed facts and pending work\n'.repeat(250), saved = [];
    const s = run([[text(handoff), done]], { compaction: c, summaryOnly: true, contextConfig: cfg, maxTokens: 16384, onSummary: value => saved.push(value) });
    assert.equal((await s.handle.completion).answer, handoff); await s.handle.drained;
    assert.equal(s.model.requests[0].maxTokens, 16384); assert.deepEqual(s.model.requests[0].tools, []);
    assert.equal(saved[0].text, handoff); assert.ok(handoff.length > 6000);
    assert.match(s.model.requests[0].messages[0].content, /Completed actions/);
    assert.doesNotMatch(s.model.requests[0].messages[0].content, /1500/);
    assert.deepEqual(c.messages, source.slice(0, c.through).map(({ role, content }) => ({ role, content })));
});

test('A non-reducing handoff never commits; manual fails and automatic falls back without truncating text', async () => {
    const c = candidate(), tooBig = 'not a useful compression'.repeat(100);
    assert.equal(summaryReduces(c, tooBig), false); assert.equal(summaryReduces(c, 'concise'), true);
    for (const summaryOnly of [true, false]) {
        const saved = [], previousMessages = planContext(history(), null, config).messages;
        const s = run([[text(tooBig), done], [text('fallback'), done]], { previousMessages, compaction: c, summaryOnly, onSummary: value => saved.push(value) });
        const result = await s.handle.completion; await s.handle.drained;
        assert.equal(saved.length, 0);
        if (summaryOnly) assert.equal(result.error, 'SUMMARY_NOT_SMALLER');
        else { assert.equal(result.answer, 'fallback'); assert.deepEqual(s.model.requests[1].messages.slice(0, previousMessages.length), previousMessages); }
        const process = createProcessStore(); process.create(identity.id); s.events.forEach(e => process.event(identity.id, e));
        assert.equal(process.snapshot(identity.id).summaryError, 'SUMMARY_NOT_SMALLER');
    }
});

test('Coverage counts distinguish a raw window, continuous summary tail, blocking and explicit omission', () => {
    const source = history(), old = { through: 2, fingerprint: fingerprint(source.slice(0, 2)), text: 'old', createdAt: 1 };
    assert.deepEqual(planContext(source, null, config).coverage, { state: 'complete', total: 16, summarized: 0, raw: 16, omitted: 0, excluded: 0 });
    assert.deepEqual(planContext(source, old, config).coverage, { state: 'complete', total: 16, summarized: 2, raw: 14, omitted: 0, excluded: 0 });
    const blocked = planContext(history(2000), { ...old, fingerprint: fingerprint(history(2000).slice(0, 2)) }, config).coverage;
    assert.equal(blocked.state, 'blocked'); assert.equal(blocked.raw, 0); assert.ok(projectCoverage(blocked));
    assert.deepEqual(planContext(source, old, config, true).coverage, { state: 'omitted', total: 16, summarized: 0, raw: 0, omitted: 0, excluded: 16 });
    source[0].content = 'edited'; assert.equal(planContext(source, old, config).coverage.summarized, 0);
});

test('Coverage projection is closed and rejects impossible counts rather than recording private data', () => {
    const safe = { state: 'complete', total: 4, summarized: 2, raw: 2, omitted: 0, excluded: 0 };
    assert.deepEqual(projectCoverage({ ...safe, text: 'PRIVATE', fingerprint: 'PRIVATE' }), safe);
    for (const patch of [{ total: 3 }, { raw: -1 }, { state: 'PRIVATE' }, { state: 'blocked' }, { total: 5000 }, { raw: NaN }]) assert.equal(projectCoverage({ ...safe, ...patch }), null);
});

test('A claimed summary prefix includes failed-turn originals between complete turns', () => {
    const source = history(); source.splice(2, 0, { role: 'user', content: 'Cancelled question revised the constraint to 4200', runId: 'cancelled' });
    const candidate = summaryCandidate(source, config);
    assert.deepEqual(candidate.messages, source.slice(0, candidate.through).map(({ role, content }) => ({ role, content })));
    assert.match(JSON.stringify(candidate.messages), /4200/);
    const old = { through: 2, fingerprint: fingerprint(source.slice(0, 2)), text: 'old', createdAt: 1 };
    const extension = summaryCandidate(source, config, old);
    assert.deepEqual(extension.messages.slice(1), source.slice(2, extension.through).map(({ role, content }) => ({ role, content })));
});

test('BUG-STRESS-1: failed or skipped extension retains every correction after the old summary', async () => {
    const source = history(10); source[4].content = 'Budget revised to 4200; disregard 3700';
    const old = { through: 2, fingerprint: fingerprint(source.slice(0, 2)), text: 'Budget 3700', createdAt: 1 };
    const plan = planContext(source, old, config), c = summaryCandidate(source, config, old);
    assert.equal(plan.omitted, 0); assert.equal(plan.needsSummary, false);
    assert.equal(plan.messages.length, 19);
    const compaction = { ...c, tail: source.slice(c.through).map(({ role, content }) => ({ role, content })) };
    for (const skip of [false, true]) {
        const s = run(skip ? [[text('answer'), done]] : [() => { throw Error('summary failed'); }, [text('answer'), done]],
            { previousMessages: plan.messages, protectedHistory: plan.protectedHistory, compaction, limits: { modelCalls: skip ? 2 : 4 } });
        assert.equal((await s.handle.completion).answer, 'answer'); await s.handle.drained;
        assert.match(JSON.stringify(s.model.requests.at(-1)), /4200/);
        assert.deepEqual(s.model.requests.at(-1).messages.slice(0, 19), plan.messages);
    }
});

test('An uncarryable summary tail stops instead of dispatching a history-gap answer', async () => {
    const source = history(2000), old = { through: 2, fingerprint: fingerprint(source.slice(0, 2)), text: 'old', createdAt: 1 };
    const plan = planContext(source, old, config); assert.equal(plan.historyBlocked, true);
    const s = run([], { previousMessages: plan.messages, protectedHistory: true, historyBlocked: true, limits: { modelCalls: 2 } });
    assert.equal((await s.handle.completion).error, 'CONTEXT_INCOMPLETE'); assert.equal(s.model.requests.length, 0);
    const model = scriptedModel([]); model.inspect = req => ({ ...measurePayload(req), estimatedTokens: 999999 });
    const full = planContext(history(), { through: 2, fingerprint: fingerprint(history().slice(0, 2)), text: 'old', createdAt: 1 }, config);
    const trim = run([], { model, previousMessages: full.messages, protectedHistory: true });
    assert.equal((await trim.handle.completion).error, 'CONTEXT_INCOMPLETE'); assert.equal(model.requests.length, 0);
});

test('Truncated automatic summary retries once with a fresh context and reserves an answer call', async () => {
    const contexts = [], requests = [], released = [];
    const model = { async *run(req, { context }) {
        contexts.push(context); requests.push(req);
        if (requests.length === 1) throw new ExecutionError('MODEL_OUTPUT_TRUNCATED');
        yield text(requests.length === 2 ? 'summary' : 'answer'); yield done;
    }, releaseContext: value => released.push(value) };
    const s = run([], { model, compaction: candidate(), maxTokens: 32768, contextConfig: { ...config, summaryTokens: 32768 }, limits: { modelCalls: 3 } });
    assert.equal((await s.handle.completion).answer, 'answer'); await s.handle.drained;
    assert.deepEqual(requests.map(r => r.maxTokens), [16384, 32768, 32768]);
    assert.deepEqual(requests.map(r => r.reasoning), ['disabled', 'disabled', undefined]);
    assert.notEqual(contexts[0], contexts[1]); assert.ok(released.includes(contexts[0]));
    const process = createProcessStore(); process.create(identity.id); s.events.forEach(e => process.event(identity.id, e));
    assert.equal(process.snapshot(identity.id).summaryUsage.calls, 2);
    const capped = run([() => { throw new ExecutionError('MODEL_OUTPUT_TRUNCATED'); }, [text('answer'), done]], { compaction: candidate(), maxTokens: 256 });
    assert.equal((await capped.handle.completion).answer, 'answer'); assert.equal(capped.model.requests.length, 2);
});

test('A partial successful summary never drops an oversized remaining tail', async () => {
    const c = candidate(); c.tail = Array.from({ length: 3841 }, () => ({ role: 'user', content: 'raw' }));
    const saved = [], s = run([[text('summary'), done]], { compaction: c, onSummary: value => saved.push(value) });
    assert.equal((await s.handle.completion).error, 'CONTEXT_INCOMPLETE'); assert.equal(saved.length, 1); assert.equal(s.model.requests.length, 1);
});

test('Operation facts survive summary replacement as bounded independent application data', async () => {
    const receipt = { operationId: 'op', artifactId: 'a', revision: 1, at: 1, status: 'outcome_unknown', diff: [], saveError: true, changed: true };
    const s = run([[text('summary'), done], [text('answer'), done]], { previousMessages: planContext(history(), null, config).messages, compaction: candidate(), applicationResults: [receipt] });
    assert.equal((await s.handle.completion).answer, 'answer'); await s.handle.drained;
    assert.doesNotMatch(JSON.stringify(s.model.requests[0]), /operationId/);
    assert.match(JSON.stringify(s.model.requests[1]), /outcome_unknown/);
    assert.equal(s.model.requests[1].messages.filter(m => m.content?.includes('operationId')).length, 1);
    const model = scriptedModel([]); model.inspect = req => ({ ...measurePayload(req), estimatedTokens: req.messages.some(m => m.content?.includes('operationId')) ? 999999 : 1 });
    const limited = run([], { model, applicationResults: [receipt] });
    assert.equal((await limited.handle.completion).error, 'CONTEXT_LIMIT'); assert.equal(model.requests.length, 0);
});

test('Context config has closed bounds and persistence failure restores the previous policy', async () => {
    for (const patch of [{ inputTokens: 1 }, { inputTokens: 1000001 }, { recentTurns: 25 }, { autoSummary: 1 }, { injected: true }]) assert.throws(() => validateContextConfig({ ...config, ...patch }));
    assert.equal(validateContextConfig(CONTEXT_DEFAULTS).inputTokens, 900000);
    assert.equal(validateContextConfig({ ...config, inputTokens: 1000000 }).inputTokens, 1000000);
    const settings = {}; let fails = false;
    const store = createContextConfigStore({ getSettings: () => settings, saveSettings: async () => { if (fails) throw Error('private'); } });
    assert.deepEqual(store.read(), CONTEXT_DEFAULTS); await store.save(config); fails = true;
    await assert.rejects(store.save(CONTEXT_DEFAULTS), /CONTEXT_CONFIG_SAVE_FAILED/); assert.deepEqual(store.read(), config);
});

test('Automatic input budget does not guess the model window but retains the request byte guard', async () => {
    const inspect = request => ({ ...measurePayload(request), estimatedTokens: 35886 });
    const autoModel = scriptedModel([[text('answer'), done]]); autoModel.inspect = inspect;
    const auto = run([], { model: autoModel, contextConfig: { ...CONTEXT_DEFAULTS, inputTokens: null } });
    assert.equal((await auto.handle.completion).answer, 'answer');
    assert.equal(autoModel.requests[0].inputTokenLimit, undefined);
    const manualModel = scriptedModel([]); manualModel.inspect = inspect;
    const manual = run([], { model: manualModel, contextConfig: { ...CONTEXT_DEFAULTS, inputTokens: 32000 } });
    assert.equal((await manual.handle.completion).error, 'CONTEXT_LIMIT');
    assert.equal(manualModel.requests.length, 0);
    const hugeModel = scriptedModel([]);
    hugeModel.inspect = request => ({ ...measurePayload(request), estimatedTokens: 100, requestBytes: 8388609 });
    const huge = run([], { model: hugeModel, contextConfig: CONTEXT_DEFAULTS });
    assert.equal((await huge.handle.completion).error, 'CONTEXT_LIMIT');
    assert.equal(hugeModel.requests.length, 0);
});

test('Process projection preserves manual input limits above the old 128k ceiling', () => {
    const process = createProcessStore(); process.create('large');
    process.event('large', { runId: 'large', seq: 1, type: 'run.context', payload: { phase: 'request', ...measurePayload({ messages: [{ role: 'user', content: 'test' }], tools: [] }), inputTokenLimit: 250000 } });
    assert.equal(process.snapshot('large').context.inputTokenLimit, 250000);
});

test('Planner preserves complete recent turns, ignores orphans and never splits oversized turns', () => {
    const source = history(), p = planContext(source, null, config);
    assert.deepEqual(p.messages.map(m => m.content), history().map(m => m.content)); assert.equal(p.omitted, 0);
    const orphan = [...source, { role: 'user', content: 'failed', runId: 'failed' }]; assert.deepEqual(planContext(orphan, null, config).messages, p.messages);
    source.at(-1).content = '中'.repeat(22000); assert.equal(planContext(source, null, config).turns, 0);
    assert.equal(planContext(history(), null, config, true).messages.length, 0);
    assert.ok(estimateTokens('中'.repeat(100)) > estimateTokens('a'.repeat(100)));
});

test('A long recent answer uses a large configured window or one whole-turn summary', () => {
    const messages = [{ role: 'user', content: 'Draft a plan', runId: 'long' }, { role: 'assistant', content: '中'.repeat(21000), runId: 'long' }];
    const large = { inputTokens: 128000, recentTurns: 12, autoSummary: false };
    assert.equal(planContext(messages, null, large).turns, 1);
    assert.equal(planContext(messages, null, large).omitted, 0);
    const normal = { ...large, inputTokens: 34500, autoSummary: true };
    assert.equal(planContext(messages, null, normal).turns, 0);
    const candidate = summaryCandidate(messages, normal);
    assert.equal(candidate?.through, 2);
    assert.equal(candidate.messages[1].content, messages[1].content);
    copyJson(compactionRequest(candidate, normal.inputTokens).messages[0]);
});

test('A summary request carries a whole long turn through bounded ordered segments', () => {
    const source = [{ role: 'user', content: '请梳理', runId: 'long' }, { role: 'assistant', content: '长段落😀'.repeat(5600), runId: 'long' }];
    const setting = { inputTokens: 128000, recentTurns: 2, autoSummary: true };
    const item = summaryCandidate(source, setting);
    assert.equal(item?.through, 2);
    const request = compactionRequest(item, setting.inputTokens);
    assert.ok(request.messages.length > 3);
    for (const message of request.messages) copyJson(message);
    const segments = request.messages.slice(1).map(message => JSON.parse(message.content));
    for (const [index, original] of source.entries()) {
        const parts = segments.filter(part => part.sourceIndex === index);
        assert.equal(parts[0].start, 0);
        assert.equal(parts.at(-1).end, original.content.length);
        assert.equal(parts.map(part => part.text).join(''), original.content);
        for (let n = 1; n < parts.length; n++) assert.equal(parts[n - 1].end, parts[n].start);
    }
    assert.deepEqual(JSON.parse(compactionRequest({ messages: [{ role: 'user', content: '' }] }, setting.inputTokens).messages[1].content),
        { sourceIndex: 0, role: 'user', start: 0, end: 0, total: 0, text: '' });
});

test('Compaction and recovery keep task provenance distinct from suggestions and unknowns across a rolling summary', async () => {
    const source = [summaryMessage('User task: compare venues. Optional suggestion: get phone. Unknown: payment.'),
        { role: 'assistant', content: 'I could verify payment and get the phone number.' },
        { role: 'user', content: 'Only compare venues; do not add verification tasks.' }];
    const model = scriptedModel([[text('User unfinished work: compare venues. Suggestions: phone lookup, not accepted. Unknown: payment.'), done], [text('comparison'), done]]);
    const handle = startMuyuRun({ identity, input: 'continue comparing venues', model, registry: registry(), allowedTools: [], contextConfig: config,
        compaction: { through: 3, fingerprint: '1:2:3', messages: source, tail: [] }, instructions: composeInstructions('assistant') });
    assert.equal((await handle.completion).error, null); await handle.drained;
    const instruction = model.requests[0].messages[0].content;
    assert.match(instruction, /NOT a planning turn/); assert.match(instruction, /explicitly requested or accepted/);
    assert.match(instruction, /Optional assistant suggestions/); assert.match(instruction, /Unknown information and conditional blockers/);
    assert.match(instruction, /Completed work does not become pending again/); assert.match(instruction, /short acceptance/);
    assert.match(instruction, /Ongoing discussion topics/);
    const segments = model.requests[0].messages.slice(1).map(m => JSON.parse(m.content));
    assert.equal(segments[1].role, 'assistant'); assert.equal(segments[2].role, 'user');
    assert.equal(segments[0].text, source[0].content, 'old reference stays a reference, not an original user request');
    assert.match(model.requests[1].messages[0].content, /untrusted reference data/);
    assert.match(model.requests[1].instructions.base, /不能把助手建议或未知事实说成用户此前交办的待办/);
    assert.match(model.requests[1].instructions.base, /不必为每个普通步骤反复确认/);
    assert.deepEqual(source[2], { role: 'user', content: 'Only compare venues; do not add verification tasks.' });
});

test('Original history tool is paged, bounded, stale-checked and guarded at each read', () => {
    const messages = [{ role: 'user', content: '旧问题' }, { role: 'assistant', content: '答案😀'.repeat(1200) }];
    let allowed = true;
    const module = createHistoryModule({ access: () => allowed ? messages : null });
    const ctx = { runId: 'run', target: { kind: 'chat', chatKey: 'A' } };
    const list = module.handlers['muyu.history.list']({ offset: 0 }, ctx);
    assert.equal(list.total, 2);
    const first = module.handlers['muyu.history.read']({ index: 1, fingerprint: list.items[1].fingerprint, start: 0 }, ctx);
    assert.equal(first.text.length, 4000);
    assert.ok(first.nextOffset > 0);
    const second = module.handlers['muyu.history.read']({ index: 1, fingerprint: list.items[1].fingerprint, start: first.nextOffset }, ctx);
    assert.equal(first.text + second.text, messages[1].content);
    assert.throws(() => module.handlers['muyu.history.read']({ index: 1, fingerprint: 'stale', start: 0 }, ctx), /HISTORY_STALE/);
    allowed = false;
    assert.throws(() => module.handlers['muyu.history.list']({ offset: 0 }, ctx), /HISTORY_UNAVAILABLE/);
});

test('Rolling summary extends a bounded contiguous prefix and invalidates when source changes', () => {
    const source = history(), c = summaryCandidate(source, config), summary = { through: c.through, fingerprint: c.fingerprint, text: 'reference', createdAt: 1 };
    assert.equal(c.through, 12); assert.ok(usableSummary(summary, source));
    assert.equal(planContext(source, summary, config).omitted, 0);
    const extended = [...source, ...history(2).map(m => ({ ...m, runId: 'new' + m.runId }))];
    const next = summaryCandidate(extended, config, summary); assert.equal(next.through, 16); assert.match(next.messages[0].content, /reference/);
    source[0].content = 'edited'; assert.equal(usableSummary(summary, source), false); assert.equal(planContext(source, summary, config).summaryUsed, false);
});

test('V2 upgrade keeps originals, summary stays out of index and is validated separately', () => {
    const source = history(), value = { version: 2, id: crypto.randomUUID(), revision: 0, scope: JSON.stringify(['chat', 'chat', 'A']), title: 'old', createdAt: 1, updatedAt: 1, messages: source, required: [], status: 'idle', archived: false, imported: false };
    const current = validateRecord(value); assert.equal(current.version, 3); assert.equal(current.contextSummary, null);
    current.contextSummary = { through: 2, fingerprint: fingerprint(source.slice(0, 2)), text: 'summary', createdAt: 1 };
    assert.deepEqual(validateRecord(current).messages, source); assert.equal(Object.hasOwn(summarizeRecord(current), 'contextSummary'), false);
    assert.throws(() => validateRecord({ ...current, contextSummary: { ...current.contextSummary, authority: true } }), /HISTORY_INVALID/);
});

test('Automatic summary has no tools, counts against run budget, and preserves original prior messages', async () => {
    const previousMessages = planContext(history(), null, config).messages, saved = [];
    const s = run([[text('summary'), done], [text('answer'), done]], { previousMessages, compaction: candidate(), maxTokens: 256, onSummary: v => saved.push(v) });
    const result = await s.handle.completion; await s.handle.drained;
    assert.equal(result.answer, 'answer'); assert.equal(result.budget.modelCalls, 2); assert.equal(saved.length, 1);
    assert.deepEqual(s.model.requests[0].tools, []); assert.match(s.model.requests[1].messages[0].content, /summary/);
    assert.equal(s.model.requests[0].maxTokens, 256);
    assert.deepEqual(previousMessages.map(m => m.content), history().map(m => m.content));
    assert.equal(s.clock.pending, 0);
});

test('Summary failure falls back; insufficient call budget skips summary, never spends an extra call', async () => {
    const prior = planContext(history(), null, config).messages;
    const s = run([() => { throw Error('private failure'); }, [text('fallback'), done]], { previousMessages: prior, compaction: candidate() });
    assert.equal((await s.handle.completion).answer, 'fallback'); assert.deepEqual(s.model.requests[1].messages.slice(0, prior.length), prior);
    assert.ok(s.events.some(e => e.payload.phase === 'summary_failed'));
    const small = run([[text('direct'), done]], { previousMessages: prior, compaction: candidate(), limits: { modelCalls: 2 } });
    assert.equal((await small.handle.completion).budget.modelCalls, 1); assert.ok(small.model.requests[0].tools.length);
});

test('Summary cancellation and timeout never launch a fallback while upstream is still draining', async () => {
    for (const cancelled of [true, false]) {
        const gate = deferred(), saved = [], s = run([() => gate.promise], { contextConfig: { ...config, summaryTimeMs: 30000 }, compaction: candidate(), onSummary: v => saved.push(v) });
        await flush(); if (cancelled) s.handle.cancel(); else s.clock.advance(30000);
        await flush(); assert.equal((await s.handle.completion).error, cancelled ? 'CANCELLED' : 'TIMEOUT');
        let drained = false; s.handle.drained.then(() => { drained = true; }); await flush(); assert.equal(drained, false);
        gate.resolve([text('late'), done]); await s.handle.drained; assert.equal(s.model.requests.length, 1); assert.equal(saved.length, 0);
    }
});

test('Manual and automatic summaries may exceed 30 seconds within the new default budgets', async () => {
    for (const summaryOnly of [true, false]) {
        const gate = deferred(), saved = [], s = run([() => gate.promise, [text('answer'), done]], { summaryOnly, compaction: candidate(), onSummary: v => saved.push(v) });
        await flush(); s.clock.advance(45000); await flush();
        assert.equal(s.handle.snapshot().status, 'running');
        gate.resolve([text('summary'), done]); const result = await s.handle.completion; await s.handle.drained;
        assert.equal(result.error, null); assert.equal(saved.length, 1); assert.equal(result.budget.timeLimitMs, 300000);
        assert.equal(s.clock.pending, 0);
    }
});

test('Summary timeout is validated, persisted, and bounded by remaining run time with answer reserve', async () => {
    for (const summaryTimeMs of [9999, 1800001, 30000.5, '300000', null]) assert.throws(() => validateContextConfig({ ...config, summaryTimeMs }), /INVALID_CONTEXT_CONFIG/);
    const settings = {}, store = createContextConfigStore({ getSettings: () => settings, saveSettings: async () => {} });
    await store.save({ ...config, summaryTimeMs: 600000 }); assert.equal(store.read().summaryTimeMs, 600000);
    for (const summaryOnly of [true, false]) {
        const gate = deferred(), saved = [], s = run([() => gate.promise], { summaryOnly, compaction: candidate(), contextConfig: { ...config, summaryTimeMs: 600000 }, limits: { timeMs: 60000 }, onSummary: v => saved.push(v) });
        await flush(); s.clock.advance(summaryOnly ? 60000 : 50000); await flush();
        assert.equal((await s.handle.completion).error, 'TIMEOUT'); assert.equal(saved.length, 0);
        gate.resolve([text('late summary'), done]); await s.handle.drained; assert.equal(saved.length, 0); assert.equal(s.clock.pending, 0);
    }
});

test('Initial preflight removes full old turns but current oversize input is blocked before model dispatch', async () => {
    const cfg = { ...config, inputTokens: 4096 };
    const s = run([[text('answer'), done]], { contextConfig: cfg, previousMessages: [{ role: 'user', content: 'x'.repeat(7000) }, { role: 'assistant', content: 'x'.repeat(7000) }] });
    assert.equal((await s.handle.completion).answer, 'answer'); assert.equal(s.model.requests[0].messages.length, 1);
    const sent = s.events.find(e => e.type === 'run.context' && e.payload.phase === 'request');
    assert.equal(sent.payload.historicalMessages, 0); assert.equal(sent.payload.trimmedHistoricalMessages, 2);
    const process = createProcessStore(); process.create(identity.id);
    for (const event of s.events) process.event(identity.id, event);
    assert.equal(process.snapshot(identity.id).context.trimmedHistoricalMessages, 2);
    const large = run([], { contextConfig: cfg, input: '中'.repeat(5000) });
    assert.equal((await large.handle.completion).error, 'CONTEXT_LIMIT'); assert.equal(large.model.requests.length, 0);
});

test('Live tool history cannot be trimmed; adapter measurement includes private overhead on every request', async () => {
    const model = scriptedModel([[request(call()), done]]);
    model.inspect = req => ({ ...measurePayload(req), estimatedTokens: req.messages.some(m => m.role === 'tool') ? 40000 : 100 });
    const s = run([], { model }); const result = await s.handle.completion;
    assert.equal(result.error, 'CONTEXT_LIMIT'); assert.equal(model.requests.length, 1); assert.equal(result.messages.at(-1).role, 'tool');
    const process = createProcessStore(); process.create(identity.id); for (const event of s.events) process.event(identity.id, event);
    assert.equal(process.snapshot(identity.id).context.estimatedTokens, 40000); assert.equal(process.snapshot(identity.id).error, 'CONTEXT_LIMIT');
    assert.doesNotMatch(JSON.stringify(process.snapshot(identity.id)), /current|callId|reasoning_content/);
});

test('Manual summary is one tool-free call and cannot execute a requested tool', async () => {
    const saved = [], s = run([[request(call()), done]], { summaryOnly: true, compaction: candidate(), onSummary: v => saved.push(v), limits: { modelCalls: 1 } });
    assert.equal((await s.handle.completion).error, 'MODEL_PROTOCOL_ERROR'); assert.equal(saved.length, 0); assert.equal(s.model.requests.length, 1);
});

test('Summary updates stay in memory when automatic saves are off; JSON backup remains read-only', async () => {
    const store = createMemoryHistoryStore(), port = { enabled: () => true, open: async () => store, setEnabled: async () => {} };
    const library = createSessionLibrary({ port }); await library.ready;
    const id = library.create(JSON.stringify(['chat', 'chat', 'A'])); library.update(id, { messages: history() }); await library.flush();
    await library.setEnabled(false); const c = candidate(), summary = { through: c.through, fingerprint: c.fingerprint, text: 'reference', createdAt: 1 };
    library.update(id, { contextSummary: summary }); await library.flush();
    assert.equal((await store.read(id)).contextSummary, null); assert.equal(library.get(id).contextSummary.text, 'reference');
    const imported = importedRecord(parseHistoryImport(exportHistoryRecord(library.get(id))));
    assert.equal(imported.imported, true); assert.notEqual(imported.id, id); assert.equal(imported.contextSummary.text, 'reference');
    await library.setEnabled(true); await library.flush(); assert.equal((await store.read(id)).contextSummary.text, 'reference');
    library.update(id, { contextSummary: null }); await library.flush(); assert.equal((await store.read(id)).contextSummary, null); await library.close();
});

test('A protocol-failed summary drains its iterator before a fallback request may start', async () => {
    const gate = deferred(); let calls = 0;
    const model = { async *run() { calls++; if (calls === 1) { try { yield request(call()); } finally { await gate.promise; } } else { yield text('fallback'); yield done; } } };
    const s = run([], { model, compaction: candidate() }); await flush(); assert.equal(calls, 1);
    gate.resolve(); assert.equal((await s.handle.completion).answer, 'fallback'); await s.handle.drained; assert.equal(calls, 2);
});
