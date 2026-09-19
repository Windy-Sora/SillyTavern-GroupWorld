import assert from 'node:assert/strict';
import test from 'node:test';
import { providers, registerProvider, unregisterProvider } from '../../provider-registry.js';

test.beforeEach(() => providers.clear());
test.after(() => providers.clear());

test('provider registry rejects cross-owner collisions', () => {
    const original = {
        id: 'shared', placeholder: '{{shared}}',
        _gdOwner: 'group-director/custom-agent', _gdOwnerId: 'agent-1',
    };
    registerProvider(original);

    assert.throws(() => registerProvider({
        id: 'shared', placeholder: '{{shared}}',
        _gdOwner: 'group-director/user-provider', _gdOwnerId: 'asset-1',
    }), /already registered/);
    assert.equal(providers.get('shared'), original);
});

test('provider registry permits same-owner refresh and protects owned unregister', () => {
    registerProvider({
        id: 'owned', placeholder: '{{owned}}', value: 1,
        _gdOwner: 'group-director/user-provider', _gdOwnerId: 'asset-1',
    });
    registerProvider({
        id: 'owned', placeholder: '{{owned}}', value: 2,
        _gdOwner: 'group-director/user-provider', _gdOwnerId: 'asset-1',
    });
    assert.equal(providers.get('owned').value, 2);

    assert.equal(unregisterProvider('owned', {
        owner: 'group-director/user-provider', ownerId: 'other-asset',
    }), false);
    assert.equal(providers.has('owned'), true);
    assert.equal(unregisterProvider('owned', {
        owner: 'group-director/user-provider', ownerId: 'asset-1',
    }), true);
});
