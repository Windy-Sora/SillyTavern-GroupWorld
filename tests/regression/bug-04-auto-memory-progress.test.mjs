import assert from 'node:assert/strict';
import test from 'node:test';
import { runAutoMemoryTargets } from '../../systems/auto-memory-coordinator.js';

test('BUG-4: successful character memory progress survives a partial batch failure', async () => {
    const progress = {};
    const calls = { A: 0, B: 0 };
    let failB = true;
    const run = currentLen => runAutoMemoryTargets({
        targets: ['A', 'B'],
        currentLen,
        interval: 10,
        coveredByTarget: progress,
        generateForTarget: async target => {
            calls[target]++;
            if (target === 'B' && failB) throw new Error('temporary model failure');
        },
        onCovered: async (target, coveredAt) => {
            progress[target] = coveredAt;
        },
    });

    const first = await run(10);
    assert.equal(first.complete, false);
    assert.deepEqual(progress, { A: 10 });

    failB = false;
    const second = await run(12);
    assert.equal(second.complete, true);
    assert.deepEqual(second.skipped, ['A']);
    assert.deepEqual(progress, { A: 10, B: 12 });
    assert.deepEqual(calls, { A: 1, B: 2 });
});

test('BUG-4: NO_NEW_MEMORIES is a successful coverage checkpoint', async () => {
    const progress = {};
    const result = await runAutoMemoryTargets({
        targets: ['A'],
        currentLen: 10,
        interval: 10,
        coveredByTarget: progress,
        generateForTarget: async () => {
            const error = new Error('nothing new');
            error.code = 'NO_NEW_MEMORIES';
            throw error;
        },
        onCovered: async (target, coveredAt) => {
            progress[target] = coveredAt;
        },
    });

    assert.equal(result.complete, true);
    assert.deepEqual(result.covered, ['A']);
    assert.deepEqual(progress, { A: 10 });
});
