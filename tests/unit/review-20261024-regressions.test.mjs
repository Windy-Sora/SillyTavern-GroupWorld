import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createVariableSystem } from '../../systems/variable-system.js';
import { hasVariableIdCollision } from '../../ui/sections/variable-helpers.js';
import { createConfigProfileSubject, jsonFile } from './helpers/config-profile-subject.mjs';
import { createWorldBookScanner } from '../../systems/world-book-scanner.js';
import { createScriptExecutorSystem } from '../../systems/script-executor-system.js';
import { createChatSummarySystem } from '../../systems/chat-summary-system.js';
import { extractCustomAgentJson } from '../../systems/custom-agent-execution.js';
import { DEFAULT_SETTINGS } from '../../settings.js';
import { register as registerHistory } from '../../assets/providers/history.js';
import { register as registerWorldInfo } from '../../assets/providers/world-info.js';
import { getProviders, unregisterProvider } from '../../provider-registry.js';
import { createMemoryAgent } from '../../agents/memory.js';

const source = async name => (await readFile(new URL('../../' + name, import.meta.url), 'utf8')).replace(/\r\n/g, '\n');

test('Memory lookup never migrates substring, empty-name or ambiguous identities', async () => {
    const text = await source('index.js');
    const start = text.indexOf('getMemoriesForChar: async (name) => {');
    const end = text.indexOf('\n    log,', start);
    const memories = { 'ringo.png': [{ event: 'Ringo only' }] };
    const characters = [{ name: 'Rin', avatar: 'rin.png' }, { name: 'Ringo', avatar: 'ringo.png' }];
    const memorySystem = {
        listMemories: avatar => memories[avatar] || [],
        getStats: () => ({ 'ringo.png': { name: 'Ringo' } }),
        _setMemories() { assert.fail('Reading cannot migrate memories'); },
        _deleteKey() { assert.fail('Reading cannot delete memories'); },
    };
    const lookup = vm.runInNewContext('({' + text.slice(start, end) + '}).getMemoriesForChar', { characters, memorySystem, log() {} });
    for (const name of ['Rin', '', ' ', null, 'Ring']) assert.equal((await lookup(name)).length, 0);
    assert.equal((await lookup('Ringo'))[0].event, 'Ringo only');
    characters.push({ name: 'Ringo', avatar: 'other.png' });
    assert.equal((await lookup('Ringo')).length, 0);
    assert.deepEqual(Object.keys(memories), ['ringo.png']);
});

test('Variable autosave rejects detached, stale, deleted and empty-ID editors', async () => {
    const text = await source('ui/sections/variables.js');
    const start = text.indexOf('const saveCurrentEditor =');
    const end = text.indexOf('\n        function scheduleAutosave', start);
    for (const change of [{ connected: false }, { editorEpoch: 2 }, { selectedId: 'other' }, { id: undefined }, { id: '  ' }, { deleted: true }]) {
        const metadata = {};
        const variableSystem = createVariableSystem({ chat_metadata: metadata, EXT_KEY: 'gd', saveChatConditional() {}, getCharacters: () => [], getChat: () => [] });
        const def = variableSystem.upsertDefinition({ id: 'coins', type: 'number', defaultValue: 99 });
        const values = { '#gd-var-edit-id': 'coins', '#gd-var-edit-type': 'number', '#gd-var-edit-value': '99', '#gd-var-edit-scope': 'global' };
        if (Object.hasOwn(change, 'id')) values['#gd-var-edit-id'] = change.id;
        const $ = selector => ({ val: () => values[selector], prop: () => false });
        const context = { $, $editor: { 0: { isConnected: change.connected ?? true }, find: $ }, epoch: 1, editorEpoch: change.editorEpoch ?? 1,
            selectedId: change.selectedId ?? 'coins', def, variableSystem, hasVariableIdCollision, settings: {}, toastr: {},
            tryParseJsonish: raw => ({ ok: true, value: raw }), renderMaintenancePreview() {}, renderDashboardVars() {}, refresh() {} };
        if (change.deleted) variableSystem.deleteDefinition('coins');
        const before = JSON.stringify(metadata);
        vm.runInNewContext(text.slice(start, end) + ';saveCurrentEditor();', context);
        assert.equal(JSON.stringify(metadata), before);
    }
    assert.match(text, /function refresh\(\)\s*\{\s*clearTimeout\(autosaveTimer\);\s*editorEpoch\+\+/);
});

test('Configuration imports reject prototype keys at any depth before changing settings', async () => {
    for (const payload of [
        '{"__proto__":{"bad":true}}',
        '{"profileLibraryAutoLoad":{"__proto__":{"bad":true}}}',
        '{"worldBookSelection":{"constructor":{"prototype":{"bad":true}}}}',
    ]) {
        const h = createConfigProfileSubject();
        const before = JSON.stringify(h.settings);
        await assert.rejects(h.subject.importProfileFromJson(jsonFile('{"type":"config-profile","version":1,"settings":' + payload + '}')), /unsafe property/);
        assert.equal(JSON.stringify(h.settings), before);
        const old = createConfigProfileSubject({ configProfiles: [{ id: 'old', settings: JSON.parse(payload), drawers: {} }] });
        await assert.rejects(old.subject.applyProfile('old'), /unsafe property/);
    }
    assert.equal(({}).bad, undefined);
});

test('Applying a legacy profile ignores unregistered and personal settings keys', async () => {
    const h = createConfigProfileSubject({ configProfiles: [{ id: 'old', drawers: {}, settings: { unexpectedKey: true, muyuContextConfig: { inputTokens: 5 }, llmMaxSpeakers: 4 } }] });
    await h.subject.applyProfile('old');
    assert.equal(h.settings.unexpectedKey, undefined);
    assert.equal(h.settings.muyuContextConfig, undefined);
    assert.equal(h.settings.llmMaxSpeakers, 4);
});

test('Runtime initialization does not share mutable nested factory defaults', async () => {
    const text = await source('index.js');
    const start = text.indexOf('let settings = Object.assign(');
    const end = text.indexOf('extension_settings[EXT_KEY] = settings;', start);
    const settings = vm.runInNewContext(text.slice(start, end) + ';settings', { DEFAULT_SETTINGS, loaded: {}, structuredClone });
    for (const key of ['agentConfigs', 'muyuContextConfig', 'profileLibraryAutoLoad']) assert.notEqual(settings[key], DEFAULT_SETTINGS[key]);
    settings.agentConfigs.reviewOnly = { apiKey: 'synthetic-key' };
    assert.equal(DEFAULT_SETTINGS.agentConfigs.reviewOnly, undefined);
});

test('Summary deletion follows invalid basedOn links without reactivating stale summaries', async () => {
    const summaries = [
        { content: 'valid', rangeEnd: 1, active: false, basedOn: null },
        { content: 'stale old', rangeEnd: 20, active: false, basedOn: 0 },
        { content: 'stale latest', rangeEnd: 30, active: true, basedOn: 1 },
    ];
    const metadata = { gd: { summaries } };
    const system = createChatSummarySystem({ settings: {}, getChatMetadata: () => metadata, getChat: () => [{}], EXT_KEY: 'gd',
        saveChatConditional: async () => {}, renderPrompt: async text => text, generateRaw: async () => '', inject_ids: {},
        extension_prompt_types: {}, setExtensionPrompt() {}, log() {} });
    await system.pruneSummaries();
    assert.deepEqual(summaries.map(row => row.active), [true, false, false]);
});

test('Decision scripts explicitly reject null and incomplete replacements without split state', async () => {
    for (const code of ['ctx.decision=null;', 'ctx.decision={reason:"missing speakers"};']) {
        const traces = [];
        const system = createScriptExecutorSystem({ settings: { scriptExecutors: [{ id: 'bad', name: 'bad', triggerOn: 'decision',
            priority: 0, code, enabled: true, params: [], renderParams: false, returnMode: 'ignore' }] },
            saveSettings() {}, renderPrompt: async text => text, AgentTrace: { push: value => traces.push(value) }, log() {} });
        const decision = { speakers: ['alice.png'], reason: 'original' };
        const snapshot = await system.executeAllDecision({ decision });
        assert.deepEqual(snapshot.decision, decision);
        assert.equal(traces.at(-1).stages[0].ok, false);
        assert.match(traces.at(-1).stages[0].error, /ctx.decision/);
    }
});

test('Disabled world book importance rows retain the public field shape', async () => {
    const scanner = createWorldBookScanner({ world_names: ['Book'], getSourceMode: () => 'manual', getSelection: () => ({ Book: true }),
        loadWorldInfo: async () => ({ entries: { 1: { uid: 1, comment: 'Disabled', disable: true, key: [], keysecondary: [], content: 'text' } } }), log() {} });
    const [row] = scanner.calculateImportance(await scanner.getRenderedBooks());
    assert.equal(row.comment, 'Disabled'); assert.equal(row.importance, 0); assert.equal(row.disable, true);
    assert.equal(row.factors, 'disabled'); assert.equal(row.uid, 1);
});

test('Custom Agent JSON repair preserves literals, escapes and genuine trailing commas', () => {
    const data = { text: 'keep ,} and ,] and "quote" and \\ slash', items: ['text ,}'] };
    assert.deepEqual(extractCustomAgentJson(JSON.stringify(data)), data);
    assert.deepEqual(extractCustomAgentJson('{"text":"keep ,}", "list":[1,2,],}'), { text: 'keep ,}', list: [1, 2] });
});

test('History and world-info wrappers preserve literal replacement metacharacters', async t => {
    for (const id of ['previousPlan', 'previousPlans', 'worldInfo']) t.after(() => unregisterProvider(id));
    const text = "literal $& $' $` $$";
    const history = [{ reason: text }];
    const settings = { llmHistoryEnabled: true, llmScriptContinuity: true, llmScriptContinuityWrapper: 'prefix {{previousPlan}} suffix' };
    registerHistory(settings, () => history);
    assert.equal(getProviders().find(p => p.id === 'previousPlan').render().content, 'prefix ' + JSON.stringify(history[0], null, 2) + ' suffix');
    registerWorldInfo({ llmWorldInfoEnabled: true, llmWorldInfoWrapper: '[{{worldInfo}}]' }, { text }, async () => assert.fail('already loaded'));
    assert.equal((await getProviders().find(p => p.id === 'worldInfo').render({})).content, '[' + text + ']');
});

test('Memory prompts preserve literal dollar replacement sequences in character data', async () => {
    const agent = createMemoryAgent({ renderPrompt: async text => text, extractJsonObject() {}, log() {} });
    const text = "$& $' $` $$";
    const result = await agent.pipeline.prompt({ charName: text, charDescription: text, charPersonality: text, existingText: text }, null, {}, { memoryPrompt: '{{charName}}|{{charDescription}}|{{charPersonality}}|{{existingMemories}}' });
    assert.equal(result, Array(4).fill(text).join('|'));
});

test('Zero-length recent-message requests return no history', async () => {
    const text = await source('index.js'), chat = [{ mes: 'private' }];
    const start = text.indexOf('function getRecentMessages()');
    const end = text.indexOf('\n}', start) + 2;
    for (const count of [0, -1, NaN]) {
        const get = vm.runInNewContext(text.slice(start, end) + ';getRecentMessages', { settings: { recentMessageCount: count }, chat });
        assert.equal(get().length, 0);
    }
    const poolStart = text.indexOf('recentMessages: (n) => {');
    const poolEnd = text.indexOf('\n        },', poolStart) + '\n        },'.length;
    const recent = vm.runInNewContext('({' + text.slice(poolStart, poolEnd) + '}).recentMessages', { chat });
    assert.equal(recent(0).length, 0); assert.equal(recent(1).length, 1);
});

test('Custom Agent actions stop bubbling and read-all instructions use a newline', async () => {
    const ui = await source('ui/sections/customAgents.js');
    for (const id of ['toggle', 'exec']) assert.ok(ui.includes(".gd-ca-" + id + "-btn').off('click').on('click', async function (e) {\n            e.stopPropagation();"));
    const controller = await source('muyu/application/controller.js');
    assert.ok(controller.includes("task: baseInstructions.task + '\\n用户开启阅读全开"));
    assert.ok(!controller.includes("task: baseInstructions.task + '\\\\n用户开启阅读全开"));
});
