import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderPort } from '../../muyu/host/providers.js';
import { createProviderModule } from '../../muyu/modules/providers/index.js';
import { validateJson } from '../../muyu/core/json-contract.js';
import { createToolBroker } from '../../muyu/tools/broker.js';
import { createPermissions } from '../../muyu/application/permissions.js';
import { assistantToolAccess, requiredSources } from '../../muyu/application/capabilities.js';
import { executionSource } from '../../muyu/permissions/contract.js';
import { createHostBridge } from '../../muyu/host/bridge.js';
import { createMuyuController } from '../../muyu/application/controller.js';
import { scriptedModel, done, text } from './helpers/muyu-subject.mjs';

function fixture(limit = 24000) {
    const target = { kind: 'chat', userKey: 'u', chatKey: 'A' }; let current = target, executions = 0;
    const ctx = { chat: [{ name: 'Alice', mes: '金币规则：每次任务奖励10金币。', is_user: false }], characters: [{ avatar: 'a.png', name: 'Alice' }], chatMetadata: { gd: { charMemories: { 'a.png': [{ event: '金币来自任务奖励', mood: 'happy' }, { event: '去了北方', mood: 'calm' }] } } } };
    const bindings = ['recentMessages', 'charMemory'].map(id => ({ id, render() { throw Error('Do not execute'); } }));
    const port = createProviderPort({ getContext: () => ctx, getSettings: () => ({}), extensionKey: 'gd', bindings, getProviders: () => bindings });
    const revision = crypto.randomUUID();
    const host = { currentTarget: () => current, providerPort: { ...port, describe: () => ({ missingContext: [] }), execute: async () => { executions++; return 'x'.repeat(10000) + '金币来自隐藏奖励' + 'y'.repeat(1000); } } };
    const module = createProviderModule(host); module.bindRun('r', limit);
    const context = { runId: 'r', target };
    const call = (name, args, extra = {}) => {
        const result = module.handlers[name](args, { ...context, ...extra });
        if (!result?.then) validateJson(module.registry.get(name).outputSchema, result);
        return result;
    };
    const search = (args = {}, extra) => call('muyu.provider.search', { id: 'chatHistory', query: '金币', ...args }, extra);
    const read = (matchToken, args = {}, extra) => call('muyu.provider.match', { id: 'chatHistory', matchToken, ...args }, extra);
    return { module, context, ctx, host, revision, call, search, read, executions: () => executions, switch() { current = { ...target, chatKey: 'B' }; } };
}

test('Native chat search returns small locations and matched read-only evidence without full injection', () => {
    const f = fixture(40000), before = structuredClone(f.ctx);
    f.ctx.chat[0].mes += '无关背景'.repeat(10000);
    const result = f.search(); assert.equal(result.status, 'ok'); assert.equal(result.complete, true); assert.equal(result.items.length, 2);
    assert.ok(JSON.stringify(result).length < 1000); assert.doesNotMatch(JSON.stringify(result), /a\.png/);
    const read = f.read(result.items[0].matchToken); assert.match(read.text, /奖励10金币/); assert.equal(read.text.length, 4000); assert.ok(read.nextToken);
    const next = f.read(read.nextToken); assert.equal(next.status, 'ok'); assert.ok(next.text.length <= 4000);
    assert.equal(f.ctx.chatMetadata.gd.charMemories['a.png'][0].event, before.chatMetadata.gd.charMemories['a.png'][0].event);
    assert.equal(f.executions(), 0);
});

test('Provider search distinguishes scan steps, distinct page records and selected-source total', () => {
    const f = fixture(); f.ctx.chat[0].mes = '金币甲，金币乙，金币丙。';
    const page = f.search();
    assert.equal(page.query, '金币'); assert.equal(page.totalRecords, 1); assert.equal(page.scannedRecords, 1);
    assert.equal(page.scannedSteps, 4); assert.equal(page.items.length, 3); assert.equal(page.complete, true);
    f.ctx.chat = Array.from({ length: 40 }, () => ({ mes: '金币，尾部' }));
    const bounded = f.search(); assert.ok(bounded.scannedSteps <= 32); assert.ok(bounded.scannedRecords <= bounded.scannedSteps);
    assert.equal(bounded.totalRecords, 40); assert.equal(bounded.complete, false);
});

test('A continuation may scan the same long record again without inflating its source total', () => {
    const f = fixture(); f.ctx.chat[0].mes = 'x'.repeat(140000) + '金币';
    const first = f.search(); assert.equal(first.totalRecords, 1); assert.equal(first.scannedRecords, 1); assert.equal(first.complete, false);
    const second = f.search({ cursor: first.cursor }); assert.equal(second.totalRecords, 1); assert.equal(second.scannedRecords, 1); assert.equal(second.complete, false);
    const third = f.search({ cursor: second.cursor }); assert.equal(third.totalRecords, 1); assert.equal(third.scannedRecords, 1); assert.equal(third.items.length, 1);
});

test('Unicode cursor rollback still counts every touched memory record and resumes without loss', () => {
    const f = fixture();
    f.ctx.chatMetadata.gd.charMemories['a.png'] = [
        { event: 'x'.repeat(65532), mood: '' },
        { event: '😀金币', mood: '' },
    ];
    const directory = f.call('muyu.provider.read', { id: 'charMemory' });
    const args = { id: 'charMemory', selector: 'character:0', revision: directory.revision };
    const first = f.search(args);
    assert.equal(first.status, 'ok'); assert.equal(first.totalRecords, 2);
    assert.equal(first.scannedSteps, 2); assert.equal(first.scannedRecords, 2);
    assert.equal(first.scannedChars, 65536); assert.equal(first.complete, false);
    assert.equal(first.items.length, 0); assert.ok(first.cursor);
    const next = f.search({ ...args, cursor: first.cursor });
    assert.equal(next.status, 'ok'); assert.equal(next.complete, true); assert.equal(next.cursor, '');
    assert.equal(next.totalRecords, 2); assert.equal(next.scannedRecords, 1);
    assert.equal(next.items.length, 1); assert.equal(next.items[0].index, 1);
    assert.match(next.items[0].text, /😀金币/);
    assert.match(f.read(next.items[0].matchToken, args).text, /😀金币/);
});

test('Bounded search continues through empty batches instead of claiming absence', () => {
    const f = fixture(); f.ctx.chat = Array.from({ length: 70 }, (_, i) => ({ name: 'A', mes: i === 69 ? '金币' : '无关' }));
    let page = f.search(); assert.equal(page.items.length, 0); assert.equal(page.complete, false); assert.ok(page.cursor); assert.equal(page.scannedRecords, 32);
    page = f.search({ cursor: page.cursor }); assert.equal(page.complete, false); assert.equal(page.items.length, 0);
    page = f.search({ cursor: page.cursor }); assert.equal(page.complete, true); assert.equal(page.items[0].index, 69);
});

test('Repeated matches in one cached text have bounded hit pages without skipping later corrections', () => {
    const f = fixture(); f.ctx.chat[0].mes = Array.from({ length: 12 }, (_, i) => `金币规则${i}。`).join('');
    const first = f.search(); assert.equal(first.items.length, 8); assert.equal(first.complete, false); assert.ok(first.cursor);
    const last = f.search({ cursor: first.cursor }); assert.equal(last.items.length, 4); assert.equal(last.complete, true);
    assert.match(f.read(last.items.at(-1).matchToken).text, /金币规则11/);
});

test('Literal search finds a boundary-spanning query, preserves Unicode, and rejects stale cursors', () => {
    const f = fixture(); f.ctx.chat[0] = { mes: 'x'.repeat(65532) + '金币🔍' + 'z'.repeat(100) };
    const page = f.search({ query: '金币🔍' }); assert.equal(page.items.length, 1); assert.match(page.items[0].text, /金币🔍/);
    const g = fixture(); g.ctx.chat[0].mes = 'x'.repeat(80000) + '金币';
    const cursor = g.search().cursor; assert.ok(cursor);
    assert.equal(g.search({ cursor, query: '别的' }).status, 'INVALID_REFERENCE');
    g.ctx.chat[0].mes = 'changed'; assert.equal(g.search({ cursor }).status, 'STALE_SOURCE');
});

test('Match references reject edits, appends, wrong source, run, target, forgotten runs and disposal', () => {
    const f = fixture(), hit = f.search().items[0].matchToken;
    assert.equal(f.read(hit, { id: 'charMemory', selector: 'character:0' }).status, 'INVALID_REFERENCE');
    f.module.bindRun('r2', 24000); assert.equal(f.read(hit, {}, { runId: 'r2' }).status, 'INVALID_REFERENCE');
    f.ctx.chat[0].mes = 'changed'; assert.equal(f.read(hit).status, 'STALE_SOURCE');
    const fresh = fixture(), ref = fresh.search().items[0].matchToken;
    fresh.ctx.chat.push({ mes: 'new' }); assert.equal(fresh.read(ref).status, 'STALE_SOURCE');
    const g = fixture(), token = g.search().items[0].matchToken; g.switch(); assert.equal(g.read(token).status, 'TARGET_UNAVAILABLE');
    const h = fixture(), old = h.search().items[0].matchToken; h.module.forgetRun('r'); assert.equal(h.read(old).status, 'BUDGET_EXCEEDED');
    h.module.dispose(); assert.equal(h.search().status, 'TARGET_UNAVAILABLE');
});

test('Memory search returns only selected-role events and rejects identity changes', () => {
    const f = fixture(), directory = f.call('muyu.provider.read', { id: 'charMemory' });
    const args = { id: 'charMemory', selector: 'character:0', revision: directory.revision }, result = f.search(args);
    assert.equal(result.items.length, 1); assert.match(result.items[0].text, /任务奖励/);
    assert.doesNotMatch(JSON.stringify(result), /a\.png|去了北方/);
    assert.match(f.read(result.items[0].matchToken, args).text, /金币来自任务奖励/);
    const old = result.items[0].matchToken;
    f.ctx.chatMetadata.gd.charMemories = { 'b.png': [{ event: '金币来自任务奖励', mood: 'happy' }] };
    assert.equal(f.read(old, args).status, 'STALE_SOURCE');
    assert.equal(f.search({ id: 'charMemory', selector: '' }).status, 'INVALID_SELECTOR');
});

test('Memory first search requires a live directory revision across reorder, deletion and replacement', () => {
    for (const change of ['reorder', 'delete', 'replace']) {
        const f = fixture();
        const alice = f.ctx.chatMetadata.gd.charMemories['a.png'];
        const bob = [{ event: '金币来自Bob', mood: '' }];
        f.ctx.characters.push({ avatar: 'b.png', name: 'Bob' });
        f.ctx.chatMetadata.gd.charMemories = { 'b.png': bob, 'a.png': alice };
        const directory = f.call('muyu.provider.read', { id: 'charMemory' });
        const args = { id: 'charMemory', selector: 'character:1', revision: directory.revision };
        assert.equal(f.search({ ...args, revision: '' }).status, 'STALE_SOURCE');
        if (change === 'reorder') f.ctx.chatMetadata.gd.charMemories = { 'a.png': alice, 'b.png': bob };
        if (change === 'delete') f.ctx.chatMetadata.gd.charMemories = { 'a.png': alice };
        if (change === 'replace') f.ctx.chatMetadata.gd.charMemories = { 'b.png': bob, 'c.png': bob };
        assert.equal(f.search(args).status, 'STALE_SOURCE');
        const fresh = f.call('muyu.provider.read', { id: 'charMemory' });
        const freshArgs = { id: 'charMemory', selector: 'character:0', revision: fresh.revision };
        const found = f.search(freshArgs); assert.equal(found.status, 'ok');
        assert.equal(f.read(found.items[0].matchToken, freshArgs).status, 'ok');
        f.ctx.chatMetadata.gd.charMemories = {};
        assert.equal(f.read(found.items[0].matchToken, freshArgs).status, 'STALE_SOURCE');
    }
});

test('Existing Provider result is searched and reread without rendering again or requiring a live registration', async () => {
    const f = fixture();
    const first = await f.call('muyu.provider.execute', { id: 'custom', revision: f.revision });
    const args = { id: 'custom', revision: f.revision, resultId: first.resultId };
    const page = f.search(args); assert.equal(page.status, 'ok'); assert.equal(page.items.length, 1);
    assert.match(f.read(page.items[0].matchToken, args).text, /隐藏奖励/); assert.equal(f.executions(), 1);
    assert.equal(f.search({ ...args, id: 'other' }).status, 'INVALID_REFERENCE');
    assert.equal(f.search({ id: 'custom', revision: f.revision }).status, 'INVALID_SELECTOR');
    f.host.providerPort.describe = () => null;
    const permissions = createPermissions(); permissions.decide({ source: 'providerExecution', reason: 'approved result', providerId: 'custom', providerRevision: f.revision, target: f.context.target, taskId: 'task' }, 'task', () => {});
    assert.equal(assistantToolAccess(f.module.registry.get('muyu.provider.search'), args, f.context.target, 'task', permissions, f.host.providerPort).decision, true);
    assert.deepEqual(requiredSources('muyu.provider.search', args), [executionSource('custom', f.revision)]);
});

test('Retrieval shares source byte budgets and fails without publishing partial references', () => {
    const f = fixture(6000); f.ctx.chat[0].mes = '金币' + '中'.repeat(10000);
    const hit = f.search().items[0].matchToken, used = f.module.usage('r').used;
    assert.equal(f.read(hit).status, 'BUDGET_EXCEEDED'); assert.equal(f.module.usage('r').used, used);
    const g = fixture(6000); for (let i = 0; i < 100 && !g.module.usage('r').exhausted; i++) g.search();
    assert.ok(g.module.usage('r').used <= 6000);
});

test('Broker guards search/match with original source grants, even when a token exists', async () => {
    const f = fixture(), permissions = createPermissions(); let reads = 0;
    const original = f.host.providerPort.searchSource; f.host.providerPort.searchSource = (...args) => { reads++; return original(...args); };
    const broker = createToolBroker({ registry: f.module.registry, handlers: f.module.handlers, ...f.context, signal: new AbortController().signal, allowedTools: ['muyu.provider.search', 'muyu.provider.match'],
        policy: ({ definition, args, target }) => assistantToolAccess(definition, args, target, 'task', permissions, f.host.providerPort).decision });
    const call = (toolId, args) => broker.call({ toolId, callId: crypto.randomUUID(), version: 1, args });
    assert.equal((await call('muyu.provider.search', { id: 'chatHistory', query: '金币' })).error.code, 'PERMISSION_REQUIRED'); assert.equal(reads, 0);
    permissions.decide({ source: 'chatHistory', reason: 'find rule', target: f.context.target, taskId: 'task' }, 'task', () => {});
    const found = await call('muyu.provider.search', { id: 'chatHistory', query: '金币' }); assert.equal(found.ok, true);
    assert.equal((await call('muyu.provider.search', { id: 'charMemory', selector: 'character:0', query: '金币' })).error.code, 'PERMISSION_REQUIRED');
    permissions.forgetTask(f.context.target, 'task');
    assert.equal((await call('muyu.provider.match', { id: 'chatHistory', matchToken: found.data.items[0].matchToken })).error.code, 'PERMISSION_REQUIRED');
});

test('Unified assistant suspends native search before data access, resumes matched read and expires task grants', async () => {
    const f = fixture(); let touched = 0;
    f.ctx.chatId = 'A'; f.ctx.characterId = 0; f.ctx.eventTypes = { CHAT_CHANGED: 'chat' }; f.ctx.eventSource = { on() {}, removeListener() {} };
    const original = f.host.providerPort.searchSource; f.host.providerPort.searchSource = (...args) => { touched++; return original(...args); };
    const tool = (id, args) => ({ type: 'tool_call_complete', call: { toolId: id, version: 1, callId: crypto.randomUUID(), args } });
    const ask = () => [tool('muyu.provider.search', { id: 'chatHistory', query: '金币' }), done];
    const model = scriptedModel([ask(), request => {
        const found = request.messages.findLast(m => m.role === 'tool').result.data;
        return [tool('muyu.provider.match', { id: 'chatHistory', matchToken: found.items[0].matchToken }), done];
    }, [text('当前剧情里任务奖励10金币。'), done], ask(), [text('未获得新任务读取授权。'), done]]);
    const settings = { muyuEnabled: true }, host = createHostBridge({ getContext: () => f.ctx, getSettings: () => settings, extensionKey: 'gd', providerPort: f.host.providerPort });
    const c = createMuyuController({ host, createModel: () => model });
    const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
    try {
        await c.configure({ endpoint: 'https://example.test', model: 'fake', apiKey: 'synthetic' });
        c.setInput('找剧情里的金币规则'); c.send(); await settle();
        assert.equal(touched, 0); assert.equal(c.snapshot().interaction.source, 'chatHistory');
        c.answerPermission(c.snapshot().interaction.id, 'task'); await settle();
        assert.equal(c.snapshot().runs.at(-1).status, 'succeeded'); assert.notEqual(c.snapshot().interaction?.status, 'pending'); assert.equal(touched, 2);
        assert.ok(JSON.parse(c.exportHistory()).required.includes('source:chatHistory'));
        c.setInput('再查一次'); c.send(); await settle();
        assert.equal(c.snapshot().interaction.source, 'chatHistory'); assert.equal(touched, 2);
        c.answerPermission(c.snapshot().interaction.id, 'deny'); await settle(); assert.equal(touched, 2);
    } finally { await c.dispose(); }
});
