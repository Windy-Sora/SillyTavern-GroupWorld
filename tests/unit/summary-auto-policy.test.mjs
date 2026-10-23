import test from 'node:test';
import assert from 'node:assert/strict';
import { planSummaryAutoRun, runSummaryAutoPlan } from '../../systems/summary-auto-policy.js';

test('First eligible round may summarize existing messages, or checkpoint below the threshold', () => {
    const base = { covered: 0, hasCounter: false, hasLegacyCounter: false, interval: 10 };
    assert.deepEqual(planSummaryAutoRun({ ...base, currentLength: 10 }), { type: 'execute', firstEnable: true, newMessages: 10 });
    assert.deepEqual(planSummaryAutoRun({ ...base, currentLength: 9 }), { type: 'checkpoint', firstEnable: true, newMessages: 9 });
});

test('Lowering interval acts on the next check without resetting coverage', () => {
    const base = { covered: 8, hasCounter: true, hasLegacyCounter: false, currentLength: 13 };
    assert.equal(planSummaryAutoRun({ ...base, interval: 10 }).type, 'none');
    assert.deepEqual(planSummaryAutoRun({ ...base, interval: 5 }), { type: 'execute', firstEnable: false, newMessages: 5 });
    assert.equal(planSummaryAutoRun({ ...base, currentLength: 6, interval: 5 }).type, 'reset');
});

test('Failed generation does not checkpoint coverage; success checkpoints afterward', async () => {
    const action = planSummaryAutoRun({ covered: 3, hasCounter: true, hasLegacyCounter: false, currentLength: 13, interval: 10 });
    const events = [];
    const saveLength = length => { events.push(['saved', length]); };
    await assert.rejects(runSummaryAutoPlan(action, { currentLength: 13, generateSummary: () => { events.push(['generate']); throw Error('failed'); }, saveLength }), /failed/);
    assert.deepEqual(events, [['generate']]);
    await runSummaryAutoPlan(action, { currentLength: 13, generateSummary: () => { events.push(['generate']); }, saveLength });
    assert.deepEqual(events.slice(1), [['generate'], ['saved', 13]]);
});
