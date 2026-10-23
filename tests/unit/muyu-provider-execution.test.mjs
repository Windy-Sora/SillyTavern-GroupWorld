import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createMuyuController } from '../../muyu/application/controller.js';
import { createHostBridge } from '../../muyu/host/bridge.js';
import { CONTEXT_DEFAULTS } from '../../muyu/context/policy.js';
import { createProviderPort } from '../../muyu/host/providers.js';
import { createConfigWriter } from '../../muyu/host/config-write.js';
import { RUN_DEFAULTS } from '../../muyu/core/budget.js';
import { createPermissions } from '../../muyu/application/permissions.js';
import { createProviderModule } from '../../muyu/modules/providers/index.js';
import { createToolBroker } from '../../muyu/tools/broker.js';
import { assistantToolAccess } from '../../muyu/application/capabilities.js';
import { executionSource, validatePermission } from '../../muyu/permissions/contract.js';
import { scriptedModel, text, done, flush } from './helpers/muyu-subject.mjs';

const tool = (toolId, args = {}) => ({ type: 'tool_call_complete', call: { toolId, callId: crypto.randomUUID(), version: toolId === 'muyu.provider.execute' ? 2 : 1, args } });
const settle = async () => { for (let i = 0; i < 16; i++) await flush(); };
function fixture(stepsBuilder = null, historyAuthorization = 'ask') {
    let called = 0;
    const events = new EventEmitter(), ctx = { chatId: 'A', groupId: 'g', groups: [{ id: 'g', members: [] }], chat: [], chatMetadata: {}, eventSource: events, eventTypes: { CHAT_CHANGED: 'chat' } };
    const settings = {}, provider = { id: 'myNotes', placeholder: '{{myNotes}}', _gdOwner: 'group-director/user-provider', render: () => { called++; return { content: 'PRIVATE_PROVIDER_RESULT' }; } };
    let registered = [provider];
    const port = createProviderPort({ getContext: () => ctx, getSettings: () => settings, extensionKey: 'gd', getProviders: () => registered });
    const revision = port.discover()[0].revision;
    const ask = () => [tool('muyu.permission.request', { source: 'providerExecution', providerId: 'myNotes', providerRevision: revision, reason: 'Read my provider result' }), done];
    const run = () => [tool('muyu.provider.execute', { id: 'myNotes', revision }), done];
    const model = scriptedModel(stepsBuilder ? stepsBuilder({ ask, run }) : [ [tool('muyu.provider.discover'), done], ask(), run(), [text('summarized'), done], [text('followup'), done] ]);
    const host = createHostBridge({ getSettings: () => settings, getContext: () => ctx, extensionKey: 'gd', providerPort: port,
        contextConfig: { read: () => ({ ...CONTEXT_DEFAULTS, historyAuthorization }) }, // History approval never authorizes a new execution.
        configWriter: createConfigWriter({ getSettings: () => settings, saveSettings: async () => {} }) });
    const controller = createMuyuController({ host, createModel: () => model });
    return { controller, model, port, ctx, provider, revision, ask, run, called: () => called, replace(next) { registered = [next]; }, switch() { ctx.chatId = 'B'; events.emit('chat'); }, async enable() { await controller.configure({ endpoint: 'https://example.test', model: 'fake', apiKey: 'synthetic' }); await controller.saveRunConfig({ ...RUN_DEFAULTS, modelCalls: 16 }); } };
}

test('Registered user Provider is discovered without rendering and runs only after bound task approval', async () => {
    const f = fixture(); await f.enable(); const c = f.controller;
    c.setInput('use my provider'); c.send(); await settle();
    assert.equal(f.called(), 0); const request = c.snapshot().interaction;
    assert.equal(request.source, 'providerExecution'); assert.equal(request.providerId, 'myNotes'); assert.equal(request.providerRevision, f.revision);
    assert.throws(() => c.answerPermission(request.id, 'chat'), /INVALID_PERMISSION_DECISION/);
    c.answerPermission(request.id, 'task'); await settle();
    assert.equal(f.called(), 1); assert.equal(c.snapshot().runs.at(-1).status, 'succeeded');
    assert.ok(JSON.parse(c.exportHistory()).required.includes(`source:providerExecution:myNotes:${f.revision}`));
    c.setInput('followup'); assert.throws(() => c.send(), /HISTORY_PERMISSION_REQUIRED/);
    c.setOmitHistory(true); c.send(); await settle();
    assert.doesNotMatch(JSON.stringify(f.model.requests.at(-1)), /PRIVATE_PROVIDER_RESULT|summarized/);
    await c.dispose();
});

test('Full access executes an available registered Provider without an authorization handoff', async () => {
    const f = fixture(({ run }) => [run(), [text('done'), done]]); await f.enable();
    f.controller.setFullAccess(true); f.controller.setInput('run my provider'); f.controller.send(); await settle();
    assert.equal(f.called(), 1);
    assert.equal(f.controller.snapshot().interaction, null);
    assert.equal(f.model.requests.length, 2);
    await f.controller.dispose();
});

test('Automatic history never authorizes fresh Provider code execution', async () => {
    const f = fixture(({ ask, run }) => [[tool('muyu.provider.discover'), done], ask(), run(), [text('PROTECTED_PROVIDER_ANSWER'), done], ask(), [text('declined'), done]], 'auto');
    await f.enable(); const c = f.controller; c.setInput('first'); c.send(); await settle();
    c.answerPermission(c.snapshot().interaction.id, 'task'); await settle(); assert.equal(f.called(), 1);
    c.setInput('followup'); c.send(); await settle();
    assert.match(JSON.stringify(f.model.requests.at(-1)), /PROTECTED_PROVIDER_ANSWER/);
    assert.equal(c.snapshot().interaction.source, 'providerExecution'); assert.equal(f.called(), 1);
    c.answerPermission(c.snapshot().interaction.id, 'deny'); await settle(); assert.equal(f.called(), 1);
    await c.dispose();
});

test('Denied execution and replaced versions never call render; failed render does not expose error text', async () => {
    const f = fixture(); await f.enable(); const c = f.controller;
    c.setInput('use'); c.send(); await settle(); c.answerPermission(c.snapshot().interaction.id, 'deny'); await settle();
    assert.equal(f.called(), 0); assert.match(JSON.stringify(f.model.requests), /PERMISSION_DENIED/); await c.dispose();
    const g = fixture(); await g.enable(); g.controller.setInput('use'); g.controller.send(); await settle();
    g.replace({ ...g.provider }); assert.throws(() => g.controller.answerPermission(g.controller.snapshot().interaction.id, 'task'), /INTERACTION_STALE/);
    assert.equal(g.called(), 0); await g.controller.dispose();
    const h = fixture(); const version = h.revision;
    h.provider.render = () => { throw Error('SECRET_STACK'); };
    assert.equal(h.port.describe('myNotes', version), null);
    const fresh = h.port.discover()[0].revision;
    await assert.rejects(h.port.execute('myNotes', fresh), /OUTCOME_UNKNOWN/);
});

test('Provider port supports async user render and rejects stale registration after completion', async () => {
    const f = fixture(); let finish;
    f.provider.render = () => new Promise(resolve => { finish = resolve; });
    const revision = f.port.discover()[0].revision;
    const result = f.port.execute('myNotes', revision);
    f.replace({ ...f.provider }); finish({ content: 'should stay private' });
    await assert.rejects(result, /OUTCOME_UNKNOWN/);
});

test('History-only approval retains Provider answers without approving execution in a new task', async () => {
    const f = fixture(({ ask, run }) => [[tool('muyu.provider.discover'), done], ask(), run(), [text('PROTECTED_PROVIDER_ANSWER'), done], ask(), [text('followup'), done]]);
    await f.enable(); const c = f.controller; c.setInput('first'); c.send(); await settle(); c.answerPermission(c.snapshot().interaction.id, 'task'); await settle();
    c.setInput('followup'); assert.throws(() => c.send(), /HISTORY_PERMISSION_REQUIRED/);
    c.allowHistory(); c.send(); await settle();
    assert.match(JSON.stringify(f.model.requests.at(-1)), /PROTECTED_PROVIDER_ANSWER/);
    assert.equal(c.snapshot().interaction.source, 'providerExecution');
    assert.equal(f.called(), 1);
    c.answerPermission(c.snapshot().interaction.id, 'task'); await settle();
    assert.match(JSON.stringify(f.model.requests.at(-1)), /PROTECTED_PROVIDER_ANSWER/);
    assert.equal(f.called(), 1); await c.dispose();
});

test('Execution grants bind exact Provider/version/task and reject persistent approval', () => {
    const p = createPermissions(), target = { kind: 'chat', userKey: 'u', chatKey: 'c' };
    const request = { source: 'providerExecution', reason: 'specific script', providerId: 'first', providerRevision: crypto.randomUUID(), target, taskId: 'task' };
    assert.throws(() => validatePermission({ source: 'providerExecution', reason: 'missing binding' }), /INVALID_PERMISSION_REQUEST/);
    assert.throws(() => validatePermission({ source: 'variables', reason: 'wrong binding', providerId: 'first', providerRevision: request.providerRevision }), /INVALID_PERMISSION_REQUEST/);
    assert.throws(() => p.decide(request, 'chat', () => {}), /INVALID_PERMISSION_DECISION/);
    p.decide(request, 'task', () => {});
    assert.equal(p.allows(executionSource('first', request.providerRevision), target, 'task'), true);
    assert.equal(p.allows(executionSource('second', request.providerRevision), target, 'task'), false);
    assert.equal(p.allows(executionSource('first', crypto.randomUUID()), target, 'task'), false);
    assert.equal(p.allows(executionSource('first', request.providerRevision), { ...target, chatKey: 'other' }, 'task'), false);
    assert.equal(p.allows(executionSource('first', request.providerRevision), target, 'next-task'), false);
    p.forgetTask(target, 'task'); assert.equal(p.allows(executionSource('first', request.providerRevision), target, 'task'), false);
});

test('Legacy broad diagnostics authorization never exposes the external execute tool', async () => {
    const f = fixture(({ run }) => [run(), [text('not executed'), done]]);
    await f.enable(); const c = f.controller;
    c.setMode('chat'); c.grantPermission('chat'); c.grantPermission('diagnostics');
    c.setInput('execute'); c.send(); await settle();
    assert.equal(f.called(), 0); assert.match(JSON.stringify(f.model.requests), /PERMISSION_DENIED|UNSUPPORTED_CAPABILITY/);
    await c.dispose();
});

test('Generic render receives bounded current-chat context and can run unmodified legacy functions', async () => {
    const ctx = { groupId: 'g', groups: [{ id: 'g', members: ['a.png'] }], chat: [{ name: 'Alice', mes: 'hello', is_user: false }] };
    const provider = { id: 'legacySample', placeholder: '{{legacySample}}', render: input => ({ content: `${input.recentMessages[0].mes}/${input.enabledMembers[0]}`, data: { count: input.recentMessages.length } }) };
    const port = createProviderPort({ getContext: () => ctx, getSettings: () => ({}), extensionKey: 'gd', getProviders: () => [provider] });
    const descriptor = port.discover()[0];
    assert.equal(await port.execute(descriptor.id, descriptor.revision), 'hello/a.png');
    assert.equal(await port.execute(descriptor.id, descriptor.revision, undefined, 'data'), '{"count":1}');
});

test('Imported source revision survives reload; changed source and live instance replacement do not reuse an in-flight result', async () => {
    const digest = 'a'.repeat(64), changed = 'b'.repeat(64);
    const digests = new WeakMap();
    const make = value => { const provider = { id: 'userScript', placeholder: '{{userScript}}', _gdOwner: 'group-director/user-provider', render: () => ({ content: 'ok' }) }; digests.set(provider, value); return provider; };
    let registered = [make(digest)];
    const create = () => createProviderPort({ getContext: () => ({ chat: [] }), getSettings: () => ({}), extensionKey: 'gd', getProviders: () => registered, trustedDigest: p => digests.get(p) });
    const first = create(), revision = first.discover()[0].revision;
    assert.equal(revision, digest + '-0');
    const permissions = createPermissions(), target = { kind: 'chat', userKey: 'u', chatKey: 'A' };
    permissions.decide({ source: 'providerExecution', reason: 'same uploaded source', providerId: 'userScript', providerRevision: revision, target, taskId: 'task' }, 'task', () => {});
    assert.equal(permissions.allows(executionSource('userScript', revision), target, 'task'), true);
    registered = [make(digest)];
    assert.equal(create().discover()[0].revision, revision);
    registered = [make(changed)];
    assert.equal(create().discover()[0].revision, changed + '-0');
    let finish;
    registered = [make(digest)];
    registered[0].render = () => new Promise(resolve => { finish = resolve; });
    const port = create(), pending = port.execute('userScript', port.discover()[0].revision);
    registered = [make(digest)];
    finish({ content: 'old instance' });
    await assert.rejects(pending, /OUTCOME_UNKNOWN/);
});

test('Provider result pages read one execution only and stay bound to its run and chat', async () => {
    let calls = 0;
    const target = { kind: 'chat', userKey: 'u', chatKey: 'A' };
    let currentTarget = target;
    const host = { currentTarget: () => currentTarget, providerPort: {
        describe: () => ({ id: 'long' }),
        execute: async () => { calls++; return 'x'.repeat(9000) + '🔍' + 'y'.repeat(1000); },
    } };
    const module = createProviderModule(host);
    module.bindRun('run1', 24000);
    const ctx = { runId: 'run1', target };
    const first = await module.handlers['muyu.provider.execute']({ id: 'long', revision: 'r1' }, ctx);
    assert.equal(first.status, 'ok'); assert.equal(first.nextOffset, 8000);
    const second = module.handlers['muyu.provider.result']({ id: 'long', revision: 'r1', resultId: first.resultId, offset: first.nextOffset }, ctx);
    assert.equal(first.text + second.text, 'x'.repeat(9000) + '🔍' + 'y'.repeat(1000));
    assert.equal(calls, 1);
    assert.equal(module.handlers['muyu.provider.result']({ id: 'long', revision: 'r1', resultId: first.resultId, offset: 8000 }, { ...ctx, runId: 'run2' }).status, 'RESULT_UNAVAILABLE');
    currentTarget = { ...target, chatKey: 'B' };
    assert.equal(module.handlers['muyu.provider.result']({ id: 'long', revision: 'r1', resultId: first.resultId, offset: 8000 }, ctx).status, 'TARGET_UNAVAILABLE');
    module.forgetRun('run1'); module.dispose();
});

test('Broker checks the same exact execution grant before reading a stored result page', async () => {
    const target = { kind: 'chat', userKey: 'u', chatKey: 'A' }, revision = crypto.randomUUID();
    let calls = 0;
    const host = { currentTarget: () => target, providerPort: { describe: () => ({ missingContext: [] }), execute: async () => { calls++; return 'z'.repeat(9000); } } };
    const module = createProviderModule(host), permissions = createPermissions(), runId = 'one';
    module.bindRun(runId, 24000);
    const broker = createToolBroker({ registry: module.registry, handlers: module.handlers, runId, target, signal: new AbortController().signal,
        allowedTools: ['muyu.provider.execute', 'muyu.provider.result'], externalTools: ['muyu.provider.execute'],
        policy: ({ definition, args, target }) => assistantToolAccess(definition, args, target, 'task', permissions, host.providerPort).decision });
    const call = (toolId, version, args) => broker.call({ toolId, callId: crypto.randomUUID(), version, args });
    assert.equal((await call('muyu.provider.execute', 2, { id: 'long', revision })).error.code, 'PERMISSION_REQUIRED');
    permissions.decide({ source: 'providerExecution', reason: 'run this script', providerId: 'long', providerRevision: revision, target, taskId: 'task' }, 'task', () => {});
    const first = await call('muyu.provider.execute', 2, { id: 'long', revision });
    assert.equal(first.ok, true);
    const page = await call('muyu.provider.result', 1, { id: 'long', revision, resultId: first.data.resultId, offset: first.data.nextOffset });
    assert.equal(page.ok, true); assert.equal(page.data.text.length, 1000); assert.equal(calls, 1);
    assert.equal((await call('muyu.provider.result', 1, { id: 'other', revision, resultId: first.data.resultId, offset: 8000 })).error.code, 'PERMISSION_REQUIRED');
    module.dispose();
});

test('Provider context declaration reports unavailable fields and supplies bounded extra context', async () => {
    const ctx = { groupId: 'g', groups: [{ id: 'g', members: [] }], chat: Array.from({ length: 205 }, (_, i) => ({ name: 'A', mes: String(i) })) };
    const provider = { id: 'contextScript', placeholder: '{{contextScript}}', muyuContext: ['chatMessages'], render: input => ({ content: `${input.chatMessages.length}:${input.chatMessages[0].mes}:${input.chatMessagesLimited}` }) };
    const port = createProviderPort({ getContext: () => ctx, getSettings: () => ({}), extensionKey: 'gd', getProviders: () => [provider] });
    const found = port.discover()[0];
    assert.deepEqual(found.context, ['chatMessages']); assert.deepEqual(found.missingContext, []);
    assert.equal(await port.execute(found.id, found.revision), '200:5:true');
    provider.muyuContext = ['characterCard'];
    assert.deepEqual(port.discover()[0].missingContext, ['characterCard']);
    await assert.rejects(port.execute(found.id, port.discover()[0].revision), /CONTEXT_UNAVAILABLE/);
});
