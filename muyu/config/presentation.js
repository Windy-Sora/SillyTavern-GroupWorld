import { uiLabel } from '../../ui/i18n.js';

// Explicit, reviewed UI-key aliases. No DOM scraping, inferred paths or write aliases.
const groups = {
    '@profileAutoSection': { 'profileLibraryAutoLoad.enabled': '@profileAuto', 'profileLibraryAutoLoad.overwriteExisting': '@profileOverwrite',
        'profileLibraryAutoLoad.importTemplate': '@profileImportTemplate', 'profileLibraryAutoLoad.mode': '@profileAutoMode',
        'profileLibraryAutoLoad.fixedId': '@profileFixed', 'profileLibraryAutoLoad.matchHash': '@profileHash',
        'profileLibraryAutoLoad.matchAvatarName': '@profileAvatar', 'profileLibraryAutoLoad.matchNameOnly': '@profileName' },
    customPromptsEnabled: { customPromptsEnabled: 'customPromptsEnabled' },
    memoryTitle: {
        memoryEnabled: 'memoryEnabled', autoMemoryEnabled: 'autoMemoryEnabled', autoMemoryInterval: '@memoryInterval', autoMemorySpeakers: 'autoMemorySpeakers',
        memoryPrompt: 'memoryPromptLabel', memoryCompressPrompt: 'memoryCompressPromptLabel', memoryJsonSchema: 'memoryJsonSchemaTitle', memoryRenderTemplate: 'memoryRenderTemplateTitle',
        memoryKeepRecent: 'memoryKeepRecent', memoryMaxEntries: 'memoryMaxEntries',
    },
    llmParamsTitle: {
        mode: 'modeTitle', llmMaxSpeakers: 'llmMaxSpeakers', llmContextDepth: 'llmContextDepth', llmRespectOrder: 'llmRespectOrder',
    },
    formulaDrawerTitle: { topN: 'topn', recentMessageCount: 'recentCount', consecutivePenalty: 'consecutivePenalty',
        'scoreWeights.mention': 'mentionWeight', 'scoreWeights.keyword': 'keywordWeight', 'scoreWeights.recency': 'recencyWeight', 'scoreWeights.talkativeness': 'talkativenessWeight',
        triggerEnabled: 'triggerEnabled', triggerScore: 'triggerScore', initiativeEnabled: 'initiativeEnabled', initiativeBaseScore: 'initiativeBase' },
    scriptTitle: { llmScriptEnabled: 'scriptEnabled', llmScriptPrompt: 'scriptPrompt', llmScriptWrapper: 'scriptWrapper', llmScriptPosition: 'llmScriptPosition' },
    continuityTitle: { llmScriptContinuity: 'continuity', llmScriptContinuityMode: 'continuityTitle', llmScriptContinuityCount: 'continuityCount',
        llmScriptContinuityWrapper: 'continuityWrapper', llmScriptContinuityHistoryWrapper: 'continuityHistoryWrapper', llmHistoryEnabled: 'historyEnabled' },
    forceSpeakDrawerTitle: { forceSpeakMode: 'forceSpeakDrawerTitle', forceSpeakPrompt: 'forceSpeakPromptLabel' },
    templateRecursiveTitle: { templateMaxPasses: 'templateMaxPasses', templateRecursive: 'templateRecursive', templateDebugPlaceholders: 'templateDebugPlaceholders' },
    worldInfoTitle: { llmWorldInfoEnabled: 'worldInfoEnabled', llmWorldInfoWrapper: 'worldInfoWrapper' },
    charDescTitle: { llmCharDescMode: 'charDescTitle', llmCharDescLength: 'charDescLength' },
    summaryDrawerTitle: { summaryEnabled: 'summaryEnabled', autoSummaryEnabled: 'autoSummaryEnabled', autoSummaryInterval: '@summaryInterval', summaryReusePrevious: 'summaryReuse', summaryPrompt: 'summaryPromptLabel' },
    critiqueEnabled: { critiqueEnabled: 'critiqueEnabled', autoCritiqueEnabled: 'autoCritiqueEnabled', autoCritiqueInterval: '@critiqueInterval', critiqueReusePrevious: 'critiqueReuse', critiquePrompt: 'critiquePromptLabel', critiqueSchema: 'critiqueSchemaLabel' },
    profileDrawerTitle: { profileEnabled: 'profileEnabled', profileTokenBudget: 'profileTokenBudget', profileConcurrency: 'profileConcurrency', profileGeneratorPrompt: 'profileGeneratorPromptTitle',
        profileJsonSchema: 'profileJsonSchemaTitle', profileRenderTemplate: 'profileRenderTemplateTitle' },
    storyBlueprintCard: { storyBlueprintEnabled: 'storyBlueprintEnabled', storyBlueprintPrompt: 'storyBlueprintPrompt', storyBlueprintContinuePrompt: 'storyBlueprintContinuePrompt',
        storyBlueprintJsonSchema: 'storyBlueprintSchema', storyBlueprintProviderTemplate: 'storyBlueprintTemplate', storyBlueprintProgressionMode: 'storyBlueprintMode', storyBlueprintProgressionLevel: 'storyBlueprintLevel',
        storyBlueprintCompletionVariable: 'storyBlueprintCompletionVariable', storyBlueprintAutoContinue: 'storyBlueprintAutoContinue', storyBlueprintMaxNodes: 'storyBlueprintMaxNodes' },
    npcTitle: { npcEnabled: 'npcEnabled', npcMaxCount: 'npcMaxCount', npcBatchSize: 'npcBatchSize', npcGenerateFirstMes: 'npcGenerateFirstMes', npcPrompt: 'npcPromptLabel' },
    worldBookSelectionTitle: { worldBookSourceMode: 'worldBookSourceMode', worldBookMaxEntries: 'worldBookMaxEntries' },
    traceTitle: { traceMaxEntries: 'traceMaxLabel' },
    psDecisionsTitle: { postSpeechDecisionLimit: 'psDecisionLimit', postSpeechBlocking: 'psBlocking' },
    psMsgEnabled: { postSpeechMessageEnabled: 'psMsgEnabled', postSpeechMessagePrompt: 'psMsgPromptLabel' },
    psRoundEnabled: { postSpeechRoundEnabled: 'psRoundEnabled', postSpeechRoundPrompt: 'psRoundPromptLabel' },
    promptTitle: { llmPrompt: 'promptTitle' }, jsonSchemaCard: { llmJsonSchema: 'jsonSchemaCard' },
    knowledgeTitle: { knowledgeText: 'knowledgeTitle' }, identityTitle: { identityPrompt: 'identityTitle' },
    providerTimeout: { providerTimeoutMs: 'providerTimeout' }, langLabel: { lang: 'langLabel' }, debug: { debugLogging: 'debug' },
};
// Interval controls are a label/input/suffix sentence, not a standalone UI label.
const composedLabels = {
    '@profileAutoSection': ['档案库', 'Profile library'],
    '@profileAuto': ['自动补缺', 'Auto-fill'], '@profileOverwrite': ['覆盖已有', 'Overwrite existing'],
    '@profileImportTemplate': ['应用模板', 'Apply template'], '@profileAutoMode': ['档案库自动加载模式', 'Profile library auto-load mode'],
    '@profileFixed': ['固定档案包 ID', 'Fixed profile package ID'], '@profileHash': ['按角色内容哈希匹配', 'Match character hash'],
    '@profileAvatar': ['按头像与名称匹配', 'Match avatar and name'], '@profileName': ['仅按名称匹配', 'Match name only'],
    '@zh': ['中文', 'Chinese'], '@en': ['英文', 'English'],
    '@memoryInterval': ['自动提取间隔（每 N 条新消息）', 'Auto-extraction interval (every N new messages)'],
    '@summaryInterval': ['自动总结间隔（每 N 条新消息）', 'Auto-summary interval (every N new messages)'],
    '@critiqueInterval': ['自动批判间隔（每 N 条新消息）', 'Auto-critique interval (every N new messages)'],
};
const rows = Object.fromEntries(Object.entries(groups).flatMap(([sectionKey, fields]) => Object.entries(fields).map(([id, labelKey]) => [id, { sectionKey, labelKey }])));
export const presentationFields = Object.freeze(Object.keys(rows));
const bilingual = key => Object.hasOwn(composedLabels, key) ? { zh: composedLabels[key][0], en: composedLabels[key][1] } : { zh: uiLabel(key, 'zh'), en: uiLabel(key, 'en') };
const units = {
    autoMemoryInterval: ['条新消息', 'new messages'], autoSummaryInterval: ['条新消息', 'new messages'], autoCritiqueInterval: ['条新消息', 'new messages'],
    topN: ['人', 'speakers'], llmMaxSpeakers: ['人', 'speakers'], memoryMaxEntries: ['条', 'entries'], memoryKeepRecent: ['条', 'entries'],
    recentMessageCount: ['条消息', 'messages'], llmContextDepth: ['条消息', 'messages'], llmCharDescLength: ['字符', 'characters'],
    llmScriptContinuityCount: ['轮', 'rounds'], templateMaxPasses: ['轮', 'passes'], profileTokenBudget: ['tokens', 'tokens'],
    worldBookMaxEntries: ['条', 'entries'], traceMaxEntries: ['条', 'entries'], postSpeechDecisionLimit: ['条', 'entries'],
    storyBlueprintMaxNodes: ['个节点', 'nodes'], npcMaxCount: ['个', 'NPCs'], npcBatchSize: ['个', 'NPCs'], providerTimeoutMs: ['毫秒', 'ms'],
};
const enumKeys = {
    lang: { zh: '@zh', en: '@en' },
    mode: { off: 'modeOff', formula: 'modeFormula', llm: 'modeLlm' }, forceSpeakMode: { native: 'forceSpeakNative', block: 'forceSpeakBlock', llm: 'forceSpeakLlm' },
    llmCharDescMode: { full: 'charDescFull', slice: 'charDescSlice' }, llmScriptPosition: { 0: 'llmScriptPositionTop', 1: 'llmScriptPositionChat' },
    llmScriptContinuityMode: { last: 'continuityLast', history: 'continuityHistory' }, worldBookSourceMode: { st: 'worldBookSourceSt', manual: 'worldBookSourceManual' },
    storyBlueprintProgressionMode: { leaf: 'storyBlueprintModeLeaf', all: 'storyBlueprintModeAll', level: 'storyBlueprintModeLevel' },
};
export function configPresentation(id) {
    if (!Object.hasOwn(rows, id)) return null;
    const row = rows[id], unit = units[id];
    return { label: bilingual(row.labelKey), section: bilingual(row.sectionKey),
        ...(unit ? { unit: { zh: unit[0], en: unit[1] } } : {}),
        ...(Object.hasOwn(enumKeys, id) ? { valueLabels: Object.fromEntries(Object.entries(enumKeys[id]).map(([value, key]) => [value, bilingual(key)])) } : {}) };
}
export function configLabel(id, lang = 'zh') {
    return configPresentation(id)?.label[lang === 'en' ? 'en' : 'zh'] || (lang === 'en' ? 'Unmapped setting' : '未登记的配置项');
}
/** Formatting never changes the underlying value or implies empty text uses defaults. */
export function configValue(id, value, lang = 'zh', { serialized = false, limit = 180 } = {}) {
    const en = lang === 'en', language = en ? 'en' : 'zh';
    if (serialized) {
        if (value === '(missing)' || value === undefined) return en ? 'Missing / not read' : '缺失／未读取';
        try { value = JSON.parse(value); } catch { /* Keep clipped or older receipt text as text. */ }
    }
    if (value === undefined) return en ? 'Missing / not read' : '缺失／未读取';
    if (value === null) return en ? 'Null' : '空值（null）';
    if (typeof value === 'boolean') return en ? value ? 'On' : 'Off' : value ? '开启' : '关闭';
    if (value === '') return en ? 'Empty text' : '空文本';
    const metadata = configPresentation(id), labels = metadata?.valueLabels;
    if (labels && Object.hasOwn(labels, String(value))) return labels[String(value)][language];
    if (typeof value === 'number') {
        if (id === 'providerTimeoutMs') return value === 0 ? en ? 'No timeout' : '不限制超时' : en ? `${value / 1000} seconds` : `${value / 1000} 秒`;
        if (id === 'profileConcurrency' && value === 0) return en ? 'All at once' : '全部同时';
        if (id === 'llmScriptContinuityCount' && value === 0) return en ? 'All history' : '全部历史';
        return `${value}${metadata?.unit ? ' ' + metadata.unit[language] : ''}`;
    }
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return text.length > limit ? text.slice(0, limit) + (en ? '… (preview truncated)' : '…（预览截断）') : text;
}
export function configDiffText(diff, lang = 'zh') {
    return `${configLabel(diff.field, lang)}：${configValue(diff.field, diff.before, lang, { serialized: true })} → ${configValue(diff.field, diff.after, lang, { serialized: true })}`;
}
