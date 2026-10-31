import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createMuyuController } from '../../muyu/application/controller.js';
import { createHostBridge } from '../../muyu/host/bridge.js';
import { createTaskEvidence } from '../../muyu/application/task-evidence.js';
import { createTaskReadEvidence } from '../../muyu/application/task-read-evidence.js';
import { RUN_DEFAULTS } from '../../muyu/core/budget.js';
import { CONTEXT_DEFAULTS } from '../../muyu/context/policy.js';
import { createRunConfigStore } from '../../muyu/host/run-config.js';
import { createContextConfigStore } from '../../muyu/host/context-config.js';
import { scriptedModel, text, done, deferred, flush } from './helpers/muyu-subject.mjs';

const tool = (toolId, args = {}, callId = 'c1') => ({ type: 'tool_call_complete', call: { toolId, args, version: 1, callId } });
const select = [tool('muyu.tools.select', { groups: ['muyu-self'] }), done];
const query = section => [tool('muyu.self.read', { section }, 'self-read'), done];
const settle = async () => { for (let i = 0; i < 16; i++) await flush(); };
function fixture(steps, { access = 'all', noChat = false, runConfig, contextConfig, ports = {} } = {}) {
    let writes = 0;
    const events = new EventEmitter(), ctx = { groupId: 'g', chatId: noChat ? null : 'A', chat: [{ mes: 'PRIVATE_CHAT' }], chatMetadata: {}, eventSource: events, eventTypes: { CHAT_CHANGED: 'chat' } };
    const port = value => ({ read: () => value, save: async () => { writes++; } });
    const model = scriptedModel(steps);
    const settings = { agentConfigs: { 'muyu-assistant': { apiKey: 'PRIVATE_STORED_KEY', endpoint: 'PRIVATE_ENDPOINT' } }, muyuHistoryData: { body: 'PRIVATE_ARCHIVE' } };
    const host = createHostBridge({ getContext: () => ctx, getSettings: () => settings, extensionKey: 'gd', pageId: 'test',
        runConfig: runConfig || port({ ...RUN_DEFAULTS }), contextConfig: contextConfig || port({ ...CONTEXT_DEFAULTS }),
        permissionConfig: port({ readAccess: access }), displayConfig: port({ processDetail: 'standard', theme: 'light' }),
        instructionConfig: port({ enabled: false, text: 'PRIVATE_SAVED_PROMPT', replyLanguage: { enabled: true, language: 'English' } }), ...ports });
    const controller = createMuyuController({ host, createModel: () => model });
    return { host, ctx, model, controller, writes: () => writes, enable: () => controller.configure({ endpoint: 'https://fixture.invalid/chat/completions', apiKey: 'PRIVATE_LIVE_KEY', model: 'private-name', thinking: false }) };
}
const readResult = f => f.model.requests.flatMap(request => request.messages).filter(message => message.role === 'tool' && message.callId === 'self-read').at(-1)?.result;
const field = (result, key) => JSON.parse(result.data.text).sections.flatMap(section => section.fields).find(item => item.key === key);

for (const noChat of [false, true]) test('controller exposes read-only self parameters without a service or chat, noChat=' + noChat, async () => {
    const f = fixture([select, query('overview'), [text('Checked'), done]], { noChat }); await f.enable();
    f.controller.setInstructionDraft({ enabled: true, text: 'PRIVATE_UNSAVED_DRAFT' });
    f.controller.setInput('Check your own settings'); await f.controller.send(); await settle();
    assert.equal(f.controller.snapshot().runs.at(-1).status, 'succeeded');
    const result = readResult(f); assert.equal(result?.data?.status, 'ok');
    assert.equal(field(result, 'modelCalls').configured.text, String(RUN_DEFAULTS.modelCalls));
    assert.equal(field(result, 'additionalInstructions').configured.text, '关闭 / Off');
    assert.equal(field(result, 'instructionLength').configured.text, String('PRIVATE_SAVED_PROMPT'.length));
    assert.equal(field(result, 'processDetail').configured.text, '标准 / Standard');
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|private-name|fixture\.invalid/);
    assert.equal(f.writes(), 0); assert.equal(f.controller.snapshot().artifacts.length, 0);
    assert.ok(JSON.parse(f.controller.exportHistory()).required.includes('source:muyuSelfConfig'));
    await f.controller.dispose();
});
for (const decision of ['task', 'deny']) test('controller pauses once for the exact self source and does not loop after ' + decision, async () => {
    const f = fixture([select, query('run'), [text('Finished'), done]], { access: 'ask' }); await f.enable();
    f.controller.setInput('Read your run limits'); await f.controller.send(); await settle();
    const request = f.controller.snapshot().interaction; assert.equal(request?.source, 'muyuSelfConfig');
    assert.equal(readResult(f), undefined);
    f.controller.answerPermission(request.id, decision); await settle();
    assert.equal(f.controller.snapshot().runs.at(-1).status, 'succeeded'); assert.notEqual(f.controller.snapshot().interaction?.status, 'pending');
    assert.equal(f.model.requests.length, 3, 'permission resumes the original tool, not another model request to ask again');
    const result = readResult(f);
    if (decision === 'task') assert.equal(result.data.status, 'ok');
    else { assert.equal(result.ok, false); assert.equal(result.error.code, 'PERMISSION_DENIED'); }
    assert.equal(f.writes(), 0); await f.controller.dispose();
});

test('current parameter changes do not replace this execution segment\'s frozen budgets', async () => {
    const started = deferred(), wait = deferred();
    const f = fixture([select, async () => { started.resolve(); await wait.promise; return query('overview'); }, [text('Compared'), done]]);
    await f.enable(); f.controller.setInput('Compare configured and effective budgets'); await f.controller.send(); await started.promise;
    await f.controller.saveRunConfig({ ...RUN_DEFAULTS, maxTokens: 1024 });
    await f.controller.saveContextConfig({ ...CONTEXT_DEFAULTS, inputTokens: 50000 });
    wait.resolve(); await settle();
    const result = readResult(f); assert.equal(result?.data?.status, 'ok');
    assert.equal(field(result, 'maxTokens').configured.text, '1024'); assert.equal(field(result, 'maxTokens').effective.text, String(RUN_DEFAULTS.maxTokens));
    assert.equal(field(result, 'inputTokens').configured.text, '50000'); assert.equal(field(result, 'inputTokens').effective.text, String(CONTEXT_DEFAULTS.inputTokens));
    assert.equal(f.writes(), 2, 'only the two explicit GUI changes save'); await f.controller.dispose();
});

test('self parameters use the same legacy-default interpretation as the GUI without writing upgrades', async () => {
    let writes = 0;
    const settings = { muyuRunConfig: { modelCalls: 6, toolCalls: 16, timeMs: 120000, maxTokens: 8192, providerBytes: 24000 },
        muyuContextConfig: { inputTokens: 32000, recentTurns: 12, autoSummary: false, historyAuthorization: 'auto', summaryTimeMs: CONTEXT_DEFAULTS.summaryTimeMs, summaryTokens: 8192 } };
    const options = { getSettings: () => settings, saveSettings: async () => { writes++; } };
    const f = fixture([select, query('overview'), [text('Checked'), done]], { runConfig: createRunConfigStore(options), contextConfig: createContextConfigStore(options) });
    await f.enable(); f.controller.setInput('Check limits'); await f.controller.send(); await settle();
    assert.equal(field(readResult(f), 'modelCalls').configured.text, String(RUN_DEFAULTS.modelCalls));
    assert.equal(field(readResult(f), 'inputTokens').configured.text, String(CONTEXT_DEFAULTS.inputTokens));
    assert.equal(settings.muyuRunConfig.modelCalls, 6); assert.equal(writes, 0); await f.controller.dispose();
});

test('full access still has no self writer and the task read carries only metadata as evidence', async () => {
    const f = fixture([select, query('run'), [text('Checked'), done]], { access: 'ask' }); await f.enable(); f.controller.setFullAccess(true);
    f.controller.setInput('Read, do not change'); await f.controller.send(); await settle();
    const result = readResult(f); assert.equal(result?.data?.status, 'ok'); assert.equal(f.writes(), 0);
    const call = { toolId: 'muyu.self.read', callId: 'self-read', args: { section: 'run' } };
    const evidence = createTaskEvidence(); evidence.observe(call, result, 'r');
    assert.equal(evidence.snapshot().observations[0].outcome, 'self-config-snapshot'); assert.deepEqual(evidence.snapshot().observedSettingFields, []);
    const records = createTaskReadEvidence({ canCarry: () => true }); records.observe(call, result, 'r');
    const data = records.project(f.host.currentTarget(), 'task'); assert.equal(data.evidence.length, 1);
    assert.doesNotMatch(JSON.stringify(data), /configured|effective|PRIVATE_|32768/);
    assert.equal(f.controller.snapshot().artifacts.length, 0); await f.controller.dispose();
});

const textQuery = item => [tool('muyu.self.read_text', { item }, 'self-read'), done];
for (const [item, expected] of [['configured-instructions', 'PRIVATE_SAVED_PROMPT'], ['effective-instructions', ''], ['draft-instructions', 'new preference [REDACTED]']]) test('controller distinguishes saved, injected and unsaved preference text: ' + item, async () => {
    const f = fixture([select, textQuery(item), [text('Read'), done]], { noChat: true }); await f.enable();
    f.controller.setInstructionDraft({ enabled: true, text: 'new preference PRIVATE_LIVE_KEY' });
    f.controller.setInput('Read your own instruction text'); await f.controller.send(); await settle();
    const result = readResult(f), body = JSON.parse(result.data.text);
    assert.equal(body.text, expected); assert.equal(body.item, item); assert.equal(body.enabled, item === 'draft-instructions');
    assert.equal(body.draft, item === 'draft-instructions'); assert.equal(body.dirty, item === 'draft-instructions' ? true : null);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_LIVE_KEY|PRIVATE_ARCHIVE|PRIVATE_CHAT/);
    assert.ok(JSON.parse(f.controller.exportHistory()).required.includes('source:muyuSelfText'));
    assert.equal(f.writes(), 0); assert.equal(f.controller.snapshot().instructionSettings.draft.text, 'new preference PRIVATE_LIVE_KEY'); await f.controller.dispose();
});
for (const decision of ['task', 'deny']) test('body source authorization resumes the original call exactly once: ' + decision, async () => {
    const f = fixture([select, textQuery('configured-instructions'), [text('Done'), done]], { access: 'ask' }); await f.enable();
    f.controller.setInput('Read your configured additional instructions'); await f.controller.send(); await settle();
    const request = f.controller.snapshot().interaction; assert.equal(request.source, 'muyuSelfText'); assert.equal(readResult(f), undefined);
    f.controller.answerPermission(request.id, decision); await settle();
    assert.equal(f.controller.snapshot().runs.at(-1).status, 'succeeded'); assert.equal(f.model.requests.length, 3);
    assert.equal(readResult(f).ok, decision === 'task'); assert.equal(f.writes(), 0); await f.controller.dispose();
});
test('registered form drafts are isolated from applied connection and removed by their owner', async () => {
    const f = fixture([select, textQuery('draft-connection'), [text('Read'), done]]); await f.enable();
    const unregister = f.controller.registerSelfConnectionDraft(() => ({ source: 'independent', endpoint: 'https://user:pass@draft.test/chat/completions?key=private', model: 'other-model PRIVATE_LIVE_KEY', apiKey: 'RAW_FORM_KEY' }));
    const closedPanel = f.controller.registerSelfConnectionDraft(() => null);
    f.controller.setInput('Read the unsaved connection form'); await f.controller.send(); await settle();
    const body = JSON.parse(readResult(f).data.text), value = JSON.parse(body.text);
    assert.equal(body.draft, true); assert.equal(body.dirty, null); assert.equal(value.endpoint, 'https://draft.test/chat/completions');
    assert.doesNotMatch(body.text, /PRIVATE_LIVE_KEY|RAW_FORM_KEY|user:pass|key=private/);
    assert.equal(f.controller.snapshot().connection.model, 'private-name'); assert.equal(f.writes(), 0);
    unregister(); unregister(); closedPanel(); await f.controller.dispose();
});
for (const mode of ['missing', 'unmounted', 'ambiguous', 'throwing']) test('unavailable form is not silently treated as an empty connection: ' + mode, async () => {
    const f = fixture([select, textQuery('draft-connection'), [text('Unavailable'), done]]); await f.enable();
    if (mode === 'unmounted') f.controller.registerSelfConnectionDraft(() => ({}))();
    if (mode === 'ambiguous') { f.controller.registerSelfConnectionDraft(() => ({})); f.controller.registerSelfConnectionDraft(() => ({})); }
    if (mode === 'throwing') f.controller.registerSelfConnectionDraft(() => { throw Error('PRIVATE_UI_ERROR'); });
    f.controller.setInput('Read connection draft'); await f.controller.send(); await settle();
    assert.deepEqual(readResult(f).data, { status: 'unavailable', text: '' }); assert.equal(f.writes(), 0); await f.controller.dispose();
});
test('configured connection reads active allowlisted text without making requests or changing it', async () => {
    const f = fixture([select, textQuery('configured-connection'), [text('Checked'), done]]); await f.enable();
    f.controller.setInput('Read your active connection'); await f.controller.send(); await settle();
    const body = JSON.parse(readResult(f).data.text), value = JSON.parse(body.text);
    assert.equal(value.model, 'private-name'); assert.equal(value.endpoint, 'https://fixture.invalid/chat/completions'); assert.equal(body.draft, false);
    assert.doesNotMatch(body.text, /PRIVATE_LIVE_KEY|PRIVATE_STORED_KEY|apiKey/); assert.equal(f.writes(), 0); assert.equal(f.model.requests.length, 3); await f.controller.dispose();
});

test('operational self inspection is passive and distinguishes configured service switches from captured admission', async () => {
    let captures = 0, checks = 0, opens = 0, skillLoads = 0;
    const services = { captureTools: () => { captures++; return { allows: key => key === 'webFetch' }; },
        toolStatus: () => ({ status: 'available', private: 'PRIVATE_SERVICE_DETAILS' }), check: () => { checks++; },
        documentsEnabled: () => true, pagesEnabled: () => false, workspaceEnabled: () => true, jsonEnabled: () => true, cancel() {} };
    const history = { enabled: () => false, storageChoice: () => 'world-book', routing: () => ({ readSource: 'world-book', writeTargets: ['server', 'account-settings'], private: 'PRIVATE_PATH' }),
        worldBookTargetMiB: () => 12, open: () => { opens++; throw Error('PRIVATE_OPEN_ERROR'); } };
    const skills = { selfState: () => ({ enabled: true, loaded: false }), ready: () => { skillLoads++; }, subscribe: () => () => {}, close() {} };
    const f = fixture([select, query('tools'), [text('Checked'), done]], { noChat: true, ports: { services, history, skills,
        agentMemory: { enabled: () => false, subscribe: () => () => {} }, webSearch: { describe: () => ({ maxSearches: 3, maxResults: 5, resultBytes: 12000, apiKey: 'PRIVATE_SEARCH_KEY' }), cancel() {} },
        stDiagnostics: { selfState: () => ({ enabled: true, browserErrors: false }), snapshot: () => ({}), dispose() {} },
        stPromptSnapshots: { selfState: () => ({ enabled: false }), snapshot: () => ({}), dispose() {} } } });
    await f.enable(); f.controller.setInput('Which tools are enabled and usable?'); await f.controller.send(); await settle();
    const result = readResult(f); assert.equal(result.data.status, 'ok');
    assert.equal(field(result, 'documents').configured.text, '开启 / On'); assert.equal(field(result, 'documents').effective.text, '关闭 / Off');
    assert.equal(field(result, 'pages').configured.text, '关闭 / Off'); assert.equal(field(result, 'pages').effective.text, '开启 / On');
    assert.equal(field(result, 'skills').configured.text, '开启 / On'); assert.equal(field(result, 'skillsLoaded').effective.text, '关闭 / Off');
    assert.equal(field(result, 'diagnostics').configured.text, '开启 / On'); assert.equal(field(result, 'maxResults').configured.text, '5');
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|private-name|fixture\.invalid/);
    assert.equal(captures, 1, 'only ordinary send captures tools; self reads never capture again');
    assert.deepEqual([checks, opens, skillLoads, f.writes()], [0, 0, 0, 0]); await f.controller.dispose();
});
test('storage self inspection reads routing without opening stores and never substitutes requested source for an active reader', async () => {
    let opens = 0;
    const history = { enabled: () => false, storageChoice: () => 'world-book', routing: () => ({ readSource: 'world-book', writeTargets: ['browser', 'server'] }), worldBookTargetMiB: () => 16,
        open: () => { opens++; throw Error('PRIVATE_STORAGE_PATH'); } };
    const f = fixture([select, query('storage'), [text('Checked'), done]], { ports: { history } }); await f.enable();
    f.controller.setInput('Where do you store conversations?'); await f.controller.send(); await settle();
    const result = readResult(f); assert.equal(field(result, 'historyReadSource').configured.text, '世界书 / World book');
    assert.equal(field(result, 'historyReadSource').effective.state, 'unknown'); assert.equal(field(result, 'historyBackend').effective.state, 'unknown');
    assert.match(field(result, 'historyWriteTargets').configured.text, /Browser storage.*Service files/);
    assert.equal(field(result, 'worldBookTargetMiB').configured.text, '16'); assert.equal(opens, 0); assert.equal(f.writes(), 0); await f.controller.dispose();
});
test('missing optional service and throwing getters stay unknown without poisoning other sections', async () => {
    const f = fixture([select, query('tools'), [text('Checked'), done]], { ports: { services: { documentsEnabled: () => { throw Error('PRIVATE_RAW_ERROR'); }, cancel() {} } } });
    await f.enable(); f.controller.setInput('Check your optional tools'); await f.controller.send(); await settle();
    const result = readResult(f); assert.equal(result.data.status, 'ok'); assert.equal(field(result, 'serviceStatus').configured.state, 'unknown');
    assert.equal(field(result, 'documents').configured.state, 'unknown'); assert.equal(field(result, 'documents').effective.text, '关闭 / Off');
    assert.equal(field(result, 'memory').configured.state, 'unknown'); assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/); await f.controller.dispose();
});
