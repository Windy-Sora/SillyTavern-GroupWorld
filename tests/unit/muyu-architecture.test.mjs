import test from 'node:test';
import assert from 'node:assert/strict';
import { createToolRegistry } from '../../muyu/tools/registry.js';
import { createToolPlan } from '../../muyu/modules/tool-plan.js';
import { createArtifactOwners } from '../../muyu/modules/artifact-owners.js';
import { createApprovedActions } from '../../muyu/actions/coordinator.js';

const toolId = 'muyu.example.read';
function moduleWith(handler = () => ({ text: 'ok' })) {
    const registry = createToolRegistry();
    registry.register({ id: toolId, version: 1, description: 'Example read', inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
        outputSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 16 } }, required: ['text'], additionalProperties: false },
        scope: 'global', effect: 'read', dataClasses: [], confirmation: 'policy', resourceKeys: [], timeoutMs: 1000, retryPolicy: { kind: 'none', maxAttempts: 1 } });
    registry.seal();
    return { registry, handlers: handler ? { [toolId]: handler } : {} };
}
const capabilityFor = id => id === toolId ? { effect: 'read', sources: () => [] } : null;
const labels = { [toolId]: ['读取示例', 'Read example'] };

test('Tool plan binds a definition to its handler and explicit capability before a run', () => {
    const handler = () => ({ text: 'ok' });
    const plan = createToolPlan([{ id: 'example', module: moduleWith(handler) }], { capabilityFor, labels });
    assert.equal(plan.registry.get(toolId).effect, 'read');
    assert.equal(plan.handlers[toolId], handler);
    assert.equal(plan.ownerOf(toolId), 'example');
    assert.equal(Object.isFrozen(plan.handlers), true);
    assert.throws(() => plan.registry.register(plan.registry.get(toolId)), /sealed/i);
});

test('Tool plan fails closed on missing or inconsistent registration', () => {
    const entry = module => [{ id: 'example', module }];
    assert.throws(() => createToolPlan(entry(moduleWith(null)), { capabilityFor, labels }), /TOOL_HANDLER_MISMATCH/);
    assert.throws(() => createToolPlan(entry({ ...moduleWith(), handlers: { [toolId]: () => null, extra: () => null } }), { capabilityFor, labels }), /TOOL_HANDLER_MISMATCH/);
    assert.throws(() => createToolPlan(entry(moduleWith()), { capabilityFor: () => null, labels }), /TOOL_CAPABILITY_MISMATCH/);
    assert.throws(() => createToolPlan(entry(moduleWith()), { capabilityFor: () => ({ effect: 'external', sources: () => [] }), labels }), /TOOL_CAPABILITY_MISMATCH/);
    assert.throws(() => createToolPlan(entry(moduleWith()), { capabilityFor, labels: {} }), /TOOL_LABEL_MISSING/);
    assert.throws(() => createToolPlan(entry(moduleWith()), { capabilityFor, labels: { ...labels, unused: ['未用', 'Unused'] } }), /TOOL_LABEL_ORPHAN/);
    assert.throws(() => createToolPlan([entry(moduleWith())[0], entry(moduleWith())[0]], { capabilityFor, labels }), /INVALID_TOOL_MODULE/);
});

test('Artifact owner routing uses the producing tool, not a candidate ID prefix', () => {
    const called = [];
    const makeOwner = module => ({
        publishDraft(_app, runId, candidateId) { called.push([module, runId, candidateId]); return { id: module, revision: 1 }; },
        validateSaved(_app, id, revision) { assert.equal(id, module); assert.equal(revision, 1); return { id }; },
    });
    const owners = createArtifactOwners([
        { toolId: 'muyu.config.preview', moduleId: 'memory-config', owner: makeOwner('memory-config') },
        { toolId: 'muyu.settings.preview', moduleId: 'settings-config', owner: makeOwner('settings-config') },
    ]);
    const app = { getArtifact: () => ({ content: { module: 'settings-config' } }) };
    owners.publish(app, 'run-1', { toolId: 'muyu.config.preview', candidateId: 'settings:forged-prefix' });
    assert.deepEqual(called, [['memory-config', 'run-1', 'settings:forged-prefix']]);
    assert.deepEqual(owners.revalidate(app, 'settings-config', 1), { id: 'settings-config' });
    assert.throws(() => owners.publish(app, 'run-1', { toolId: 'muyu.unknown.preview', candidateId: 'candidate:1' }), /INVALID_CANDIDATE_SOURCE/);
    assert.throws(() => createArtifactOwners([{ toolId: 'muyu.config.preview', moduleId: 'memory-config', owner: makeOwner('one') },
        { toolId: 'muyu.config.preview', moduleId: 'other', owner: makeOwner('two') }]), /INVALID_ARTIFACT_OWNER/);
});

test('Multiple preview tools can share one owner/candidate group but cannot hijack its module', () => {
    const owner = { publishDraft() {}, validateSaved() {} };
    const owners = createArtifactOwners([{ toolId: 'muyu.provider.preview', moduleId: 'provider-asset', owner },
        { toolId: 'muyu.provider.remove_preview', moduleId: 'provider-asset', owner }]);
    assert.equal(owners.group('muyu.provider.remove_preview'), 'muyu.provider.preview');
    assert.throws(() => createArtifactOwners([{ toolId: 'muyu.provider.preview', moduleId: 'provider-asset', owner },
        { toolId: 'muyu.provider.remove_preview', moduleId: 'provider-asset', owner: { ...owner } }]), /INVALID_ARTIFACT_OWNER/);
});

test('A second action contract can reuse approval lifecycle without granting model write access', async () => {
    let executions = 0;
    const artifact = { id: 'asset', revision: 1, sessionId: 's', kind: 'example-draft', content: { value: 7 } };
    const actions = createApprovedActions({ getArtifact: () => structuredClone(artifact), getTarget: () => ({ kind: 'global', userKey: 'u' }),
        contract: { idPrefix: 'example:', matchesArtifact: value => value.kind === 'example-draft', validate: () => {},
            execute: async record => { executions++; assert.equal(record.content.value, 7); return { status: 'applied_confirmed' }; },
            resultStatus: result => result.status, notExecuted: () => false } });
    const pending = actions.prepare('asset', 1);
    assert.equal(executions, 0);
    assert.equal((await actions.approve(pending.id)).status, 'applied_confirmed');
    assert.equal(executions, 1);
    assert.throws(() => actions.approve(pending.id), /ACTION_STALE/);
});
