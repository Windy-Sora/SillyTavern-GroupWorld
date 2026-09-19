import assert from 'node:assert/strict';
import test from 'node:test';
import { planCustomAgentAutoRuns } from '../../systems/custom-agent-auto-coordinator.js';

const agent = (id, order, interval = 10) => ({
    id, order, autoInterval: interval, enabled: true, autoEnabled: true,
});

test('custom agent auto policy sorts work and handles first-enable checkpoints', () => {
    const actions = planCustomAgentAutoRuns({
        instances: [agent('late', 2), agent('first', 1)],
        currentLength: 4,
        counters: {},
    });
    assert.deepEqual(actions.map(item => [item.instance.id, item.type]), [
        ['first', 'checkpoint'],
        ['late', 'checkpoint'],
    ]);
});

test('custom agent auto policy uses stored coverage and detects rollback', () => {
    const instances = [agent('run', 1, 3), agent('reset', 2, 3), agent('quiet', 3, 9)];
    const actions = planCustomAgentAutoRuns({
        instances,
        currentLength: 8,
        counters: { _autoCAG_run: 5, _autoCAG_reset: 12, _autoCAG_quiet: 5 },
    });
    assert.deepEqual(actions.map(item => [item.instance.id, item.type]), [
        ['run', 'execute'],
        ['reset', 'reset'],
    ]);
});

test('custom agent auto policy falls back to the latest result coverage', () => {
    const actions = planCustomAgentAutoRuns({
        instances: [agent('a', 0, 5)],
        currentLength: 9,
        counters: {},
        getLatestRangeEnd: () => 5,
    });
    // Existing result coverage suppresses first-enable handling; only four new messages.
    assert.equal(actions.length, 0);
});
