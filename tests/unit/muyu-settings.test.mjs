import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../../settings.js';
import { assertWritable, assignSettingsFields, configFields, dependencyFields, fieldDefinition, previewSettings, readSettingsFields } from '../../muyu/config/registry.js';
import { assertConfigurationCoverage, configurationCoverage, dynamicSettings } from '../../muyu/config/coverage.js';
import { createConfigWriter } from '../../muyu/host/config-write.js';
import { createConfigActions } from '../../muyu/actions/config-apply.js';
import { actionReceipt, validateReceipt, receiptContext } from '../../muyu/actions/receipts.js';
import { validateRecord } from '../../muyu/sessions/contract.js';
import { createSessionLibrary } from '../../muyu/sessions/library.js';
import { importedRecord } from '../../muyu/sessions/exchange.js';
import { createSettingsModule } from '../../muyu/modules/settings/index.js';
import { assistantToolAccess, requiredSources } from '../../muyu/application/capabilities.js';
import { createPermissions } from '../../muyu/application/permissions.js';
import { createToolBroker } from '../../muyu/tools/broker.js';
import { scoreFormulaCharacter } from '../../systems/speaker-selection.js';
import { matchesTrigger, rollInitiative } from '../../systems/trigger-initiative.js';
import { DEFAULT_MEMORY_SCHEMA, DEFAULT_MEMORY_RENDER } from '../../agents/memory.js';

const target = { kind: 'global', userKey: 'test' };
const baselineFor = (settings, patch) => readSettingsFields(settings, dependencyFields(Object.keys(patch)));
function fixture(patch, save = async () => undefined) {
    const settings = structuredClone(DEFAULT_SETTINGS), baseline = baselineFor(settings, patch);
    const preview = previewSettings({ baseline, changes: patch });
    let busy = false, saves = 0;
    const writer = createConfigWriter({ getSettings: () => settings, isBusy: () => busy, saveSettings: () => { saves++; return save(); } });
    const artifact = { id: 'a', revision: 1, kind: 'config-draft', sessionId: 's', content: { module: 'settings-config', baseline, preview } };
    const actions = createConfigActions({ getArtifact: () => structuredClone(artifact), getTarget: () => target, writer,
        validate: () => { if (JSON.stringify(baselineFor(settings, patch)) !== JSON.stringify(baseline)) throw Error('STALE_BASELINE'); } });
    return { settings, baseline, writer, actions, saves: () => saves, busy: () => { busy = true; } };
}
test('Configuration coverage explicitly owns every default key and separates pending resources', () => {
    assert.equal(assertConfigurationCoverage(), Object.keys(DEFAULT_SETTINGS).length);
    const rows = configurationCoverage(); assert.equal(rows.find(r => r.key === 'agentConfigs').status, 'special-editor-pending');
    assert.equal(rows.find(r => r.key === 'agentConfigs').secret, true);
    assert.equal(rows.find(r => r.key === 'muyuWebSearchConfig').status, 'internal');
    assert.deepEqual(rows.find(r => r.key === 'muyuWebSearchConfig').fields, []);
    assert.equal(rows.find(r => r.key === 'scoreWeights').fields.length, 4);
    assert.ok(dynamicSettings.userProviders); assert.ok(dynamicSettings.uiState);
    DEFAULT_SETTINGS.newUnregisteredSetting = false;
    try { assert.throws(assertConfigurationCoverage, /DRIFT/); } finally { delete DEFAULT_SETTINGS.newUnregisteredSetting; }
});
test('PostSpeech settings are bounded registered fields while executable assets stay deferred', () => {
    const keys = ['traceMaxEntries', 'postSpeechMessageEnabled', 'postSpeechMessagePrompt', 'postSpeechRoundEnabled', 'postSpeechRoundPrompt', 'postSpeechBlocking', 'postSpeechDecisionLimit'];
    const rows = configurationCoverage();
    for (const key of keys) {
        const row = rows.find(item => item.key === key);
        assert.equal(row?.owner, 'postSpeech');
        assert.equal(row.status, 'supported');
        assert.deepEqual(row.fields, [key]);
        assert.equal(row.writer, 'muyu/host/config-write.js');
        assert.equal(configFields.includes(key), true);
    }
});
test('Director history and world-info switches require one reviewed global-settings approval', async () => {
    const patch = { llmHistoryEnabled: false, llmWorldInfoEnabled: true };
    for (const key of Object.keys(patch)) {
        const row = configurationCoverage().find(item => item.key === key);
        assert.equal(row?.owner, 'director'); assert.equal(row?.status, 'supported');
        assert.deepEqual(row.fields, [key]); assert.equal(fieldDefinition(key).schema.type, 'boolean');
    }
    const f = fixture(patch);
    f.settings.worldBookSelection = { ExistingBook: true };
    const preview = previewSettings({ baseline: f.baseline, changes: patch });
    assert.deepEqual(preview.manifest.settings, patch);
    assert.ok(preview.warnings.includes('DIRECTOR_WORLD_INFO_CONTEXT_AND_EXTERNAL_MODEL'));
    assert.match(preview.notice, /世界书.*正文发送给所配置模型/);
    assert.deepEqual(requiredSources('muyu.settings.preview', { changes: patch }), ['source:configSettings']);
    assert.equal(f.saves(), 0);
    const action = f.actions.prepare('a', 1);
    assert.equal((await f.actions.approve(action.id)).status, 'applied_unconfirmed');
    assert.equal(f.saves(), 1);
    assert.equal(f.settings.llmHistoryEnabled, false);
    assert.equal(f.settings.llmWorldInfoEnabled, true);
    assert.deepEqual(f.settings.worldBookSelection, { ExistingBook: true });
    assert.throws(() => f.actions.approve(action.id), /ACTION_STALE/);
});
test('Director switches reject coercion and stale/busy writes without touching settings', async () => {
    for (const key of ['llmHistoryEnabled', 'llmWorldInfoEnabled']) {
        for (const value of [0, 'true', null]) assert.throws(() => previewSettings({ baseline: {}, changes: { [key]: value } }));
    }
    const stale = fixture({ llmWorldInfoEnabled: true });
    const action = stale.actions.prepare('a', 1);
    stale.settings.llmWorldInfoEnabled = true;
    assert.throws(() => stale.actions.approve(action.id), /STALE/);
    assert.equal(stale.saves(), 0);
    const busy = fixture({ llmHistoryEnabled: false });
    const pending = busy.actions.prepare('a', 1); busy.busy();
    assert.equal((await busy.actions.approve(pending.id)).status, 'not_executed');
    assert.equal(busy.settings.llmHistoryEnabled, true);
    assert.equal(busy.saves(), 0);
});
test('World-info wrapper is a reviewed global template with explicit and automatic routes', async () => {
    const id = 'llmWorldInfoWrapper';
    const contract = fieldDefinition(id);
    assert.equal(contract.domain, 'director'); assert.equal(contract.scope, 'global');
    assert.equal(contract.source, 'ui/sections/worldinfo.js'); assert.equal(contract.idle, true);
    assert.deepEqual(contract.schema, { type: 'string', maxLength: 4000 });
    assert.deepEqual(dependencyFields([id]), ['llmPrompt', 'llmWorldInfoEnabled', id].sort());
    assert.deepEqual(requiredSources('muyu.settings.preview', { changes: { [id]: '' } }), ['source:configSettings']);
    assert.equal(configurationCoverage().find(row => row.key === id).status, 'supported');
    for (const value of [null, 7, 'x'.repeat(4001)]) assert.throws(() => previewSettings({ baseline: {}, changes: { [id]: value } }));

    const patch = { [id]: '[Lore: {{worldInfo}}]' }, f = fixture(patch);
    const preview = previewSettings({ baseline: f.baseline, changes: patch });
    assert.deepEqual(preview.manifest.settings, patch);
    assert.ok(preview.warnings.includes('WORLD_INFO_WRAPPER_DISABLED'));
    assert.equal(preview.warnings.includes('DIRECTOR_LLM_MODE_INACTIVE'), false);
    assert.match(preview.notice, /Director 与 LLM 强制发言/);
    assert.match(preview.notice, /不读取世界书正文/);
    f.settings.worldBookSelection = { Example: true };
    const action = f.actions.prepare('a', 1);
    assert.equal((await f.actions.approve(action.id)).status, 'applied_unconfirmed');
    assert.equal(f.settings[id], patch[id]); assert.equal(f.saves(), 1);
    assert.deepEqual(f.settings.worldBookSelection, { Example: true });
    assert.throws(() => f.actions.approve(action.id), /ACTION_STALE/);

    const base = { llmWorldInfoEnabled: true, llmPrompt: 'Custom prompt' };
    const missing = previewSettings({ baseline: base, changes: { [id]: 'Only label' } });
    assert.ok(missing.warnings.includes('WORLD_INFO_WRAPPER_NO_WORLD_INFO'));
    const repeated = previewSettings({ baseline: base, changes: { [id]: '{{worldInfo}} {{worldInfo}} {{custom}}' } });
    assert.ok(repeated.warnings.includes('WORLD_INFO_WRAPPER_REPEATED_PLACEHOLDER'));
    assert.ok(repeated.warnings.includes('WORLD_INFO_WRAPPER_OTHER_PLACEHOLDERS'));
    const empty = previewSettings({ baseline: base, changes: { [id]: '' } });
    assert.equal(empty.warnings.includes('WORLD_INFO_WRAPPER_NO_WORLD_INFO'), false);
    assert.match(empty.notice, /空串退回纯世界书正文/);

    const stale = fixture(patch), staleAction = stale.actions.prepare('a', 1);
    stale.settings.llmPrompt = 'Changed prompt';
    assert.throws(() => stale.actions.approve(staleAction.id), /STALE/);
    assert.equal(stale.saves(), 0);
    const busy = fixture(patch), pending = busy.actions.prepare('a', 1); busy.busy();
    assert.equal((await busy.actions.approve(pending.id)).status, 'not_executed');
    assert.equal(busy.saves(), 0);
});
test('Four remaining text settings have scoped previews and one reviewed leaf write', async () => {
    const patch = {
        forceSpeakPrompt: 'Only {charName}', knowledgeText: 'Literal {{privateTag}}',
        identityPrompt: 'Keep {{character_profiles}}', npcPrompt: 'Read {{newRecentMessages}} and return {"npcs":[]}',
    };
    const expected = {
        forceSpeakPrompt: ['director', 4000, ['forceSpeakMode', 'lang']],
        knowledgeText: ['prompt', 8000, []], identityPrompt: ['prompt', 4000, []],
        npcPrompt: ['npc', 4000, ['npcEnabled']],
    };
    for (const [id, [domain, maximum, deps]] of Object.entries(expected)) {
        const contract = fieldDefinition(id);
        assert.equal(contract.domain, domain); assert.equal(contract.schema.type, 'string');
        assert.equal(contract.schema.maxLength, maximum); assert.equal(contract.idle, true);
        assert.deepEqual(dependencyFields([id]), [id, ...deps].sort());
        assert.equal(configurationCoverage().find(row => row.key === id).status, 'supported');
        for (const value of [null, 42, 'x'.repeat(maximum + 1)])
            assert.throws(() => previewSettings({ baseline: {}, changes: { [id]: value } }));
    }
    assert.deepEqual(requiredSources('muyu.settings.preview', { changes: patch }), ['source:configSettings']);
    const f = fixture(patch), preview = previewSettings({ baseline: f.baseline, changes: patch });
    assert.deepEqual(preview.manifest.settings, patch);
    assert.ok(preview.warnings.includes('FORCE_SPEAK_PROMPT_MODE_INACTIVE'));
    assert.ok(preview.warnings.includes('NPC_DISABLED'));
    assert.match(preview.notice, /知识库内容仅在后续 Prompt 引用/);
    assert.match(preview.notice, /空串退回内置身份模板/);
    f.settings.topN = 3;
    const action = f.actions.prepare('a', 1);
    assert.equal((await f.actions.approve(action.id)).status, 'applied_unconfirmed');
    for (const [id, value] of Object.entries(patch)) assert.equal(f.settings[id], value);
    assert.equal(f.settings.topN, 3); assert.equal(f.saves(), 1);
    assert.throws(() => f.actions.approve(action.id), /ACTION_STALE/);

    const missing = previewSettings({ baseline: { forceSpeakMode: 'llm', lang: 'zh', npcEnabled: true },
        changes: { forceSpeakPrompt: 'No name', npcPrompt: 'No context' } });
    assert.ok(missing.warnings.includes('FORCE_SPEAK_PROMPT_NO_CHARACTER_NAME'));
    assert.ok(missing.warnings.includes('NPC_PROMPT_NO_RECENT_MESSAGES'));
    const empty = previewSettings({ baseline: {}, changes: { forceSpeakPrompt: '', knowledgeText: '', identityPrompt: '', npcPrompt: '' } });
    assert.deepEqual(empty.manifest.settings, { forceSpeakPrompt: '', knowledgeText: '', identityPrompt: '', npcPrompt: '' });
    assert.equal(empty.warnings.includes('FORCE_SPEAK_PROMPT_NO_CHARACTER_NAME'), false);
    assert.equal(empty.warnings.includes('NPC_PROMPT_NO_RECENT_MESSAGES'), false);

    const stale = fixture({ forceSpeakPrompt: 'Only {charName}' }), staleAction = stale.actions.prepare('a', 1);
    stale.settings.lang = 'en';
    assert.throws(() => stale.actions.approve(staleAction.id), /STALE/);
    assert.equal(stale.saves(), 0);
    const busy = fixture({ npcPrompt: 'Read {{newRecentMessages}}' }), pending = busy.actions.prepare('a', 1);
    busy.busy();
    assert.equal((await busy.actions.approve(pending.id)).status, 'not_executed');
    assert.equal(busy.saves(), 0);
});
test('Nine director controls have bounded contracts and one reviewed patch changes only their leaves', async () => {
    const patch = { llmScriptEnabled: true, llmScriptPosition: 1, llmScriptContinuity: true, llmScriptContinuityMode: 'history', llmScriptContinuityCount: 5,
        forceSpeakMode: 'llm', templateMaxPasses: 8, templateRecursive: false, templateDebugPlaceholders: true };
    for (const key of Object.keys(patch)) {
        const row = configurationCoverage().find(item => item.key === key);
        assert.equal(row?.status, 'supported'); assert.deepEqual(row.fields, [key]);
        assert.equal(fieldDefinition(key).idle, true);
    }
    assert.deepEqual(fieldDefinition('forceSpeakMode').schema.enum, ['native', 'block', 'llm']);
    assert.deepEqual(fieldDefinition('llmScriptContinuityMode').schema.enum, ['last', 'history']);
    assert.equal(fieldDefinition('templateMaxPasses').schema.maximum, 10);
    const f = fixture(patch); f.settings.memoryEnabled = true;
    const preview = previewSettings({ baseline: f.baseline, changes: patch });
    assert.deepEqual(preview.manifest.settings, patch);
    for (const warning of ['DIRECTOR_LLM_MODE_INACTIVE', 'DIRECTOR_STAGE_DIRECTION_ENABLED', 'DIRECTOR_STAGE_DIRECTION_NEAR_CHAT', 'DIRECTOR_CONTINUITY_CONTEXT_COST', 'FORCE_SPEAK_EXTRA_MODEL_CALL', 'TEMPLATE_PASSES_INACTIVE', 'TEMPLATE_UNKNOWN_PLACEHOLDERS_VISIBLE']) assert.ok(preview.warnings.includes(warning));
    assert.match(preview.notice, /强制发言模式可能增加模型调用/);
    assert.deepEqual(requiredSources('muyu.settings.preview', { changes: patch }), ['source:configSettings']);
    const action = f.actions.prepare('a', 1);
    assert.equal((await f.actions.approve(action.id)).status, 'applied_unconfirmed');
    for (const [key, value] of Object.entries(patch)) assert.equal(f.settings[key], value);
    assert.equal(f.settings.memoryEnabled, true); assert.equal(f.saves(), 1);
    assert.throws(() => f.actions.approve(action.id), /ACTION_STALE/);
});
test('Director controls reject invalid values and report all-history, blocked speech and dormant dependencies', async () => {
    for (const changes of [{ llmScriptEnabled: 1 }, { llmScriptPosition: 2 }, { llmScriptContinuity: 'true' }, { llmScriptContinuityMode: 'all' },
        { llmScriptContinuityCount: -1 }, { llmScriptContinuityCount: 101 }, { forceSpeakMode: 'none' }, { templateMaxPasses: 0 }, { templateMaxPasses: 11 },
        { templateRecursive: 1 }, { templateDebugPlaceholders: 'yes' }]) assert.throws(() => previewSettings({ baseline: {}, changes }));
    const allHistory = previewSettings({ baseline: { llmScriptContinuityCount: 3, mode: 'llm', llmHistoryEnabled: false, llmScriptContinuity: false, llmScriptContinuityMode: 'last' }, changes: { llmScriptContinuityCount: 0 } });
    for (const warning of ['DIRECTOR_HISTORY_DISABLED', 'DIRECTOR_CONTINUITY_DISABLED', 'DIRECTOR_HISTORY_COUNT_INACTIVE', 'DIRECTOR_ALL_HISTORY_CONTEXT']) assert.ok(allHistory.warnings.includes(warning));
    assert.match(allHistory.notice, /0 表示全部历史/);
    const blocked = previewSettings({ baseline: { forceSpeakMode: 'native' }, changes: { forceSpeakMode: 'block' } });
    assert.ok(blocked.warnings.includes('FORCE_SPEAK_BLOCKS_GENERATION'));
    assert.match(blocked.notice, /阻止对应强制发言生成/);
    const stale = fixture({ llmScriptContinuity: true }); const action = stale.actions.prepare('a', 1);
    stale.settings.llmHistoryEnabled = false;
    assert.throws(() => stale.actions.approve(action.id), /STALE/); assert.equal(stale.saves(), 0);
    const busy = fixture({ templateRecursive: false }); const pending = busy.actions.prepare('a', 1); busy.busy();
    assert.equal((await busy.actions.approve(pending.id)).status, 'not_executed'); assert.equal(busy.settings.templateRecursive, true);
});
test('Director script style and injection wrapper have independent reviewed contracts', async () => {
    const patch = { llmScriptPrompt: 'Use concise stage directions.',
        llmScriptWrapper: '[{{characterLore}}\n{{script}}]' };
    for (const id of Object.keys(patch)) {
        const contract = fieldDefinition(id);
        assert.equal(contract.domain, 'director'); assert.equal(contract.scope, 'global'); assert.equal(contract.idle, true);
        assert.equal(contract.source, 'ui/sections/director.js');
        assert.equal(contract.schema.type, 'string'); assert.equal(contract.schema.maxLength, 4000);
        assert.equal(configurationCoverage().find(row => row.key === id).status, 'supported');
        assert.deepEqual(dependencyFields([id]), [id, 'mode', 'llmScriptEnabled'].sort());
        assert.deepEqual(requiredSources('muyu.settings.preview', { changes: { [id]: '' } }), ['source:configSettings']);
        for (const value of [null, 42, 'x'.repeat(4001)]) assert.throws(() => previewSettings({ baseline: {}, changes: { [id]: value } }));
    }
    const f = fixture(patch), preview = previewSettings({ baseline: f.baseline, changes: patch });
    assert.deepEqual(preview.manifest.settings, patch);
    assert.ok(preview.warnings.includes('DIRECTOR_SCRIPT_TEXT_MODE_INACTIVE'));
    assert.ok(preview.warnings.includes('DIRECTOR_SCRIPT_TEXT_DISABLED'));
    assert.match(preview.notice, /空串退回纯 \{\{script\}\}/);
    assert.equal(f.saves(), 0);
    f.settings.llmMaxSpeakers = 7;
    const action = f.actions.prepare('a', 1);
    assert.equal((await f.actions.approve(action.id)).status, 'applied_unconfirmed');
    assert.equal(f.settings.llmScriptPrompt, patch.llmScriptPrompt);
    assert.equal(f.settings.llmScriptWrapper, patch.llmScriptWrapper);
    assert.equal(f.settings.llmMaxSpeakers, 7);
    assert.equal(f.saves(), 1);
    assert.throws(() => f.actions.approve(action.id), /ACTION_STALE/);
    const missing = previewSettings({ baseline: { mode: 'llm', llmScriptEnabled: true },
        changes: { llmScriptWrapper: '{{charMemoryCurrent}}' } });
    assert.ok(missing.warnings.includes('DIRECTOR_SCRIPT_WRAPPER_NO_SCRIPT'));
    const reset = previewSettings({ baseline: { mode: 'llm', llmScriptEnabled: true, ...patch },
        changes: { llmScriptPrompt: '', llmScriptWrapper: '' } });
    assert.deepEqual(reset.manifest.settings, { llmScriptPrompt: '', llmScriptWrapper: '' });
    assert.deepEqual(reset.warnings, []);
    const stale = fixture({ llmScriptWrapper: '{{script}}' });
    const staleAction = stale.actions.prepare('a', 1); stale.settings.llmScriptEnabled = true;
    assert.throws(() => stale.actions.approve(staleAction.id), /STALE/); assert.equal(stale.saves(), 0);
    const busy = fixture({ llmScriptPrompt: 'brief' }); const pending = busy.actions.prepare('a', 1); busy.busy();
    assert.equal((await busy.actions.approve(pending.id)).status, 'not_executed'); assert.equal(busy.saves(), 0);
});
test('Director output-format text is one reviewed leaf with accurate optional-field warnings', async () => {
    const id = 'llmJsonSchema';
    const contract = fieldDefinition(id);
    assert.equal(contract.domain, 'director'); assert.equal(contract.scope, 'global'); assert.equal(contract.idle, true);
    assert.equal(contract.source, 'ui/sections/director.js');
    assert.equal(contract.schema.type, 'string'); assert.equal(contract.schema.maxLength, 4000);
    assert.deepEqual(dependencyFields([id]), [id, 'mode', 'forceSpeakMode', 'llmScriptEnabled', 'storyBlueprintEnabled'].sort());
    assert.deepEqual(requiredSources('muyu.settings.preview', { changes: { [id]: '' } }), ['source:configSettings']);
    assert.equal(configurationCoverage().find(row => row.key === id).status, 'supported');
    assert.equal(configurationCoverage().find(row => row.key === 'llmJsonSchemaHint').status, 'pending');
    for (const value of [null, 42, 'x'.repeat(4001)]) assert.throws(() => previewSettings({ baseline: {}, changes: { [id]: value } }));

    const patch = { [id]: 'Reply with {"speakers": ["Alice"]} {{scriptField}} {{storyBlueprintDoneField}}' };
    const f = fixture(patch), preview = previewSettings({ baseline: f.baseline, changes: patch });
    assert.deepEqual(preview.manifest.settings, patch);
    assert.ok(preview.warnings.includes('DIRECTOR_OUTPUT_FORMAT_INACTIVE'));
    assert.match(preview.notice, /不是原生 JSON Schema/);
    assert.match(preview.notice, /空串表示不提供格式提示/);
    assert.equal(f.saves(), 0);
    f.settings.llmMaxSpeakers = 7;
    const action = f.actions.prepare('a', 1);
    assert.equal((await f.actions.approve(action.id)).status, 'applied_unconfirmed');
    assert.equal(f.settings[id], patch[id]); assert.equal(f.settings.llmMaxSpeakers, 7); assert.equal(f.saves(), 1);
    assert.throws(() => f.actions.approve(action.id), /ACTION_STALE/);

    const active = previewSettings({ baseline: { mode: 'off', forceSpeakMode: 'llm', llmScriptEnabled: true, storyBlueprintEnabled: true },
        changes: { [id]: 'Return JSON with a reason only. {{llmJsonSchema}} {{customProvider}}' } });
    for (const warning of ['DIRECTOR_OUTPUT_FORMAT_NO_SPEAKERS', 'DIRECTOR_OUTPUT_FORMAT_NO_SCRIPT_FIELD',
        'DIRECTOR_OUTPUT_FORMAT_NO_STORY_DONE_FIELD', 'DIRECTOR_OUTPUT_FORMAT_SELF_REFERENCE_STRIPPED',
        'DIRECTOR_OUTPUT_FORMAT_OTHER_PLACEHOLDERS']) assert.ok(active.warnings.includes(warning));
    assert.equal(active.warnings.includes('DIRECTOR_OUTPUT_FORMAT_INACTIVE'), false);
    const empty = previewSettings({ baseline: { mode: 'llm', forceSpeakMode: 'native', llmScriptEnabled: true,
        storyBlueprintEnabled: true, [id]: patch[id] }, changes: { [id]: '' } });
    assert.deepEqual(empty.manifest.settings, { [id]: '' });
    assert.deepEqual(empty.warnings, ['DIRECTOR_OUTPUT_FORMAT_EMPTY']);
    const stale = fixture({ [id]: 'speakers' }); const staleAction = stale.actions.prepare('a', 1);
    stale.settings.storyBlueprintEnabled = true;
    assert.throws(() => stale.actions.approve(staleAction.id), /STALE/); assert.equal(stale.saves(), 0);
    const busy = fixture({ [id]: 'speakers' }); const pending = busy.actions.prepare('a', 1); busy.busy();
    assert.equal((await busy.actions.approve(pending.id)).status, 'not_executed'); assert.equal(busy.saves(), 0);
});
test('Director continuity wrappers preview both history paths before one reviewed write', async () => {
    const patch = { llmScriptContinuityWrapper: 'Last: {{previousPlan}}',
        llmScriptContinuityHistoryWrapper: 'History: {{previousPlans}}' };
    const deps = ['mode', 'forceSpeakMode', 'llmHistoryEnabled', 'llmScriptContinuity',
        'llmScriptContinuityMode', 'llmScriptContinuityCount', 'llmPrompt'];
    for (const id of Object.keys(patch)) {
        const contract = fieldDefinition(id);
        assert.equal(contract.domain, 'director'); assert.equal(contract.scope, 'global'); assert.equal(contract.idle, true);
        assert.equal(contract.source, 'ui/sections/continuity.js');
        assert.equal(contract.schema.type, 'string'); assert.equal(contract.schema.maxLength, 4000);
        assert.deepEqual(dependencyFields([id]), [id, ...deps].sort());
        assert.deepEqual(requiredSources('muyu.settings.preview', { changes: { [id]: '' } }), ['source:configSettings']);
        assert.equal(configurationCoverage().find(row => row.key === id).status, 'supported');
        for (const value of [null, 42, 'x'.repeat(4001)]) assert.throws(() => previewSettings({ baseline: {}, changes: { [id]: value } }));
    }
    const f = fixture(patch), preview = previewSettings({ baseline: f.baseline, changes: patch });
    assert.deepEqual(preview.manifest.settings, patch);
    assert.ok(preview.warnings.includes('DIRECTOR_CONTINUITY_TEMPLATE_INACTIVE'));
    assert.ok(preview.warnings.includes('DIRECTOR_CONTINUITY_TEMPLATE_DISABLED'));
    assert.ok(preview.warnings.includes('DIRECTOR_HISTORY_WRAPPER_MODE_INACTIVE'));
    assert.match(preview.notice, /空串退回纯历史 JSON/);
    f.settings.llmMaxSpeakers = 7;
    const action = f.actions.prepare('a', 1);
    assert.equal((await f.actions.approve(action.id)).status, 'applied_unconfirmed');
    assert.equal(f.settings.llmScriptContinuityWrapper, patch.llmScriptContinuityWrapper);
    assert.equal(f.settings.llmScriptContinuityHistoryWrapper, patch.llmScriptContinuityHistoryWrapper);
    assert.equal(f.settings.llmMaxSpeakers, 7); assert.equal(f.saves(), 1);
    assert.throws(() => f.actions.approve(action.id), /ACTION_STALE/);

    const active = { mode: 'llm', forceSpeakMode: 'llm', llmHistoryEnabled: true,
        llmScriptContinuity: true, llmScriptContinuityMode: 'history', llmScriptContinuityCount: 0,
        llmPrompt: 'Only {{previousPlan}}' };
    const missing = previewSettings({ baseline: active, changes: {
        llmScriptContinuityHistoryWrapper: 'Wrong {{previousPlan}} and {{customProvider}}',
    } });
    for (const warning of ['DIRECTOR_HISTORY_WRAPPER_NO_PLANS', 'DIRECTOR_CONTINUITY_WRAPPER_OTHER_PLACEHOLDERS',
        'DIRECTOR_CONTINUITY_WRAPPER_ALL_HISTORY', 'DIRECTOR_CONTINUITY_PROMPT_WRONG_PLACEHOLDER']) assert.ok(missing.warnings.includes(warning));
    const repeated = previewSettings({ baseline: { ...active, llmPrompt: '' }, changes: {
        llmScriptContinuityHistoryWrapper: '{{previousPlans}} / {{previousPlans}}',
    } });
    assert.ok(repeated.warnings.includes('DIRECTOR_CONTINUITY_WRAPPER_REPEATED_PLACEHOLDER'));
    const force = previewSettings({ baseline: { ...active, llmPrompt: 'Custom prompt without history' }, changes: {
        llmScriptContinuityHistoryWrapper: 'History: {{previousPlans}}',
    } });
    assert.ok(force.warnings.includes('FORCE_SPEAK_CONTINUITY_NO_EXPLICIT_PLACEHOLDER'));
    const empty = previewSettings({ baseline: { ...active, llmPrompt: '', ...patch }, changes: {
        llmScriptContinuityWrapper: '', llmScriptContinuityHistoryWrapper: '',
    } });
    assert.deepEqual(empty.manifest.settings, { llmScriptContinuityWrapper: '', llmScriptContinuityHistoryWrapper: '' });
    assert.equal(empty.warnings.includes('DIRECTOR_LAST_WRAPPER_NO_PLAN'), false);
    assert.equal(empty.warnings.includes('DIRECTOR_HISTORY_WRAPPER_NO_PLANS'), false);
    const stale = fixture({ llmScriptContinuityWrapper: patch.llmScriptContinuityWrapper });
    const staleAction = stale.actions.prepare('a', 1); stale.settings.llmPrompt = 'New prompt';
    assert.throws(() => stale.actions.approve(staleAction.id), /STALE/); assert.equal(stale.saves(), 0);
    const busy = fixture({ llmScriptContinuityHistoryWrapper: patch.llmScriptContinuityHistoryWrapper });
    const pending = busy.actions.prepare('a', 1); busy.busy();
    assert.equal((await busy.actions.approve(pending.id)).status, 'not_executed'); assert.equal(busy.saves(), 0);
});
test('Script executors use a specialized asset editor, not editable settings', () => {
    const row = configurationCoverage().find(item => item.key === 'scriptExecutors');
    assert.equal(row?.status, 'special-editor-supported');
    assert.equal(row.executable, true);
    assert.equal(row.writer, 'muyu/host/script-executors.js');
    assert.deepEqual(row.fields, []);
    assert.equal(configFields.includes('scriptExecutors'), false);
    assert.throws(() => previewSettings({ baseline: {}, changes: { scriptExecutors: [] } }));
});
test('PostSpeech contract bounds seven fields and warns before automatic calls', async () => {
    for (const [field, minimum, maximum] of [['traceMaxEntries', 1, 200], ['postSpeechDecisionLimit', 1, 500]]) {
        const contract = fieldDefinition(field);
        assert.equal(contract.schema.minimum, minimum);
        assert.equal(contract.schema.maximum, maximum);
        for (const invalid of [minimum - 1, maximum + 1, 1.5]) {
            assert.throws(() => previewSettings({ baseline: {}, changes: { [field]: invalid } }));
        }
    }
    for (const field of ['postSpeechMessagePrompt', 'postSpeechRoundPrompt']) {
        assert.throws(() => previewSettings({ baseline: {}, changes: { [field]: 'x'.repeat(4001) } }));
    }
    const patch = { postSpeechMessageEnabled: true, postSpeechRoundEnabled: true };
    const subject = fixture(patch);
    const preview = previewSettings({ baseline: subject.baseline, changes: patch });
    assert.ok(preview.warnings.includes('POST_SPEECH_MESSAGE_EXTRA_MODEL_CALLS_AND_CAPABILITY_EFFECTS'));
    assert.ok(preview.warnings.includes('POST_SPEECH_ROUND_EXTRA_MODEL_CALLS_AND_CAPABILITY_EFFECTS'));
    assert.match(preview.notice, /每条合格角色消息可能增加一次模型调用/);
    assert.match(preview.notice, /每个合格轮次可能增加一次模型调用/);
    assert.deepEqual(requiredSources('muyu.settings.preview', { changes: patch }), ['source:configSettings']);
    const action = subject.actions.prepare('a', 1);
    assert.equal((await subject.actions.approve(action.id)).status, 'applied_unconfirmed');
    assert.equal(subject.settings.postSpeechMessageEnabled, true);
    assert.equal(subject.settings.postSpeechRoundEnabled, true);
    assert.equal(subject.saves(), 1);
    const dormant = previewSettings({ baseline: { postSpeechMessagePrompt: '', postSpeechMessageEnabled: false }, changes: { postSpeechMessagePrompt: 'new' } });
    assert.ok(dormant.warnings.includes('POST_SPEECH_MESSAGE_DISABLED'));
});
test('PostSpeech preview dependencies and busy guard protect later execution', async () => {
    assert.deepEqual(dependencyFields(['postSpeechMessagePrompt']), ['postSpeechMessageEnabled', 'postSpeechMessagePrompt']);
    const subject = fixture({ postSpeechRoundPrompt: 'new policy' });
    const action = subject.actions.prepare('a', 1);
    subject.settings.postSpeechRoundEnabled = true;
    assert.throws(() => subject.actions.approve(action.id), /STALE/);
    assert.equal(subject.saves(), 0);
    const busy = fixture({ postSpeechBlocking: false });
    const pending = busy.actions.prepare('a', 1);
    busy.busy();
    assert.equal((await busy.actions.approve(pending.id)).status, 'not_executed');
    assert.equal(busy.settings.postSpeechBlocking, true);
});
test('Registered projection never traverses credentials or arbitrary paths', () => {
    const settings = { mode: 'formula', get agentConfigs() { throw Error('SECRET'); } };
    assert.deepEqual(readSettingsFields(settings, ['mode']), { mode: 'formula' });
    for (const fields of [['agentConfigs'], ['scoreWeights.constructor'], [], ['mode', 'mode']]) assert.throws(() => readSettingsFields(settings, fields));
});
test('Domain validation rejects coercion, invalid ranges, undeclared fields and oversized prompt', () => {
    for (const changes of [{ mode: 'invalid' }, { topN: '3' }, { llmMaxSpeakers: 21 }, { 'scoreWeights.talkativeness': 0 }, { providerTimeoutMs: -1 }, { apiKey: 'secret' }, { llmPrompt: 'x'.repeat(4001) }, { worldBookSourceMode: 'all' }, { worldBookMaxEntries: 0 }, { worldBookMaxEntries: 201 }]) assert.throws(() => previewSettings({ baseline: {}, changes }));
    assert.equal(previewSettings({ baseline: {}, changes: { llmPrompt: '{{provider}}\nnot JSON' } }).manifest.settings.llmPrompt, '{{provider}}\nnot JSON');
});
test('World-book mode and result limit preview preserve manual selection and require one explicit apply', async () => {
    const patch = { worldBookSourceMode: 'manual', worldBookMaxEntries: 12 };
    const f = fixture(patch); f.settings.worldBookSelection = { BookA: true };
    const baseline = baselineFor(f.settings, patch);
    assert.deepEqual(Object.keys(baseline).sort(), Object.keys(patch).sort());
    assert.deepEqual(requiredSources('muyu.settings.preview', { changes: patch }), ['source:configSettings']);
    const preview = previewSettings({ baseline, changes: patch });
    assert.ok(preview.warnings.includes('WORLD_BOOK_MANUAL_SELECTION_REQUIRED'));
    assert.deepEqual(preview.manifest.settings, patch);
    assert.equal(f.saves(), 0);
    const action = f.actions.prepare('a', 1);
    assert.equal((await f.actions.approve(action.id)).status, 'applied_unconfirmed');
    assert.equal(f.saves(), 1);
    assert.deepEqual(f.settings.worldBookSelection, { BookA: true });
    assert.equal(f.settings.worldBookSourceMode, 'manual');
    assert.equal(f.settings.worldBookMaxEntries, 12);
});
test('Leaf writes preserve sibling concurrent updates and never initialize unrelated defaults', async () => {
    const f = fixture({ 'scoreWeights.mention': 50 }); const a = f.actions.prepare('a', 1);
    f.settings.scoreWeights.keyword = 99; f.settings.agentConfigs = { secret: 'keep' };
    assert.equal((await f.actions.approve(a.id)).status, 'applied_unconfirmed');
    assert.deepEqual(f.settings.scoreWeights, { mention: 50, keyword: 99, recency: 20, talkativeness: 10 });
    assert.deepEqual(f.settings.agentConfigs, { secret: 'keep' });
});
test('Changed leaf or semantic dependency invalidates preview, unrelated memory flag does not', async () => {
    const f = fixture({ autoMemoryInterval: 15 }); const a = f.actions.prepare('a', 1);
    f.settings.autoMemorySpeakers = true;
    assert.equal((await f.actions.approve(a.id)).status, 'applied_unconfirmed');
    const g = fixture({ autoMemoryInterval: 15 }); const b = g.actions.prepare('a', 1); g.settings.memoryEnabled = true;
    assert.throws(() => g.actions.approve(b.id), /STALE/); assert.equal(g.saves(), 0);
});
test('Runtime busy after preview refuses all changes before assignment', async () => {
    const f = fixture({ mode: 'llm', providerTimeoutMs: 800 }); const a = f.actions.prepare('a', 1); f.busy();
    assert.equal((await f.actions.approve(a.id)).status, 'not_executed'); assert.equal(f.settings.mode, 'formula'); assert.equal(f.settings.providerTimeoutMs, 10000); assert.equal(f.saves(), 0);
});
test('Property write preflight prevents half-applied patch on read-only leaf', async () => {
    const f = fixture({ topN: 2, 'scoreWeights.mention': 50 });
    Object.defineProperty(f.settings.scoreWeights, 'mention', { value: 30, enumerable: true, writable: false });
    await assert.rejects(f.writer.apply({ baseline: f.baseline, changes: { topN: 2, 'scoreWeights.mention': 50 }, contractVersion: 2 }), /WRITE_UNAVAILABLE/);
    assert.equal(f.settings.topN, 1); assert.equal(f.saves(), 0);
});
test('Long prompt survives preview, one-time approval and versioned receipt without truncation', async () => {
    const prompt = 'Evidence and scope.\n'.repeat(100), f = fixture({ llmPrompt: prompt }); const a = f.actions.prepare('a', 1);
    const done = f.actions.approve(a.id); assert.throws(() => f.actions.approve(a.id)); const result = await done;
    assert.equal(f.settings.llmPrompt, prompt); assert.equal(f.saves(), 1);
    const receipt = validateReceipt(actionReceipt(result)); assert.equal(receipt.version, 2); assert.equal(JSON.parse(receipt.diff[0].after), prompt);
});
test('Rejected async save preserves imported value and later edits with an honest warning', async () => {
    let reject; const f = fixture({ 'scoreWeights.mention': 50 }, () => new Promise((_, r) => { reject = r; }));
    const a = f.actions.prepare('a', 1), done = f.actions.approve(a.id); await Promise.resolve();
    f.settings.scoreWeights.mention = 77; f.settings.scoreWeights.keyword = 99; reject(Error('private'));
    const r = await done; assert.equal(r.result.saveError, true); assert.equal(r.result.changed, true); assert.equal(f.settings.scoreWeights.mention, 77); assert.equal(f.settings.scoreWeights.keyword, 99);
});
test('Every supported field declares read dependencies; unknown read tools fail closed', () => {
    const permissions = createPermissions();
    for (const field of configFields) assert.ok(requiredSources('muyu.settings.read', { fields: [field] }).length);
    assert.equal(assistantToolAccess({ id: 'unknown', effect: 'read' }, {}, target, 'task', permissions).decision, 'policy_forbidden');
    permissions.grant('diagnostics', target);
    assert.equal(assistantToolAccess({ id: 'muyu.settings.read', effect: 'read' }, { fields: ['llmPrompt'] }, target, 'task', permissions).decision, 'permission_required');
    assert.deepEqual(requiredSources('muyu.settings.preview', { changes: { autoMemoryInterval: 15, mode: 'llm' } }), ['source:memoryConfig', 'source:configSettings']);
});
test('Settings catalog is public without host reads; unauthorized reads never enter host', async () => {
    let reads = 0; const module = createSettingsModule({ getSettings: () => { reads++; return DEFAULT_SETTINGS; }, getTarget: () => target });
    const permissions = createPermissions(), broker = createToolBroker({ registry: module.registry, handlers: module.handlers, target, runId: 'r', signal: new AbortController().signal, maxCalls: 8, allowedTools: module.registry.list().map(d => d.id),
        policy: ({ definition, args }) => assistantToolAccess(definition, args, target, 't', permissions).decision });
    const catalog = await broker.call({ toolId: 'muyu.settings.catalog', version: 1, callId: '1', args: {} });
    assert.equal(catalog.ok, true); assert.equal(reads, 0);
    const listing = JSON.parse(catalog.data.text);
    assert.ok(listing.supported.find(row => row.domain === 'postSpeech')?.fields.includes('postSpeechMessageEnabled'));
    assert.equal(listing.specialEditors.find(row => row.key === 'scriptExecutors')?.writer, 'muyu/host/script-executors.js');
    assert.equal(listing.pending.some(row => row.key === 'postSpeechMessageEnabled'), false);
    assert.equal((await broker.call({ toolId: 'muyu.settings.read', version: 1, callId: '2', args: { fields: ['mode'] } })).ok, false); assert.equal(reads, 0);
    for (const [callId, domain, field] of [['3', 'summary', 'summaryPrompt'], ['4', 'critique', 'critiquePrompt']]) {
        const contract = await broker.call({ toolId: 'muyu.settings.contract', version: 1, callId, args: { domain } });
        assert.equal(contract.ok, true);
        assert.ok(JSON.parse(contract.data.text).some(row => row.id === field));
    }
    const exact = await broker.call({ toolId: 'muyu.settings.contract', version: 1, callId: '5', args: { fields: ['topN', 'providerTimeoutMs', 'memoryMaxEntries'] } });
    assert.equal(exact.ok, true);
    assert.deepEqual(JSON.parse(exact.data.text).map(row => row.id), ['topN', 'providerTimeoutMs', 'memoryMaxEntries']);
    assert.ok(exact.data.text.length < 6000, 'Exact-field contract must stay substantially smaller than a full-domain query');
    assert.equal(JSON.parse(exact.data.text).find(row => row.id === 'memoryMaxEntries').schema.minimum, 10);
    assert.equal((await broker.call({ toolId: 'muyu.settings.contract', version: 1, callId: '6', args: { domain: 'director', fields: ['memoryMaxEntries'] } })).ok, false);
    assert.equal((await broker.call({ toolId: 'muyu.settings.contract', version: 1, callId: '7', args: {} })).ok, false);
    assert.equal(reads, 0);
    module.dispose();
});

test('General receipt history carries exact dependencies and import restores no approval', async () => {
    const f = fixture({ llmPrompt: 'Long prompt. '.repeat(200) }), a = f.actions.prepare('a', 1);
    const receipt = actionReceipt(await f.actions.approve(a.id));
    const library = createSessionLibrary(); await library.ready; const id = library.create(JSON.stringify(['assistant', 'global', null]));
    library.recordReceipt(id, receipt); const record = library.get(id);
    assert.deepEqual(record.required, ['source:configSettings']);
    assert.throws(() => validateRecord({ ...record, required: ['source:memoryConfig'] }));
    const imported = importedRecord(record); assert.equal(imported.imported, true); assert.equal(imported.receipts[0].diff[0].after, receipt.diff[0].after); assert.equal(imported.configActions, undefined);
    const context = receiptContext([receipt]); assert.match(context, /display excerpt/); assert.ok(context.length < 6000);
    await library.close();
});

test('Multiple large action records remain individually bounded, not one oversized DTO', async () => {
    const actions = createConfigActions({ getTarget: () => target, writer: {}, validate: () => {},
        getArtifact: id => ({ id, sessionId: 's', revision: 1, kind: 'config-draft', content: { baseline: {}, preview: previewSettings({ baseline: {}, changes: { llmPrompt: 'x'.repeat(4000) } }) } }) });
    for (let i = 0; i < 6; i++) actions.prepare('a' + i, 1);
    assert.equal(actions.list().length, 6);
    const copy = actions.list(); copy[0].status = 'applied_confirmed'; assert.equal(actions.list()[0].status, 'pending');
});

test('Provider timeout update calls the host save path with the new setting', async () => {
    const settings = { providerTimeoutMs: 10000 }; let appliedTimeout;
    const writer = createConfigWriter({ getSettings: () => settings, saveSettings: async () => { appliedTimeout = settings.providerTimeoutMs; } });
    await writer.apply({ baseline: { providerTimeoutMs: 10000 }, changes: { providerTimeoutMs: 0 }, contractVersion: 2 });
    assert.equal(appliedTimeout, 0);
});

test('Speaker rules declare their real consumers, bounded inputs and dependent conditions', () => {
    const fields = ['recentMessageCount', 'consecutivePenalty', 'triggerEnabled', 'triggerScore', 'initiativeEnabled', 'initiativeBaseScore', 'llmContextDepth', 'llmRespectOrder', 'llmCharDescMode', 'llmCharDescLength'];
    assert.equal(configFields.length, 96);
    assert.equal(configurationCoverage().find(row => row.key === 'recentMessageCount').status, 'supported');
    assert.equal(configurationCoverage().find(row => row.key === 'llmContextDepth').status, 'supported');
    for (const id of fields) {
        const contract = fieldDefinition(id);
        assert.equal(contract.scope, 'global'); assert.equal(contract.idle, true);
        assert.ok(contract.description.length > 20);
        assert.ok(contract.source.startsWith('ui/sections/'));
    }
    assert.deepEqual(dependencyFields(['triggerScore']), ['mode', 'triggerEnabled', 'triggerScore']);
    assert.deepEqual(dependencyFields(['initiativeBaseScore']), ['initiativeBaseScore', 'initiativeEnabled', 'mode']);
    assert.deepEqual(dependencyFields(['llmCharDescLength']), ['llmCharDescLength', 'llmCharDescMode']);
    for (const changes of [{ recentMessageCount: 0 }, { consecutivePenalty: -1 }, { triggerEnabled: 'yes' }, { triggerScore: -1 }, { initiativeEnabled: 1 }, { initiativeBaseScore: -1 }, { llmContextDepth: 201 }, { llmRespectOrder: 'false' }, { llmCharDescMode: 'none' }, { llmCharDescLength: 4001 }]) {
        assert.throws(() => previewSettings({ baseline: {}, changes }));
    }
});

test('Speaker-rule preview reports dormant settings and refuses changed semantic preconditions', async () => {
    const dormant = structuredClone(DEFAULT_SETTINGS); dormant.mode = 'llm'; dormant.triggerEnabled = false; dormant.initiativeEnabled = false; dormant.llmCharDescMode = 'full';
    const patch = { triggerScore: 70, initiativeBaseScore: 12, llmCharDescLength: 300 };
    const baseline = baselineFor(dormant, patch), preview = previewSettings({ baseline, changes: patch });
    assert.deepEqual(preview.warnings, ['FORMULA_MODE_INACTIVE', 'TRIGGER_DISABLED', 'INITIATIVE_DISABLED', 'CHAR_DESC_NOT_SLICED']);
    const writer = createConfigWriter({ getSettings: () => dormant, saveSettings: async () => undefined, isBusy: () => false });
    dormant.triggerEnabled = true;
    await assert.rejects(writer.apply({ baseline, changes: patch, contractVersion: 2 }), /STALE_BASELINE/);
    assert.equal(dormant.triggerScore, 40);
});

test('Approved formula changes feed the next scoring and trigger calculation', async () => {
    const f = fixture({ triggerScore: 70, consecutivePenalty: 5, initiativeBaseScore: 12, recentMessageCount: 3 });
    const a = f.actions.prepare('a', 1);
    assert.equal((await f.actions.approve(a.id)).status, 'applied_unconfirmed');
    const character = { name: 'Alice', avatar: 'alice', description: 'forest guardian', talkativeness: 0.5 };
    const chat = [{ name: 'Alice', avatar: 'alice', mes: 'Hello' }], recentMessages = [{ is_user: true, mes: 'forest' }];
    assert.equal(matchesTrigger(character, recentMessages, { enabled: f.settings.triggerEnabled }), true);
    assert.equal(rollInitiative({ enabled: f.settings.initiativeEnabled, baseScore: f.settings.initiativeBaseScore, random: () => 0.5 }), 6);
    const score = scoreFormulaCharacter({ character, recentMessages, chat, scoreWeights: f.settings.scoreWeights, triggerScore: f.settings.triggerScore, consecutivePenalty: f.settings.consecutivePenalty, triggered: true, initiative: 6 });
    assert.equal(score.score, 96);
    assert.equal(f.settings.recentMessageCount, 3);
    assert.equal(f.saves(), 1);
});

test('Director shared depth and order changes require idle writer and preserve siblings', async () => {
    const f = fixture({ llmContextDepth: 24, llmRespectOrder: false, llmCharDescMode: 'full', llmCharDescLength: 120 });
    const a = f.actions.prepare('a', 1); f.settings.llmPrompt = 'concurrent UI draft';
    assert.equal((await f.actions.approve(a.id)).status, 'applied_unconfirmed');
    assert.equal(f.settings.llmContextDepth, 24); assert.equal(f.settings.llmRespectOrder, false);
    assert.equal(f.settings.llmCharDescMode, 'full'); assert.equal(f.settings.llmCharDescLength, 120);
    assert.equal(f.settings.llmPrompt, 'concurrent UI draft');
    const blocked = fixture({ llmRespectOrder: false }); const b = blocked.actions.prepare('a', 1); blocked.busy();
    assert.equal((await blocked.actions.approve(b.id)).status, 'not_executed'); assert.equal(blocked.settings.llmRespectOrder, true);
});

test('Memory extraction and compression Prompts keep distinct render contracts and reviewed writes', async () => {
    for (const id of ['memoryPrompt', 'memoryCompressPrompt']) {
        const field = fieldDefinition(id);
        assert.equal(field.domain, 'memory'); assert.equal(field.idle, true);
        assert.equal(field.schema.maxLength, 4000);
        assert.equal(configurationCoverage().find(row => row.key === id).status, 'supported');
        assert.deepEqual(dependencyFields([id]), ['memoryEnabled', id].sort());
        assert.deepEqual(requiredSources('muyu.settings.preview', { changes: { [id]: '' } }), ['source:memoryConfig']);
        for (const value of [null, 2, 'x'.repeat(4001)]) assert.throws(() => previewSettings({ baseline: {}, changes: { [id]: value } }));
    }
    assert.match(fieldDefinition('memoryPrompt').description, /renderPrompt/);
    assert.match(fieldDefinition('memoryCompressPrompt').description, /不执行通用 Provider/);
    assert.throws(() => previewSettings({ baseline: {}, changes: { memoryCompressPrompt: 'Compress {{charName}}' } }), /MEMORY_COMPRESS_PROMPT_MISSING_MEMORIES/);
    const extraction = previewSettings({ baseline: { memoryPrompt: '', memoryEnabled: true }, changes: { memoryPrompt: 'Return JSON using {{myCustomProvider}}' } });
    assert.ok(extraction.warnings.includes('MEMORY_PROMPT_NO_RECENT_MESSAGES'));
    assert.ok(!extraction.warnings.includes('AUTO_NOT_ENABLED'));
    const reset = previewSettings({ baseline: { memoryCompressPrompt: 'Old {{memories}}', memoryEnabled: true }, changes: { memoryCompressPrompt: '' } });
    assert.ok(!reset.warnings.includes('AUTO_NOT_ENABLED'));
    const patch = { memoryPrompt: 'Extract {{newRecentMessages}} as JSON', memoryCompressPrompt: 'Compress {{memories}}' };
    const f = fixture(patch);
    const action = f.actions.prepare('a', 1);
    assert.equal((await f.actions.approve(action.id)).status, 'applied_unconfirmed');
    assert.equal(f.settings.memoryPrompt, patch.memoryPrompt);
    assert.equal(f.settings.memoryCompressPrompt, patch.memoryCompressPrompt);
    assert.equal(f.saves(), 1);
    assert.throws(() => f.actions.approve(action.id), /ACTION_STALE/);
    const busy = fixture({ memoryPrompt: 'Extract {{newRecentMessages}} as JSON' });
    const pending = busy.actions.prepare('a', 1); busy.busy();
    assert.equal((await busy.actions.approve(pending.id)).status, 'not_executed');
    assert.equal(busy.saves(), 0);
});

test('Memory Schema and render template are bounded, effective settings with reviewed writes', async () => {
    const fields = ['memoryJsonSchema', 'memoryRenderTemplate'];
    for (const id of fields) {
        assert.equal(configurationCoverage().find(row => row.key === id).status, 'supported');
        assert.equal(fieldDefinition(id).idle, true);
        assert.deepEqual(dependencyFields([id]), ['memoryEnabled', id].sort());
        assert.deepEqual(requiredSources('muyu.settings.preview', { changes: { [id]: '' } }), ['source:memoryConfig']);
        assert.throws(() => previewSettings({ baseline: {}, changes: { [id]: 'x'.repeat(4001) } }));
    }
    for (const changes of [{ memoryJsonSchema: '{"type":"array"}' },
        { memoryJsonSchema: '{broken' },
        { memoryRenderTemplate: '{{#charMemory:all}}bad{{/charMemory}}' }]) {
        assert.throws(() => previewSettings({ baseline: {}, changes }));
    }
    const patch = { memoryJsonSchema: DEFAULT_MEMORY_SCHEMA, memoryRenderTemplate: DEFAULT_MEMORY_RENDER };
    const f = fixture(patch);
    const preview = previewSettings({ baseline: f.baseline, changes: patch });
    assert.deepEqual(preview.manifest.settings, patch);
    assert.ok(!preview.warnings.includes('AUTO_NOT_ENABLED'));
    assert.match(preview.notice, /保存前校验输出/);
    const action = f.actions.prepare('a', 1);
    assert.equal((await f.actions.approve(action.id)).status, 'applied_unconfirmed');
    assert.equal(f.settings.memoryJsonSchema, DEFAULT_MEMORY_SCHEMA);
    assert.equal(f.settings.memoryRenderTemplate, DEFAULT_MEMORY_RENDER);
    assert.equal(f.saves(), 1);
    const withoutData = previewSettings({ baseline: { memoryRenderTemplate: '', memoryEnabled: true }, changes: { memoryRenderTemplate: 'Static text' } });
    assert.ok(withoutData.warnings.includes('MEMORY_RENDER_NO_MEMORY_LOOP'));
    const reset = previewSettings({ baseline: { memoryJsonSchema: DEFAULT_MEMORY_SCHEMA, memoryEnabled: true }, changes: { memoryJsonSchema: '' } });
    assert.deepEqual(reset.manifest.settings, { memoryJsonSchema: '' });
});

test('Memory keep-recent contract names both manual consumers without implying an automatic action', () => {
    const contract = fieldDefinition('memoryKeepRecent');
    assert.equal(contract.domain, 'memory');
    assert.equal(contract.scope, 'global');
    assert.equal(contract.applies, 'next-use');
    assert.equal(contract.source, 'ui/sections/memory.js');
    assert.match(contract.description, /压缩/);
    assert.match(contract.description, /撤销/);
    assert.match(contract.description, /不会立即/);
    assert.deepEqual(dependencyFields(['memoryKeepRecent']), ['memoryEnabled', 'memoryKeepRecent']);
    assert.equal(configurationCoverage().find(row => row.key === 'memoryKeepRecent').status, 'supported');
    assert.equal(configurationCoverage().find(row => row.key === 'memoryTokenBudget').status, 'pending');
    assert.equal(configurationCoverage().find(row => row.key === 'memoryMaxEntries').status, 'supported');
    for (const changes of [{ memoryKeepRecent: 0 }, { memoryKeepRecent: 101 }, { memoryKeepRecent: '5' }, { memoryKeepRecent: null }]) {
        assert.throws(() => previewSettings({ baseline: {}, changes }));
    }
});

test('Memory keep-recent preview and approved write preserve unrelated memory settings', async () => {
    const f = fixture({ memoryKeepRecent: 8 });
    const preview = previewSettings({ baseline: f.baseline, changes: { memoryKeepRecent: 8 } });
    assert.deepEqual(preview.warnings, ['MEMORY_NOT_ENABLED']);
    assert.deepEqual(preview.diff, [{ field: 'memoryKeepRecent', before: '5', after: '8' }]);
    const action = f.actions.prepare('a', 1);
    f.settings.autoMemoryInterval = 37;
    assert.equal((await f.actions.approve(action.id)).status, 'applied_unconfirmed');
    assert.equal(f.settings.memoryKeepRecent, 8);
    assert.equal(f.settings.autoMemoryInterval, 37);
    assert.equal(f.saves(), 1);
    const stale = fixture({ memoryKeepRecent: 8 });
    const staleAction = stale.actions.prepare('a', 1);
    stale.settings.memoryEnabled = true;
    assert.throws(() => stale.actions.approve(staleAction.id), /STALE/);
    assert.equal(stale.saves(), 0);
});

test('Summary settings declare global scope, activation dependencies and supported interval', () => {
    const ids = ['summaryEnabled', 'autoSummaryEnabled', 'autoSummaryInterval', 'summaryReusePrevious'];
    for (const id of ids) {
        const contract = fieldDefinition(id);
        assert.equal(contract.domain, 'summary'); assert.equal(contract.scope, 'global'); assert.equal(contract.idle, true);
        assert.equal(contract.source, 'ui/sections/chatSummary.js'); assert.ok(contract.description.length > 30);
        assert.equal(configurationCoverage().find(row => row.key === id).status, 'supported');
    }
    assert.deepEqual(dependencyFields(['autoSummaryInterval']), ['autoSummaryEnabled', 'autoSummaryInterval', 'summaryEnabled']);
    assert.deepEqual(dependencyFields(['summaryReusePrevious']), ['summaryEnabled', 'summaryReusePrevious']);
    for (const changes of [{ summaryEnabled: 'true' }, { autoSummaryEnabled: 1 }, { autoSummaryInterval: 0 }, { autoSummaryInterval: 201 }, { summaryReusePrevious: null }]) {
        assert.throws(() => previewSettings({ baseline: {}, changes }));
    }
});

test('Summary preview warns about inactive switches and rejects changed activation conditions', async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    const patch = { autoSummaryInterval: 15, summaryReusePrevious: false };
    const baseline = baselineFor(settings, patch), preview = previewSettings({ baseline, changes: patch });
    assert.deepEqual(preview.warnings, ['SUMMARY_DISABLED', 'AUTO_SUMMARY_DISABLED']);
    const writer = createConfigWriter({ getSettings: () => settings, isBusy: () => false, saveSettings: async () => undefined });
    settings.summaryEnabled = true;
    await assert.rejects(writer.apply({ baseline, changes: patch, contractVersion: 2 }), /STALE_BASELINE/);
    assert.equal(settings.autoSummaryInterval, 10);
    const dormant = fixture({ autoSummaryInterval: 15 });
    const action = dormant.actions.prepare('a', 1);
    assert.equal((await dormant.actions.approve(action.id)).status, 'applied_unconfirmed');
    assert.equal(dormant.settings.autoSummaryInterval, 15); assert.equal(dormant.saves(), 1);
    assert.equal(dormant.settings.summaryEnabled, false); assert.equal(dormant.settings.autoSummaryEnabled, false);
});
test('Summary and critique Prompt contracts preserve raw text and default-reset semantics', async () => {
    for (const [field, domain, enable, source] of [
        ['summaryPrompt', 'summary', 'summaryEnabled', 'ui/sections/chatSummary.js'],
        ['critiquePrompt', 'critique', 'critiqueEnabled', 'ui/sections/critique.js'],
    ]) {
        const contract = fieldDefinition(field);
        assert.equal(contract.domain, domain); assert.equal(contract.source, source);
        assert.equal(contract.idle, true); assert.match(contract.description, /空字符串/);
        assert.match(contract.description, /重新生成/);
        assert.deepEqual(dependencyFields([field]), [enable, field].sort());
        assert.equal(configurationCoverage().find(row => row.key === field).status, 'supported');
        assert.deepEqual(requiredSources('muyu.settings.preview', { changes: { [field]: 'raw {{text}}\n{}' } }), ['source:configSettings']);
        assert.throws(() => previewSettings({ baseline: {}, changes: { [field]: 'x'.repeat(4001) } }));
        assert.throws(() => previewSettings({ baseline: {}, changes: { [field]: null } }));
        const f = fixture({ [field]: 'raw {{text}}\n{}' });
        assert.deepEqual(previewSettings({ baseline: f.baseline, changes: { [field]: 'raw {{text}}\n{}' } }).warnings, [domain === 'summary' ? 'SUMMARY_DISABLED' : 'CRITIQUE_DISABLED']);
        const action = f.actions.prepare('a', 1);
        assert.equal((await f.actions.approve(action.id)).status, 'applied_unconfirmed');
        assert.equal(f.settings[field], 'raw {{text}}\n{}'); assert.equal(f.saves(), 1);
        const reset = previewSettings({ baseline: { [field]: 'custom', [enable]: true }, changes: { [field]: '' } });
        assert.deepEqual(reset.manifest.settings, { [field]: '' });
        assert.deepEqual(reset.warnings, []);
        const stale = fixture({ [field]: 'next' });
        const staleAction = stale.actions.prepare('a', 1); stale.settings[enable] = true;
        assert.throws(() => stale.actions.approve(staleAction.id), /STALE/);
        assert.equal(stale.saves(), 0);
        const busy = fixture({ [field]: 'next' }); const busyAction = busy.actions.prepare('a', 1); busy.busy();
        assert.equal((await busy.actions.approve(busyAction.id)).status, 'not_executed');
        assert.equal(busy.saves(), 0);
    }
});

test('Critique settings declare global scope, activation dependencies and bounded interval', () => {
    const ids = ['critiqueEnabled', 'autoCritiqueEnabled', 'autoCritiqueInterval', 'critiqueReusePrevious'];
    for (const id of ids) {
        const contract = fieldDefinition(id);
        assert.equal(contract.domain, 'critique'); assert.equal(contract.scope, 'global'); assert.equal(contract.idle, true);
        assert.equal(contract.source, 'ui/sections/critique.js'); assert.ok(contract.description.length > 30);
        assert.equal(configurationCoverage().find(row => row.key === id).status, 'supported');
    }
    assert.deepEqual(dependencyFields(['autoCritiqueInterval']), ['autoCritiqueEnabled', 'autoCritiqueInterval', 'critiqueEnabled']);
    assert.deepEqual(dependencyFields(['critiqueReusePrevious']), ['critiqueEnabled', 'critiqueReusePrevious']);
    for (const changes of [{ critiqueEnabled: 'true' }, { autoCritiqueEnabled: 1 }, { autoCritiqueInterval: 0 }, { autoCritiqueInterval: 201 }, { critiqueReusePrevious: null }]) {
        assert.throws(() => previewSettings({ baseline: {}, changes }));
    }
});

test('Critique preview warns about inactive switches, checks dependencies and writes only requested leaves', async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    const patch = { autoCritiqueInterval: 15, critiqueReusePrevious: false };
    const baseline = baselineFor(settings, patch), preview = previewSettings({ baseline, changes: patch });
    assert.deepEqual(preview.warnings, ['CRITIQUE_DISABLED', 'AUTO_CRITIQUE_DISABLED']);
    const writer = createConfigWriter({ getSettings: () => settings, isBusy: () => false, saveSettings: async () => undefined });
    settings.critiqueEnabled = true;
    await assert.rejects(writer.apply({ baseline, changes: patch, contractVersion: 2 }), /STALE_BASELINE/);
    assert.equal(settings.autoCritiqueInterval, 10);
    const dormant = fixture({ autoCritiqueInterval: 15 });
    const action = dormant.actions.prepare('a', 1);
    assert.equal((await dormant.actions.approve(action.id)).status, 'applied_unconfirmed');
    assert.equal(dormant.settings.autoCritiqueInterval, 15); assert.equal(dormant.saves(), 1);
    assert.equal(dormant.settings.critiqueEnabled, false); assert.equal(dormant.settings.autoCritiqueEnabled, false);
    const blocked = fixture({ critiqueReusePrevious: false }); const pending = blocked.actions.prepare('a', 1); blocked.busy();
    assert.equal((await blocked.actions.approve(pending.id)).status, 'not_executed');
    assert.equal(blocked.settings.critiqueReusePrevious, true); assert.equal(blocked.saves(), 0);
});

test('Critique output example is a bounded JSON template, not executable or a formal schema', async () => {
    const example = JSON.stringify({ directorCritique: { pacing: 'good', spotlight: 'shared', suggestions: ['slow down'] }, characterCritiques: { Alice: { consistency: 'good', interaction: 'active', suggestions: [] } } });
    const contract = fieldDefinition('critiqueSchema');
    assert.equal(contract.domain, 'critique'); assert.equal(contract.scope, 'global'); assert.equal(contract.idle, true);
    assert.match(contract.description, /并非标准 JSON Schema/);
    assert.equal(configurationCoverage().find(row => row.key === 'critiqueSchema').status, 'supported');
    assert.deepEqual(dependencyFields(['critiqueSchema']), ['critiqueEnabled', 'critiqueSchema']);
    assert.deepEqual(requiredSources('muyu.settings.preview', { changes: { critiqueSchema: example } }), ['source:configSettings']);
    for (const invalid of ['not JSON', '[]', '{}', '{"directorCritique":[],"characterCritiques":{}}', '{"directorCritique":{},"characterCritiques":{"Alice":null}}', '{"directorCritique":{},"characterCritiques":{},"__proto__":{}}', 'x'.repeat(4001)]) {
        assert.throws(() => previewSettings({ baseline: {}, changes: { critiqueSchema: invalid } }));
    }
    const preview = previewSettings({ baseline: { critiqueSchema: '', critiqueEnabled: true }, changes: { critiqueSchema: example } });
    assert.deepEqual(preview.warnings, []);
    assert.deepEqual(preview.manifest.settings, { critiqueSchema: example });
    assert.deepEqual(previewSettings({ baseline: { critiqueSchema: '', critiqueEnabled: true }, changes: { critiqueSchema: '{"directorCritique":{},"characterCritiques":{}}' } }).warnings, ['CRITIQUE_OUTPUT_EXAMPLE_NONSTANDARD_FIELDS']);
    const f = fixture({ critiqueSchema: example });
    const action = f.actions.prepare('a', 1);
    assert.equal(f.saves(), 0); assert.equal(f.settings.critiqueSchema, '');
    assert.equal((await f.actions.approve(action.id)).status, 'applied_unconfirmed');
    assert.equal(f.settings.critiqueSchema, example); assert.equal(f.saves(), 1);
    const reset = previewSettings({ baseline: { critiqueSchema: example, critiqueEnabled: true }, changes: { critiqueSchema: '' } });
    assert.deepEqual(reset.manifest.settings, { critiqueSchema: '' }); assert.deepEqual(reset.warnings, []);
    const stale = fixture({ critiqueSchema: example }); const pending = stale.actions.prepare('a', 1);
    stale.settings.critiqueEnabled = true;
    assert.throws(() => stale.actions.approve(pending.id), /STALE/); assert.equal(stale.saves(), 0);
    const busy = fixture({ critiqueSchema: example }); const blocked = busy.actions.prepare('a', 1); busy.busy();
    assert.equal((await busy.actions.approve(blocked.id)).status, 'not_executed'); assert.equal(busy.saves(), 0);
});

test('Profile settings describe global effects, bounded tool inputs and activation dependencies', () => {
    const ids = ['profileEnabled', 'profileTokenBudget', 'profileConcurrency'];
    for (const id of ids) {
        const contract = fieldDefinition(id);
        assert.equal(contract.domain, 'profiles'); assert.equal(contract.scope, 'global'); assert.equal(contract.idle, true);
        assert.equal(contract.source, 'ui/sections/profile.js'); assert.ok(contract.description.length > 30);
        assert.equal(configurationCoverage().find(row => row.key === id).status, 'supported');
    }
    assert.deepEqual(dependencyFields(['profileConcurrency']), ['profileConcurrency', 'profileEnabled']);
    assert.deepEqual(dependencyFields(['profileTokenBudget']), ['profileEnabled', 'profileTokenBudget']);
    for (const changes of [{ profileEnabled: 1 }, { profileTokenBudget: 0 }, { profileTokenBudget: 20001 }, { profileConcurrency: -1 }, { profileConcurrency: 21 }, { profileConcurrency: '2' }]) {
        assert.throws(() => previewSettings({ baseline: {}, changes }));
    }
});

test('Profile previews warn about dormant or unlimited settings and preserve unrequested fields', async () => {
    const settings = structuredClone(DEFAULT_SETTINGS), patch = { profileTokenBudget: 3000, profileConcurrency: 0 };
    const baseline = baselineFor(settings, patch), preview = previewSettings({ baseline, changes: patch });
    assert.deepEqual(preview.warnings, ['PROFILES_DISABLED', 'PROFILE_UNBOUNDED_CONCURRENCY']);
    settings.profileEnabled = true;
    const writer = createConfigWriter({ getSettings: () => settings, isBusy: () => false, saveSettings: async () => undefined });
    await assert.rejects(writer.apply({ baseline, changes: patch, contractVersion: 2 }), /STALE_BASELINE/);
    assert.equal(settings.profileTokenBudget, 2000);
    const f = fixture({ profileTokenBudget: 3000 }); const a = f.actions.prepare('a', 1);
    f.settings.profileGeneratorPrompt = 'unsaved draft';
    assert.equal((await f.actions.approve(a.id)).status, 'applied_unconfirmed');
    assert.equal(f.settings.profileTokenBudget, 3000); assert.equal(f.settings.profileEnabled, false);
    assert.equal(f.settings.profileGeneratorPrompt, 'unsaved draft'); assert.equal(f.saves(), 1);
    const blocked = fixture({ profileEnabled: true }); const b = blocked.actions.prepare('a', 1); blocked.busy();
    assert.equal((await blocked.actions.approve(b.id)).status, 'not_executed');
    assert.equal(blocked.settings.profileEnabled, false); assert.equal(blocked.saves(), 0);
});

test('Profile generator Prompt uses a bounded, separately approved leaf without constraining Provider placeholders', async () => {
    const field = 'profileGeneratorPrompt', prompt = 'Profile {{charName}} from {{charDescription}} and {{customProvider}}';
    const contract = fieldDefinition(field);
    assert.equal(contract.domain, 'profiles'); assert.equal(contract.scope, 'global'); assert.equal(contract.idle, true);
    assert.equal(contract.source, 'ui/sections/profile.js');
    assert.match(contract.description, /renderPrompt/); assert.match(contract.description, /空字符串/);
    assert.deepEqual(dependencyFields([field]), ['profileEnabled', field]);
    assert.equal(configurationCoverage().find(row => row.key === field).status, 'supported');
    assert.deepEqual(requiredSources('muyu.settings.preview', { changes: { [field]: prompt } }), ['source:configSettings']);
    for (const invalid of [null, 4, 'x'.repeat(4001)]) assert.throws(() => previewSettings({ baseline: {}, changes: { [field]: invalid } }));
    const f = fixture({ [field]: prompt });
    const preview = previewSettings({ baseline: f.baseline, changes: { [field]: prompt } });
    assert.deepEqual(preview.warnings, ['PROFILES_DISABLED']);
    assert.deepEqual(preview.manifest.settings, { [field]: prompt });
    assert.equal(f.settings[field], ''); assert.equal(f.saves(), 0);
    const action = f.actions.prepare('a', 1);
    f.settings.profileJsonSchema = '{"type":"object"}';
    assert.equal((await f.actions.approve(action.id)).status, 'applied_unconfirmed');
    assert.equal(f.settings[field], prompt); assert.equal(f.settings.profileJsonSchema, '{"type":"object"}');
    assert.equal(f.saves(), 1);
    const reset = previewSettings({ baseline: { [field]: prompt, profileEnabled: true }, changes: { [field]: '' } });
    assert.deepEqual(reset.manifest.settings, { [field]: '' }); assert.deepEqual(reset.warnings, []);
    const stale = fixture({ [field]: prompt }); const pending = stale.actions.prepare('a', 1); stale.settings.profileEnabled = true;
    assert.throws(() => stale.actions.approve(pending.id), /STALE/); assert.equal(stale.saves(), 0);
    const busy = fixture({ [field]: prompt }); const blocked = busy.actions.prepare('a', 1); busy.busy();
    assert.equal((await busy.actions.approve(blocked.id)).status, 'not_executed'); assert.equal(busy.saves(), 0);
});

test('Profile JSON Schema has a bounded dedicated contract and one-field preview', async () => {
    const field = 'profileJsonSchema';
    const schema = JSON.stringify({ type: 'object', properties: { summary: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } }, required: ['summary', 'tags'] });
    const contract = fieldDefinition(field);
    assert.equal(contract.domain, 'profiles'); assert.equal(contract.scope, 'global'); assert.equal(contract.idle, true);
    assert.match(contract.description, /strict: true/); assert.match(contract.description, /空字符串/);
    assert.deepEqual(dependencyFields([field]), ['profileEnabled', field]);
    assert.equal(configurationCoverage().find(row => row.key === field).status, 'supported');
    assert.deepEqual(requiredSources('muyu.settings.preview', { changes: { [field]: schema } }), ['source:configSettings']);
    for (const invalid of [null, 1, 'x'.repeat(4001), '{', '[]', '{"type":"array","items":{"type":"string"}}',
        '{"type":"object","properties":[],"required":[]}', '{"type":"object","properties":{"a":{"type":"string"}},"required":["missing"]}',
        '{"type":"object","properties":{"a":{"type":"array"}}}', '{"type":"object","properties":{"constructor":{"type":"string"}}}',
        '{"type":"object","unknown":1}']) assert.throws(() => previewSettings({ baseline: {}, changes: { [field]: invalid } }));
    const f = fixture({ [field]: schema });
    const preview = previewSettings({ baseline: f.baseline, changes: { [field]: schema } });
    assert.deepEqual(preview.manifest.settings, { [field]: schema });
    assert.deepEqual(preview.warnings, ['PROFILES_DISABLED']);
    assert.equal(f.saves(), 0);
    const action = f.actions.prepare('a', 1);
    const applied = await f.actions.approve(action.id);
    assert.equal(applied.status, 'applied_unconfirmed'); assert.equal(f.settings[field], schema); assert.equal(f.saves(), 1);
    assert.throws(() => f.actions.approve(action.id));
    assert.deepEqual(previewSettings({ baseline: { [field]: schema, profileEnabled: true }, changes: { [field]: '' } }).manifest.settings, { [field]: '' });
    const stale = fixture({ [field]: schema }); const pending = stale.actions.prepare('a', 1);
    stale.settings.profileEnabled = true;
    assert.throws(() => stale.actions.approve(pending.id), /STALE/); assert.equal(stale.saves(), 0);
    const busy = fixture({ [field]: schema }); const blocked = busy.actions.prepare('a', 1); busy.busy();
    assert.equal((await busy.actions.approve(blocked.id)).status, 'not_executed'); assert.equal(busy.saves(), 0);
    const failed = fixture({ [field]: schema }, async () => { throw Error('save unavailable'); });
    const failedAction = failed.actions.prepare('a', 1);
    const result = await failed.actions.approve(failedAction.id);
    assert.equal(result.result.saveError, true);
    assert.equal(failed.settings[field], schema);
    assert.equal(failed.saves(), 1);
});

test('Profile render template previews literal placeholders and writes only its approved leaf', async () => {
    const field = 'profileRenderTemplate', template = '{{name}} / {{summary}} / {{custom}}';
    const contract = fieldDefinition(field);
    assert.equal(contract.domain, 'profiles'); assert.equal(contract.scope, 'global'); assert.equal(contract.idle, true);
    assert.match(contract.description, /原样保留/); assert.match(contract.description, /空字符串/);
    assert.deepEqual(dependencyFields([field]), ['profileEnabled', field]);
    assert.equal(configurationCoverage().find(row => row.key === field).status, 'supported');
    assert.deepEqual(requiredSources('muyu.settings.preview', { changes: { [field]: template } }), ['source:configSettings']);
    for (const invalid of [null, 7, 'x'.repeat(4001)]) assert.throws(() => previewSettings({ baseline: {}, changes: { [field]: invalid } }));
    const f = fixture({ [field]: template });
    const preview = previewSettings({ baseline: f.baseline, changes: { [field]: template } });
    assert.deepEqual(preview.warnings, ['PROFILES_DISABLED', 'PROFILE_RENDER_UNKNOWN_PLACEHOLDERS']);
    assert.deepEqual(preview.manifest.settings, { [field]: template });
    assert.equal(f.settings[field], ''); assert.equal(f.saves(), 0);
    const action = f.actions.prepare('a', 1);
    f.settings.profileJsonSchema = '{"type":"object"}';
    assert.equal((await f.actions.approve(action.id)).status, 'applied_unconfirmed');
    assert.equal(f.settings[field], template); assert.equal(f.settings.profileJsonSchema, '{"type":"object"}'); assert.equal(f.saves(), 1);
    assert.throws(() => f.actions.approve(action.id));
    const reset = previewSettings({ baseline: { [field]: template, profileEnabled: true }, changes: { [field]: '' } });
    assert.deepEqual(reset.manifest.settings, { [field]: '' }); assert.deepEqual(reset.warnings, []);
    const stale = fixture({ [field]: template }); const pending = stale.actions.prepare('a', 1);
    stale.settings.profileEnabled = true;
    assert.throws(() => stale.actions.approve(pending.id), /STALE/); assert.equal(stale.saves(), 0);
    const busy = fixture({ [field]: template }); const blocked = busy.actions.prepare('a', 1); busy.busy();
    assert.equal((await busy.actions.approve(blocked.id)).status, 'not_executed'); assert.equal(busy.saves(), 0);
    const failed = fixture({ [field]: template }, async () => { throw Error('save unavailable'); });
    const result = await failed.actions.approve(failed.actions.prepare('a', 1).id);
    assert.equal(result.result.saveError, true); assert.equal(failed.settings[field], template); assert.equal(failed.saves(), 1);
});

test('Story Blueprint generation and continuation Prompts require one reviewed global write', async () => {
    const patch = { storyBlueprintPrompt: 'Plan {{newRecentMessages}} / {{storyBlueprintMaxNodes}}',
        storyBlueprintContinuePrompt: 'Continue {{storyBlueprintFullJson}} / {{storyBlueprintProgress}}' };
    for (const id of Object.keys(patch)) {
        const contract = fieldDefinition(id);
        assert.equal(contract.domain, 'storyBlueprint'); assert.equal(contract.scope, 'global'); assert.equal(contract.idle, true);
        assert.equal(contract.schema.maxLength, 4000);
        assert.equal(configurationCoverage().find(row => row.key === id).status, 'supported');
        assert.deepEqual(dependencyFields([id]), [id, 'storyBlueprintEnabled'].sort());
        assert.deepEqual(requiredSources('muyu.settings.preview', { changes: { [id]: '' } }), ['source:configSettings']);
        for (const value of [null, 42, 'x'.repeat(4001)]) assert.throws(() => previewSettings({ baseline: {}, changes: { [id]: value } }));
    }
    const f = fixture(patch), preview = previewSettings({ baseline: f.baseline, changes: patch });
    assert.deepEqual(preview.manifest.settings, patch);
    assert.deepEqual(preview.warnings, ['STORY_BLUEPRINT_DISABLED']);
    assert.match(preview.notice, /蓝图全文和进度/);
    assert.equal(f.saves(), 0);
    const action = f.actions.prepare('a', 1);
    f.settings.storyBlueprintMaxNodes = 17;
    assert.equal((await f.actions.approve(action.id)).status, 'applied_unconfirmed');
    assert.equal(f.settings.storyBlueprintPrompt, patch.storyBlueprintPrompt);
    assert.equal(f.settings.storyBlueprintContinuePrompt, patch.storyBlueprintContinuePrompt);
    assert.equal(f.settings.storyBlueprintMaxNodes, 17);
    assert.equal(f.saves(), 1);
    assert.throws(() => f.actions.approve(action.id), /ACTION_STALE/);
    const missing = previewSettings({ baseline: { storyBlueprintPrompt: '', storyBlueprintContinuePrompt: '', storyBlueprintEnabled: true },
        changes: { storyBlueprintPrompt: 'Custom {{characters}}', storyBlueprintContinuePrompt: 'Continue {{characters}}' } });
    for (const warning of ['STORY_BLUEPRINT_PROMPT_NO_RECENT_MESSAGES', 'STORY_BLUEPRINT_CONTINUE_NO_BLUEPRINT', 'STORY_BLUEPRINT_CONTINUE_NO_PROGRESS']) assert.ok(missing.warnings.includes(warning));
    const reset = previewSettings({ baseline: { storyBlueprintPrompt: 'old', storyBlueprintEnabled: true }, changes: { storyBlueprintPrompt: '' } });
    assert.deepEqual(reset.manifest.settings, { storyBlueprintPrompt: '' });
    const stale = fixture({ storyBlueprintContinuePrompt: 'Continue {{storyBlueprintFullJson}}' });
    const staleAction = stale.actions.prepare('a', 1); stale.settings.storyBlueprintEnabled = true;
    assert.throws(() => stale.actions.approve(staleAction.id), /STALE/);
    const busy = fixture({ storyBlueprintPrompt: 'Plan {{newRecentMessages}}' });
    const pending = busy.actions.prepare('a', 1); busy.busy();
    assert.equal((await busy.actions.approve(pending.id)).status, 'not_executed');
    assert.equal(busy.saves(), 0);
});

test('Story Blueprint output-format text and Provider template require reviewed global writes', async () => {
    const patch = {
        storyBlueprintJsonSchema: 'Return JSON with nodes and title.',
        storyBlueprintProviderTemplate: 'Node: {{current.nodeJson}}; total: {{progress.total}}; done: {{completionVariable}}',
    };
    for (const id of Object.keys(patch)) {
        const contract = fieldDefinition(id);
        assert.equal(contract.domain, 'storyBlueprint'); assert.equal(contract.scope, 'global'); assert.equal(contract.idle, true);
        assert.equal(contract.schema.type, 'string'); assert.equal(contract.schema.maxLength, 4000);
        assert.equal(configurationCoverage().find(row => row.key === id).status, 'supported');
        assert.deepEqual(dependencyFields([id]), [id, 'storyBlueprintEnabled'].sort());
        assert.deepEqual(requiredSources('muyu.settings.preview', { changes: { [id]: '' } }), ['source:configSettings']);
        for (const value of [null, 42, 'x'.repeat(4001)]) assert.throws(() => previewSettings({ baseline: {}, changes: { [id]: value } }));
    }
    const f = fixture(patch);
    const preview = previewSettings({ baseline: f.baseline, changes: patch });
    assert.deepEqual(preview.manifest.settings, patch);
    assert.deepEqual(preview.warnings, ['STORY_BLUEPRINT_DISABLED']);
    assert.match(preview.notice, /不是模型原生 JSON Schema/);
    assert.match(preview.notice, /未知路径变为空/);
    f.settings.storyBlueprintMaxNodes = 17;
    const action = f.actions.prepare('a', 1);
    assert.equal((await f.actions.approve(action.id)).status, 'applied_unconfirmed');
    assert.equal(f.settings.storyBlueprintJsonSchema, patch.storyBlueprintJsonSchema);
    assert.equal(f.settings.storyBlueprintProviderTemplate, patch.storyBlueprintProviderTemplate);
    assert.equal(f.settings.storyBlueprintMaxNodes, 17);
    assert.equal(f.saves(), 1);
    assert.throws(() => f.actions.approve(action.id), /ACTION_STALE/);
    const missing = previewSettings({ baseline: { storyBlueprintEnabled: true }, changes: {
        storyBlueprintJsonSchema: 'Return a list of acts.',
        storyBlueprintProviderTemplate: '{{unknown.path}} {{progress.total}}',
    } });
    for (const warning of ['STORY_OUTPUT_FORMAT_NO_NODE_ARRAY', 'STORY_PROVIDER_TEMPLATE_UNKNOWN_PATHS',
        'STORY_PROVIDER_TEMPLATE_NO_CURRENT_DETAIL', 'STORY_PROVIDER_TEMPLATE_NO_COMPLETION_VARIABLE']) assert.ok(missing.warnings.includes(warning));
    const nested = previewSettings({ baseline: { storyBlueprintEnabled: true }, changes: {
        storyBlueprintProviderTemplate: '{{current.node.title}} {{completionVariable}}',
    } });
    assert.deepEqual(nested.warnings, []);
    const reset = previewSettings({ baseline: { storyBlueprintEnabled: true,
        storyBlueprintJsonSchema: patch.storyBlueprintJsonSchema, storyBlueprintProviderTemplate: patch.storyBlueprintProviderTemplate },
    changes: { storyBlueprintJsonSchema: '', storyBlueprintProviderTemplate: '' } });
    assert.deepEqual(reset.manifest.settings, { storyBlueprintJsonSchema: '', storyBlueprintProviderTemplate: '' });
    assert.deepEqual(reset.warnings, []);
    const stale = fixture({ storyBlueprintJsonSchema: patch.storyBlueprintJsonSchema });
    const staleAction = stale.actions.prepare('a', 1); stale.settings.storyBlueprintEnabled = true;
    assert.throws(() => stale.actions.approve(staleAction.id), /STALE/);
    const busy = fixture({ storyBlueprintProviderTemplate: patch.storyBlueprintProviderTemplate });
    const pending = busy.actions.prepare('a', 1); busy.busy();
    assert.equal((await busy.actions.approve(pending.id)).status, 'not_executed'); assert.equal(busy.saves(), 0);
});

test('Story Blueprint ordinary settings are bounded, scoped and do not implicitly enable the feature', async () => {
    for (const id of ['storyBlueprintAutoContinue', 'storyBlueprintMaxNodes', 'storyBlueprintProgressionMode', 'storyBlueprintProgressionLevel']) {
        const contract = fieldDefinition(id);
        assert.equal(contract.domain, 'storyBlueprint'); assert.equal(contract.scope, 'global'); assert.equal(contract.idle, true);
        assert.equal(contract.source, 'ui/sections/storyBlueprint.js');
        assert.equal(configurationCoverage().find(row => row.key === id).status, 'supported');
        assert.deepEqual(dependencyFields([id]), [id, 'storyBlueprintEnabled', ...(id === 'storyBlueprintProgressionMode' ? ['storyBlueprintProgressionLevel'] : id === 'storyBlueprintProgressionLevel' ? ['storyBlueprintProgressionMode'] : [])].sort());
    }
    assert.deepEqual(requiredSources('muyu.settings.preview', { changes: { storyBlueprintMaxNodes: 12 } }), ['source:configSettings']);
    for (const changes of [{ storyBlueprintAutoContinue: 'true' }, { storyBlueprintMaxNodes: 0 }, { storyBlueprintMaxNodes: 51 }, { storyBlueprintMaxNodes: 1.5 }, { storyBlueprintEnabled: 'true' }, { storyBlueprintProgressionMode: 'invalid' }, { storyBlueprintProgressionLevel: -1 }, { storyBlueprintProgressionLevel: 1001 }, { storyBlueprintCompletionVariable: 'Bad Name!' }, { storyBlueprintCompletionVariableGuard: 'done' }]) {
        assert.throws(() => previewSettings({ baseline: {}, changes }));
    }
    const patch = { storyBlueprintAutoContinue: true, storyBlueprintMaxNodes: 12 };
    const f = fixture(patch), preview = previewSettings({ baseline: f.baseline, changes: patch });
    assert.equal(f.baseline.storyBlueprintEnabled, false);
    assert.equal(configurationCoverage().find(row => row.key === 'storyBlueprintEnabled').status, 'supported');
    await assert.rejects(createConfigWriter({ getSettings: () => f.settings, saveSettings: async () => {}, isBusy: () => false }).apply({
        baseline: readSettingsFields(f.settings, dependencyFields(['storyBlueprintEnabled'])), changes: { storyBlueprintEnabled: true }, contractVersion: 2 }), /WRITE_UNAVAILABLE/);
    assert.deepEqual(preview.warnings, ['STORY_BLUEPRINT_DISABLED']);
    assert.deepEqual(preview.manifest.settings, patch);
    assert.equal(f.saves(), 0);
    const action = f.actions.prepare('a', 1);
    f.settings.storyBlueprintPrompt = 'unrelated draft';
    assert.equal((await f.actions.approve(action.id)).status, 'applied_unconfirmed');
    assert.equal(f.settings.storyBlueprintAutoContinue, true); assert.equal(f.settings.storyBlueprintMaxNodes, 12);
    assert.equal(f.settings.storyBlueprintEnabled, false); assert.equal(f.settings.storyBlueprintPrompt, 'unrelated draft');
    assert.equal(f.saves(), 1); assert.throws(() => f.actions.approve(action.id));
    const stale = fixture(patch), pending = stale.actions.prepare('a', 1); stale.settings.storyBlueprintEnabled = true;
    assert.throws(() => stale.actions.approve(pending.id), /STALE/); assert.equal(stale.saves(), 0);
    const busy = fixture(patch), blocked = busy.actions.prepare('a', 1); busy.busy();
    assert.equal((await busy.actions.approve(blocked.id)).status, 'not_executed'); assert.equal(busy.saves(), 0);
    const failed = fixture(patch, async () => { throw Error('save unavailable'); });
    const result = await failed.actions.approve(failed.actions.prepare('a', 1).id);
    assert.equal(result.result.saveError, true); assert.equal(failed.saves(), 1);
});

test('Story Blueprint mode and level preview requires an explicit scoped apply', async () => {
    const patch = { storyBlueprintProgressionMode: 'level', storyBlueprintProgressionLevel: 2 };
    const f = fixture(patch);
    const preview = previewSettings({ baseline: f.baseline, changes: patch });
    assert.ok(preview.warnings.includes('STORY_PROGRESS_SCOPE_SWITCH'));
    assert.ok(preview.warnings.includes('STORY_BLUEPRINT_DISABLED'));
    assert.equal(preview.warnings.includes('STORY_LEVEL_INACTIVE'), false);
    assert.deepEqual(preview.manifest.settings, patch);
    assert.deepEqual(requiredSources('muyu.settings.preview', { changes: patch }), ['source:configSettings']);
    const action = f.actions.prepare('a', 1);
    assert.equal((await f.actions.approve(action.id)).status, 'applied_unconfirmed');
    assert.equal(f.settings.storyBlueprintProgressionMode, 'level');
    assert.equal(f.settings.storyBlueprintProgressionLevel, 2);
    assert.equal(f.saves(), 1);
});

test('NPC settings declare global scope, closed ranges and dependent capacity semantics', () => {
    const ids = ['npcEnabled', 'npcMaxCount', 'npcBatchSize', 'npcGenerateFirstMes'];
    for (const id of ids) {
        const contract = fieldDefinition(id);
        assert.equal(contract.domain, 'npc'); assert.equal(contract.scope, 'global'); assert.equal(contract.idle, true);
        assert.equal(contract.source, 'ui/sections/npc.js'); assert.ok(contract.description.length > 30);
        assert.equal(configurationCoverage().find(row => row.key === id).status, 'supported');
    }
    assert.deepEqual(dependencyFields(['npcMaxCount']), ['npcBatchSize', 'npcEnabled', 'npcMaxCount']);
    assert.deepEqual(dependencyFields(['npcBatchSize']), ['npcBatchSize', 'npcEnabled', 'npcMaxCount']);
    for (const changes of [{ npcEnabled: 1 }, { npcMaxCount: 0 }, { npcMaxCount: 201 }, { npcBatchSize: 0 }, { npcBatchSize: 201 }, { npcGenerateFirstMes: null }]) {
        assert.throws(() => previewSettings({ baseline: {}, changes }));
    }
});

test('NPC preview warns about disabled use and clamped batch, with stale dependency protection', async () => {
    const settings = structuredClone(DEFAULT_SETTINGS), patch = { npcMaxCount: 2, npcGenerateFirstMes: true };
    const baseline = baselineFor(settings, patch), preview = previewSettings({ baseline, changes: patch });
    assert.deepEqual(preview.warnings, ['NPC_DISABLED', 'NPC_BATCH_CLAMPED']);
    const writer = createConfigWriter({ getSettings: () => settings, isBusy: () => false, saveSettings: async () => undefined });
    settings.npcBatchSize = 1;
    await assert.rejects(writer.apply({ baseline, changes: patch, contractVersion: 2 }), /STALE_BASELINE/);
    assert.equal(settings.npcMaxCount, 10);
    const f = fixture({ npcBatchSize: 2 }); const a = f.actions.prepare('a', 1);
    f.settings.npcPrompt = 'unsaved draft';
    assert.equal((await f.actions.approve(a.id)).status, 'applied_unconfirmed');
    assert.equal(f.settings.npcBatchSize, 2); assert.equal(f.settings.npcEnabled, false);
    assert.equal(f.settings.npcPrompt, 'unsaved draft'); assert.equal(f.saves(), 1);
    const blocked = fixture({ npcEnabled: true }); const b = blocked.actions.prepare('a', 1); blocked.busy();
    assert.equal((await blocked.actions.approve(b.id)).status, 'not_executed');
    assert.equal(blocked.settings.npcEnabled, false); assert.equal(blocked.saves(), 0);
});
