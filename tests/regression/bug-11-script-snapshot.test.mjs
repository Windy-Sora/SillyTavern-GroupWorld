import assert from 'node:assert/strict';
import test from 'node:test';
import { createScriptExecutorSystem } from '../../systems/script-executor-system.js';

function createSystem(code, logs) {
    return createScriptExecutorSystem({
        settings: {
            scriptExecutors: [{
                id: 'snapshot-probe',
                name: 'snapshot probe',
                triggerOn: 'decision',
                priority: 0,
                code,
                enabled: true,
                params: [],
                returnMode: 'shared',
            }],
        },
        saveSettings: () => {},
        renderPrompt: async value => value,
        AgentTrace: { push: () => {} },
        log: message => logs.push(String(message)),
    });
}

for (const [type, expression] of [
    ['Map', 'new Map([["key", 1]])'],
    ['Set', 'new Set(["value"])'],
    ['TypedArray', 'new Uint8Array([1, 2])'],
]) {
    test(`BUG-11: unsupported ${type} shared values are rejected without breaking snapshot creation`, async () => {
        const logs = [];
        const system = createSystem(`return { exotic: ${expression} };`, logs);
        const decision = { speakers: ['A'] };

        const snapshot = await system.executeAllDecision({ decision });

        assert.ok(snapshot);
        assert.equal(snapshot.shared.exotic, undefined);
        assert.ok(logs.some(message => /unsupported snapshot value/i.test(message)));
        assert.equal(Object.isFrozen(snapshot), true);
        assert.equal(Object.isFrozen(snapshot.decision), true);
    });
}

test('BUG-11: unsupported objects introduced through ctx.decision are rolled back', async () => {
    const logs = [];
    const system = createSystem(
        'ctx.decision.exotic = new Map([["key", 1]]); return {};',
        logs,
    );

    const snapshot = await system.executeAllDecision({
        decision: { speakers: ['A'] },
    });

    assert.equal(snapshot.decision.exotic, undefined);
    assert.ok(logs.some(message => /unsupported snapshot value/i.test(message)));
    assert.equal(Object.isFrozen(snapshot.decision.speakers), true);
});
