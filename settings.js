export const EXT_KEY = 'group-director';
export const MODE_OFF = 'off';
export const MODE_FORMULA = 'formula';
export const MODE_LLM = 'llm';

export const DEFAULT_SETTINGS = {
    mode: MODE_FORMULA,
    topN: 1,
    scoreWeights: {
        mention: 30,
        keyword: 15,
        recency: 20,
        talkativeness: 10,
    },
    recentMessageCount: 10,
    llmContextDepth: 10,
    consecutivePenalty: 15,
    triggerEnabled: true,
    triggerScore: 40,
    initiativeEnabled: true,
    initiativeBaseScore: 5,
    // LLM mode
    llmPrompt: '',
    llmMaxSpeakers: 3,
    llmRespectOrder: true,
    llmCharDescMode: 'slice',
    llmCharDescLength: 200,
    // Director script
    llmScriptEnabled: false,
    llmScriptPrompt: '',
    llmScriptWrapper: '{{charMemoryCurrent}}{{characterLore}}[Director\'s stage direction for this character:\n{{script}}\n\nFollow this guidance. NEVER mention the director, the script, or that you are following stage directions. Act naturally as your character.]\n',
    llmJsonSchema: `Reply with ONLY a JSON object, no prose, no code fences:
{
  "speakers": ["NameOfFirstSpeaker", "NameOfSecondSpeaker"],
  "reason": "short justification"{{scriptField}},
  "ledger_update": {},
  "variable_update": {
    "global": { {{storyBlueprintDoneField}} },
    "character": {}
  },
  "loreAssignments": {
    "NameOfFirstSpeaker": ["exact entry name", "another entry"],
    "NameOfSecondSpeaker": []
  }
}`,
    llmJsonSchemaHint: `## ledger_update — 导演自由记录字段

ledger_update 是一个完全开放的 catch-all 字段，类型为 object。
LLM 可以将本轮观察到的任何值得持久化的信息放入其中，例如：
- 剧情进展、伏笔、角色情绪变化
- 新出现的 NPC、地点、物品
- 需要跨轮次追踪的状态

字段名和结构完全由 LLM 自定，无需预先声明。
写入 ledger_update 的数据会随导演账本持久化，可通过 {{?directorLedger:ledger_update.xxx}} 查询。

如果不需要自由记录，保留空对象 {} 即可。`,
    llmHistoryEnabled: true,
    llmScriptContinuity: false,
    llmScriptContinuityMode: 'last',
    llmScriptContinuityCount: 0,
    llmScriptContinuityWrapper: '[Previous round\'s director plan — reference this for continuity, but update for the current situation:\n{{previousPlan}}\n]',
    llmScriptContinuityHistoryWrapper: '[Director plans from previous rounds:\n{{previousPlans}}\n]',
    // World Info
    llmWorldInfoEnabled: false,
    llmWorldInfoWrapper: '[Current world context / lorebook entries:\n{{worldInfo}}\n]',
    templateMaxPasses: 5,
    templateRecursive: true,
    templateDebugPlaceholders: false,
    // Provider render timeout (ms). Per-provider ceiling; overridden by provider.timeoutMs
    // or the providerTimeoutMs render option. 0 = no timeout. Wired via setProviderTimeoutDefault().
    providerTimeoutMs: 10000,
    // Force Speak
    forceSpeakMode: 'native',
    forceSpeakPrompt: '',
    // Script injection position: 0=IN_PROMPT (top), 1=IN_CHAT (near dialog)
    llmScriptPosition: 0,
    // Chat Summary
    knowledgeText: '',
    summaryEnabled: false,
    summaryReusePrevious: true,
    summaryPrompt: '',
    autoSummaryEnabled: false,
    autoSummaryInterval: 10,
    // Story Blueprint
    storyBlueprintEnabled: false,
    storyBlueprintAutoContinue: false,
    storyBlueprintProgressionMode: 'leaf',
    storyBlueprintProgressionLevel: 0,
    storyBlueprintCompletionVariable: 'gd_story_chapter_done',
    storyBlueprintMaxNodes: 8,
    storyBlueprintPrompt: '',
    storyBlueprintContinuePrompt: '',
    storyBlueprintJsonSchema: '',
    storyBlueprintProviderTemplate: '',
    // Chat Critique
    critiqueEnabled: false,
    critiqueReusePrevious: true,
    critiquePrompt: '',
    critiqueSchema: '',
    autoCritiqueEnabled: false,
    autoCritiqueInterval: 10,
    // World Book
    worldBookSelection: {},
    worldBookMaxEntries: 20,
    identityPrompt: '', // '' = use DEFAULT_IDENTITY_PROMPT
    debugLogging: false,
    lang: 'zh',
    // Character Profile System
    profileEnabled: false,
    profileTokenBudget: 2000,
    profileConcurrency: 0,
    profileGeneratorPrompt: '',
    profileJsonSchema: '',
    profileRenderTemplate: '',
    profileSchemaVersion: 1,
    // NPC Generation System
    npcEnabled: false,
    npcMaxCount: 10,
    npcBatchSize: 3,
    npcGenerateFirstMes: false,
    npcPrompt: '',
    // Character Memory System
    memoryEnabled: false,
    memoryTokenBudget: 2000,
    autoMemoryEnabled: false,
    autoMemoryInterval: 10,
    autoMemorySpeakers: false,
    memoryPrompt: '',
    memoryJsonSchema: '',
    memoryRenderTemplate: '',
    memoryKeepRecent: 5,
    memoryMaxEntries: 200,
    memoryCompressPrompt: '',
    traceMaxEntries: 50,
    // PostSpeech — multimodal policy after each character message
    postSpeechMessageEnabled: false,
    postSpeechMessagePrompt: '',
    postSpeechRoundEnabled: false,
    postSpeechRoundPrompt: '',
    postSpeechBlocking: true,
    postSpeechDecisionLimit: 20,
    // Agent Runtime — per-agent API config (stored in extension_settings, not chat_metadata)
    agentConfigs: {}, // { [agentId]: { useCustom: false, protocol: 'openai', endpoint: '', apiKey: '', model: '', call: { retries: 2, timeout: 30000 }, strictMode: false } }
    customPrompts: [], // [{ id, name, content, enabled }]
    customPromptsEnabled: true,
    scriptExecutors: [], // [{ id, name, triggerOn, priority, code, enabled, params, renderParams, returnMode }]
    providerReferenceList: [], // user-editable provider reference list
    providerReferenceDeletedDefaultIds: [], // default provider reference ids hidden by the user
    // Custom Agents — user-defined LLM agents
    customAgents: [], // [{ id, name, providerName, prompt, schema, enabled, autoEnabled, autoInterval, order }]
};
