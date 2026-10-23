import test from 'node:test';
import assert from 'node:assert/strict';
import { muyuFloatingState } from '../../muyu/ui/floating-state.js';
import { createProcessStore } from '../../muyu/application/process-store.js';

test('Floating presentation follows model and tool events, without treating a recoverable tool failure as task failure', () => {
    const p = createProcessStore(); p.create('run');
    const display = () => muyuFloatingState({ busy: true, activity: p.snapshot('run') }).displayState;
    p.event('run', { runId: 'run', seq: 1, type: 'model.started', at: 0, payload: { attemptId: 1 } });
    assert.equal(display(), 'thinking');
    p.event('run', { runId: 'run', seq: 2, type: 'tool.requested', at: 1, payload: { attemptId: 1 } });
    assert.equal(display(), 'executing');
    p.event('run', { runId: 'run', seq: 3, type: 'tool.failed', at: 2, payload: { attemptId: 1 } });
    assert.equal(display(), 'executing');
});

test('Presentation distinguishes idle, waiting, completed, failed and cancelled tasks', () => {
    assert.equal(muyuFloatingState().displayState, 'idle');
    assert.equal(muyuFloatingState({ interaction: { status: 'pending' } }).displayState, 'waiting');
    assert.equal(muyuFloatingState({ notice: 'private text' }).displayState, 'waiting');
    assert.equal(muyuFloatingState({ runs: [{ status: 'succeeded' }] }).displayState, 'completed');
    assert.equal(muyuFloatingState({ runs: [{ status: 'failed' }] }).displayState, 'error');
    for (const status of ['cancelled', 'interrupted', 'yielded']) assert.equal(muyuFloatingState({ runs: [{ status }] }).displayState, 'idle');
});

test('Active work takes precedence over old failures and pending interactions in a different viewed session', () => {
    const s = { busy: true, interaction: { status: 'pending' }, runs: [{ status: 'failed' }], activity: { phase: 'model.started' } };
    assert.equal(muyuFloatingState(s).displayState, 'thinking');
    assert.equal(muyuFloatingState({ ...s, resetting: true }).displayState, 'executing');
    assert.equal(muyuFloatingState({ ...s, draining: true }).displayState, 'executing');
    assert.equal(muyuFloatingState({ busy: true, context: { compacting: true } }).displayState, 'thinking');
    assert.deepEqual(Object.keys(muyuFloatingState(s)), ['status', 'displayState']);
});
