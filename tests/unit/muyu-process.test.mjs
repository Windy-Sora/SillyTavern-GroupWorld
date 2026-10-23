import test from 'node:test';
import assert from 'node:assert/strict';

test('Coverage observations retain only bounded counts and safe recovery status', () => {
    const p = createProcessStore(); p.create('r');
    const coverage = { state: 'complete', total: 10, summarized: 2, raw: 8, omitted: 0, excluded: 0 };
    const event = (seq, payload) => ({ runId: 'r', seq, type: 'run.context', payload });
    p.event('r', event(1, { phase: 'history_coverage', status: 'fallback', coverage: { ...coverage, text: 'PRIVATE', fingerprint: 'PRIVATE' } }));
    assert.deepEqual(p.snapshot('r').coverage, { ...coverage, status: 'fallback' });
    p.event('r', event(2, { phase: 'history_coverage', status: 'PRIVATE', coverage }));
    p.event('r', event(3, { phase: 'history_coverage', status: 'blocked', coverage: { ...coverage, total: 11 } }));
    assert.equal(p.snapshot('r').coverage.status, 'fallback'); assert.doesNotMatch(JSON.stringify(p.snapshot('r')), /PRIVATE/);
    p.lifecycle('r', 'cancelled'); p.event('r', event(4, { phase: 'history_coverage', status: 'summarized', coverage }));
    assert.equal(p.snapshot('r').coverage.status, 'fallback');
});
import { createProcessStore } from '../../muyu/application/process-store.js';
import { createApplication } from '../../muyu/application/service.js';
import { startMuyuRun } from '../../muyu/composition.js';
import { createClock, flush, deferred, identity, toolId, registry, call, request, done, text, scriptedModel } from './helpers/muyu-subject.mjs';

test('Provider process projection retains only source/status/count/truncation, never text or revision', () => {
    const p = createProcessStore(); p.create('r');
    p.event('r', { runId: 'r', seq: 1, type: 'tool.completed', payload: { attemptId: 1, toolId: 'muyu.provider.read', result: { data: { source: 'charMemory', status: 'ok', text: 'PRIVATE', revision: 'SECRET_REVISION', truncated: true } } } });
    assert.deepEqual(p.snapshot('r').rows[0].read, { source: 'charMemory', status: 'ok', characters: 7, truncated: true });
    assert.doesNotMatch(JSON.stringify(p.snapshot('r')), /PRIVATE|SECRET_REVISION/);
});

test('Safe projection discards payloads, unknown tool names, private errors and replayed/out-of-order events', () => {
    const p = createProcessStore(); p.create('r');
    const event = (seq, type, payload) => ({ runId: 'r', seq, type, at: seq * 10, payload });
    p.event('r', event(1, 'model.delta', { text: 'PRIVATE' }));
    p.event('r', event(2, 'tool.requested', { attemptId: 1, toolId: 'PRIVATE', args: 'PRIVATE' }));
    p.event('r', event(3, 'tool.failed', { attemptId: 1, toolId: 'PRIVATE', result: { error: { code: 'PRIVATE', message: 'PRIVATE' }, data: 'PRIVATE' } }));
    p.event('r', event(3, 'tool.failed', { attemptId: 1 })); p.event('r', event(2, 'tool.started', { attemptId: 1 }));
    p.event('r', { ...event(4, 'model.started', { attemptId: 2 }), runId: 'other' });
    const s = p.snapshot('r'); assert.equal(s.rows.length, 2); assert.equal(s.toolFailures, 1);
    assert.equal(s.rows[1].durationMs, 10); assert.doesNotMatch(JSON.stringify(s), /PRIVATE|args|message|data/);
    s.rows.length = 0; assert.equal(p.snapshot('r').rows.length, 2);
});

test('Process bounds drop old rows but retain terminal/error/cleanup; late events cannot undo cancellation', () => {
    const p = createProcessStore({ maxRows: 3, maxTotalRows: 4, maxRuns: 2 }); p.create('a'); p.create('b'); p.create('c');
    for (const id of ['a', 'b']) for (let i = 1; i <= 6; i++) p.event(id, { runId: id, seq: i, type: 'model.started', at: i, payload: { attemptId: i } });
    assert.ok(p.snapshot('a').rows.length + p.snapshot('b').rows.length <= 4); assert.equal(p.snapshot('c'), null);
    p.lifecycle('b', 'cancelling'); p.event('b', { runId: 'b', seq: 10, type: 'tool.completed', payload: { attemptId: 1 } });
    p.lifecycle('b', 'cancelled'); p.lifecycle('b', 'succeeded'); p.lifecycle('b', 'cleaned');
    assert.equal(p.snapshot('b').terminal, 'cancelled'); assert.equal(p.snapshot('b').cleaned, true); assert.ok(p.snapshot('b').dropped > 0);
    p.clear(); assert.equal(p.snapshot('b'), null);
});

test('Runtime identifies actual execution versus reused and denied calls; observation failures do not alter results', async () => {
    const events = []; let executions = 0;
    const h = startMuyuRun({ identity, input: 'test', registry: registry(), handlers: { [toolId]: () => { executions++; return 1; } },
        allowedTools: [toolId], policy: () => true, clock: createClock(),
        model: scriptedModel([[request(call()), done], [request(call()), request({ ...call('denied'), toolId: 'unknown' }), done], [text('done'), done]]),
        onEvent: e => { events.push(e); throw Error('observer failure'); } });
    assert.equal((await h.completion).state.status, 'succeeded'); await h.drained;
    assert.equal(executions, 1);
    assert.deepEqual(events.filter(e => e.type === 'tool.started').map(e => e.payload.attemptId), [1]);
    assert.deepEqual(events.filter(e => e.type === 'tool.reused').map(e => e.payload.attemptId), [2]);
    assert.equal(events.filter(e => e.type === 'model.started').length, 3);
    assert.equal(events.filter(e => e.type === 'model.completed').length, 3);
});

test('Application separates logical cancellation from drain and does not put process data into model history', async () => {
    const wait = deferred(), model = scriptedModel([() => wait.promise, [text('next'), done]]), clock = createClock();
    const app = createApplication({ currentTarget: identity.target, startRun: options => startMuyuRun({ ...options, registry: registry(), model, clock }) });
    const sid = app.createSession(identity.target); const r = app.submit(sid, 'first'); await flush();
    assert.equal(app.snapshot().runs[0].process.phase, 'model.started');
    app.cancel(r.runId); await flush(); assert.equal(app.snapshot().runs[0].process.terminal, 'cancelled');
    assert.equal(app.snapshot().runs[0].process.cleaned, false);
    wait.resolve([text('late'), done]); for (let i = 0; i < 5; i++) await flush();
    assert.equal(app.snapshot().runs[0].process.cleaned, true);
    app.submit(sid, 'next'); for (let i = 0; i < 5; i++) await flush();
    assert.doesNotMatch(JSON.stringify(model.requests), /elapsedMs|durationMs|toolFailures|model.started/);
    app.dispose(); assert.equal(app.snapshot().runs[0].process, null);
});

test('Runtime model failure and startup failure produce distinct safe terminal records', async () => {
    const app = createApplication({ currentTarget: identity.target, startRun: options => startMuyuRun({ ...options, registry: registry(), clock: createClock(), model: scriptedModel([() => { throw Error('PRIVATE'); }]) }) });
    app.submit(app.createSession(identity.target), 'test'); for (let i = 0; i < 5; i++) await flush();
    const p = app.snapshot().runs[0].process; assert.equal(p.terminal, 'failed'); assert.equal(p.error, 'MODEL_FAILED');
    assert.equal(p.rows.at(-1).type, 'model.failed'); assert.doesNotMatch(JSON.stringify(p), /PRIVATE/); app.dispose();
    const broken = createApplication({ currentTarget: identity.target, startRun: () => { throw Error('PRIVATE'); } });
    broken.submit(broken.createSession(identity.target), 'test'); await flush();
    assert.equal(broken.snapshot().runs[0].process.error, 'START_FAILED'); assert.equal(broken.snapshot().runs[0].process.cleaned, true); broken.dispose();
});
