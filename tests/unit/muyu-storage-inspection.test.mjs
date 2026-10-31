import test from 'node:test';
import assert from 'node:assert/strict';
import { createStorageInspectionPort } from '../../muyu/host/storage-inspection.js';
import { createStorageInspectionModule } from '../../muyu/modules/storage-inspection/index.js';
import { createAgentMemoryPort } from '../../muyu/host/agent-memory.js';
import { createAgentMemoryModule } from '../../muyu/modules/agent-memory/index.js';
import { createHostBridge } from '../../muyu/host/bridge.js';
import { createBuiltins } from '../../muyu/modules/builtins.js';
import { createPermissions } from '../../muyu/application/permissions.js';
import { assistantToolAccess, requiredSources } from '../../muyu/application/capabilities.js';
import { readSourceAllowed } from '../../muyu/permissions/read-policy.js';
import { createToolBroker } from '../../muyu/tools/broker.js';
import { deferred } from './helpers/muyu-subject.mjs';

const target = { kind: 'chat', userKey: 'page:test', chatKey: 'A' };
const identity = { id: 'run', taskId: 'task', target };
const ctx = () => ({ runId: identity.id, target, signal: new AbortController().signal });
function fixture({ charge = () => true, notes, metadata = { gd: { summaries: [{ content: 'old summary', active: false }, { content: 'latest summary', active: true }] } } } = {}) {
    let settings = { summaryEnabled: false }, current = target;
    const context = { chatMetadata: metadata };
    const port = createStorageInspectionPort({ getContext: () => context, getSettings: () => settings, getTarget: () => current, extensionKey: 'gd', agentMemory: notes });
    const module = createStorageInspectionModule({ port, charge }); module.bindRun(identity);
    return { module, port, context, get settings() { return settings; }, replace(value) { settings = value; }, switch(value) { current = value; },
        call: (operation, args) => module.handlers['muyu.storage.' + operation](args, ctx()) };
}
const body = result => { assert.equal(result.status, 'ok'); return JSON.parse(result.text); };

test('disabled summaries remain readable as management observations, including inactive records, without writes or metadata initialization', async () => {
    const f = fixture(), before = JSON.stringify([f.settings, f.context]);
    const list = body(await f.call('list', { resource: 'summaries' }));
    assert.equal(list.runtimeEnabled, false); assert.equal(list.persistence, 'unknown'); assert.equal(list.kind, 'directory');
    assert.deepEqual(list.items.map(item => item.active), [false, true]); assert.equal(JSON.stringify(list).includes('latest summary'), false);
    const read = body(await f.call('read', { resource: 'summaries', id: list.items[0].id, revision: list.revision }));
    assert.equal(read.text, 'old summary'); assert.equal(read.complete, true);
    assert.equal(JSON.stringify([f.settings, f.context]), before);
    f.context.chatMetadata = {};
    assert.equal(body(await f.call('list', { resource: 'summaries' })).total, 0); assert.deepEqual(f.context.chatMetadata, {});
});

test('management uses real note identity and scope filtering while normal use and model writes remain disabled', async () => {
    const settings = { muyuAgentMemoryEnabled: false }; let current = target, writes = 0;
    const notes = createAgentMemoryPort({ getAccount: async () => ({ enabled: false }), getSettings: () => settings, getTarget: () => current, saveSettings: async () => { writes++; } });
    await notes.save({ title: 'account note', content: 'global preference', scope: 'account' }, { target });
    await notes.save({ title: 'chat A', content: 'local preference', scope: 'chat' }, { target });
    current = { ...target, chatKey: 'B' };
    await notes.save({ title: 'chat B', content: 'OTHER_CHAT_SECRET', scope: 'chat' }, { target: current }); current = target;
    const before = JSON.stringify(settings), initialWrites = writes, f = fixture({ notes });
    const list = body(await f.call('list', { resource: 'notes' }));
    assert.equal(list.runtimeEnabled, false); assert.equal(list.total, 2); assert.doesNotMatch(JSON.stringify(list), /OTHER_CHAT|preference/);
    const note = body(await f.call('read', { resource: 'notes', id: list.items[0].id, revision: list.revision })); assert.equal(note.text, 'global preference');
    const normal = createAgentMemoryModule({ port: notes }); normal.bindRun(identity, { userQuestion: '记住：new' });
    assert.equal((await normal.handlers['muyu.notes.list']({ query: '', offset: 0 }, ctx())).status, 'disabled');
    assert.equal((await normal.handlers['muyu.notes.remember']({ quote: 'new', scope: 'chat' }, ctx())).status, 'disabled');
    assert.equal(writes, initialWrites); assert.equal(JSON.stringify(settings), before);
});

test('directory pagination requires the same revision and never exposes bodies', async () => {
    const f = fixture({ metadata: { gd: { summaries: Array.from({ length: 10 }, (_, i) => ({ content: 'SECRET_BODY_' + i, active: i === 9 })) } } });
    const first = body(await f.call('list', { resource: 'summaries' })); assert.equal(first.items.length, 8); assert.equal(first.nextOffset, 8);
    assert.equal((await f.call('list', { resource: 'summaries', offset: 8 })).status, 'stale_source');
    const next = body(await f.call('list', { resource: 'summaries', offset: 8, revision: first.revision })); assert.equal(next.complete, true); assert.equal(next.items.length, 2);
    assert.doesNotMatch(JSON.stringify([first, next]), /SECRET_BODY/);
    f.context.chatMetadata.gd.summaries.unshift({ content: 'new', active: false });
    assert.equal((await f.call('list', { resource: 'summaries', offset: 8, revision: first.revision })).status, 'stale_source');
});

test('body pagination preserves surrogate pairs and rejects changed/replaced records and invalid offsets', async () => {
    const f = fixture(); f.context.chatMetadata.gd.summaries[0].content = 'a'.repeat(1999) + '🦉' + 'tail';
    const list = body(await f.call('list', { resource: 'summaries' }));
    const args = { resource: 'summaries', id: 'summary:0', revision: list.revision };
    const first = body(await f.call('read', args)); assert.equal(first.nextOffset, 1999);
    const next = body(await f.call('read', { ...args, offset: first.nextOffset })); assert.equal(first.text + next.text, f.context.chatMetadata.gd.summaries[0].content);
    assert.equal((await f.call('read', { ...args, offset: 2000 })).status, 'invalid_offset');
    assert.equal((await f.call('read', { ...args, offset: 9999 })).status, 'invalid_offset');
    assert.equal((await f.call('read', { ...args, id: 'missing' })).status, 'not_found');
    f.context.chatMetadata.gd.summaries[0].content += '!'; assert.equal((await f.call('read', args)).status, 'stale_source');
    const fresh = body(await f.call('list', { resource: 'summaries' }));
    f.replace({ ...f.settings }); assert.equal((await f.call('read', { ...args, revision: fresh.revision })).status, 'stale_source');
});

for (const reason of ['target', 'forget', 'dispose', 'abort']) test('pending inspection cannot deliver after ' + reason, async () => {
    const wait = deferred(), started = deferred(); let charged = 0;
    const f = fixture({ notes: { list: async () => { started.resolve(); await wait.promise; return []; }, enabled: () => false }, charge: () => { charged++; return true; } });
    const abort = new AbortController(), callCtx = { ...ctx(), signal: abort.signal }; const work = f.module.handlers['muyu.storage.list']({ resource: 'notes' }, callCtx); await started.promise;
    if (reason === 'target') f.switch({ ...target, chatKey: 'B' });
    if (reason === 'forget') f.module.forgetRun(identity.id);
    if (reason === 'dispose') f.module.dispose();
    if (reason === 'abort') abort.abort();
    wait.resolve();
    if (reason === 'abort') await assert.rejects(work);
    else assert.notEqual((await work).status, 'ok');
    assert.equal(charged, 0);
});

test('budget refusal returns no partial body and charges the serialized UTF-8 result', async () => {
    let bytes = 0; const f = fixture({ charge: (_id, value) => { bytes = value; return false; } });
    assert.deepEqual(await f.call('list', { resource: 'summaries' }), { status: 'budget_exceeded', text: '' }); assert.ok(bytes > 0);
    const charges = [], yes = fixture({ charge: (_id, value) => { charges.push(value); return true; } });
    const value = await yes.call('list', { resource: 'summaries' }); assert.deepEqual(charges, [new TextEncoder().encode(JSON.stringify(value)).length]);
});

test('missing or malformed resources are not reported as an empty repository', async () => {
    const f = fixture(); assert.equal((await f.call('list', { resource: 'notes' })).status, 'unavailable');
    f.context.chatMetadata = null; assert.equal((await f.call('list', { resource: 'summaries' })).status, 'unavailable');
    f.context.chatMetadata = { gd: { summaries: [{ content: 42, active: true }] } }; assert.equal((await f.call('list', { resource: 'summaries' })).status, 'unsupported');
});

test('management grants are resource-specific, honor denial and are never implied by self-configuration consent', () => {
    const f = fixture(), definition = f.module.registry.get('muyu.storage.list');
    const permissions = createPermissions({ readAccess: () => false, fullAccess: () => false });
    permissions.grantSource('source:muyuSelfConfig', target);
    for (const [resource, source] of [['notes', 'muyuNoteStorage'], ['summaries', 'chatSummaryStorage']]) {
        assert.deepEqual(requiredSources(definition.id, { resource }), ['source:' + source]); assert.equal(readSourceAllowed('source:' + source), true);
        assert.equal(assistantToolAccess(definition, { resource }, target, identity.taskId, permissions).decision, 'permission_required');
        permissions.grantSource('source:' + source, target);
        assert.equal(assistantToolAccess(definition, { resource }, target, identity.taskId, permissions).decision, true);
        permissions.decide({ source, reason: 'test', target, taskId: identity.taskId }, 'deny', () => {});
        assert.equal(assistantToolAccess(definition, { resource }, target, identity.taskId, permissions).decision, 'user_denied');
    }
    assert.equal(assistantToolAccess(definition, { resource: 'summaries' }, { kind: 'global', userKey: target.userKey }, identity.taskId, permissions).decision, 'target_unavailable');
});

test('read-only schema rejects write operations before entering the port', async () => {
    const f = fixture(), broker = createToolBroker({ registry: f.module.registry, handlers: f.module.handlers, runId: identity.id, target, allowedTools: ['muyu.storage.list'], maxCalls: 5, signal: ctx().signal, policy: () => true });
    for (const [i, args] of [{ resource: 'notes', enabled: true }, { resource: 'summaries', changes: {} }, { resource: 'archives' }].entries()) {
        const result = await broker.call({ toolId: 'muyu.storage.list', version: 1, callId: 'bad' + i, args }); assert.equal(result.ok, false); assert.equal(result.error.code, 'INVALID_ARGUMENT');
    }
});

test('summary denial cannot be bypassed through the other reader, while approvals remain separate', () => {
    for (const [deniedSource, other] of [['chatSummary', 'chatSummaryStorage'], ['chatSummaryStorage', 'chatSummary']]) {
        const permissions = createPermissions({ readAccess: () => true, fullAccess: () => false });
        permissions.grantSource('source:' + other, target);
        permissions.decide({ source: deniedSource, reason: 'no summary text', target, taskId: identity.taskId }, 'deny', () => {});
        assert.equal(permissions.denied('source:' + other, target, identity.taskId), true);
        assert.equal(permissions.allows('source:' + other, target, identity.taskId), false);
    }
    const permissions = createPermissions({ readAccess: () => false, fullAccess: () => false });
    permissions.grantSource('source:chatSummary', target);
    assert.equal(permissions.allows('source:chatSummaryStorage', target, identity.taskId), false);
});

test('summary inspection honors the injected compatibility key and does not claim global or unsupported metadata is empty', async () => {
    const owner = { summaryEnabled: false }, metadata = { compatibilityKey: { summaries: [{ active: true, content: 'correct key' }] }, gd: { summaries: [{ active: true, content: 'wrong key' }] } };
    const port = createStorageInspectionPort({ getContext: () => ({ chatMetadata: metadata }), getSettings: () => owner, getTarget: () => target, extensionKey: 'compatibilityKey' });
    assert.equal((await port.snapshot('summaries', target)).items[0].text, 'correct key');
    await assert.rejects(port.snapshot('summaries', { kind: 'global', userKey: target.userKey }), /STORAGE_CONTEXT_REQUIRED/);
    metadata.compatibilityKey = 'damaged'; await assert.rejects(port.snapshot('summaries', target), /STORAGE_UNSUPPORTED/);
});

test('assembly provides an optional read-only group without any service plugin and preserves run revisions across permission continuations', async () => {
    const settings = {}, context = { groupId: 'g', chatId: 'A', chatMetadata: {} };
    const host = createHostBridge({ getContext: () => context, getSettings: () => settings, extensionKey: 'gd' });
    const absent = createBuiltins({ ...host, storageInspection: undefined }); assert.equal(absent.registry.get('muyu.storage.list'), null); absent.dispose();
    const builtins = createBuiltins(host), bound = { ...identity, target: host.currentTarget() };
    builtins.tasks.assistant.bind(bound, {}); builtins.bindBudget(bound.id, 6000);
    const first = body(await builtins.handlers['muyu.storage.list']({ resource: 'summaries' }, { ...ctx(), target: bound.target }));
    assert.equal(builtins.toolGroups['muyu.storage.list'].id, 'storage-inspection'); assert.equal(builtins.candidateTool('muyu.storage.list'), false);
    const next = { ...bound, id: 'next' }; builtins.transferRun(bound.id, next, {}); builtins.bindBudget(next.id, 6000, bound.id);
    const again = body(await builtins.handlers['muyu.storage.list']({ resource: 'summaries', revision: first.revision }, { ...ctx(), target: bound.target, runId: 'next' }));
    assert.equal(again.revision, first.revision); builtins.dispose();
});
