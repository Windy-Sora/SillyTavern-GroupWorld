/**
 * I18N dictionary and UI display helpers.
 *
 * I18N          — zh/en translation data
 * applyI18n     — replace data-i18n / data-i18n-placeholder elements
 * applyModeVisibility — show/hide formula/llm/off sections
 * toggleCharDescLength — enable/disable slice-length input
 * toggleContinuityMode — enable/disable continuity-wrapper inputs
 */

// ─── I18n Data ─────────────────────────────────────────────────────────
const I18N = {
    zh: {
        langLabel: '语言 / Language',
        intro: '解决群聊中所有角色抢话的问题。两种判断模式互斥，一次只能启用一种。',
        modeTitle: '判断模式（单选）',
        modeOff: '<b>关闭</b> — 不干预 SillyTavern 默认行为',
        modeFormula: '<b>公式判断</b> — 使用关键词、提名、近期发言、主动性等本地评分（无 API 调用）',
        modeLlm: '<b>大模型判断</b> — 调用当前主模型，结合上下文决定谁发言、按什么顺序（消耗 token）',
        debug: '调试日志（浏览器控制台）',
        offHint: '当前模式：关闭。所有角色将按 SillyTavern 默认逻辑发言（即抢话行为不被抑制）。',

        formulaDrawerTitle: '公式判断配置',
        topnTitle: 'Top-N 设置',
        topn: '每轮允许发言人数 (Top-N)',
        recentCount: '分析最近消息条数',
        consecutivePenalty: '连续发言惩罚分（每条）',

        weightsTitle: '评分权重',
        mentionWeight: '名字被提及权重',
        keywordWeight: '关键词匹配权重',
        recencyWeight: '近期未发言加权',
        talkativenessWeight: 'Talkativeness 权重',

        triggerTitle: '触发器引擎',
        triggerEnabled: '启用关键词触发器（基于角色描述切词）',
        triggerScore: '触发器命中加分',

        initiativeTitle: '主动性 (Initiative)',
        initiativeEnabled: '启用主动性系统（每轮随机扰动）',
        initiativeBase: '主动性基础值（每轮随机 0~该值）',

        llmParamsDrawerTitle: 'Director LLM 参数',
        llmParamsTitle: 'Director LLM 参数',
        llmMaxSpeakers: '每轮最多发言人数',
        llmContextDepth: '传入上下文层数（最近 N 条消息）',
        llmContextDepthHint: '控制发送给 Director 的最近消息数量，对 <code>{{recentMessages}}</code> 和 <code>{{newRecentMessages}}</code> 均生效。<code>{{newRecentMessages}}</code> 在启用总结后会额外返回总结文本 + 总结后的全部新消息，此时不受深度限制。',
        llmRespectOrder: '严格按 LLM 顺序发言（接管 ST 激活循环，手动按导演决定的顺序逐人生成）',

        charDescTitle: '角色描述控制',
        charDescHint: '控制传入 Director LLM 的角色描述长度（<code>{{characters}}</code> 占位符）。过长可能超出上下文，过短可能不够判断。',
        charDescFull: '全量传入（角色简介不作截断）',
        charDescSlice: '切片截断（保留前 N 个字符）',
        charDescLength: '切片长度（字符数）',

        scriptTitle: '导演剧本 (Director Script)',
        scriptDrawerTitle: '导演剧本 & 连贯性',
        scriptHint: '让导演不仅决定谁发言，还生成一段场景剧本，注入到角色生成 prompt 中指导内容创作。',
        scriptEnabled: '启用导演剧本（Director 为每个发言角色输出独立剧本，注入角色 prompt 指导表演，角色不会暴露剧本存在）',
        scriptPrompt: '剧本要求提示（Script Prompt）',
        scriptPromptHint: '告诉导演你希望什么样的剧本风格。例如："剧情要温馨治愈，突出姐妹情深"、"保持紧张悬疑的氛围"、"加入搞笑吐槽元素"等。留空则只要求基本场景描述。',

        historyEnabled: '<b>记录导演账本</b> — 每次 LLM 决策后将完整 JSON 保存到聊天元数据，跟随对话导出/导入/分支',
        historyClear: '清空当前导演账本',
        ledgerDrawerTitle: '导演账本浏览器',
        ledgerHint: '查看、编辑、清空导演账本。生成中锁死不可编辑。',
        ledgerLocked: '生成中，面板已锁定',
        ledgerRefresh: '刷新',
        ledgerRawToggle: 'Raw 模式',
        forceSpeakDrawerTitle: '强制发言 (Force Speak)',
        forceSpeakWarning: '测试功能，可能不稳定，谨慎使用',
        forceSpeakHint: '当用户在群聊中手动强制触发某个角色发言时（非正常导演流程），Group Director 的处理方式。',
        forceSpeakNative: '<b>原生放行</b> — 弹窗确认后透传给 ST 自行处理（不计账本，不注入剧本）',
        forceSpeakBlock: '<b>直接截停</b> — 阻止强制发言，不做任何处理',
        forceSpeakLlm: '<b>LLM 接管</b> — 调用模型只为此角色生成剧本并计入账本（实验性）',
        forceSpeakPromptLabel: '强制发言 Prompt 注入',
        forceSpeakPromptHint: '附加到 Director Prompt 尾部的系统指令。<code>{charName}</code> 会被替换为实际角色名。',
        forceSpeakPromptReset: '恢复默认 Prompt',
        testerDrawerTitle: '模板测试器 (Template Tester)',
        testerHint: '输入含占位符的模板，点击测试查看实时渲染结果。不会触发任何生成。',
        testerRun: '测试渲染',
        testerOutput: '渲染结果',
        summaryDrawerTitle: '上下文总结 (Chat Summary)',
        summaryHint: '将聊天上下文压缩为简洁摘要注入 Prompt，降低 token 消耗。修改或删除消息后请手动重新生成。',
        summaryEnabled: '启用上下文总结',
        summaryReuse: '复用上次总结（勾选=上次总结+新增片段，取消=全量上下文重新总结）',
        summaryPromptLabel: '总结 Prompt',
        summaryPromptHint: '留空使用内置默认。支持所有注册的 Provider 占位符。',
        summaryPromptReset: '恢复默认 Prompt',
        summaryExecute: '执行总结',
        summaryRegenerate: '重新总结',
        summaryRevert: '回退总结',
        summaryReset: '重置全部',
        summaryResultLabel: '总结结果（可直接编辑）',
        summaryResultSave: '保存编辑',
        summaryLocked: '生成中，面板已锁定',
        summaryScanClear: '清除存档',
        summaryScan: '扫描存档总结',
        summaryPrune: '清除已禁用',
        summaryHideDisabled: '隐藏已禁用',
        historyMeta: '当前账本风格：',

        continuity: '<b>使用导演历史</b> — 将记录的导演账本注入当前 prompt，保持剧情连续性',

        continuityTitle: '连贯剧本模式',
        continuityHint: '选择只注入上一轮计划，还是注入完整历史记录。',
        continuityLast: '<b>仅上一轮</b> — 只注入最近一次的导演 JSON（当前默认行为）',
        continuityHistory: '<b>完整历史</b> — 永久记录每轮导演输出，注入指定数量的 JSON 数组（保留所有自定义字段）',
        continuityCount: '历史轮数（0 = 全部）',
        continuityCountHint: '指定注入最近 N 轮导演计划的 JSON 数量。设为 0 则注入全部记录。',
        continuityWrapper: '连贯剧本包装模板（仅上一轮模式）',
        continuityWrapperHint: '<code>{{previousPlan}}</code> 占位符会被替换为上一轮导演的完整 JSON 回复。',
        continuityHistoryWrapper: '连贯剧本包装模板（完整历史模式）',
        continuityHistoryWrapperHint: '<code>{{previousPlans}}</code> 占位符会被替换为过往导演计划的 JSON 数组。',

        worldInfoTitle: '世界书注入 (World Info)',
        worldInfoDrawerTitle: '世界书注入 (World Info)',
        worldBookSelectionTitle: '世界书选择 (World Book Selection)',
        worldBookSelectionHint: '手动选择要暴露给 Director 的世界书。不勾选的书不会被扫描，避免世界观串台。',
        worldBookMaxEntries: '最大注入条目数',
        worldBookMaxEntriesHint: '限制 {{worldBookImportance}} 输出给 Director 的条目数量。推荐 15-30。',
        worldBookRefresh: '刷新世界书列表',
        worldInfoHint: '将当前激活的世界书/ lorebook 条目注入 Director prompt，让导演了解世界背景设定。',
        worldInfoEnabled: '启用世界书注入（将激活的 lorebook 内容传递给 Director）',
        worldInfoWrapper: '世界书包装模板',
        worldInfoWrapperHint: '<code>{{worldInfo}}</code> 占位符会被替换为当前激活的世界书条目文本。',

        scriptWrapper: '剧本注入包装模板（Script Wrapper）',
        scriptWrapperHint: '控制剧本如何包裹后注入角色 prompt。<code>{{script}}</code> 占位符会被替换为实际剧本内容。',

        promptTitle: 'Director Prompt 模板',
        promptDrawerTitle: 'Director Prompt 模板',
        promptHint: '可用占位符：<code>{{recentMessages}}</code>、<code>{{characters}}</code>、<code>{{maxSpeakers}}</code><br>模型必须返回 JSON：<code>{"speakers": ["Name1", "Name2"], "reason": "..."}</code>。启用剧本后还需包含 <code>"script": "..."</code>。<code>speakers</code> 数组<b>顺序就是发言顺序</b>。',
        promptReset: '恢复默认 Prompt',
        promptNote: '注意：每轮群聊生成会额外调用一次主模型来做导演决策。LLM 调用失败时插件会透明放行（不影响聊天）。',
        templateRecursiveTitle: '模板递归渲染',
        templateRecursiveHint: '当占位符渲染出的文本中仍包含 <code>{{...}}</code> 占位符时，是否继续解析。',
        templateRecursive: '启用递归渲染（如脚本内容中包含 <code>{{?directorLedger:xxx}}</code> 将被继续解析）',
        templateMaxPasses: '最大递归轮数',
        templateMaxPassesHint: '限制递归渲染次数以防止无限循环。推荐 3-5，接受任意正整数。',
        templateDebugPlaceholders: '调试模式：保留无法识别的占位符（如拼写错误的 <code>{{charcters}}</code> 会原样输出，而非静默清除）',
        templateDebugPlaceholdersHint: '开启后未注册的占位符会保留在输出中方便排查。关闭（默认）则静默清除，避免污染 LLM 上下文。',
        knowledgeTitle: '知识库 (Knowledge)',
        knowledgeHint: '此区域的文本不会被渲染——其中的 <code>{{XXX}}</code> 会原样发给 LLM，用于教 LLM 使用 DSL 接口。通过 <code>{{knowledge}}</code> 占位符引用。',

        profileTitle: '角色档案系统 (Character Profile System)',
        profileDrawerTitle: '角色档案系统',
        profileHint: '提前分析每个角色的特质、动机、关系，作为结构化数据注入 Director Prompt。独立于导演判断逻辑。',
        profileEnabled: '启用角色档案（让 Director 了解每个角色的深层信息）',
        profileTokenBudget: '档案 Token 预算（超过时压缩非活跃角色）',
        profileConcurrency: '并发数（0=全部同时, 1=逐个, N=每批N个）',
        profileGeneratorPromptTitle: '生成器 Prompt 模板',
        profileGeneratorPromptHint: '告诉 LLM 如何分析角色。占位符：<code>{{charName}}</code> <code>{{charDescription}}</code> <code>{{charPersonality}}</code> <code>{{charScenario}}</code>',
        profileGeneratorReset: '恢复默认生成器 Prompt',
        profileJsonSchemaTitle: 'JSON Schema（可选，用于结构化生成）',
        profileJsonSchemaHint: '定义 AI 返回的 JSON 格式。留空使用内置默认 Schema。',
        profileSchemaReset: '恢复默认 Schema',
        profileRenderTemplateTitle: '渲染模板（Render Template）',
        profileRenderTemplateHint: '控制 <code>{{character_profiles}}</code> 占位符的输出格式。每角色占位符：<code>{{name}}</code> <code>{{summary}}</code> <code>{{tags}}</code> <code>{{motivation}}</code> <code>{{relationships}}</code>',
        profileRenderReset: '恢复默认渲染模板',
        profileManagementTitle: '档案管理',
        profileScanSave: '扫描当前存档中的角色档案',
        profileDetectChanges: '检测角色变动（加入/删除）',
        profileRegenerateAll: '全部重新生成',

        exportImportTitle: '群聊导出 / 导入',
        exportImportHint: '将当前群聊的角色卡和激活的世界书打包导出为压缩包，或从压缩包导入。',
        exportGroup: '导出群聊',
        importGroup: '导入群聊',
    },
    en: {
        langLabel: '语言 / Language',
        intro: 'Prevents all characters from rushing to speak in group chats. The two modes are mutually exclusive.',
        modeTitle: 'Mode (single choice)',
        modeOff: '<b>Off</b> — Do not intervene; SillyTavern default behavior',
        modeFormula: '<b>Formula</b> — Local scoring via keywords, mentions, recency, talkativeness (no API call)',
        modeLlm: '<b>LLM Director</b> — Ask the main model to decide who speaks and in what order (consumes tokens)',
        debug: 'Debug logging (browser console)',
        offHint: 'Current mode: Off. All characters follow SillyTavern default logic (rushing behavior is not suppressed).',

        formulaDrawerTitle: 'Formula Configuration',
        topnTitle: 'Top-N Settings',
        topn: 'Speakers per round (Top-N)',
        recentCount: 'Recent messages to analyze',
        consecutivePenalty: 'Consecutive speech penalty (per message)',

        weightsTitle: 'Scoring Weights',
        mentionWeight: 'Name mention weight',
        keywordWeight: 'Keyword match weight',
        recencyWeight: 'Not-spoken-recently bonus',
        talkativenessWeight: 'Talkativeness weight',

        triggerTitle: 'Trigger Engine',
        triggerEnabled: 'Enable keyword triggers (tokenized from character description)',
        triggerScore: 'Trigger hit bonus',

        initiativeTitle: 'Initiative',
        initiativeEnabled: 'Enable initiative system (random perturbation per round)',
        initiativeBase: 'Initiative base value (random 0~base per round)',

        llmParamsDrawerTitle: 'Director LLM Parameters',
        llmParamsTitle: 'Director LLM Parameters',
        llmMaxSpeakers: 'Max speakers per round',
        llmContextDepth: 'Context depth (recent N messages)',
        llmContextDepthHint: 'Number of recent messages sent to the Director. Affects both <code>{{recentMessages}}</code> and <code>{{newRecentMessages}}</code>. When summary is enabled, <code>{{newRecentMessages}}</code> additionally returns the summary text + all new messages after it, without the depth limit.',
        llmRespectOrder: 'Strict LLM order (take over ST activation loop, generate in director-determined order)',

        charDescTitle: 'Character Description Control',
        charDescHint: 'Controls how much character description is sent to the Director LLM (<code>{{characters}}</code> placeholder). Too long may exceed context; too short may be insufficient.',
        charDescFull: 'Full (no truncation)',
        charDescSlice: 'Slice (keep first N characters)',
        charDescLength: 'Slice length (characters)',

        scriptTitle: 'Director Script',
        scriptDrawerTitle: 'Director Script & Continuity',
        scriptHint: 'Let the director generate per-character stage directions injected into character prompts.',
        scriptEnabled: 'Enable Director Script (Director outputs per-character stage directions, injected into character prompts; characters do not reveal script existence)',
        scriptPrompt: 'Script Prompt',
        scriptPromptHint: 'Tell the director what kind of script style you want. For example: "Keep a warm and healing tone", "Maintain a suspenseful atmosphere", "Add comedic elements". Leave empty for basic scene descriptions only.',

        historyEnabled: '<b>Record Director Ledger</b> — Save full JSON to chat metadata after each LLM decision (follows chat export/import/branch)',
        historyClear: 'Clear Current Ledger',
        ledgerDrawerTitle: 'Director Ledger Browser',
        ledgerHint: 'View, edit, and clear director ledger entries. Locked during generation.',
        ledgerLocked: 'Generation in progress — panel locked',
        ledgerRefresh: 'Refresh',
        ledgerRawToggle: 'Raw mode',
        forceSpeakDrawerTitle: 'Force Speak',
        forceSpeakWarning: 'Experimental feature — may be unstable, use with caution',
        forceSpeakHint: 'How Group Director handles manual force-speak triggers in group chat (outside normal director flow).',
        forceSpeakNative: '<b>Native Pass-through</b> — Confirm dialog then let ST handle (no ledger, no script injection)',
        forceSpeakBlock: '<b>Block</b> — Prevent force-speak entirely',
        forceSpeakLlm: '<b>LLM Takeover</b> — Call model for this character only, generate script, record to ledger (experimental)',
        forceSpeakPromptLabel: 'Force Speak Prompt Injection',
        forceSpeakPromptHint: 'System instruction appended to Director Prompt. <code>{charName}</code> is replaced with the character name.',
        forceSpeakPromptReset: 'Reset to default prompt',
        testerDrawerTitle: 'Template Tester',
        testerHint: 'Enter a template with placeholders and click test to see the rendered output. Does not trigger any generation.',
        testerRun: 'Test Render',
        testerOutput: 'Output',
        summaryDrawerTitle: 'Chat Summary',
        summaryHint: 'Compress chat context into a concise summary to reduce token usage. Re-run manually after editing or deleting messages.',
        summaryEnabled: 'Enable chat summary',
        summaryReuse: 'Reuse previous summary (checked=summary + new, unchecked=full rescan)',
        summaryPromptLabel: 'Summary Prompt',
        summaryPromptHint: 'Leave empty for built-in default. All registered Provider placeholders supported.',
        summaryPromptReset: 'Reset to default prompt',
        summaryExecute: 'Execute Summary',
        summaryRegenerate: 'Regenerate',
        summaryRevert: 'Revert',
        summaryReset: 'Reset All',
        summaryResultLabel: 'Summary result (editable)',
        summaryResultSave: 'Save edits',
        summaryLocked: 'Generation in progress — panel locked',
        summaryScanClear: 'Clear archive',
        summaryScan: 'Scan for summaries',
        summaryPrune: 'Clear disabled',
        summaryHideDisabled: 'Hide disabled',
        historyMeta: 'Current ledger style: ',

        continuity: '<b>Use Director History</b> — Inject recorded ledger into current prompt for continuity',

        continuityTitle: 'Continuity Mode',
        continuityHint: 'Choose whether to inject only the last round or full recorded history.',
        continuityLast: '<b>Last Round Only</b> — Inject only the most recent director JSON (default)',
        continuityHistory: '<b>Full History</b> — Persist every round, inject N rounds as a JSON array (custom fields preserved)',
        continuityCount: 'History rounds (0 = all)',
        continuityCountHint: 'Number of recent director plans to inject as JSON. Set to 0 to include all records.',
        continuityWrapper: 'Continuity Wrapper (last-round mode)',
        continuityWrapperHint: '<code>{{previousPlan}}</code> is replaced with the previous round\'s full JSON response.',
        continuityHistoryWrapper: 'Continuity Wrapper (history mode)',
        continuityHistoryWrapperHint: '<code>{{previousPlans}}</code> is replaced with a JSON array of past director plans.',

        worldInfoTitle: 'World Info Injection',
        worldInfoDrawerTitle: 'World Info Injection',
        worldBookSelectionTitle: 'World Book Selection',
        worldBookSelectionHint: 'Manually select which world books to expose to the Director. Unchecked books are not scanned, preventing setting contamination.',
        worldBookMaxEntries: 'Max entries to inject',
        worldBookMaxEntriesHint: 'Limits the number of entries {{worldBookImportance}} outputs to the Director. Recommended: 15-30.',
        worldBookRefresh: 'Refresh world book list',
        worldInfoHint: 'Inject currently activated lorebook entries into the Director prompt so the director understands world context.',
        worldInfoEnabled: 'Enable World Info injection (pass activated lorebook content to Director)',
        worldInfoWrapper: 'World Info Wrapper',
        worldInfoWrapperHint: '<code>{{worldInfo}}</code> is replaced with the currently activated lorebook entry text.',

        scriptWrapper: 'Script Injection Wrapper',
        scriptWrapperHint: 'Controls how the script is wrapped before injection into character prompt. <code>{{script}}</code> is replaced with the actual script content.',

        promptTitle: 'Director Prompt Template',
        promptDrawerTitle: 'Director Prompt Template',
        promptHint: 'Placeholders: <code>{{recentMessages}}</code>, <code>{{characters}}</code>, <code>{{maxSpeakers}}</code><br>Model must return JSON: <code>{"speakers": ["Name1", "Name2"], "reason": "..."}</code>. With script enabled, also include <code>"script": "..."</code>. <code>speakers</code> array <b>order is speaking order</b>.',
        promptReset: 'Restore Default Prompt',
        promptNote: 'Note: Each round of group chat generation makes one extra main-model call for the director decision. LLM call failures are transparent (chat continues unaffected).',
        templateRecursiveTitle: 'Template Recursive Rendering',
        templateRecursiveHint: 'When rendered text still contains <code>{{...}}</code> placeholders, continue resolving them.',
        templateRecursive: 'Enable recursive rendering (e.g. <code>{{?directorLedger:xxx}}</code> inside script text will be resolved)',
        templateMaxPasses: 'Max recursive passes',
        templateMaxPassesHint: 'Limits recursion depth to prevent infinite loops. Recommended: 3-5, accepts any positive integer.',
        templateDebugPlaceholders: 'Debug mode: keep unrecognized placeholders (e.g. misspelled <code>{{charcters}}</code> stays visible instead of being silently removed)',
        templateDebugPlaceholdersHint: 'When on, unknown placeholders remain in output for troubleshooting. Off by default to avoid polluting LLM context.',
        knowledgeTitle: 'Knowledge Base',
        knowledgeHint: 'Text in this area is NOT rendered — <code>{{XXX}}</code> patterns are sent to the LLM as-is. Use <code>{{knowledge}}</code> placeholder to reference it.',

        profileTitle: 'Character Profile System',
        profileDrawerTitle: 'Character Profile System',
        profileHint: 'Pre-analyze each character\'s traits, motivations, and relationships as structured data for the Director Prompt. Independent of director decision logic.',
        profileEnabled: 'Enable Character Profiles (let Director understand each character\'s deep traits)',
        profileTokenBudget: 'Profile Token Budget (compress inactive characters when exceeded)',
        profileConcurrency: 'Concurrency (0=all, 1=sequential, N=batch of N)',
        profileGeneratorPromptTitle: 'Generator Prompt Template',
        profileGeneratorPromptHint: 'Tell the LLM how to analyze characters. Placeholders: <code>{{charName}}</code> <code>{{charDescription}}</code> <code>{{charPersonality}}</code> <code>{{charScenario}}</code>',
        profileGeneratorReset: 'Restore Default Generator Prompt',
        profileJsonSchemaTitle: 'JSON Schema (optional, for structured generation)',
        profileJsonSchemaHint: 'Define the JSON format for AI responses. Leave empty to use the built-in default schema.',
        profileSchemaReset: 'Restore Default Schema',
        profileRenderTemplateTitle: 'Render Template',
        profileRenderTemplateHint: 'Controls the output format of <code>{{character_profiles}}</code>. Per-character placeholders: <code>{{name}}</code> <code>{{summary}}</code> <code>{{tags}}</code> <code>{{motivation}}</code> <code>{{relationships}}</code>',
        profileRenderReset: 'Restore Default Render Template',
        profileManagementTitle: 'Profile Management',
        profileScanSave: 'Scan current save for character profiles',
        profileDetectChanges: 'Detect character changes (added/removed)',
        profileRegenerateAll: 'Regenerate All',

        exportImportTitle: 'Group Export / Import',
        exportImportHint: 'Package the current group\'s character cards and activated world books into a zip archive, or import from one.',
        exportGroup: 'Export Group',
        importGroup: 'Import Group',
    },
};

export function applyI18n(lang, EXT_KEY, chat_metadata) {
    const t = I18N[lang] || I18N.zh;
    $('[data-i18n]').each(function () {
        const key = $(this).attr('data-i18n');
        if (t[key] !== undefined) {
            $(this).html(t[key]);
        }
    });
    $('[data-i18n-placeholder]').each(function () {
        const key = $(this).attr('data-i18n-placeholder');
        if (t[key] !== undefined) {
            $(this).attr('placeholder', t[key]);
        }
    });
    const persistedScript = chat_metadata?.[EXT_KEY]?.historyMeta?.scriptPrompt;
    if (persistedScript) {
        $('#gd-history-meta-script').text(persistedScript);
    }
}

export function applyModeVisibility(mode) {
    $('#gd-formula-section').toggle(mode === 'formula');
    $('#gd-llm-section').toggle(mode === 'llm');
    $('#gd-off-hint').toggle(mode === 'off');
}

export function toggleCharDescLength(mode) {
    $('#gd-llm-char-desc-length').prop('disabled', mode !== 'slice');
}

export function toggleContinuityMode(mode) {
    $('#gd-llm-script-continuity-count').prop('disabled', mode !== 'history');
    $('#gd-llm-script-continuity-history-wrapper').prop('disabled', mode !== 'history');
    $('#gd-llm-script-continuity-wrapper').prop('disabled', mode !== 'last');
}