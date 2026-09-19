import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTakeoverSchedule } from '../../systems/takeover-scheduler.js';

test('takeover scheduler preserves original plan order and skips completed or unknown characters', () => {
    const result = buildTakeoverSchedule(['alice', 'bob', 'ghost', 'eve'], {
        completed: new Set(['alice']),
        knownAvatars: new Set(['alice', 'bob', 'eve']),
    });
    assert.deepEqual(result, {
        queue: [{ avatar: 'bob', originalIndex: 1 }, { avatar: 'eve', originalIndex: 3 }],
        skipped: [{ avatar: 'alice', originalIndex: 0, reason: 'completed' }, { avatar: 'ghost', originalIndex: 2, reason: 'unknown' }],
        remaining: 2,
    });
});

test('takeover scheduler yields an empty queue when every planned speaker is unavailable', () => {
    assert.deepEqual(buildTakeoverSchedule(['alice'], { completed: new Set(['alice']), knownAvatars: new Set(['alice']) }), {
        queue: [],
        skipped: [{ avatar: 'alice', originalIndex: 0, reason: 'completed' }],
        remaining: 0,
    });
});
