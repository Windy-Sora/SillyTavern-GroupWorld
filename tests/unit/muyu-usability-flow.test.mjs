import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createMuyuController } from '../../muyu/application/controller.js';
import { createHostBridge } from '../../muyu/host/bridge.js';
import { createConfigWriter } from '../../muyu/host/config-write.js';
import { createMemoryLimitPort } from '../../muyu/host/memory-limit.js';
import { scriptedModel, text, done, flush } from './helpers/muyu-subject.mjs';

const call = (toolId, args, callId = crypto.randomUUID()) => ({ type: 'tool_call_complete', call: { toolId, args, callId, version: 1 } });
const settle = async () => { for (let i = 0; i < 24; i++) await flush(); };

function fixture(steps) {
    const events = new EventEmitter();
    const settings = { mode: 'formula', topN: 1, memoryMaxEntries: 200 };
    const context = { chatId: 'A', groupId: 'g', groups: [{ id: 'g', members: [] }], chat: [], chatMetadata: {}, eventSource: events, eventTypes: { CHAT_CHANGED: 'chat' } };
    let saves = 0;
    let host;
    const memoryLimitPort = createMemoryLimitPort({ getTarget: () => host.currentTarget(), getMetadata: () => context.chatMetadata, extensionKey: 'gd', memorySystem: { pruneAfter: async () => {} } });
    host = createHostBridge({ getSettings: () => settings, getContext: () => context, extensionKey: 'gd', memoryLimitPort,
        configWriter: createConfigWriter({ getSettings: () => settings, isBusy: () => false, memoryLimitPort,
            saveSettings: async () => { saves++; return { confirmed: true }; } }) });
    const model = scriptedModel(steps);
    const controller = createMuyuController({ host, createModel: () => model });
    return { settings, model, controller, saves: () => saves, async start(input) {
        await controller.configure({ endpoint: 'https://example.test', model: 'scripted', apiKey: 'synthetic' });
        controller.setFullAccess(true); controller.setInput(input); controller.send(); await settle();
    } };
}

test('A normal configuration apply is checked locally without another model call or write', async () => {
    const f = fixture([[call('muyu.settings.preview', { changes: { topN: 2 }, apply: true }), done], [text('以回执为准'), done]]);
    try {
        await f.start('把 topN 改为 2，并确认当前值');
        const state = f.controller.snapshot(), receipt = state.receipts[0], check = state.configChecks[receipt.operationId];
        assert.equal(f.settings.topN, 2);
        assert.equal(f.saves(), 1);
        assert.equal(receipt.status, 'applied_confirmed');
        assert.equal(check.state, 'matched');
        assert.equal(check.persistence, 'unknown');
        assert.equal(check.fields[0].actual, '2');
        assert.equal(f.model.requests.length, 2);
    } finally { await f.controller.dispose(); }
});

test('Preview-only requests never write or start a receipt check', async () => {
    const f = fixture([[call('muyu.settings.preview', { changes: { topN: 2 } }), done], [text('仅预览'), done]]);
    try {
        await f.start('把 topN 改为 2，先预览，不要应用');
        assert.equal(f.settings.topN, 1);
        assert.equal(f.saves(), 0);
        assert.equal(f.controller.snapshot().receipts.length, 0);
        assert.deepEqual(f.controller.snapshot().configChecks, {});
    } finally { await f.controller.dispose(); }
});

test('Automatic check does not borrow a removed read grant', async () => {
    const f = fixture([[call('muyu.settings.preview', { changes: { topN: 2 } }), done], [text('草稿'), done]]);
    try {
        await f.start('预览 topN 改为 2');
        f.controller.setFullAccess(false);
        const draft = f.controller.snapshot().artifacts[0];
        const action = f.controller.prepareConfigApply(draft.id, draft.revision);
        await f.controller.approveConfigApply(action.id); await settle();
        assert.equal(f.settings.topN, 2);
        assert.equal(f.controller.snapshot().configChecks[action.id].state, 'permission_required');
        assert.equal(f.model.requests.length, 2);
    } finally { await f.controller.dispose(); }
});

test('A mixed memory-limit preview returns a safe split hint and can be corrected in the same run', async () => {
    const f = fixture([[call('muyu.settings.preview', { changes: { memoryMaxEntries: 10, topN: 2 } }), done],
        [call('muyu.settings.preview', { changes: { topN: 2 } }), done], [text('普通字段草稿；记忆上限需单独预览'), done]]);
    try {
        await f.start('把记忆上限改为 10，topN 改为 2，只预览');
        const result = f.model.requests[1].messages.find(m => m.role === 'tool').result;
        assert.equal(result.ok, false);
        assert.equal(result.error.code, 'MEMORY_LIMIT_REQUIRES_SEPARATE_DRAFT');
        assert.equal(result.effectState, 'not_started');
        assert.equal(f.controller.snapshot().artifacts.length, 1);
        assert.equal(f.saves(), 0);
        assert.equal(f.settings.topN, 1);
    } finally { await f.controller.dispose(); }
});

test('Split settings previews publish both independent drafts without applying either', async () => {
    const f = fixture([[call('muyu.settings.preview', { changes: { memoryMaxEntries: 10, topN: 2 } }), done],
        [call('muyu.settings.preview', { changes: { memoryMaxEntries: 10 } }), done],
        [call('muyu.settings.preview', { changes: { topN: 2 } }), done], [text('两份草稿'), done]]);
    try {
        await f.start('分别预览记忆上限 10 与 topN 2，不要应用');
        const artifacts = f.controller.snapshot().artifacts;
        assert.equal(artifacts.length, 2);
        assert.deepEqual(artifacts.map(a => a.content.requestedChanges), [{ memoryMaxEntries: 10 }, { topN: 2 }]);
        assert.equal(f.settings.memoryMaxEntries, 200); assert.equal(f.settings.topN, 1); assert.equal(f.saves(), 0);
    } finally { await f.controller.dispose(); }
});

test('A later preview of the same field replaces its earlier draft', async () => {
    const f = fixture([[call('muyu.settings.preview', { changes: { topN: 2 } }), done],
        [call('muyu.settings.preview', { changes: { topN: 3 } }), done], [text('修订草稿'), done]]);
    try {
        await f.start('预览 topN 2，然后改成 3');
        assert.deepEqual(f.controller.snapshot().artifacts.map(a => a.content.requestedChanges), [{ topN: 3 }]);
        assert.equal(f.saves(), 0);
    } finally { await f.controller.dispose(); }
});

test('Revising a memory-limit draft does not publish its obsolete prune plan', async () => {
    const f = fixture([[call('muyu.settings.preview', { changes: { memoryMaxEntries: 10 } }), done],
        [call('muyu.settings.preview', { changes: { memoryMaxEntries: 11 } }), done], [text('修订记忆草稿'), done]]);
    try {
        await f.start('先预览记忆上限 10，随后改为 11');
        assert.deepEqual(f.controller.snapshot().artifacts.map(a => a.content.requestedChanges), [{ memoryMaxEntries: 11 }]);
        assert.equal(f.settings.memoryMaxEntries, 200); assert.equal(f.saves(), 0);
    } finally { await f.controller.dispose(); }
});

test('A corrected side-effect-free split error allows the requested automatic apply', async () => {
    const f = fixture([[call('muyu.settings.preview', { changes: { memoryMaxEntries: 10, topN: 2 }, apply: true }), done],
        [call('muyu.settings.preview', { changes: { topN: 2 }, apply: true }), done], [text('先完成 topN'), done]]);
    try {
        await f.start('把记忆上限改成 10、topN 改成 2，先完成能做的部分');
        const state = f.controller.snapshot();
        assert.equal(f.settings.topN, 2); assert.equal(f.settings.memoryMaxEntries, 200);
        assert.equal(f.saves(), 1); assert.equal(state.receipts.length, 1);
        assert.equal(state.notice, null);
    } finally { await f.controller.dispose(); }
});

test('An unrelated tool failure still blocks automatic apply and explains manual review', async () => {
    const f = fixture([[call('muyu.settings.preview', { changes: { topN: 2 }, apply: true }), done],
        [call('muyu.settings.contract', { domain: 'not-a-domain' }), done], [text('请检查草稿'), done]]);
    try {
        await f.start('把 topN 改成 2');
        const state = f.controller.snapshot();
        assert.equal(f.settings.topN, 1); assert.equal(f.saves(), 0);
        assert.equal(state.artifacts.length, 1); assert.equal(state.receipts.length, 0);
        assert.equal(state.notice, 'AUTO_APPLY_REQUIRES_REVIEW');
    } finally { await f.controller.dispose(); }
});

for (const apply of [false, true]) test(`A later independent split error preserves all earlier and corrected drafts (${apply ? 'apply' : 'preview'})`, async () => {
    const preview = changes => call('muyu.settings.preview', { changes, ...(apply ? { apply: true } : {}) });
    const f = fixture([[preview({ topN: 2 }), done],
        [preview({ memoryMaxEntries: 10, providerTimeoutMs: 1000 }), done],
        [preview({ memoryMaxEntries: 10 }), done],
        [preview({ providerTimeoutMs: 1000 }), done], [text('三项分别处理'), done]]);
    try {
        await f.start('分别处理 topN 2、记忆上限 10 和 Provider 超时 1000'); await settle();
        const state = f.controller.snapshot();
        assert.deepEqual(state.artifacts.map(a => a.content.requestedChanges), [
            { topN: 2 }, { memoryMaxEntries: 10 }, { providerTimeoutMs: 1000 },
        ]);
        assert.equal(f.settings.topN, apply ? 2 : 1);
        assert.equal(f.settings.memoryMaxEntries, apply ? 10 : 200);
        assert.equal(f.saves(), apply ? 3 : 0);
        assert.equal(state.receipts.length, apply ? 3 : 0);
        assert.equal(state.notice, null);
    } finally { await f.controller.dispose(); }
});

test('An invalid overlapping revision removes only that draft, not an unrelated one', async () => {
    const f = fixture([[call('muyu.settings.preview', { changes: { topN: 2 } }), done],
        [call('muyu.settings.preview', { changes: { mode: 'llm' } }), done],
        [call('muyu.settings.preview', { changes: { mode: 'invalid' } }), done], [text('模式修订无效'), done]]);
    try {
        await f.start('分别预览 topN 和模式');
        const state = f.controller.snapshot();
        assert.deepEqual(state.artifacts.map(a => a.content.requestedChanges), [{ topN: 2 }]);
        assert.equal(f.saves(), 0);
    } finally { await f.controller.dispose(); }
});
