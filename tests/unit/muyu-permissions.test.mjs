import test from 'node:test';
import assert from 'node:assert/strict';
import { createPermissions } from '../../muyu/application/permissions.js';
import { validatePermission } from '../../muyu/permissions/contract.js';
import { createInteractionStore } from '../../muyu/interactions/store.js';
import { createProviderModule } from '../../muyu/modules/providers/index.js';
import { providerCatalog } from '../../muyu/modules/providers/catalog.js';
import { assistantToolAccess } from '../../muyu/application/capabilities.js';

const A = { kind: 'chat', userKey: 'user', chatKey: 'A' }, B = { ...A, chatKey: 'B' };
const request = { source: 'chatHistory', reason: 'Check recent events', target: A, taskId: 't1' };
for (const decision of ['task', 'deny']) test(`Provider execution ${decision} rollback restores existing records without granting new ones`, () => {
    const p = createPermissions(), execution = { ...request, source: 'providerExecution', providerId: 'custom', providerRevision: 'a'.repeat(64) + '-0' };
    const has = r => p[decision === 'task' ? 'allowsExecution' : 'deniedExecution'](r.target, r.taskId, r.providerId, r.providerRevision);
    const failure = Error('enqueue failed'), fail = () => { throw failure; };
    assert.throws(() => p.decide(execution, decision, fail), error => error === failure);
    assert.equal(has(execution), false);
    assert.equal(p.decide(execution, decision, () => 'queued'), 'queued');
    assert.throws(() => p.decide(execution, decision, fail), error => error === failure);
    assert.equal(has(execution), true);
    for (const other of [{ ...execution, target: B }, { ...execution, taskId: 't2' }, { ...execution, providerRevision: 'b'.repeat(64) + '-0' }, { ...execution, providerId: 'other' }]) {
        assert.throws(() => p.decide(other, decision, fail), error => error === failure);
        assert.equal(has(other), false); assert.equal(has(execution), true);
    }
    assert.equal(p[decision === 'task' ? 'deniedExecution' : 'allowsExecution'](A, 't1', execution.providerId, execution.providerRevision), false);
    p.forgetTask(A, 't1'); assert.equal(has(execution), false);
});
test('Public source catalog never probes host availability or content', () => {
    const fail = () => { throw Error('Host must not be accessed'); };
    const module = createProviderModule({ providerPort: { available: fail, read: fail }, currentTarget: fail });
    const catalog = module.handlers['muyu.provider.list']();
    assert.equal(catalog.length, providerCatalog.length); assert.ok(catalog.every(p => !Object.hasOwn(p, 'available')));
    assert.equal(validatePermission({ source: 'memoryConfig', reason: 'read' }).source, 'memoryConfig');
    module.dispose();
});
test('Source grants are bounded by source, task, target and connection; failed continuation rolls back', () => {
    const p = createPermissions();
    assert.throws(() => p.decide(request, 'task', () => { throw Error('full'); }), /full/);
    assert.equal(p.allows('source:chatHistory', A, 't1'), false);
    p.decide(request, 'task', () => {});
    assert.equal(p.allows('source:chatHistory', A, 't1'), true);
    assert.equal(p.allows('source:characters', A, 't1'), false);
    assert.equal(p.allows('source:chatHistory', B, 't1'), false);
    assert.equal(p.allows('source:chatHistory', A, 't2'), false);
    p.forgetTask(A, 't1'); assert.equal(p.allows('source:chatHistory', A, 't1'), false);
    p.decide(request, 'chat', () => {});
    assert.equal(p.allows('source:chatHistory', A, 't2'), true);
    assert.equal(p.allows('extended', A), false);
    p.clear(); assert.equal(p.allows('source:chatHistory', A, 't2'), false);
});
test('Rejects extra scope, arbitrary sources and decisions; denial never becomes a grant', () => {
    assert.throws(() => validatePermission({ source: 'files', reason: 'read' }));
    assert.throws(() => validatePermission({ source: 'chatHistory', reason: 'read', scope: 'all' }));
    const p = createPermissions(); assert.throws(() => p.decide(request, 'all', () => {}));
    p.decide(request, 'deny', () => {});
    assert.equal(p.denied('source:chatHistory', A, 't1'), true);
    assert.equal(p.denied('source:chatHistory', A, 't2'), false);
    assert.equal(p.allows('source:chatHistory', A, 't1'), false);
});
test('Source revocation and legacy category revocation remove the intended source grants', () => {
    const p = createPermissions(); p.decide(request, 'chat', () => {});
    p.revoke('source:chatHistory', A); assert.equal(p.allows('source:chatHistory', A), false);
    p.decide(request, 'task', () => {}); p.revoke('extended', A);
    assert.equal(p.allows('source:chatHistory', A, 't1'), false);
});
test('Permission requests are not clarification drafts and can be consumed only once', () => {
    const s = createInteractionStore();
    const r = s.create({ target: A, sessionId: 's', taskId: 't', runId: 'r' }, { kind: 'permission', source: 'chatHistory', reason: 'read' });
    assert.throws(() => s.draft(r.id, 'yes'), /STALE/);
    s.resolve(r.id, 'granted'); assert.throws(() => s.resolve(r.id, 'granted'), /STALE/);
});
test('Assistant access distinguishes missing, denied, invalid, unavailable and forbidden', () => {
    const p = createPermissions(), read = { id: 'muyu.settings.read', effect: 'read' };
    const inspect = (definition, args, target = A) => assistantToolAccess(definition, args, target, 't1', p, null);
    assert.deepEqual(inspect(read, { fields: ['memoryMaxEntries'] }), { decision: 'permission_required', required: [], missingSources: ['source:memoryConfig'] });
    p.decide({ source: 'memoryConfig', reason: 'read', target: A, taskId: 't1' }, 'deny', () => {});
    assert.equal(inspect(read, { fields: ['memoryMaxEntries'] }).decision, 'user_denied');
    assert.equal(inspect(read, { fields: ['notAField'] }).decision, 'invalid_request');
    assert.equal(inspect({ ...read, effect: 'external' }, { fields: ['memoryMaxEntries'] }).decision, 'policy_forbidden');
    assert.equal(inspect({ id: 'muyu.memory.inspect', effect: 'read' }, {}, { kind: 'global', userKey: 'user' }).decision, 'target_unavailable');
});
