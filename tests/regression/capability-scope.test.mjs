import assert from 'node:assert/strict';
import test from 'node:test';
import { CapabilityRegistry } from '../../systems/capability-registry.js';

test('BUG-13: capability scope override survives unregister and re-registration', t => {
    const id = 'test.regression.scope-override';
    t.after(() => {
        CapabilityRegistry.unregister(id);
        delete CapabilityRegistry._scopeOverrides[id];
    });
    CapabilityRegistry._scopeOverrides[id] = 'round';
    CapabilityRegistry.register({ id, scope: 'message', executor: async () => {} });
    assert.equal(CapabilityRegistry.get(id).scope, 'round');
    CapabilityRegistry.unregister(id);
    CapabilityRegistry.register({ id, scope: 'message', executor: async () => {} });
    assert.equal(CapabilityRegistry.get(id).scope, 'round');
});
