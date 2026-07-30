import assert from 'node:assert/strict';
import test from 'node:test';
import { CapabilityRegistry } from '../../systems/capability-registry.js';
import { createExecutor } from '../../systems/executor.js';

test('BUG-5/BUG-8: a queued round_end plan is cancelled after capability removal', async t => {
    const id = 'test.regression.stale-capability';
    t.after(() => CapabilityRegistry.unregister(id));
    let calls = 0;
    CapabilityRegistry.register({
        id,
        scope: 'message',
        executor: async () => { calls++; },
    });
    const executor = createExecutor({
        blocking: true,
        resolveCapability: capabilityId => CapabilityRegistry.get(capabilityId),
    });

    const queued = await executor.run({
        intents: [{ type: id, params: {} }],
        timing: { mode: 'round_end' },
    }, CapabilityRegistry.listExecutableForMode('message'));
    CapabilityRegistry.unregister(id);

    const result = await executor.executeDeferred(queued.deferred);
    assert.equal(calls, 0);
    assert.equal(result.results[0].cancelled, true);
});

test('BUG-5/BUG-8: disabling or replacing a capability invalidates its queued revision', async t => {
    const id = 'test.regression.capability-revision';
    t.after(() => CapabilityRegistry.unregister(id));
    let oldCalls = 0;
    let newCalls = 0;
    CapabilityRegistry.register({ id, executor: async () => { oldCalls++; } });
    const executor = createExecutor({
        blocking: true,
        resolveCapability: capabilityId => CapabilityRegistry.get(capabilityId),
    });

    const disabledPlan = await executor.run({
        intents: [{ type: id, params: {} }],
        timing: { mode: 'round_end' },
    }, CapabilityRegistry.listExecutableForMode('message'));
    CapabilityRegistry.setEnabled(id, false);
    const disabledResult = await executor.executeDeferred(disabledPlan.deferred);

    assert.equal(oldCalls, 0);
    assert.equal(disabledResult.results[0].cancelled, true);

    CapabilityRegistry.setEnabled(id, true);
    const replacedPlan = await executor.run({
        intents: [{ type: id, params: {} }],
        timing: { mode: 'round_end' },
    }, CapabilityRegistry.listExecutableForMode('message'));
    CapabilityRegistry.register({ id, executor: async () => { newCalls++; } });
    const replacedResult = await executor.executeDeferred(replacedPlan.deferred);

    assert.equal(oldCalls, 0);
    assert.equal(newCalls, 0);
    assert.equal(replacedResult.results[0].cancelled, true);
});
