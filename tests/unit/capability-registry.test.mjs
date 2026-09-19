import assert from 'node:assert/strict';
import test from 'node:test';
import { CapabilityRegistry } from '../../systems/capability-registry.js';

test('capability registry filters by enabled state and scope', t => {
    const ids = ['test.registry.message', 'test.registry.round', 'test.registry.off'];
    t.after(() => ids.forEach(id => CapabilityRegistry.unregister(id)));

    CapabilityRegistry.register({ id: ids[0], scope: 'message', executor: async () => {} });
    CapabilityRegistry.register({ id: ids[1], scope: 'round', executor: async () => {} });
    CapabilityRegistry.register({ id: ids[2], scope: 'both', enabled: false, executor: async () => {} });

    assert.deepEqual(
        CapabilityRegistry.listExecutableForMode('message').filter(c => ids.includes(c.id)).map(c => c.id),
        [ids[0]],
    );
    assert.deepEqual(
        CapabilityRegistry.listExecutableForMode('round').filter(c => ids.includes(c.id)).map(c => c.id),
        [ids[1]],
    );

    CapabilityRegistry.setEnabled(ids[2], true);
    CapabilityRegistry.setScope(ids[2], 'round');
    assert.equal(CapabilityRegistry.listExecutableForMode('round').some(c => c.id === ids[2]), true);
});

test('unregister removes a live capability', t => {
    const id = 'test.registry.unregister';
    t.after(() => CapabilityRegistry.unregister(id));
    CapabilityRegistry.register({ id, executor: async () => {} });
    assert.ok(CapabilityRegistry.get(id));
    assert.equal(CapabilityRegistry.unregister(id), true);
    assert.equal(CapabilityRegistry.get(id), undefined);
});

test('capability ownership rejects cross-owner replacement and protects unregister', t => {
    const id = 'test.capability.owner';
    t.after(() => CapabilityRegistry.unregister(id));
    CapabilityRegistry.register({
        id, executor() {}, _gdOwner: 'owner-a', _gdOwnerId: 'asset-a',
    });

    assert.throws(() => CapabilityRegistry.register({
        id, executor() {}, _gdOwner: 'owner-b', _gdOwnerId: 'asset-b',
    }), /already registered/);
    assert.equal(CapabilityRegistry.unregister(id, { owner: 'owner-b', ownerId: 'asset-b' }), false);
    assert.equal(CapabilityRegistry.get(id)._gdOwner, 'owner-a');

    CapabilityRegistry.register({
        id, executor() { return 'updated'; }, _gdOwner: 'owner-a', _gdOwnerId: 'asset-a',
    });
    assert.equal(CapabilityRegistry.get(id).executor(), 'updated');
    assert.equal(CapabilityRegistry.unregister(id, { owner: 'owner-a', ownerId: 'asset-a' }), true);
});
