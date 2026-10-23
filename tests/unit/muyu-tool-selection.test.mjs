import test from 'node:test';
import assert from 'node:assert/strict';
import { createToolSelection } from '../../muyu/tools/selection.js';
import { createToolRegistry } from '../../muyu/tools/registry.js';
import { createToolBroker } from '../../muyu/tools/broker.js';
import { ExecutionError } from '../../muyu/core/execution.js';
import { createToolboxModule } from '../../muyu/modules/toolbox.js';
import { startMuyuRun } from '../../muyu/composition.js';
import { identity, request, text, done, scriptedModel } from './helpers/muyu-subject.mjs';

function registry(extraIds = []) {
    const r = createToolRegistry();
    for (const d of createToolboxModule().registry.list()) r.register(d);
    for (const group of ['skills', 'prompts', 'agents']) for (let i = 0; i < 25; i++) r.register({ id: `muyu.${group}.tool_${i}`, version: 1, description: 'Synthetic optional tool', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, outputSchema: { type: 'integer' }, scope: 'global', effect: 'read', dataClasses: ['synthetic'], confirmation: 'policy', resourceKeys: [], timeoutMs: 1000, retryPolicy: { kind: 'none', maxAttempts: 1 } });
    for (const id of extraIds) r.register({ id, version: 1, description: 'Synthetic draft or read tool', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, outputSchema: { type: 'integer' }, scope: 'global', effect: 'read', dataClasses: ['synthetic'], confirmation: 'policy', resourceKeys: [], timeoutMs: 1000, retryPolicy: { kind: 'none', maxAttempts: 1 } });
    r.seal(); return r;
}
const call = (id, toolId, args = {}) => request({ callId: id, toolId, version: 1, args });
const draftIds = ['muyu.settings.preview', 'muyu.task.preview', 'muyu.profile.preview'];
test('Large catalogs defer draft schemas but keep configuration discovery/read/contract visible and allowlists exact', () => {
    const readIds = ['muyu.settings.catalog', 'muyu.settings.read', 'muyu.settings.contract', 'muyu.config.preview', 'muyu.variables.preview'];
    const r = registry([...draftIds, ...readIds]);
    const selector = createToolSelection(r.list(), r.list().map(d => d.id));
    assert.ok(readIds.every(id => selector.select().some(d => d.id === id)));
    assert.ok(draftIds.every(id => !selector.select().some(d => d.id === id)));
    assert.deepEqual(selector.list().groups.find(g => g.id === 'config-drafts').tools, draftIds);
    assert.ok(draftIds.every(id => selector.select(['config-drafts']).some(d => d.id === id)));
    const limited = createToolSelection(r.list(), r.list().map(d => d.id).filter(id => id !== 'muyu.task.preview'));
    assert.ok(!limited.select(['config-drafts']).some(d => d.id === 'muyu.task.preview'));
    const small = createToolSelection(r.list(), ['muyu.tools.list', 'muyu.tools.select', ...draftIds]);
    assert.equal(small.enabled, false); assert.equal(small.select().length, 5);
});
test('Loading the draft group does not approve a draft operation or bypass runtime policy', async () => {
    const r = registry(draftIds); let executions = 0;
    const model = scriptedModel([
        [call('directory', 'muyu.tools.list'), done],
        [call('select', 'muyu.tools.select', { groups: ['config-drafts'] }), done],
        [call('preview', 'muyu.settings.preview'), done],
        [text('Permission denied, no draft created.'), done],
    ]);
    const handle = startMuyuRun({ identity, input: 'Preview only', registry: r, allowedTools: r.list().map(d => d.id), model,
        handlers: { 'muyu.settings.preview': () => { executions++; return 1; } }, policy: p => !draftIds.includes(p.definition.id) });
    assert.equal((await handle.completion).state.status, 'succeeded'); assert.equal(executions, 0);
    assert.ok(!model.requests[0].tools.some(d => d.id === 'muyu.settings.preview'));
    assert.ok(model.requests[2].tools.some(d => d.id === 'muyu.settings.preview'));
    assert.equal(model.requests[3].messages.find(m => m.role === 'tool' && m.callId === 'preview').result.error.code, 'PERMISSION_DENIED');
    const selected = model.requests[2].messages.find(m => m.role === 'tool' && m.callId === 'select').result.data;
    assert.equal(JSON.parse(selected.text).permissionGranted, false);
});
test('Tool directory advertises discovery before denying unloaded Skill management without conferring permission', () => {
    const definition = createToolboxModule().registry.list().find(tool => tool.id === 'muyu.tools.list');
    assert.match(definition.description, /unselected, not unsupported/);
    assert.match(definition.description, /BEFORE denying a capability/);
    assert.match(definition.description, /NOT the whole management API/);
    assert.match(definition.description, /not permission/);
});
test('Tool selection makes every optional group reachable without truncating or granting permission', () => {
    const r = registry(), selector = createToolSelection(r.list(), r.list().map(d => d.id));
    assert.equal(selector.enabled, true); assert.equal(selector.select().length, 2);
    assert.equal(selector.list().groups.flatMap(g => g.tools).length, 75);
    for (const group of selector.list().groups) assert.equal(selector.select([group.id]).length, 27);
    assert.throws(() => selector.select(['skills', 'prompts', 'agents']), /TOOL_GROUP_CAPACITY/);
    assert.throws(() => selector.select(['skills', 'skills']), /INVALID_TOOL_GROUP/);
    assert.throws(() => selector.select(['missing']), /INVALID_TOOL_GROUP/);
    assert.equal(selector.select(['skills']).some(d => d.id.startsWith('muyu.prompts.')), false);
});
test('Tool selection preserves small toolsets and cannot expose tools absent from allowlist', () => {
    const r = registry(), tools = ['muyu.tools.list', 'muyu.tools.select', 'muyu.skills.tool_0'];
    const selector = createToolSelection(r.list(), tools);
    assert.equal(selector.enabled, false); assert.equal(selector.select().length, 3);
    assert.throws(() => selector.select(['prompts']), /INVALID_TOOL_GROUP/);
});
test('Runtime tool group selection applies to next request, replaces groups and preserves policy checks', async () => {
    const r = registry(); let calls = 0;
    const model = scriptedModel([
        [call('select1', 'muyu.tools.select', { groups: ['skills'] }), done],
        [call('read', 'muyu.skills.tool_0'), done],
        [call('select2', 'muyu.tools.select', { groups: ['prompts'] }), done],
        [call('hidden', 'muyu.skills.tool_0'), done],
        [text('Finished'), done],
    ]);
    const handle = startMuyuRun({ identity, input: 'Use tools', registry: r, handlers: { 'muyu.skills.tool_0': () => { calls++; return 1; } }, allowedTools: r.list().map(d => d.id), policy: p => !p.definition.id.startsWith('muyu.skills.'), model });
    const result = await handle.completion;
    assert.equal(result.state.status, 'succeeded'); assert.equal(calls, 0);
    assert.equal(model.requests[0].tools.length, 2); assert.equal(model.requests[1].tools.length, 27);
    assert.ok(model.requests[3].tools.every(d => !d.id.startsWith('muyu.skills.')));
    assert.equal(model.requests[2].messages.find(m => m.role === 'tool' && m.callId === 'read').result.error.code, 'PERMISSION_DENIED');
});
test('Runtime rejects mixed selection and host operations before executing either', async () => {
    const r = registry(); let calls = 0;
    const model = scriptedModel([[call('select', 'muyu.tools.select', { groups: ['skills'] }), call('read', 'muyu.skills.tool_0'), done], [text('Finished'), done]]);
    const handle = startMuyuRun({ identity, input: 'Use tools', registry: r, handlers: { 'muyu.skills.tool_0': () => { calls++; return 1; } }, allowedTools: r.list().map(d => d.id), policy: () => true, model });
    assert.equal((await handle.completion).state.status, 'succeeded'); assert.equal(calls, 0);
    assert.equal(model.requests[1].tools.length, 2);
    assert.ok(model.requests[1].messages.filter(m => m.role === 'tool').every(m => m.result.error.code === 'INVALID_ARGUMENT'));
});

for (const groups of [['missing'], ['skills', 'skills'], ['skills', 'prompts', 'agents']]) test(`Invalid selection ${groups.join('/')} gives safe correction guidance and preserves visible tools`, async () => {
    const r = registry(), model = scriptedModel([
        [call('load', 'muyu.tools.select', { groups: ['skills'] }), done],
        [call('invalid', 'muyu.tools.select', { groups }), done],
        [call('corrected', 'muyu.tools.select', { groups: ['prompts'] }), done],
        [text('Finished'), done],
    ]);
    const result = await startMuyuRun({ identity, input: 'Use tools', registry: r, allowedTools: r.list().map(d => d.id), policy: () => true, model }).completion;
    assert.equal(result.state.status, 'succeeded');
    const failed = model.requests[2].messages.find(m => m.role === 'tool' && m.callId === 'invalid').result;
    assert.equal(failed.error.code, 'INVALID_ARGUMENT'); assert.equal(failed.error.retryable, false);
    assert.equal(failed.effectState, 'not_started'); assert.match(failed.error.message, /muyu.tools.list/);
    assert.deepEqual(model.requests[2].tools, model.requests[1].tools);
    assert.ok(model.requests[3].tools.some(d => d.id.startsWith('muyu.prompts.')));
    assert.ok(model.requests[3].tools.every(d => !d.id.startsWith('muyu.skills.')));
});

test('Repeated invalid selections consume correction budget rather than generic execution retries', async () => {
    const r = registry(), model = scriptedModel(Array.from({ length: 3 }, (_, i) => [call(`invalid${i}`, 'muyu.tools.select', { groups: ['missing'] }), done]));
    const result = await startMuyuRun({ identity, input: 'Use tools', registry: r, allowedTools: r.list().map(d => d.id), policy: () => true, model, limits: { corrections: 2 } }).completion;
    assert.equal(result.error, 'BUDGET_EXCEEDED'); assert.equal(model.requests.length, 3);
    assert.equal(result.budget.reason, 'corrections'); assert.equal(result.budget.corrections, 3);
    assert.equal(result.messages.filter(m => m.role === 'tool' && m.result.error?.code === 'INVALID_ARGUMENT').length, 3);
});

test('Selection error disclosure is restricted to typed errors from the selection tool', async () => {
    const r = registry(), controller = new AbortController();
    for (const [toolId, error] of [['muyu.tools.select', Error('INVALID_TOOL_GROUP secret')], ['muyu.skills.tool_0', new ExecutionError('INVALID_TOOL_GROUP')], ['muyu.tools.select', new ExecutionError('UNEXPECTED_SECRET')]]) {
        const broker = createToolBroker({ registry: r, handlers: { [toolId]: () => { throw error; } }, runId: 'test', target: identity.target, allowedTools: [toolId], policy: () => true, signal: controller.signal });
        const result = await broker.call({ callId: 'error', toolId, version: 1, args: toolId === 'muyu.tools.select' ? { groups: [] } : {} });
        assert.deepEqual(result, { ok: false, error: { code: 'TOOL_FAILED', message: 'TOOL_FAILED', retryable: false }, effectState: 'unknown' });
    }
});
