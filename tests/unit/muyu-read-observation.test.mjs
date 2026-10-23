import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadObservation } from '../../muyu/application/read-observation.js';
import { createPermissions } from '../../muyu/application/permissions.js';

const target = { kind: 'chat', userKey: 'u', chatKey: 'A' }, taskId = 'task';
const request = source => ({ target, taskId, source, reason: 'Test' });
const call = source => ({ toolId: 'muyu.provider.read', args: { id: source } });
const registry = { get: () => ({ effect: 'read' }) };

test('Read observations reflect host task/global decisions once and never grant authority', () => {
    const permissions = createPermissions(), decisions = new Map([['source:memoryConfig', 'chat'], ['source:recentMessages', 'task']]);
    const port = createReadObservation({ permissions, target, taskId, decisions, registry });
    assert.equal(port.observe(call('recentMessages')), null);
    permissions.decide(request('recentMessages'), 'task', () => {});
    const first = port.validate(port.observe(call('recentMessages')));
    assert.deepEqual(first.sources, [{ source: 'recentMessages', status: 'granted_now', grantScope: 'task' }]);
    assert.equal(port.observe(call('recentMessages')).sources[0].status, 'reused');
    assert.equal(permissions.allows('source:recentMessages', target, 'other-task'), false);
    permissions.decide(request('memoryConfig'), 'chat', () => {});
    assert.equal(port.observe(call('memoryConfig')).sources[0].grantScope, 'connection');
    assert.throws(() => port.validate({ ...first, grants: ['all'] }));
});

test('Denied, unavailable and executable sources do not become observed read grants', () => {
    const permissions = createPermissions(), port = createReadObservation({ permissions, target, taskId, decisions: new Map(), registry });
    permissions.decide(request('recentMessages'), 'deny', () => {});
    assert.deepEqual(port.observe(call('recentMessages')).sources, [{ source: 'recentMessages', status: 'denied', grantScope: 'none' }]);
    assert.equal(port.observe(call('unknown')), null);
    assert.equal(port.observe({ toolId: 'muyu.provider.execute', args: { id: 'p', revision: 'x' } }), null);
    assert.equal(permissions.allows('source:recentMessages', target, taskId), false);
});

test('A multi-source read observes each real grant once without granting other sources', () => {
    const permissions = createPermissions(), decisions = new Map();
    for (const source of ['memoryConfig', 'memoryDiagnostics']) {
        permissions.decide(request(source), 'task', () => {});
        decisions.set('source:' + source, 'task');
    }
    const port = createReadObservation({ permissions, target, taskId, decisions, registry });
    const multi = { toolId: 'muyu.memory.inspect', args: {} };
    assert.deepEqual(port.validate(port.observe(multi)).sources.map(s => s.status), ['granted_now', 'granted_now']);
    assert.equal(decisions.size, 0);
    assert.deepEqual(port.observe(multi).sources.map(s => s.status), ['reused', 'reused']);
    assert.equal(permissions.allows('source:recentMessages', target, taskId), false);
    assert.equal(port.observe(call('recentMessages')), null);
});
