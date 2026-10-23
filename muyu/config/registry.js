import { copyJson, jsonKey, validateJson } from '../core/json-contract.js';
import { configPresentation } from './presentation.js';
import { bundleFieldPolicy } from './bundle-policy.js';
import { memoryFieldSchemas } from '../modules/config-draft/contracts.js';
import { directorRuleDefinitions, formulaRuleDefinitions } from './speaker-rules.js';
import { inspectDirectorOutputFormat } from './director-output-format.js';
import { inspectDirectorContinuityTemplate } from './director-continuity-template.js';
import { inspectDirectorWorldInfoTemplate } from './director-world-info-template.js';
import { summaryRuleDefinitions } from './summary-rules.js';
import { critiqueRuleDefinitions } from './critique-rules.js';
import { inspectCritiqueTemplate } from './critique-template.js';
import { profileRuleDefinitions } from './profile-rules.js';
import { storyBlueprintRuleDefinitions } from './story-blueprint-rules.js';
import { inspectStoryBlueprintProviderTemplate } from './story-blueprint-template.js';
import { inspectProfileSchema } from './profile-schema.js';
import { inspectProfileRenderTemplate } from './profile-template.js';
import { npcRuleDefinitions } from './npc-rules.js';
import { worldBookRuleDefinitions } from './world-book-rules.js';
import { postSpeechRuleDefinitions } from './post-speech-rules.js';
import { memoryRuleDefinitions } from './memory-rules.js';
import { generalRuleDefinitions } from './general-rules.js';
import { settingsSwitchRules, settingsSwitchDependencies, validateSettingsSwitchPatch } from './settings-switch-rules.js';
import { inspectMemorySchema } from '../../agents/memory-schema.js';
import { inspectMemoryRenderTemplate } from '../../assets/providers/memory-template.js';

// Registered leaf paths only. This is not an arbitrary settings-path writer.
const integer = minimum => ({ type: 'integer', minimum, maximum: Number.MAX_SAFE_INTEGER });
const definitions = {
    ...generalRuleDefinitions,
    ...Object.fromEntries(Object.entries(memoryFieldSchemas).map(([id, schema]) => [id, { domain: 'memory', schema, dependencies: ['memoryEnabled', 'autoMemoryEnabled'] }])),
    ...memoryRuleDefinitions,
    memoryMaxEntries: { domain: 'memory', schema: { type: 'integer', minimum: 10, maximum: 2000 }, idle: true, source: 'ui/sections/memory.js', description: '每角色保留条数上限。仅可单独预览和批准；调低会在当前聊天裁剪各角色最旧的超额记忆，且影响所有聊天后续记忆生成与导入。全局设置保存与当前聊天裁剪是两个保存域，可能部分完成；本工具范围 10..2000，原界面输入处理仅强制下限。' },
    mode: { domain: 'director', schema: { type: 'string', enum: ['off', 'formula', 'llm'] }, idle: true },
    topN: { domain: 'director', schema: { type: 'integer', minimum: 1, maximum: 20 }, idle: true },
    llmMaxSpeakers: { domain: 'director', schema: { type: 'integer', minimum: 1, maximum: 20 }, idle: true },
    ...directorRuleDefinitions,
    ...Object.fromEntries(['mention', 'keyword', 'recency', 'talkativeness'].map(key => [`scoreWeights.${key}`, { domain: 'scoring', schema: integer(key === 'talkativeness' ? 1 : 0), idle: true }])),
    ...formulaRuleDefinitions,
    ...summaryRuleDefinitions,
    ...critiqueRuleDefinitions,
    ...profileRuleDefinitions,
    ...settingsSwitchRules,
    ...storyBlueprintRuleDefinitions,
    ...npcRuleDefinitions,
    ...worldBookRuleDefinitions,
    ...postSpeechRuleDefinitions,
    llmPrompt: { domain: 'prompt', schema: { type: 'string', maxLength: 4000 }, idle: true },
    knowledgeText: { domain: 'prompt', schema: { type: 'string', maxLength: 8000 }, idle: true, source: 'ui/sections/director.js', description: '全局知识库原文，只在后续 Prompt 显式使用 {{knowledge}} 时注入。内容中的 {{...}} 会转义为字面文本，不执行 Provider；空串使该 Provider 输出为空。可能将知识正文发送给所配置模型；不改已有聊天，最多 8000 字符且整份草稿仍受 DTO 字节预算限制。' },
    identityPrompt: { domain: 'prompt', schema: { type: 'string', maxLength: 4000 }, idle: true, source: 'ui/sections/identity.js', description: '全局身份锚定 Prompt 原文；仅后续 Prompt 显式引用 {{identity}} 时注入，空串使用内置身份模板，不是关闭身份 Provider。内置模板包含角色档案和记忆占位符，实际是否继续解析取决于调用方的模板渲染设置。可能发送角色资料给配置模型；最多 4000 字符。' },
    providerTimeoutMs: { domain: 'provider', schema: integer(0) },
};
const readOnlyDependencies = settingsSwitchDependencies;
export const configFields = Object.freeze(Object.keys(definitions));
export const configDomains = Object.freeze(['memory', 'director', 'scoring', 'prompt', 'provider', 'summary', 'critique', 'profiles', 'storyBlueprint', 'npc', 'worldBook', 'postSpeech', 'general']);
export const configChangesSchema = { type: 'object', properties: Object.fromEntries(configFields.map(id => [id, definitions[id].schema])), additionalProperties: false };
export function fieldDefinition(id) {
    const definition = Object.hasOwn(definitions, id) ? definitions[id] : Object.hasOwn(readOnlyDependencies, id) ? readOnlyDependencies[id] : null;
    if (!definition) throw Error('UNKNOWN_CONFIG_FIELD');
    const notes = {
        memory: '记忆开关/自动提取参数。interval单位为新增消息条数，1..200是本工具支持范围，不是运行时强制上限。间隔只是调度阈值；总开关、自动提取开关及运行触发条件满足后才可能执行，不证明发生或成功。缺失保持未知，不自动补开开关。自动提取关闭只停用自动提取路径，不能推断记忆冻结或只能手动提取；编辑、导入等路径需分别核实。',
        director: 'off关闭、formula公式、llm导演模型。topN用于公式模式，llmMaxSpeakers用于LLM模式。人数1..20与快捷操作一致；生成中不可修改。LLM人数是上限，不是实际选择结果；即使上限等于成员数，模型仍可少选，不能说导演不再筛选。',
        scoring: '评分权重，按单个叶字段修改，保留其他权重；生成中不可修改。',
        prompt: '导演提示词原文，不是JSON Schema。空串沿用插件缺省提示词。最多4000字符；超出草稿DTO字节预算则拒绝，不截断保存。生成中不可修改。',
        provider: '毫秒；0表示不超时。保存入口同步默认渲染超时，只影响后续调用，不中断正在执行的Provider。',
    };
    return copyJson({ id, scope: 'global', applies: 'next-use', description: notes[definition.domain], source: definition.domain === 'scoring' ? 'ui/sections/formula.js' : definition.domain === 'memory' ? 'ui/sections/memory.js' : 'ui/sections/director.js', ...definition, presentation: configPresentation(id), bundle: Object.hasOwn(definitions, id) ? bundleFieldPolicy(id) : { supported: false, reason: 'Read-only dependency, not a registered writable field.' } });
}
export function selectedFields(fields) {
    if (!Array.isArray(fields) || !fields.length || fields.length > configFields.length + Object.keys(readOnlyDependencies).length || new Set(fields).size !== fields.length) throw Error('INVALID_CONFIG_FIELDS');
    fields.forEach(fieldDefinition); return fields;
}
export function dependencyFields(fields) {
    return [...new Set(selectedFields(fields).flatMap(id => [id, ...(fieldDefinition(id).dependencies || [])]))].sort();
}
function leaf(settings, field) {
    let value = settings;
    for (const key of field.split('.')) {
        if (value === undefined) return undefined;
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('UNSUPPORTED_BASELINE');
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor) return undefined;
        if (!Object.hasOwn(descriptor, 'value')) throw Error('UNSUPPORTED_BASELINE');
        value = descriptor.value;
    }
    return value;
}
export function readSettingsFields(settings, fields) {
    const result = {};
    for (const field of selectedFields(fields)) {
        const value = leaf(settings, field);
        if (value !== undefined) result[field] = copyJson(value);
    }
    return copyJson(result);
}
export function projectBaseline(baseline, fields) {
    return copyJson(Object.fromEntries(selectedFields(fields).filter(id => Object.hasOwn(baseline, id)).map(id => [id, baseline[id]])));
}
export function previewSettings({ baseline, changes, allowEmpty = false }) {
    const patch = validateJson(configChangesSchema, changes), keys = Object.keys(patch);
    if (!keys.length) throw Error('EMPTY_CHANGES');
    validateSettingsSwitchPatch(baseline, patch);
    const critiqueTemplate = keys.includes('critiqueSchema') ? inspectCritiqueTemplate(patch.critiqueSchema) : null;
    if (keys.includes('profileJsonSchema')) inspectProfileSchema(patch.profileJsonSchema);
    if (keys.includes('memoryCompressPrompt') && patch.memoryCompressPrompt && !patch.memoryCompressPrompt.includes('{{memories}}')) throw Error('MEMORY_COMPRESS_PROMPT_MISSING_MEMORIES');
    if (keys.includes('memoryJsonSchema')) inspectMemorySchema(patch.memoryJsonSchema);
    const memoryTemplate = keys.includes('memoryRenderTemplate') ? inspectMemoryRenderTemplate(patch.memoryRenderTemplate) : null;
    const blueprintTemplate = keys.includes('storyBlueprintProviderTemplate') ? inspectStoryBlueprintProviderTemplate(patch.storyBlueprintProviderTemplate) : null;
    const directorOutputFormat = keys.includes('llmJsonSchema') ? inspectDirectorOutputFormat(patch.llmJsonSchema) : null;
    const continuityLastTemplate = keys.includes('llmScriptContinuityWrapper') ? inspectDirectorContinuityTemplate(patch.llmScriptContinuityWrapper, 'previousPlan') : null;
    const continuityHistoryTemplate = keys.includes('llmScriptContinuityHistoryWrapper') ? inspectDirectorContinuityTemplate(patch.llmScriptContinuityHistoryWrapper, 'previousPlans') : null;
    const worldInfoTemplate = keys.includes('llmWorldInfoWrapper') ? inspectDirectorWorldInfoTemplate(patch.llmWorldInfoWrapper) : null;
    if (keys.includes('storyBlueprintCompletionVariable') && (!/^[a-z0-9_]{1,64}$/.test(patch.storyBlueprintCompletionVariable) ||
        ['__proto__', 'constructor', 'prototype'].includes(patch.storyBlueprintCompletionVariable))) throw Error('INVALID_COMPLETION_VARIABLE');
    const profileTemplate = keys.includes('profileRenderTemplate') ? inspectProfileRenderTemplate(patch.profileRenderTemplate) : null;
    const observed = projectBaseline(baseline, dependencyFields(keys));
    const diff = keys.filter(id => !Object.hasOwn(observed, id) || jsonKey(observed[id]) !== jsonKey(patch[id])).map(field => ({ field, before: Object.hasOwn(observed, field) ? JSON.stringify(observed[field]) : '(missing)', after: JSON.stringify(patch[field]) }));
    if (!diff.length && !allowEmpty) throw Error('NO_EFFECTIVE_CHANGE');
    const effective = { ...observed, ...patch }, warnings = [];
    if (keys.some(id => id.startsWith('profileLibraryAutoLoad.'))) {
        if (!effective.profileEnabled) warnings.push('PROFILE_NOT_ENABLED');
        if (!effective['profileLibraryAutoLoad.enabled']) warnings.push('PROFILE_AUTO_LOAD_DISABLED');
        if (effective['profileLibraryAutoLoad.overwriteExisting']) warnings.push('PROFILE_LIBRARY_MAY_OVERWRITE_EXISTING');
        if (effective['profileLibraryAutoLoad.importTemplate']) warnings.push('PROFILE_LIBRARY_MAY_IMPORT_GLOBAL_TEMPLATES');
    }
    if (keys.includes('debugLogging') && patch.debugLogging) warnings.push('DEBUG_LOGGING_MAY_RECORD_PRIVATE_DATA');
    if (keys.some(id => definitions[id].domain === 'memory' && id !== 'memoryMaxEntries')) {
        if (effective.memoryEnabled !== true) warnings.push('MEMORY_NOT_ENABLED');
        if (keys.some(id => ['autoMemoryEnabled', 'autoMemoryInterval', 'autoMemorySpeakers'].includes(id)) && effective.autoMemoryEnabled !== true) warnings.push('AUTO_NOT_ENABLED');
    }
    if (keys.includes('memoryPrompt') && patch.memoryPrompt && !patch.memoryPrompt.includes('{{newRecentMessages}}')) warnings.push('MEMORY_PROMPT_NO_RECENT_MESSAGES');
    if (memoryTemplate?.custom && !memoryTemplate.containsMemoryLoop) warnings.push('MEMORY_RENDER_NO_MEMORY_LOOP');
    if (keys.some(id => Object.hasOwn(formulaRuleDefinitions, id)) && effective.mode !== 'formula') warnings.push('FORMULA_MODE_INACTIVE');
    if (keys.some(id => Object.hasOwn(directorRuleDefinitions, id) && id === 'llmRespectOrder') && effective.mode !== 'llm') warnings.push('LLM_ORDER_MODE_INACTIVE');
    if (keys.includes('llmWorldInfoEnabled') && patch.llmWorldInfoEnabled === true) warnings.push('DIRECTOR_WORLD_INFO_CONTEXT_AND_EXTERNAL_MODEL');
    if (worldInfoTemplate && effective.llmWorldInfoEnabled !== true) warnings.push('WORLD_INFO_WRAPPER_DISABLED');
    if (worldInfoTemplate && !worldInfoTemplate.empty && worldInfoTemplate.placeholderCount === 0) warnings.push('WORLD_INFO_WRAPPER_NO_WORLD_INFO');
    if (worldInfoTemplate?.placeholderCount > 1) warnings.push('WORLD_INFO_WRAPPER_REPEATED_PLACEHOLDER');
    if (worldInfoTemplate?.otherPlaceholders) warnings.push('WORLD_INFO_WRAPPER_OTHER_PLACEHOLDERS');
    const continuityFields = ['llmScriptContinuity', 'llmScriptContinuityMode', 'llmScriptContinuityCount'];
    if (keys.some(id => ['llmScriptEnabled', 'llmScriptPosition', ...continuityFields].includes(id)) && effective.mode !== 'llm') warnings.push('DIRECTOR_LLM_MODE_INACTIVE');
    if (keys.includes('llmScriptEnabled') && patch.llmScriptEnabled === true) warnings.push('DIRECTOR_STAGE_DIRECTION_ENABLED');
    if (keys.includes('llmScriptPosition') && effective.llmScriptEnabled !== true) warnings.push('DIRECTOR_STAGE_DIRECTION_DISABLED');
    if (keys.some(id => id === 'llmScriptPrompt' || id === 'llmScriptWrapper') && effective.mode !== 'llm') warnings.push('DIRECTOR_SCRIPT_TEXT_MODE_INACTIVE');
    if (keys.some(id => id === 'llmScriptPrompt' || id === 'llmScriptWrapper') && effective.llmScriptEnabled !== true) warnings.push('DIRECTOR_SCRIPT_TEXT_DISABLED');
    if (keys.includes('llmScriptWrapper') && patch.llmScriptWrapper && !patch.llmScriptWrapper.includes('{{script}}')) warnings.push('DIRECTOR_SCRIPT_WRAPPER_NO_SCRIPT');
    if (directorOutputFormat && effective.mode !== 'llm' && effective.forceSpeakMode !== 'llm') warnings.push('DIRECTOR_OUTPUT_FORMAT_INACTIVE');
    if (directorOutputFormat?.empty) warnings.push('DIRECTOR_OUTPUT_FORMAT_EMPTY');
    if (directorOutputFormat && !directorOutputFormat.empty && !directorOutputFormat.hasSpeakers) warnings.push('DIRECTOR_OUTPUT_FORMAT_NO_SPEAKERS');
    if (directorOutputFormat && !directorOutputFormat.empty && effective.llmScriptEnabled === true && !directorOutputFormat.hasScriptField) warnings.push('DIRECTOR_OUTPUT_FORMAT_NO_SCRIPT_FIELD');
    if (directorOutputFormat && !directorOutputFormat.empty && effective.storyBlueprintEnabled === true && !directorOutputFormat.hasStoryDoneField) warnings.push('DIRECTOR_OUTPUT_FORMAT_NO_STORY_DONE_FIELD');
    if (directorOutputFormat?.hasSelfReference) warnings.push('DIRECTOR_OUTPUT_FORMAT_SELF_REFERENCE_STRIPPED');
    if (directorOutputFormat?.hasOtherPlaceholders) warnings.push('DIRECTOR_OUTPUT_FORMAT_OTHER_PLACEHOLDERS');
    if (keys.includes('llmScriptPosition') && patch.llmScriptPosition === 1) warnings.push('DIRECTOR_STAGE_DIRECTION_NEAR_CHAT');
    if (keys.some(id => continuityFields.includes(id)) && effective.llmHistoryEnabled !== true) warnings.push('DIRECTOR_HISTORY_DISABLED');
    if (keys.some(id => ['llmScriptContinuityMode', 'llmScriptContinuityCount'].includes(id)) && effective.llmScriptContinuity !== true) warnings.push('DIRECTOR_CONTINUITY_DISABLED');
    if (keys.includes('llmScriptContinuityCount') && effective.llmScriptContinuityMode !== 'history') warnings.push('DIRECTOR_HISTORY_COUNT_INACTIVE');
    if (keys.includes('llmScriptContinuityCount') && patch.llmScriptContinuityCount === 0) warnings.push('DIRECTOR_ALL_HISTORY_CONTEXT');
    if (keys.includes('llmScriptContinuity') && patch.llmScriptContinuity === true || keys.includes('llmScriptContinuityMode') && patch.llmScriptContinuityMode === 'history') warnings.push('DIRECTOR_CONTINUITY_CONTEXT_COST');
    const hasContinuityTemplate = continuityLastTemplate !== null || continuityHistoryTemplate !== null;
    if (hasContinuityTemplate && effective.mode !== 'llm' && effective.forceSpeakMode !== 'llm') warnings.push('DIRECTOR_CONTINUITY_TEMPLATE_INACTIVE');
    if (hasContinuityTemplate && effective.llmHistoryEnabled !== true) warnings.push('DIRECTOR_CONTINUITY_TEMPLATE_HISTORY_DISABLED');
    if (hasContinuityTemplate && effective.llmScriptContinuity !== true) warnings.push('DIRECTOR_CONTINUITY_TEMPLATE_DISABLED');
    if (continuityLastTemplate && effective.llmScriptContinuityMode === 'history') warnings.push('DIRECTOR_LAST_WRAPPER_MODE_INACTIVE');
    if (continuityHistoryTemplate && effective.llmScriptContinuityMode !== 'history') warnings.push('DIRECTOR_HISTORY_WRAPPER_MODE_INACTIVE');
    if (continuityLastTemplate?.placeholderCount === 0) warnings.push('DIRECTOR_LAST_WRAPPER_NO_PLAN');
    if (continuityHistoryTemplate?.placeholderCount === 0) warnings.push('DIRECTOR_HISTORY_WRAPPER_NO_PLANS');
    if ((continuityLastTemplate?.placeholderCount ?? 0) > 1 || (continuityHistoryTemplate?.placeholderCount ?? 0) > 1) warnings.push('DIRECTOR_CONTINUITY_WRAPPER_REPEATED_PLACEHOLDER');
    if (continuityLastTemplate?.otherPlaceholders || continuityHistoryTemplate?.otherPlaceholders) warnings.push('DIRECTOR_CONTINUITY_WRAPPER_OTHER_PLACEHOLDERS');
    if (continuityHistoryTemplate && effective.llmScriptContinuityMode === 'history' && effective.llmScriptContinuityCount === 0) warnings.push('DIRECTOR_CONTINUITY_WRAPPER_ALL_HISTORY');
    if (hasContinuityTemplate && effective.llmPrompt &&
        (effective.llmPrompt.includes('{{previousPlan}}') || effective.llmPrompt.includes('{{previousPlans}}')) &&
        !effective.llmPrompt.includes(effective.llmScriptContinuityMode === 'history' ? '{{previousPlans}}' : '{{previousPlan}}')) warnings.push('DIRECTOR_CONTINUITY_PROMPT_WRONG_PLACEHOLDER');
    if (hasContinuityTemplate && effective.forceSpeakMode === 'llm' && effective.llmPrompt &&
        !effective.llmPrompt.includes('{{previousPlan}}') && !effective.llmPrompt.includes('{{previousPlans}}')) warnings.push('FORCE_SPEAK_CONTINUITY_NO_EXPLICIT_PLACEHOLDER');
    if (keys.includes('forceSpeakMode') && patch.forceSpeakMode === 'llm') warnings.push('FORCE_SPEAK_EXTRA_MODEL_CALL');
    if (keys.includes('forceSpeakMode') && patch.forceSpeakMode === 'block') warnings.push('FORCE_SPEAK_BLOCKS_GENERATION');
    if (keys.includes('forceSpeakPrompt') && effective.forceSpeakMode !== 'llm') warnings.push('FORCE_SPEAK_PROMPT_MODE_INACTIVE');
    if (keys.includes('forceSpeakPrompt') && patch.forceSpeakPrompt && !patch.forceSpeakPrompt.includes('{charName}')) warnings.push('FORCE_SPEAK_PROMPT_NO_CHARACTER_NAME');
    if (keys.includes('templateMaxPasses') && effective.templateRecursive === false) warnings.push('TEMPLATE_PASSES_INACTIVE');
    if (keys.includes('templateRecursive') && patch.templateRecursive === true) warnings.push('TEMPLATE_RECURSION_WORK');
    if (keys.includes('templateDebugPlaceholders') && patch.templateDebugPlaceholders === true) warnings.push('TEMPLATE_UNKNOWN_PLACEHOLDERS_VISIBLE');
    if (keys.includes('triggerScore') && effective.triggerEnabled !== true) warnings.push('TRIGGER_DISABLED');
    if (keys.includes('initiativeBaseScore') && effective.initiativeEnabled !== true) warnings.push('INITIATIVE_DISABLED');
    if (keys.includes('llmCharDescLength') && effective.llmCharDescMode !== 'slice') warnings.push('CHAR_DESC_NOT_SLICED');
    if (keys.some(id => id !== 'summaryEnabled' && Object.hasOwn(summaryRuleDefinitions, id)) && effective.summaryEnabled !== true) warnings.push('SUMMARY_DISABLED');
    if (keys.includes('autoSummaryInterval') && effective.autoSummaryEnabled !== true) warnings.push('AUTO_SUMMARY_DISABLED');
    if (keys.some(id => id !== 'critiqueEnabled' && Object.hasOwn(critiqueRuleDefinitions, id)) && effective.critiqueEnabled !== true) warnings.push('CRITIQUE_DISABLED');
    if (keys.includes('autoCritiqueInterval') && effective.autoCritiqueEnabled !== true) warnings.push('AUTO_CRITIQUE_DISABLED');
    if (critiqueTemplate?.nonstandard) warnings.push('CRITIQUE_OUTPUT_EXAMPLE_NONSTANDARD_FIELDS');
    if (keys.some(id => id !== 'profileEnabled' && Object.hasOwn(profileRuleDefinitions, id)) && effective.profileEnabled !== true) warnings.push('PROFILES_DISABLED');
    if (keys.includes('profileConcurrency') && effective.profileConcurrency === 0) warnings.push('PROFILE_UNBOUNDED_CONCURRENCY');
    if (profileTemplate?.unknown.length) warnings.push('PROFILE_RENDER_UNKNOWN_PLACEHOLDERS');
    if (keys.some(id => Object.hasOwn(storyBlueprintRuleDefinitions, id)) && effective.storyBlueprintEnabled !== true) warnings.push('STORY_BLUEPRINT_DISABLED');
    if (keys.includes('storyBlueprintPrompt') && patch.storyBlueprintPrompt && !patch.storyBlueprintPrompt.includes('{{newRecentMessages}}')) warnings.push('STORY_BLUEPRINT_PROMPT_NO_RECENT_MESSAGES');
    if (keys.includes('storyBlueprintContinuePrompt') && patch.storyBlueprintContinuePrompt && !patch.storyBlueprintContinuePrompt.includes('{{storyBlueprintFullJson}}')) warnings.push('STORY_BLUEPRINT_CONTINUE_NO_BLUEPRINT');
    if (keys.includes('storyBlueprintContinuePrompt') && patch.storyBlueprintContinuePrompt && !patch.storyBlueprintContinuePrompt.includes('{{storyBlueprintProgress}}')) warnings.push('STORY_BLUEPRINT_CONTINUE_NO_PROGRESS');
    if (keys.includes('storyBlueprintJsonSchema') && patch.storyBlueprintJsonSchema && !/\b(nodes|chapters)\b/.test(patch.storyBlueprintJsonSchema)) warnings.push('STORY_OUTPUT_FORMAT_NO_NODE_ARRAY');
    if (blueprintTemplate?.unknown.length) warnings.push('STORY_PROVIDER_TEMPLATE_UNKNOWN_PATHS');
    if (keys.includes('storyBlueprintProviderTemplate') && patch.storyBlueprintProviderTemplate && !blueprintTemplate.hasCurrentDetail) warnings.push('STORY_PROVIDER_TEMPLATE_NO_CURRENT_DETAIL');
    if (keys.includes('storyBlueprintProviderTemplate') && patch.storyBlueprintProviderTemplate && !blueprintTemplate.hasCompletionVariable) warnings.push('STORY_PROVIDER_TEMPLATE_NO_COMPLETION_VARIABLE');
    if (keys.some(id => id === 'storyBlueprintProgressionMode' || id === 'storyBlueprintProgressionLevel')) warnings.push('STORY_PROGRESS_SCOPE_SWITCH');
    if (keys.includes('storyBlueprintProgressionLevel') && effective.storyBlueprintProgressionMode !== 'level') warnings.push('STORY_LEVEL_INACTIVE');
    if (keys.includes('storyBlueprintCompletionVariable')) warnings.push('STORY_COMPLETION_VARIABLE_REQUIRES_CHAT_CREATION');
    if (keys.includes('npcPrompt') && patch.npcPrompt && !patch.npcPrompt.includes('{{newRecentMessages}}')) warnings.push('NPC_PROMPT_NO_RECENT_MESSAGES');
    if (keys.some(id => id !== 'npcEnabled' && Object.hasOwn(npcRuleDefinitions, id)) && effective.npcEnabled !== true) warnings.push('NPC_DISABLED');
    if (keys.some(id => id === 'npcMaxCount' || id === 'npcBatchSize') && effective.npcBatchSize > effective.npcMaxCount) warnings.push('NPC_BATCH_CLAMPED');
    if (keys.includes('worldBookSourceMode') && effective.worldBookSourceMode === 'manual') warnings.push('WORLD_BOOK_MANUAL_SELECTION_REQUIRED');
    if (keys.includes('postSpeechMessageEnabled') && effective.postSpeechMessageEnabled) warnings.push('POST_SPEECH_MESSAGE_EXTRA_MODEL_CALLS_AND_CAPABILITY_EFFECTS');
    if (keys.includes('postSpeechRoundEnabled') && effective.postSpeechRoundEnabled) warnings.push('POST_SPEECH_ROUND_EXTRA_MODEL_CALLS_AND_CAPABILITY_EFFECTS');
    if (keys.includes('postSpeechMessagePrompt') && effective.postSpeechMessageEnabled !== true) warnings.push('POST_SPEECH_MESSAGE_DISABLED');
    if (keys.includes('postSpeechRoundPrompt') && effective.postSpeechRoundEnabled !== true) warnings.push('POST_SPEECH_ROUND_DISABLED');
    const postSpeechNotice = [
        keys.includes('forceSpeakPrompt') ? '强制发言 Prompt 只在后续 LLM 接管时追加；{charName} 替换为指定角色名，空串使用当前界面语言的内置指令。追加段不再经过通用 Provider 渲染；不立即发起模型请求。' : '',
        keys.includes('knowledgeText') ? '知识库内容仅在后续 Prompt 引用 {{knowledge}} 时作为原文字面内容注入；其中的 {{...}} 不触发 Provider。空串表示不注入知识文本，正文可能发送给配置模型。' : '',
        keys.includes('identityPrompt') ? '身份锚定文本仅在后续 Prompt 引用 {{identity}} 时注入；空串退回内置身份模板，不是关闭。内置模板可能引用角色档案和记忆，是否进一步渲染由调用方决定。' : '',
        keys.includes('npcPrompt') ? 'NPC Prompt 只影响后续手动生成；空串使用内置模板。非空文本单轮渲染 Provider 和局部变量，可能把聊天资料发送给模型；结果仍须是可解析的 NPC JSON，不改已有 NPC。' : '',
        worldInfoTemplate ? '世界书包装模板影响所有聊天后续使用 {{worldInfo}} Provider 的 Prompt；Director 与 LLM 强制发言的主 Prompt 未显式包含该占位符时，还可能自动前置。仅替换第一个 {{worldInfo}}；空串退回纯世界书正文，不恢复出厂包装。需开启世界书注入且有实际激活条目，才会加入内容；预览不读取世界书正文。其他 Provider 占位符在显式引用与自动前置路径可能有不同渲染结果。激活条目正文可能发送给所配置模型。' : '',
        keys.includes('postSpeechMessageEnabled') && patch.postSpeechMessageEnabled ? '启用消息后策略：之后每条合格角色消息可能增加一次模型调用，并按结果执行已启用 Capability。' : '',
        keys.includes('postSpeechRoundEnabled') && patch.postSpeechRoundEnabled ? '启用轮次后策略：之后每个合格轮次可能增加一次模型调用，并按结果执行已启用 Capability。' : '',
        keys.includes('llmWorldInfoEnabled') && patch.llmWorldInfoEnabled ? '启用世界书上下文：后续导演或强制发言调用可能查询当前激活的世界书，并将相关正文发送给所配置模型；不修改世界书。' : '',
        keys.includes('llmScriptEnabled') && patch.llmScriptEnabled ? '启用舞台指导：后续 LLM 导演计划可能为角色生成指导文本并注入角色 Prompt；不执行 JavaScript。' : '',
        keys.includes('llmScriptPosition') && patch.llmScriptPosition === 1 ? '舞台指导会放在对话附近，影响可能比 Prompt 开头更直接。' : '',
        keys.includes('llmScriptPrompt') ? '剧本风格要求只在后续启用舞台指导的 LLM 导演计划中附加；空串表示不附加要求，不修改已有历史。' : '',
        keys.includes('llmScriptWrapper') ? '剧本包装模板只影响之后的角色 Prompt 注入；先替换 {{script}}，再渲染已注册 Provider，可能读取并发送聊天资料或调用用户 Provider。空串退回纯 {{script}}，不是恢复出厂包装模板。缺少 {{script}} 会丢失剧本指导文本。' : '',
        keys.includes('llmJsonSchema') ? '导演 JSON 输出格式只是一段给模型看的提示文本，不是原生 JSON Schema，也不用于按模板校验回复；影响之后的 Director 与 LLM 强制发言。运行时替换剧本和蓝图完成字段占位符，移除自引用；空串表示不提供格式提示，不等于恢复内置文本。自定义其他占位符在两种注入路径的渲染结果可能不同。' : '',
        hasContinuityTemplate ? '连续性模板仅影响后续模型 Prompt，不读取或修改本聊天历史。需导演历史与连续性开启且已有计划；last 使用上一份，history 按轮数读取，0 表示全部，可能增加上下文及费用。空串退回纯历史 JSON，不恢复出厂说明文字；仅替换模板中第一个对应占位符。默认主 Prompt 显式使用 Provider；自定义 Prompt 没有两个历史占位符时 Director 才自动前置，Force Speak 不自动前置。其他模板占位符在两条路径的处理可能不同。' : '',
        keys.some(id => continuityFields.includes(id)) && (effective.llmScriptContinuity === true || patch.llmScriptContinuityCount === 0) ? '导演连续性可能把已保存的本聊天导演计划发给模型；history 模式的轮数 0 表示全部历史，可能明显增加上下文与费用。' : '',
        keys.includes('forceSpeakMode') && patch.forceSpeakMode === 'llm' ? 'LLM 强制发言模式可能增加模型调用，且需要可用的强制发言模型连接。' : '',
        keys.includes('forceSpeakMode') && patch.forceSpeakMode === 'block' ? '直接截停模式会阻止对应强制发言生成。' : '',
        keys.some(id => ['templateMaxPasses', 'templateRecursive', 'templateDebugPlaceholders'].includes(id)) ? '模板渲染参数影响多个功能之后的 Prompt；递归复用本次 Provider 结果，调试占位符可能原样进入模型。' : '',
        keys.includes('memoryPrompt') ? '记忆提取 Prompt 只影响之后的手动或自动提取；空串使用内置值。运行时先替换角色与已有记忆字段，再由通用渲染器处理最近消息和已注册 Provider；模型输出需能解析为记忆数组。' : '',
        keys.includes('memoryCompressPrompt') ? '记忆压缩 Prompt 只影响之后手动点击压缩；空串使用内置值。非空文本必须包含 {{memories}}，运行时只替换四个固定占位符，不执行 Provider 渲染；修改本设置不会立即压缩记忆。' : '',
        keys.includes('memoryJsonSchema') ? '记忆 JSON Schema 的空串保留原有宽松解析；非空文本只支持现有 memories/event/mood 存储结构，会加入后续提取 Prompt，并在保存前校验输出。此处不保证模型服务商原生结构化输出。' : '',
        keys.includes('memoryRenderTemplate') ? '记忆渲染模板只改变以后 {{charMemory}} 的输出；空串沿用旧版分组格式，不更改 {{charMemoryCurrent}} 或记忆仓库。模板仅查询现有记忆数据，不调用其他 Provider。' : '',
        keys.includes('storyBlueprintPrompt') ? '蓝图生成 Prompt 只影响之后的新建或重新生成；空串使用当前界面语言的内置值。运行时替换节点目标数，再渲染已注册 Provider，并追加输出格式文本；可能把选用的聊天资料发送给模型，不立即修改蓝图。' : '',
        keys.includes('storyBlueprintContinuePrompt') ? '蓝图续写 Prompt 只影响之后的手动或自动续写；空串使用当前界面语言的内置值。现有蓝图全文和进度可通过局部占位符注入并发送给模型，缺少蓝图时续写入口会拒绝；本次修改不立即追加节点。' : '',
        keys.includes('storyBlueprintJsonSchema') ? '蓝图 storyBlueprintJsonSchema 实际是附加在生成与续写 Prompt 后的输出格式说明文本，不是模型原生 JSON Schema，也不用于校验结果；空串使用内置说明。结果仍须能解析出非空 nodes 或 chapters。' : '',
        keys.includes('storyBlueprintProviderTemplate') ? '蓝图 Provider 模板只影响以后 storyBlueprintCurrent 的注入文本；空串使用内置模板。它只替换点分数据路径，未知路径变为空，不执行其他 Provider；蓝图完成时另用固定提示。遗漏当前节点详情或完成变量可能使导演缺少推进依据。' : '',
        keys.includes('lang') ? '语言仅修改插件界面及后续语言相关内置文本；保留当前暮羽窗口输入，窗口完整翻译下次打开生效。不翻译已有内容，不改变酒馆全局语言。' : '',
        keys.includes('debugLogging') ? '调试设置仅控制后续输出与追踪，可能记录业务资料；关闭不删除旧记录，不授予终端或日志读取权限。' : '',
        keys.includes('customPromptsEnabled') ? '本次通过业务接口注册或注销现有自定义 Prompt Provider；不删除条目、不渲染内容、不立即调用模型。启用后引用它们的 Prompt 可能包含这些资料。冲突会导致失败；保存异常后按业务规则恢复，结果未知，不自动重试。' : '',
        keys.some(id => id.startsWith('profileLibraryAutoLoad.')) ? '仅保存档案库加载策略，不立即导入或生成。影响所有聊天后续加载及手动导入默认选项；允许覆盖会替换匹配档案，导入模板可能改变全局档案模板。现有模式、固定包ID及匹配规则保持不变；自动加载禁用仅姓名匹配，固定模式无ID会退回最佳匹配。不确认库存在或当前可匹配角色数。' : '',
        keys.some(id => id.startsWith('profileLibraryAutoLoad.')) ? `此次策略：模式为${effective['profileLibraryAutoLoad.mode'] === 'fixed' ? '固定档案包' : '最佳匹配'}；固定包 ID：${effective['profileLibraryAutoLoad.fixedId'] || '未选择'}；` +
            Object.entries({ enabled: '自动加载', matchHash: '内容哈希匹配', matchAvatarName: '头像与名称匹配', overwriteExisting: '覆盖已有档案', importTemplate: '导入模板设置' }).map(([key, label]) => `${label}：${effective['profileLibraryAutoLoad.' + key] ? '开' : '关'}`).join('；') + '。' : '',
    ].filter(Boolean).join('');
    return copyJson({ contractVersion: 2, scope: 'global', structural: 'passed', range: 'passed', semantic: warnings.length ? 'warnings' : 'passed', intent: 'requires_user_review', warnings, diff,
        manifest: { type: 'settings-patch', version: 2, settings: Object.fromEntries(diff.map(d => [d.field, patch[d.field]])) }, notice: '仅预览，未应用。影响所有聊天；仅修改列出的字段。Prompt 最多4000字符，整份草稿仍受DTO字节预算限制。' + postSpeechNotice });
}
export function assertWritable(settings, fields, isBusy) {
    selectedFields(fields);
    if (fields.some(id => !Object.hasOwn(definitions, id))) throw Error('WRITE_UNAVAILABLE');
    if (fields.some(id => definitions[id].idle) && (typeof isBusy !== 'function' || isBusy())) throw Error('WRITE_UNAVAILABLE');
    for (const field of fields) {
        const parts = field.split('.'); let owner = settings;
        for (const part of parts.slice(0, -1)) {
            const descriptor = Object.getOwnPropertyDescriptor(owner, part);
            if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.value || typeof descriptor.value !== 'object' || Array.isArray(descriptor.value)) throw Error('WRITE_UNAVAILABLE');
            owner = descriptor.value;
        }
        const d = Object.getOwnPropertyDescriptor(owner, parts.at(-1));
        if (d ? !Object.hasOwn(d, 'value') || !d.writable : !Object.isExtensible(owner)) throw Error('WRITE_UNAVAILABLE');
    }
}
export function assignSettingsFields(settings, changes) {
    for (const [field, value] of Object.entries(changes)) {
        if (!Object.hasOwn(definitions, field)) throw Error('WRITE_UNAVAILABLE');
        const parts = field.split('.'); let owner = settings;
        for (const part of parts.slice(0, -1)) owner = owner[part];
        owner[parts.at(-1)] = value;
    }
}
