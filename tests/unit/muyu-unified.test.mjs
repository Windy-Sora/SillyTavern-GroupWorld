import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createMuyuController } from '../../muyu/application/controller.js';
import { createHostBridge } from '../../muyu/host/bridge.js';
import { CONTEXT_DEFAULTS } from '../../muyu/context/policy.js';
import { createProviderPort } from '../../muyu/host/providers.js';
import { createConfigWriter } from '../../muyu/host/config-write.js';
import { createMemoryLimitPort } from '../../muyu/host/memory-limit.js';
import { createPermissions } from '../../muyu/application/permissions.js';
import { RUN_DEFAULTS } from '../../muyu/core/budget.js';
import { scriptedModel, text, done, flush } from './helpers/muyu-subject.mjs';
const call = (toolId, args = {}) => ({ type: 'tool_call_complete', call: { toolId, callId: crypto.randomUUID(), version: toolId.startsWith('muyu.provider.') ? 2 : 1, args } });
const ask = source => [call('muyu.permission.request', { source, reason: 'Need this source for the user question' }), done];
const preview = () => [call('muyu.config.preview', { changes: { autoMemoryInterval: 15 } }), done];
const read = () => [call('muyu.provider.read', { id: 'memoryConfig', selector: '', revision: '', offset: 0 }), done];
const settle = async () => { for (let i = 0; i < 16; i++) await flush(); };
test('Explicit unchanged settings remain approval preconditions', async () => {
    const f = fixture([ask('configSettings'), [call('muyu.settings.preview', { changes: { mode: 'formula', topN: 2 } }), done], [text('Preview'), done]], false);
    try {
        f.settings.topN = 1; await f.enable(); const c = f.controller;
        c.setInput('Keep formula mode and set topN to 2'); c.send(); await settle();
        c.answerPermission(c.snapshot().interaction.id, 'chat'); await settle();
        const a = c.snapshot().artifacts[0], action = c.prepareConfigApply(a.id, a.revision);
        f.settings.mode = 'llm';
        assert.throws(() => c.approveConfigApply(action.id), /STALE/);
        assert.equal(f.settings.topN, 1); assert.equal(f.writes(), 0);
    } finally { await f.controller.dispose(); }
});

test('Checking one receipt does not require unrelated receipt permissions', async () => {
    const f = fixture([ask('memoryConfig'), preview(), [text('Memory draft'), done], ask('configSettings'),
        [call('muyu.settings.preview', { changes: { mode: 'llm' } }), done], [text('Director draft'), done]], false);
    try {
        await f.enable(); const c = f.controller;
        c.setInput('Memory interval'); c.send(); await settle(); c.answerPermission(c.snapshot().interaction.id, 'task'); await settle();
        let a = c.snapshot().artifacts.at(-1), action = c.prepareConfigApply(a.id, a.revision);
        await c.approveConfigApply(action.id); const memoryId = action.id;
        c.setInput('Director mode'); c.allowHistory(); c.send(); await settle(); c.answerPermission(c.snapshot().interaction.id, 'chat'); await settle();
        a = c.snapshot().artifacts.at(-1); action = c.prepareConfigApply(a.id, a.revision); await c.approveConfigApply(action.id);
        assert.equal(c.snapshot().canCheckReceipts[action.id], true);
        assert.equal(c.snapshot().canCheckReceipts[memoryId], false);
        assert.equal(c.snapshot().canReadConfig, false);
        await c.checkReceipt(action.id); assert.equal(c.snapshot().configChecks[action.id].state, 'matched');
        await assert.rejects(c.checkReceipt(memoryId), /CONSENT_REQUIRED/);
    } finally { await f.controller.dispose(); }
});
test('Unchanged explicit settings are checked but not written or included in receipt diff', async () => {
    const f = fixture([ask('configSettings'), [call('muyu.settings.preview', { changes: { mode: 'formula', topN: 2 } }), done], [text('Preview'), done]], false);
    try {
        f.settings.topN = 1; await f.enable(); const c = f.controller;
        c.setInput('Keep formula mode and set topN to 2'); c.send(); await settle();
        c.answerPermission(c.snapshot().interaction.id, 'chat'); await settle();
        const a = c.snapshot().artifacts[0];
        assert.equal(a.content.baseline.mode, 'formula');
        assert.deepEqual(a.content.preview.manifest.settings, { topN: 2 });
        Object.defineProperty(f.settings, 'mode', { writable: false });
        const action = c.prepareConfigApply(a.id, a.revision); await c.approveConfigApply(action.id);
        assert.equal(f.settings.topN, 2); assert.equal(f.writes(), 1);
        assert.deepEqual(c.snapshot().receipts[0].diff.map(d => d.field), ['topN']);
    } finally { await f.controller.dispose(); }
});
test('Speaker-rule fields use the unified permission, draft, approval and receipt path', async () => {
    const changes = { triggerScore: 70, initiativeBaseScore: 12, llmContextDepth: 24, llmRespectOrder: false };
    const f = fixture([ask('configSettings'), [call('muyu.settings.contract', { domain: 'scoring' }), done],
        [call('muyu.settings.preview', { changes }), done], [text('Preview'), done]], false);
    try {
        Object.assign(f.settings, { triggerEnabled: true, initiativeEnabled: true, triggerScore: 40, initiativeBaseScore: 5, llmContextDepth: 10, llmRespectOrder: true });
        await f.enable(); const c = f.controller;
        c.setInput('Adjust speaker rules'); c.send(); await settle();
        assert.equal(f.reads(), 0);
        c.answerPermission(c.snapshot().interaction.id, 'chat'); await settle();
        const a = c.snapshot().artifacts[0];
        assert.deepEqual(a.content.preview.manifest.settings, changes);
        assert.equal(f.writes(), 0);
        const action = c.prepareConfigApply(a.id, a.revision); await c.approveConfigApply(action.id);
        assert.equal(f.settings.triggerScore, 70); assert.equal(f.settings.initiativeBaseScore, 12);
        assert.equal(f.settings.llmContextDepth, 24); assert.equal(f.settings.llmRespectOrder, false);
        assert.equal(f.writes(), 1);
        await c.checkReceipt(action.id); assert.equal(c.snapshot().configChecks[action.id].state, 'matched');
    } finally { await f.controller.dispose(); }
});
test('Summary settings require authorization, approval and one save before receipt checking', async () => {
    const changes = { summaryEnabled: true, autoSummaryEnabled: true, autoSummaryInterval: 15, summaryReusePrevious: false };
    const f = fixture([ask('configSettings'), [call('muyu.settings.contract', { domain: 'summary' }), done],
        [call('muyu.settings.preview', { changes }), done], [text('Preview'), done]], false);
    try {
        Object.assign(f.settings, { summaryEnabled: false, autoSummaryEnabled: false, autoSummaryInterval: 10, summaryReusePrevious: true });
        await f.enable(); const c = f.controller;
        c.setInput('Set auto summary to 15 messages'); c.send(); await settle();
        assert.equal(f.reads(), 0);
        c.answerPermission(c.snapshot().interaction.id, 'chat'); await settle();
        const a = c.snapshot().artifacts[0];
        assert.deepEqual(a.content.preview.manifest.settings, changes);
        assert.equal(a.content.preview.semantic, 'passed'); assert.equal(f.writes(), 0);
        const action = c.prepareConfigApply(a.id, a.revision); await c.approveConfigApply(action.id);
        assert.equal(f.settings.summaryEnabled, true); assert.equal(f.settings.autoSummaryEnabled, true);
        assert.equal(f.settings.autoSummaryInterval, 15); assert.equal(f.settings.summaryReusePrevious, false);
        assert.equal(f.writes(), 1);
        await c.checkReceipt(action.id); assert.equal(c.snapshot().configChecks[action.id].state, 'matched');
    } finally { await f.controller.dispose(); }
});
test('Critique settings use permission, preview, approval, save and receipt checking', async () => {
    const changes = { critiqueEnabled: true, autoCritiqueEnabled: true, autoCritiqueInterval: 15, critiqueReusePrevious: false };
    const f = fixture([ask('configSettings'), [call('muyu.settings.contract', { domain: 'critique' }), done],
        [call('muyu.settings.preview', { changes }), done], [text('Preview'), done]], false);
    try {
        Object.assign(f.settings, { critiqueEnabled: false, autoCritiqueEnabled: false, autoCritiqueInterval: 10, critiqueReusePrevious: true });
        await f.enable(); const c = f.controller;
        c.setInput('Set automatic critique to 15 messages'); c.send(); await settle();
        assert.equal(f.reads(), 0);
        c.answerPermission(c.snapshot().interaction.id, 'chat'); await settle();
        const a = c.snapshot().artifacts[0];
        assert.deepEqual(a.content.preview.manifest.settings, changes);
        assert.equal(a.content.preview.semantic, 'passed'); assert.equal(f.writes(), 0);
        const action = c.prepareConfigApply(a.id, a.revision); await c.approveConfigApply(action.id);
        assert.equal(f.settings.critiqueEnabled, true); assert.equal(f.settings.autoCritiqueEnabled, true);
        assert.equal(f.settings.autoCritiqueInterval, 15); assert.equal(f.settings.critiqueReusePrevious, false);
        assert.equal(f.writes(), 1);
        await c.checkReceipt(action.id); assert.equal(c.snapshot().configChecks[action.id].state, 'matched');
    } finally { await f.controller.dispose(); }
});
test('Profile settings use permission, preview, approval, save and receipt checking', async () => {
    const changes = { profileEnabled: true, profileTokenBudget: 3000, profileConcurrency: 2 };
    const f = fixture([ask('configSettings'), [call('muyu.settings.contract', { domain: 'profiles' }), done],
        [call('muyu.settings.preview', { changes }), done], [text('Preview'), done]], false);
    try {
        Object.assign(f.settings, { profileEnabled: false, profileTokenBudget: 2000, profileConcurrency: 0 });
        await f.enable(); const c = f.controller;
        c.setInput('Enable profiles with budget 3000 and concurrency 2'); c.send(); await settle();
        assert.equal(f.reads(), 0);
        c.answerPermission(c.snapshot().interaction.id, 'chat'); await settle();
        const a = c.snapshot().artifacts[0];
        assert.deepEqual(a.content.preview.manifest.settings, changes);
        assert.equal(a.content.preview.semantic, 'passed'); assert.equal(f.writes(), 0);
        const action = c.prepareConfigApply(a.id, a.revision); await c.approveConfigApply(action.id);
        assert.equal(f.settings.profileEnabled, true); assert.equal(f.settings.profileTokenBudget, 3000);
        assert.equal(f.settings.profileConcurrency, 2); assert.equal(f.writes(), 1);
        await c.checkReceipt(action.id); assert.equal(c.snapshot().configChecks[action.id].state, 'matched');
    } finally { await f.controller.dispose(); }
});
test('NPC settings use permission, preview, approval, save and receipt checking', async () => {
    const changes = { npcEnabled: true, npcMaxCount: 8, npcBatchSize: 2, npcGenerateFirstMes: true };
    const f = fixture([ask('configSettings'), [call('muyu.settings.contract', { domain: 'npc' }), done],
        [call('muyu.settings.preview', { changes }), done], [text('Preview'), done]], false);
    try {
        Object.assign(f.settings, { npcEnabled: false, npcMaxCount: 10, npcBatchSize: 3, npcGenerateFirstMes: false });
        await f.enable(); const c = f.controller;
        c.setInput('Enable NPC generation with a limit of eight and batch size two'); c.send(); await settle();
        assert.equal(f.reads(), 0);
        c.answerPermission(c.snapshot().interaction.id, 'chat'); await settle();
        const a = c.snapshot().artifacts[0];
        assert.deepEqual(a.content.preview.manifest.settings, changes);
        assert.equal(a.content.preview.semantic, 'passed'); assert.equal(f.writes(), 0);
        const action = c.prepareConfigApply(a.id, a.revision); await c.approveConfigApply(action.id);
        assert.equal(f.settings.npcEnabled, true); assert.equal(f.settings.npcMaxCount, 8);
        assert.equal(f.settings.npcBatchSize, 2); assert.equal(f.settings.npcGenerateFirstMes, true);
        assert.equal(f.writes(), 1);
        await c.checkReceipt(action.id); assert.equal(c.snapshot().configChecks[action.id].state, 'matched');
    } finally { await f.controller.dispose(); }
});
test('World-book ordinary settings use exact permission, preview and one confirmed operation', async () => {
    const changes = { worldBookSourceMode: 'manual', worldBookMaxEntries: 12 };
    const f = fixture([[call('muyu.settings.contract', { domain: 'worldBook' }), done],
        [call('muyu.settings.preview', { changes }), done], [text('Preview only'), done]], false);
    Object.assign(f.settings, { worldBookSourceMode: 'st', worldBookMaxEntries: 20, worldBookSelection: { BookA: true } });
    try {
        await f.enable(); const c = f.controller;
        c.setInput('Use manually selected books and limit importance results to twelve; preview only'); c.send(); await settle();
        assert.equal(c.snapshot().interaction.source, 'configSettings');
        assert.equal(c.snapshot().interaction.hostManaged, true);
        assert.equal(f.writes(), 0);
        c.answerPermission(c.snapshot().interaction.id, 'chat'); await settle();
        const a = c.snapshot().artifacts[0];
        assert.deepEqual(a.content.preview.manifest.settings, changes);
        assert.ok(a.content.preview.warnings.includes('WORLD_BOOK_MANUAL_SELECTION_REQUIRED'));
        assert.equal(f.settings.worldBookSourceMode, 'st');
        const action = c.prepareConfigApply(a.id, a.revision); await c.approveConfigApply(action.id);
        assert.equal(f.settings.worldBookSourceMode, 'manual'); assert.equal(f.settings.worldBookMaxEntries, 12);
        assert.deepEqual(f.settings.worldBookSelection, { BookA: true }); assert.equal(f.writes(), 1);
        await c.checkReceipt(action.id); assert.equal(c.snapshot().configChecks[action.id].state, 'matched');
    } finally { await f.controller.dispose(); }
});
test('Summary and critique Prompt draft needs config consent and leaves Schema untouched', async () => {
    const changes = { summaryPrompt: 'Summarize only observed events.\n{{recent}}', critiquePrompt: 'Critique role pacing, not the user.' };
    const f = fixture([[call('muyu.settings.preview', { changes }), done], [text('Two Prompt drafts, not applied'), done]], false);
    Object.assign(f.settings, { summaryEnabled: true, critiqueEnabled: true, summaryPrompt: '', critiquePrompt: '', critiqueSchema: '{"keep":true}' });
    try {
        await f.enable(); const c = f.controller;
        c.setInput('Preview these summary and critique prompts; do not apply'); c.send(); await settle();
        assert.equal(c.snapshot().interaction.source, 'configSettings');
        assert.equal(c.snapshot().interaction.hostManaged, true);
        assert.equal(f.reads(), 0); assert.equal(f.writes(), 0);
        c.answerPermission(c.snapshot().interaction.id, 'chat'); await settle();
        const a = c.snapshot().artifacts[0];
        assert.deepEqual(a.content.preview.manifest.settings, changes);
        assert.deepEqual(a.content.preview.warnings, []);
        assert.equal(f.settings.summaryPrompt, ''); assert.equal(f.settings.critiquePrompt, '');
        const action = c.prepareConfigApply(a.id, a.revision); await c.approveConfigApply(action.id);
        assert.equal(f.settings.summaryPrompt, changes.summaryPrompt);
        assert.equal(f.settings.critiquePrompt, changes.critiquePrompt);
        assert.equal(f.settings.critiqueSchema, '{"keep":true}'); assert.equal(f.writes(), 1);
        await c.checkReceipt(action.id); assert.equal(c.snapshot().configChecks[action.id].state, 'matched');
    } finally { await f.controller.dispose(); }
});
function fixture(steps, chat = true) {
    const events = new EventEmitter(), ctx = { chatId: chat ? 'A' : '', groupId: 'g', groups: [{ id: 'g', members: [] }], chat: [], chatMetadata: {}, eventSource: events, eventTypes: { CHAT_CHANGED: 'chat' } };
    const settings = { memoryEnabled: true, autoMemoryEnabled: true, autoMemoryInterval: 10, autoMemorySpeakers: false, memoryMaxEntries: 200, mode: 'formula' };
    let reads = 0, writes = 0;
    const getSettings = () => { reads++; return settings; };
    const providerPort = createProviderPort({ getSettings, getContext: () => ctx, extensionKey: 'gd' });
    let host;
    const memoryLimitPort = createMemoryLimitPort({ getTarget: () => host.currentTarget(), getMetadata: () => ctx.chatMetadata,
        extensionKey: 'gd', memorySystem: { isPruning: () => false, pruneAfter: async () => {} } });
    host = createHostBridge({ getSettings, getContext: () => ctx, extensionKey: 'gd', providerPort, memoryLimitPort,
        contextConfig: { read: () => ({ ...CONTEXT_DEFAULTS, historyAuthorization: 'ask' }) }, // Exercise optional history approval independently of tool grants.
        configWriter: createConfigWriter({ getSettings, isBusy: () => false, saveSettings: async () => { writes++; }, memoryLimitPort }) });
    const model = scriptedModel(steps), controller = createMuyuController({ host, createModel: () => model });
    return { controller, model, settings, host, ctx, reads: () => reads, writes: () => writes,
        async enable() { await controller.configure({ endpoint: 'https://example.test', model: 'fake', apiKey: 'synthetic' }); await controller.saveRunConfig({ ...RUN_DEFAULTS, modelCalls: 16 }); },
        switch(id) { ctx.chatId = id; events.emit('chat'); },
    };
}
test('Unified global conversation asks permission, lazily drafts, confirms once and checks without mode/field selection', async () => {
    const f = fixture([ask('memoryConfig'), preview(), [text('draft only'), done], [text('plain answer'), done]], false);
    await f.enable(); const c = f.controller; assert.equal(c.snapshot().mode, 'assistant');
    c.setInput('set interval 15'); c.send(); await settle();
    assert.equal(f.reads(), 0); const request = c.snapshot().interaction; assert.equal(request.source, 'memoryConfig');
    c.answerPermission(request.id, 'chat'); await settle();
    const s = c.snapshot(); assert.equal(s.notice, null); assert.equal(s.artifacts.length, 1); assert.equal(f.writes(), 0);
    const history = JSON.parse(c.exportHistory());
    assert.equal(history.version, 7);
    assert.deepEqual(history.messages.filter(row => row.role === 'user').map(row => row.origin), ['question', 'continuation']);
    const a = s.artifacts[0], action = c.prepareConfigApply(a.id, a.revision); await c.approveConfigApply(action.id);
    assert.equal(f.writes(), 1); await c.checkReceipt(action.id); assert.equal(c.snapshot().configChecks[action.id].state, 'matched');
    f.switch('A'); await c.openSession(s.history.sessionId);
    assert.equal(c.snapshot().targetKind, 'global'); c.setInput('hello'); c.send(); await settle();
    assert.equal(c.snapshot().runs.at(-1).status, 'succeeded'); assert.equal(c.snapshot().artifacts.length, 1);
    await c.dispose();
});

test('General settings request produces an approved leaf patch, versioned history and fresh receipt check', async () => {
    const f = fixture([ask('configSettings'), [call('muyu.settings.contract', { fields: ['mode', 'scoreWeights.mention', 'llmPrompt'] }), done],
        [call('muyu.settings.preview', { changes: { mode: 'llm', 'scoreWeights.mention': 55, llmPrompt: 'Focus on relevance.\n{{recentMessages}}' } }), done], [text('Preview only'), done]], false);
    f.settings.scoreWeights = { mention: 30, keyword: 15 }; f.settings.llmPrompt = '';
    await f.enable(); const c = f.controller; c.setInput('Change mode, weight and prompt'); c.send(); await settle();
    assert.equal(f.reads(), 0); c.answerPermission(c.snapshot().interaction.id, 'chat'); await settle();
    const s = c.snapshot(); assert.equal(s.notice, null); assert.equal(s.artifacts.length, 1); assert.equal(f.writes(), 0);
    const a = s.artifacts[0]; assert.equal(a.content.module, 'settings-config');
    const action = c.prepareConfigApply(a.id, a.revision); f.settings.scoreWeights.keyword = 99;
    await c.approveConfigApply(action.id); assert.equal(f.settings.mode, 'llm'); assert.equal(f.settings.scoreWeights.keyword, 99); assert.equal(f.writes(), 1);
    assert.equal(c.snapshot().receipts[0].version, 2); assert.equal(c.snapshot().receiptRecordFailed, false);
    await c.checkReceipt(action.id); assert.equal(c.snapshot().configChecks[action.id].state, 'matched');
    const history = JSON.parse(c.exportHistory()); assert.ok(history.required.includes('source:configSettings')); assert.ok(!history.required.includes('source:memoryConfig'));
    await c.dispose();
});

test('Denied general settings cannot be read through the new preview tool', async () => {
    const f = fixture([ask('configSettings'), [call('muyu.settings.read', { fields: ['mode'] }), done], [call('muyu.settings.preview', { changes: { mode: 'llm' } }), done], [text('No access'), done]], false);
    await f.enable(); f.controller.setInput('Change mode'); f.controller.send(); await settle();
    f.controller.answerPermission(f.controller.snapshot().interaction.id, 'deny'); await settle();
    assert.equal(f.reads(), 0); assert.equal(f.writes(), 0); assert.equal(f.controller.snapshot().artifacts.length, 0);
    await f.controller.dispose();
});

test('Memory limit preview pauses the original call for exact missing sources and resumes without model reselection', async () => {
    const changes = { memoryMaxEntries: 10 };
    const f = fixture([[call('muyu.settings.read', { fields: ['memoryMaxEntries'] }), done],
        [call('muyu.settings.preview', { changes }), done], [text('Preview only'), done]]);
    f.ctx.chatMetadata.gd = { charMemories: { alice: Array.from({ length: 12 }, (_, i) => ({ event: `m${i}` })) } };
    try {
        await f.enable(); const c = f.controller;
        c.setInput('把单角色记忆上限改成 10，先预览，不要应用'); c.send(); await settle();
        assert.equal(c.snapshot().interaction.source, 'memoryConfig');
        assert.equal(c.snapshot().interaction.hostManaged, true);
        assert.equal(f.model.requests.length, 1);
        c.answerPermission(c.snapshot().interaction.id, 'task'); await settle();
        assert.equal(c.snapshot().interaction.source, 'memoryDiagnostics');
        assert.equal(c.snapshot().interaction.hostManaged, true);
        assert.equal(f.model.requests.length, 2);
        assert.equal(c.snapshot().artifacts.length, 0);
        c.answerPermission(c.snapshot().interaction.id, 'task'); await settle();
        assert.equal(f.model.requests.length, 3);
        assert.equal(f.model.requests.at(-1).messages.filter(m => m.role === 'tool' && m.result?.ok).length, 2);
        const resumed = f.model.requests.at(-1).messages;
        const calls = resumed.flatMap(m => m.role === 'assistant' ? m.toolCalls || [] : []);
        assert.deepEqual(resumed.filter(m => m.role === 'tool').map(m => m.callId), calls.map(c => c.callId));
        assert.deepEqual(calls.map(c => c.args), [{ fields: ['memoryMaxEntries'] }, { changes }]);
        const artifact = c.snapshot().artifacts.find(a => a.kind === 'config-draft');
        assert.deepEqual(artifact.content.preview.manifest.settings, changes);
        assert.equal(artifact.content.preview.impact.remove, 2);
        assert.equal(f.settings.memoryMaxEntries, 200); assert.equal(f.writes(), 0);
    } finally { await f.controller.dispose(); }
});

test('Host-managed read denial resumes the same call as user_denied without reading settings', async () => {
    const f = fixture([[call('muyu.settings.read', { fields: ['memoryMaxEntries'] }), done], [text('No access'), done]]);
    try {
        await f.enable(); const c = f.controller;
        c.setInput('Read the memory limit'); c.send(); await settle();
        const request = c.snapshot().interaction;
        assert.equal(request.source, 'memoryConfig');
        assert.equal(request.hostManaged, true);
        assert.equal(f.reads(), 0);
        c.answerPermission(request.id, 'deny'); await settle();
        assert.equal(c.snapshot().interaction.status, 'denied');
        assert.equal(f.reads(), 0);
        assert.equal(f.model.requests.length, 2);
        const failure = f.model.requests.at(-1).messages.find(m => m.role === 'tool' && m.result?.error?.reason === 'user_denied');
        assert.equal(failure.result.error.code, 'PERMISSION_DENIED');
    } finally { await f.controller.dispose(); }
});

test('Changing chats expires a host-paused read without executing it', async () => {
    const f = fixture([[call('muyu.provider.read', { id: 'variables', selector: '', revision: '', offset: 0 }), done]]);
    let reads = 0;
    Object.defineProperty(f.ctx.chatMetadata, 'gd', { get() { reads++; throw Error('Old chat was read'); } });
    try {
        await f.enable(); const c = f.controller;
        c.setInput('Inspect variables'); c.send(); await settle();
        const request = c.snapshot().interaction;
        assert.equal(request.source, 'variables');
        assert.equal(request.hostManaged, true);
        f.switch('B'); await settle();
        assert.throws(() => c.answerPermission(request.id, 'task'), /INTERACTION_STALE/);
        assert.equal(reads, 0);
        assert.equal(f.model.requests.length, 1);
    } finally { await f.controller.dispose(); }
});

test('Repeating an approved permission request is not reported as a user denial', async () => {
    const f = fixture([ask('memoryConfig'), ask('memoryConfig'), [text('Already approved'), done]]);
    try {
        await f.enable(); const c = f.controller;
        c.setInput('Check memory configuration'); c.send(); await settle();
        c.answerPermission(c.snapshot().interaction.id, 'task'); await settle();
        assert.equal(c.snapshot().interaction.status, 'granted');
        const result = f.model.requests.at(-1).messages.find(m => m.role === 'tool' && m.result?.error?.code === 'PERMISSION_REQUEST_INVALID');
        assert.equal(result.result.effectState, 'not_started');
        assert.equal(c.snapshot().artifacts.length, 0);
    } finally { await f.controller.dispose(); }
});

test('Denied memory diagnostics blocks the limit preview without offering another source', async () => {
    const f = fixture([ask('memoryConfig'), ask('memoryDiagnostics'),
        [call('muyu.settings.preview', { changes: { memoryMaxEntries: 10 } }), done], [text('No preview'), done]]);
    try {
        await f.enable(); const c = f.controller;
        c.setInput('Preview a memory limit of 10'); c.send(); await settle();
        c.answerPermission(c.snapshot().interaction.id, 'task'); await settle();
        c.answerPermission(c.snapshot().interaction.id, 'deny'); await settle();
        const failure = f.model.requests.at(-1).messages.find(m => m.role === 'tool' && m.result?.error?.code === 'PERMISSION_DENIED');
        assert.ok(failure); assert.equal(failure.result.error.missingSources, undefined);
        assert.equal(c.snapshot().artifacts.length, 0);
        assert.equal(f.settings.memoryMaxEntries, 200); assert.equal(f.writes(), 0);
    } finally { await f.controller.dispose(); }
});

test('Invalid replacement preview cannot publish the earlier successful candidate', async () => {
    const f = fixture([ask('configSettings'), [call('muyu.settings.preview', { changes: { mode: 'llm' } }), done],
        [call('muyu.settings.preview', { changes: { mode: 'not-a-mode' } }), done], [text('Cannot preview that'), done]], false);
    await f.enable(); f.controller.setInput('change mode'); f.controller.send(); await settle();
    f.controller.answerPermission(f.controller.snapshot().interaction.id, 'chat'); await settle();
    assert.equal(f.controller.snapshot().artifacts.length, 0); assert.equal(f.writes(), 0); await f.controller.dispose();
});

test('Story sources require separate grants before reads and protect dependent history after task expiry', async () => {
    const sourceRead = id => [call('muyu.provider.read', { id, selector: '', revision: '', offset: 0 }), done];
    const f = fixture([sourceRead('variables'), sourceRead('storyBlueprint'), [text('PROTECTED_STORY_RESULT'), done], [text('without old history'), done]]);
    f.settings.storyBlueprintEnabled = true;
    let variableReads = 0, blueprintReads = 0;
    f.ctx.chatMetadata.gd = {};
    Object.defineProperty(f.ctx.chatMetadata.gd, 'variables', { get() { variableReads++; return { defs: [], values: {} }; } });
    Object.defineProperty(f.ctx.chatMetadata.gd, 'storyBlueprint', { get() { blueprintReads++; return { blueprint: null }; } });
    await f.enable(); const c = f.controller; c.setInput('inspect story'); c.send(); await settle();
    assert.equal(variableReads, 0); assert.equal(blueprintReads, 0);
    assert.equal(c.snapshot().interaction.source, 'variables');
    assert.equal(c.snapshot().interaction.hostManaged, true);
    c.answerPermission(c.snapshot().interaction.id, 'task'); await settle();
    assert.ok(variableReads > 0); assert.equal(blueprintReads, 0); assert.equal(c.snapshot().interaction.source, 'storyBlueprint');
    c.answerPermission(c.snapshot().interaction.id, 'task'); await settle();
    assert.ok(blueprintReads > 0); assert.equal(f.writes(), 0);
    assert.deepEqual(JSON.parse(c.exportHistory()).required.sort(), ['source:storyBlueprint', 'source:variables']);
    c.setInput('continue'); assert.throws(() => c.send(), /HISTORY_PERMISSION_REQUIRED/);
    c.setOmitHistory(true); c.send(); await settle(); assert.doesNotMatch(JSON.stringify(f.model.requests.at(-1)), /PROTECTED_STORY_RESULT/);
    await c.dispose();
});

test('Denied variable access does not read metadata or authorize blueprint, and global sessions cannot request either', async () => {
    const calls = ['variables', 'storyBlueprint'].map(id => [call('muyu.provider.read', { id, selector: '', revision: '', offset: 0 }), done]);
    const f = fixture([ask('variables'), ...calls, [text('denied'), done]]); let reads = 0;
    Object.defineProperty(f.ctx.chatMetadata, 'gd', { get() { reads++; throw Error('Must not read'); } });
    await f.enable(); const c = f.controller; c.setInput('read'); c.send(); await settle(); c.answerPermission(c.snapshot().interaction.id, 'deny'); await settle();
    assert.equal(reads, 0); assert.match(JSON.stringify(f.model.requests), /PERMISSION_DENIED/); await c.dispose();
    const g = fixture([ask('variables'), ask('storyBlueprint'), [text('no chat'), done]], false);
    await g.enable(); g.controller.setInput('read'); g.controller.send(); await settle(); assert.equal(g.controller.snapshot().interaction, null); await g.controller.dispose();
});
test('Unified conversation can publish multiple diagnostics and a draft without classifying the question', async () => {
    const f = fixture([ask('memoryConfig'), ask('memoryDiagnostics'), ask('directorDiagnostics'),
        [call('muyu.memory.inspect'), done], [call('muyu.director.inspect'), done], preview(), [text('results'), done]]);
    await f.enable(); const c = f.controller; c.setInput('diagnose and propose interval'); c.send(); await settle();
    for (const source of ['memoryConfig', 'memoryDiagnostics', 'directorDiagnostics']) {
        assert.equal(c.snapshot().interaction.source, source); c.answerPermission(c.snapshot().interaction.id, 'task'); await settle();
    }
    const s = c.snapshot(); assert.equal(s.runs.at(-1).status, 'succeeded'); assert.equal(s.notice, null);
    assert.equal(s.artifacts.filter(a => a.kind === 'report').length, 2); assert.equal(s.artifacts.filter(a => a.kind === 'config-draft').length, 1);
    assert.equal(f.writes(), 0); assert.deepEqual(s.sourceGrants, []);
    const history = JSON.parse(c.exportHistory()); assert.ok(history.required.includes('source:memoryConfig')); assert.ok(history.required.includes('source:directorDiagnostics'));
    await c.dispose();
});
test('Denial cannot be bypassed through diagnostics or preview; plain conversation initializes no settings', async () => {
    const f = fixture([ask('memoryConfig'), [call('muyu.memory.inspect'), done], preview(), read(), ask('memoryConfig'), [text('no access'), done]]);
    await f.enable(); const c = f.controller; c.setInput('read it'); c.send(); await settle(); c.answerPermission(c.snapshot().interaction.id, 'deny'); await settle();
    assert.equal(f.reads(), 0); assert.equal(f.writes(), 0); assert.equal(c.snapshot().artifacts.length, 0);
    assert.equal(c.snapshot().interaction.status, 'denied'); assert.equal(c.snapshot().notice, null);
    assert.match(JSON.stringify(f.model.requests), /PERMISSION_DENIED/); await c.dispose();
});
test('Task grant expiration requires explicit history approval, separate from fresh source approval', async () => {
    const f = fixture([ask('memoryConfig'), read(), [text('PROTECTED_CONFIG_ANSWER'), done], ask('memoryConfig'), [text('followup'), done]]);
    await f.enable(); const c = f.controller; c.setInput('config'); c.send(); await settle(); c.answerPermission(c.snapshot().interaction.id, 'task'); await settle();
    c.setInput('explain previous answer'); assert.throws(() => c.send(), /HISTORY_PERMISSION_REQUIRED/);
    c.allowHistory(); c.send(); await settle();
    assert.match(JSON.stringify(f.model.requests.at(-1)), /PROTECTED_CONFIG_ANSWER/);
    assert.equal(c.snapshot().interaction.source, 'memoryConfig');
    c.answerPermission(c.snapshot().interaction.id, 'task'); await settle();
    assert.match(JSON.stringify(f.model.requests.at(-1)), /PROTECTED_CONFIG_ANSWER/); await c.dispose();
});
test('Source scope uses the catalog: global grants follow owner, chat grants never follow another chat', () => {
    const p = createPermissions(), A = { kind: 'chat', userKey: 'u', chatKey: 'A' }, B = { ...A, chatKey: 'B' }, G = { kind: 'global', userKey: 'u' };
    const r = source => ({ source, reason: 'read', target: A, taskId: 't' });
    p.decide(r('memoryConfig'), 'chat', () => {}); p.decide(r('memoryDiagnostics'), 'chat', () => {});
    assert.equal(p.allows('source:memoryConfig', B), true); assert.equal(p.allows('source:memoryConfig', G), true);
    assert.equal(p.allows('source:memoryConfig', { ...G, userKey: 'other' }), false);
    assert.equal(p.allows('source:memoryDiagnostics', B), false);
    assert.throws(() => p.decide({ ...r('memoryDiagnostics'), target: G }, 'chat', () => {}));
    p.revoke('source:memoryConfig', G); assert.equal(p.allows('source:memoryConfig', A), false);
});
test('Legacy history stays viewable but cannot resume from the unified interface', async () => {
    const f = fixture([[text('legacy'), done]]); await f.enable(); const c = f.controller;
    c.setMode('chat'); c.setInput('old'); c.send(); await settle(); const id = JSON.parse(c.exportHistory()).id;
    c.setMode('assistant'); await c.openSession(id); assert.equal(c.snapshot().readOnly, true);
    assert.throws(() => c.send(), /HISTORY_READ_ONLY/); assert.match(c.exportHistory(), /legacy/);
    c.newSession(); assert.equal(c.snapshot().readOnly, false); await c.dispose();
});

test('Unified no-data reply reads nothing; global sessions cannot request chat data and v5 import stays inert', async () => {
    const f = fixture([[text('hello'), done], ask('memoryDiagnostics'), [text('no chat'), done]], false);
    await f.enable(); const c = f.controller; c.setInput('hello'); c.send(); await settle();
    assert.equal(f.reads(), 0); assert.equal(c.snapshot().notice, null); assert.equal(c.snapshot().artifacts.length, 0);
    c.setInput('diagnose'); c.send(); await settle(); assert.equal(c.snapshot().interaction, null); assert.equal(f.reads(), 0);
    const exported = c.exportHistory(); await c.importHistory(exported); assert.equal(c.snapshot().readOnly, true);
    assert.throws(() => c.send(), /HISTORY_READ_ONLY/); assert.equal(f.model.requests.length, 3); await c.dispose();
});
test('Changing chat expires pending requests; connection changes clear source grants', async () => {
    const f = fixture([ask('memoryConfig'), [text('granted'), done], ask('memoryDiagnostics')]);
    await f.enable(); const c = f.controller; c.setInput('config'); c.send(); await settle();
    c.answerPermission(c.snapshot().interaction.id, 'chat'); await settle();
    c.setInput('diagnose'); c.send(); await settle(); const old = c.snapshot().interaction;
    f.switch('B'); await settle(); assert.throws(() => c.answerPermission(old.id, 'chat'), /INTERACTION_STALE/);
    assert.ok(c.snapshot().sourceGrants.includes('source:memoryConfig'));
    await f.enable(); assert.deepEqual(c.snapshot().sourceGrants, []); await c.dispose();
});
test('Manually omitting history remains effective across unified permission continuations', async () => {
    const f = fixture([ask('memoryConfig'), read(), [text('SECRET_OLD_ANSWER'), done], ask('memoryConfig'), [text('new'), done]]);
    await f.enable(); const c = f.controller; c.setInput('config'); c.send(); await settle(); c.answerPermission(c.snapshot().interaction.id, 'task'); await settle();
    c.setOmitHistory(true); c.setInput('new question'); c.send(); await settle();
    c.answerPermission(c.snapshot().interaction.id, 'task'); await settle();
    assert.doesNotMatch(JSON.stringify(f.model.requests.at(-1)), /SECRET_OLD_ANSWER/); await c.dispose();
});
