# Group World — 设计文档

## 1. 概述

Group World 是一个 **群聊上下文管线**：收集数据 → Agent 决策 → 注入角色 prompt。

默认搭载 10 组可配置 LLM 调用：Director（导演）、ForceSpeak（强制发言）、Profile（角色档案）、Summary（上下文总结）、NPC（NPC 生成）、Memory（角色记忆）、PostSpeech（多模态策略）、Critique（批判）、Story Blueprint（故事蓝图）、Custom Agent（用户自定义 —— 不注册为 Agent，直接通过 system 调用 LLM）。注册到 Agent Runtime 的 Agent 走声明式 pipeline；Story Blueprint 和 Custom Agent 直接通过各自 system 调用 LLM，但同样拥有独立 API 配置。

框架不绑定任何特定用例——可替换 prompt 模板实现地牢主宰、辩论裁判、战斗系统、社会模拟等场景。

### 1.1 四层架构

```
┌── Agent Registry ─────────────────────────────────────────────────┐
│   register(agent) / get(id) / list()                              │
│   Agent = { id, pipelineOrder, pipeline, contextAccess }          │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ┌─ Agent 层 ──────────────────────────────────────────────────┐  │
│  │  agent.run({ pool, caller, config })                        │  │
│  │  声明 pipeline: context → prompt → call → parse → validate │  │
│  │  声明 contextAccess: 权限边界                                │  │
│  ├─────────────────────────────────────────────────────────────┤  │
│  │  Runtime 层                                                 │  │
│  │  execute() — 按 pipelineOrder 执行，state-driven            │  │
│  │  createScopedPool() — Proxy 强制 contextAccess             │  │
│  │  managedCall() — retry + timeout + onRetry callback         │  │
│  ├─────────────────────────────────────────────────────────────┤  │
│  │  Protocol 层                                                │  │
│  │  createCaller(config) — ST Native / OpenAI / Anthropic      │  │
│  │  config.agentConfigs[id] → extension_settings (Key 在此)     │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                    │
├── Provider 层 ─────────────────────────────────────────────────────┤
│   {{placeholder}} → 数据注入 (无状态)                               │
├── Systems 层 ──────────────────────────────────────────────────────┤
│   有状态业务逻辑 (工厂 + 依赖注入)                                    │
├── UI 层 ───────────────────────────────────────────────────────────┤
│   仪表盘 + 5 抽屉 + 卡片系统 + 自注册模式 (registerSection)         │
└────────────────────────────────────────────────────────────────────┘
```

### 1.2 关键设计决策

| 决策 | 理由 |
|------|------|
| Agent = 声明式 pipeline | Runtime 执行，Agent 不碰控制流，可追踪、可调试 |
| contextAccess Per Agent | Proxy enforce，越权 warn/throw，防止数据污染 |
| callModel 统一治理 | retry + timeout + fallback，不在各处散落 |
| Protocol 层独立 | Agent 不感知 OpenAI/Anthropic 差异，加协议只改一个文件 |
| Key 存 extension_settings | 不随聊天导出，重启不丢 |
| 可变值用 getter | `chat`/`characters`/`chat_metadata` 是 ST 的 `export let` |
| 零修改 ST 核心 | 纯 Extension API：`generate_interceptor` + `abort(false)` |
| 仪表盘始终可见 | 状态（模式、决策、统计）不应藏在抽屉里 |
| 卡片默认折叠 + 状态持久化 | 100+ 配置项不能全平铺；`settings.uiState.cardStates` 记录折叠状态 |

---

## 2. Agent Runtime（核心）

### 2.1 Agent 定义

```js
const directorAgent = {
  id: 'director',
  displayName: 'Director',
  contextAccess: ['chat', 'recentMessages', 'characters', 'profiles', ...],
  pipelineOrder: ['context', 'prompt', 'call', 'parse', 'validate'],
  pipeline: {
    async context(input, ctx, pool, config) { /* → state.ctx */ },
    async prompt(input, ctx, pool, config)  { /* → state.prompt */ },
    // call: null → Runtime 统一治理 (managedCall)
    async parse(input, ctx, pool, config)   { /* → state.parsed */ },
    async validate(input, ctx, pool, config){ /* → state.parsed */ },
  },
};
```

- `contextAccess`：声明该 Agent 需要访问哪些 pool key。未声明的 key 被 Proxy 拦截。
- `pipelineOrder`：阶段执行顺序。不在其中的阶段不执行，天然可选。
- `pipeline.call = null`：由 Runtime 统一治理（retry + timeout）。Agent 也可自定义 `call` 实现。

### 2.2 执行引擎 (execute)

```
execute(agent, { pool, caller, config })
  │
  ├─ createScopedPool(pool, contextAccess, agent, config)
  │    → Proxy enforce: strictMode=true → throw; false → warn+undefined
  │    → 记录 usedAccess Set
  │
  ├─ for (stage of pipelineOrder)
  │    ├─ 'call' + null → managedCall(caller, prompt, callConfig)
  │    ├─ 其他阶段 → fn(input, state.ctx, scoped, config)
  │    └─ state[stage] = result
  │
  └─ console.log(accessReport) // 声明 vs 实际使用差异
```

**State 对象**：`{ ctx, prompt, raw, parsed }` — 每个阶段读写明确的 key，不混用。

### 2.3 Context Pool

```js
buildContextPool({ group, enabledMembers, ... }) → {
  chat:           () => chat,
  recentMessages: (n) => chat.slice(-n),
  characters:     () => characters,
  profilesText:   () => buildCharacterProfilesText(),
  worldInfoText:  () => wiState.text,
  ledger:         () => getDirectorHistory(),
  group:          () => group,
  settings:       () => settings,
  // ... per-agent overrides
}
```

Agent 通过 `contextAccess` 声明需要哪些字段，Pool 通过 Proxy 强制约束。

### 2.4 Execution Trace（可观测性层）

Agent 执行过程完全可追溯。通过 `config.enableTrace = true` 开启，零开销关闭。

| 原则 | 实现 |
|------|------|
| append-only | 每条 entry 写入后 `Object.freeze()` 冻结，不可修改 |
| 不参与控制流 | trace 变量不在 `if/return/throw` 中，只 push |
| 浅拷贝 | 外部数据 snapshot 时只拷贝元信息（长度、key 列表） |
| 默认关闭 | `config.enableTrace` 不传 = 零开销 |

#### 数据结构

```js
trace.snapshot() → {
  agentId: 'director',
  startTime: '2026-06-20T...',
  stages: [
    { stage: '_start', pipeline: ['context','prompt','call','parse','validate'],
      contextAccess: ['chat','recentMessages',...], time: ..., elapsed: 0 },
    { stage: 'context', duration: 1.2, outputSummary: { type:'object', keys:[...] } },
    { stage: 'prompt',  duration: 45.3, outputSummary: { type:'text', length: 3200 } },
    { stage: 'call',    duration: 2100, retries: 1, promptLength: 3200 },
    { stage: 'parse',   duration: 0.3, outputSummary: { type:'object', keys:['speakers','reason'] } },
    { stage: 'validate', duration: 0.1, outputSummary: { type:'object', keys:['speakers'] } },
    { stage: '_done', result: { type:'object', keys:[...] }, contextUsed: ['chat','recentMessages',...] }
  ],
  contextUsed: ['chat', 'recentMessages', 'characters', ...]
}
```

### 2.5 协议层 (createCaller)

```js
createCaller(config, stGenerateRaw) → { generate(prompt), test() }

config.useCustom = false → ST 原生 generateRaw
config.useCustom = true  → openaiCompatible / anthropicCompatible

// OpenAI:  POST {base}/v1/chat/completions
// Anthropic: POST {base}/v1/messages (anthropic-version: 2023-06-01)
```

### 2.6 Agent 注册

```js
AgentRegistry.register(createDirectorAgent({ renderPrompt, ... }));
AgentRegistry.register(createForceSpeakAgent({ renderPrompt, ... }));
AgentRegistry.register(createProfileAgent({ renderPrompt, ... }));
AgentRegistry.register(createSummaryAgent({ log }));
AgentRegistry.register(createCritiqueAgent({ log }));
AgentRegistry.register(createNpcAgent({ renderPrompt, ... }));
AgentRegistry.register(createMemoryAgent({ renderPrompt, ... }));
AgentRegistry.register(createPostSpeechAgent({ renderPrompt, log }));
```

### 2.7 配置存储

```js
settings.agentConfigs = {
  'director':    { useCustom: false, protocol: 'openai', endpoint: '', apiKey: '',
                   model: '', call: { retries: 2, timeout: 30000 }, strictMode: false },
  'force-speak': { ... },
  'profile':     { ... },
  'summary':     { ... },
  'npc':         { ... },
  'memory':      { ... },
  'post-speech': { ... },
  'story-blueprint': { ... }, // 故事蓝图生成/续写
  'custom-agent': { ... },  // 所有自定义 Agent 实例共存
};
```

存于 `extension_settings[EXT_KEY].agentConfigs`。不与聊天数据混合，不随导出泄露。

---

## 3. Provider 系统

### 3.1 接口

```js
registerProvider({
    id: 'myFeature',
    placeholder: '{{myFeature}}',
    render: async (ctx) => ({
        content: '摘要文本',        // {{myFeature}} → 此文本
        data: { key: 'val' },      // {{?myFeature:key}} → "val"
    }),
});
```

### 3.2 渲染行为 (v0.6.1+)

- **并行执行** — Phase 1 中所有 Provider 的 `render()` 通过 `Promise.allSettled` 同时运行，非顺序。单个 Provider 的超时/报错不影响其他 Provider。
- **每 Provider 超时** — 默认 10s（`settings.providerTimeoutMs`，GUI 可调）。Provider 可在注册时声明 `timeoutMs` 覆盖（优先级：`provider.timeoutMs` > 调用 option > 全局默认）。设为 0 禁用超时。超时后在 Console 输出 `[GroupDirector] Provider "xxx" timed out`。
- **信号中断** — `renderPrompt` 接受 `signal` option（Director/ForceSpeak/PostSpeech agent 已接入）。用户按 Stop 时中断正在渲染的 Provider 并传播 AbortError。
- **错误隔离** — 超时或 `render()` 抛错的 Provider 降级为空内容 `{content:'', data:null}`，同批次其他 Provider 不受影响。
- **世界书 Provider 并发安全** — `{{worldBooks}}` 和 `{{worldBookImportance}}` 共享 in-flight promise dedup，并行时不会重复调用 `loadWorldInfo`。

### 3.3 已注册 Provider（47 个内置 + N 个自定义 Agent 动态注册）

| Provider | 占位符 | 说明 |
|----------|--------|------|
| `recentMessages` | `{{recentMessages}}` | 最近 N 条消息 |
| `newRecentMessages` | `{{newRecentMessages}}` | 智能上下文窗口 |
| `characters` | `{{characters}}` | 角色列表 |
| `character_profiles` | `{{character_profiles}}` | 角色档案 |
| `maxSpeakers` | `{{maxSpeakers}}` | 最大发言人数 |
| `worldInfo` | `{{worldInfo}}` | ST 世界书条目 |
| `previousPlan` | `{{previousPlan}}` | 上一轮导演计划 |
| `previousPlans` | `{{previousPlans}}` | 历史导演计划数组 |
| `directorLedger` | `{{directorLedger}}` | 最新导演计划 JSON |
| `directorHistory` | `{{directorHistory}}` | 全部导演历史 JSON |
| `llmJsonSchema` | `{{llmJsonSchema}}` | 用户可编辑的 JSON 输出格式模板，含 `{{scriptField}}` |
| `scriptField` | `{{scriptField}}` | 根据剧本开关展开 scripts 字段片段或清空 |
| `storyBlueprintDoneField` | `{{storyBlueprintDoneField}}` | 根据故事蓝图开关展开完成变量字段或清空 |
| `worldBooks` | `{{worldBooks}}` | 激活世界书清单 |
| `worldBookImportance` | `{{worldBookImportance}}` | 条目重要性排名 |
| `gdWorldBooksFull` | `{{gdWorldBooksFull}}` | 当前激活世界书全部条目文本（含宏替换） |
| `gdWorldBooksConstant` | `{{gdWorldBooksConstant}}` | 当前激活世界书无条件（always-on）条目文本 |
| `gdWorldBooksNames` | `{{gdWorldBooksNames}}` | 当前激活世界书名称列表 |
| `characterLore` | `{{characterLore}}` | 角色世界书触发词 |
| `chatSummary` | `{{chatSummary}}` | 上下文总结 |
| `directorCritique` | `{{directorCritique}}` | 导演批判（可读文本） |
| `characterCritique` | `{{characterCritique}}` | 全量角色批判（JSON + DSL） |
| `charCritique` | `{{charCritique}}` | 当前角色批判（可读，自动解析角色名） |
| `npcList` | `{{npcList}}` | NPC 列表 + 路径查询 |
| `charMemory` | `{{charMemory}}` | 全部角色记忆 |
| `charMemoryCurrent` | `{{charMemoryCurrent}}` | 当前发言角色记忆 |
| `importedSummary` | `{{importedSummary}}` | 导入的摘要（独立存储） |
| `identity` | `{{identity}}` | 身份锚定提示词 |
| `systemTime` | `{{systemTime}}` | 系统日期时间 |
| `randomDice` | `{{randomDice}}` | 0.00-1.00 随机数 |
| `dice` | `{{dice}}` | 骰子 + 幸运值 |
| `moonPhase` | `{{moonPhase}}` | 月相 |
| `timeOfDay` | `{{timeOfDay}}` | 时段 + 季节 |
| `knowledge` | `{{knowledge}}` | 知识库原文 |
| `script` | `{{script}}` | 当前角色导演剧本（角色 Prompt 注入模版专用） |
| `importedCritique` | `{{importedCritique}}` | 导入的批判（独立存储） |
| `test` | `{{test}}` | 模板语法测试 |
| `globalVars` | `{{globalVars}}` | 全局变量列表（可读文本） |
| `charVars` | `{{charVars}}` | 角色变量列表（按角色分组） |
| `vars` | `{{vars}}` | 完整变量快照 JSON |
| `varsJson` | `{{varsJson}}` | 完整变量快照 JSON（同 vars） |
| `variableMaintenance` | `{{variableMaintenance}}` | 变量维护说明（注入 Director Prompt，告知 LLM 如何返回 variable_update） |
| `storyBlueprintCurrent` | `{{storyBlueprintCurrent}}` | 当前故事蓝图推进块；完成提示仅 Director 消费一次 |
| `storyBlueprintCurrentJson` | `{{storyBlueprintCurrentJson}}` | 当前推进节点 JSON |
| `storyBlueprintProgress` | `{{storyBlueprintProgress}}` | 蓝图进度摘要 |
| `storyBlueprintSchemaHint` | `{{storyBlueprintSchemaHint}}` | 完成变量协议提示 |
| `storyBlueprintFullJson` | `{{storyBlueprintFullJson}}` | 完整蓝图 JSON |

### 3.4 变量系统（v0.7）

变量系统为 Group World 提供了结构化的长期状态追踪能力。与 `ledger_update`（自由格式 JSON）不同，变量系统提供类型化、带校验、自动更新的具名变量。

**核心特性：**
- **22 个内置变量模板** — story_phase、current_goal、party_funds、danger_level、trust_user、emotion、health 等，覆盖叙事/经济/关系/状态
- **两种作用域** — `global`（全局）和 `character`（每个角色独立值）
- **六种数据类型** — string、number、boolean、enum、object、array
- **四种更新模式** — replace（替换）、delta（数值增减）、append（追加）、merge（对象合并）
- **值校验与钳制** — number 有 min/max，enum 检查合法值，delta 自动计算
- **变更日志** — 最近 100 条操作记录，含 messageId/hash 用于 stale 检测
- **stale 检测** — 消息被删除或修改后，变量标记为"可能过期"
- **回滚支持** — 可恢复到上一条非 ignored 记录
- **事务化导入** — 只有聊天元数据异步保存成功后才返回成功；保存失败时按 `导入前 / 导入后 / 当前值` 三方状态撤销导入写入，同时保留等待期间发生的并发编辑
- **锁定** — locked=true 的变量记录 LLM 更新但不写入值
- **配置档集成** — 导出/导入配置档时同步携带变量数据

**LLM 交互：** `{{variableMaintenance}}` 注入 Director system prompt → LLM 在 JSON 响应中返回 `variable_update` 字段 → `applyUpdates()` 解析并写入 `chat_metadata`。

**存储：** `chat_metadata[EXT_KEY].variables = { defs: [...], values: { global: {...}, character: {...} }, log: [...] }`

**导入回滚：** 定义和值按字段路径进行三方回滚；数组通过最长公共子序列识别 `导入后 → 当前值` 的序列差异，再把并发追加/删除重放到导入前数组；日志只移除本次导入片段并保留等待保存期间新增的记录。这样保存失败不会留下导入数据，也不会用旧快照覆盖无关编辑或同数组的并发序列增删。

**UI：** 工具抽屉 → 变量卡片（列表+编辑器+模板+导入导出）；仪表盘 → 变量面板（点击"变量"按钮展开，实时查看/编辑/回滚/锁定）。

### 3.5 Story Blueprint 系统

Story Blueprint 是连续性层的故事结构系统。框架只维护结构化蓝图和进度，不在代码里判断剧情是否合理；是否完成当前块由 Director/ForceSpeak 通过布尔变量协议声明。

**核心协议：**
- 完成变量默认 `gd_story_chapter_done`，存为全局 boolean 变量。
- Director JSON schema 通过 `{{storyBlueprintDoneField}}` 在 `variable_update.global` 中展开完成字段；关闭故事蓝图时该占位符为空。
- LLM 把完成变量设为 `true` 时，系统推进一个步骤并立即把变量重置为 `false`。
- 如果 ForceSpeak LLM 返回了完成变量，也会消费该信号，避免残留到下一轮 Director。

**蓝图结构：** `nodes` 是动态树，可一层、章/节/小节或更深。推进模式支持 `leaf`、`all`、`level`。`content` 是 prompt 作者自由定义的对象。

**生成与续写：**
- 生成/续写 prompt 走普通 Provider 渲染，可使用角色、档案、世界书、账本、总结、变量等接口。
- 默认生成 prompt 带 `{{storyBlueprintFullJson}}` 和 `{{storyBlueprintProgress}}`，让重新生成时也能保护已有连续性；用户可在 prompt 中删除这些接口来强制重启。
- Story Blueprint 使用 `agentConfigs['story-blueprint']`，在工具抽屉的 Agent 配置中可单独设置 API。
- 自动续写在后台运行，不阻塞当前 Director 决策；`continuePending` 用于 UI 显示“续写中”。
- 续写追加节点时会按当前顶层长度重新生成缺失 id，并递归处理 id 冲突，保护 `doneSignals`。
- 续写返回空节点会报错，不会显示成功但无变化。

**人工编辑：**
- UI 支持新建用户自建蓝图、追加根级章节、点击推进节点查看内容，以及用定位按钮单独设置当前步骤。
- 蓝图标题、meta 字段和当前/查看节点的 content 字段支持行内编辑，保存时复用 `setBlueprint(..., { resetProgress:false })`，不重置进度。

**状态与安全：**
- 蓝图正文和进度保存在 `chat_metadata[EXT_KEY].storyBlueprint`，配置保存在 `extension_settings`。
- `doneSignals` 记录已完成节点 id、步骤索引、聊天长度、时间和来源。
- 完成提示只在 Director prompt 中消费一次；UI 预览和 ForceSpeak 不会抢占该提示。
- 导入/高级 JSON 编辑会校验非空 `nodes`，非法结构不会被静默保存。
- 配置档只同步故事蓝图配置和变量定义/数据，不同步当前聊天的蓝图正文与进度；蓝图正文走 Story Blueprint 自己的导入/导出。

### 3.6 可复用库系统（Profile / NPC / Story Blueprint Library）

三类库系统（`profile-library-system` / `npc-library-system` / `story-blueprint-library-system`）采用统一架构，提供"把当前群组数据存成可复用、跨群聊应用的库条目"的便捷层。库条目持久化在 `extension_settings`（不随聊天导出），复用各自既有的 export/import payload，仅额外包裹 `libraryMeta`（名称、描述、时间戳、计数）。

**统一 API**：`saveCurrentAsLibrary` / `getLibrary` / `deleteLibrary` / `applyLibrary` / `exportLibrary` / `importFileToLibrary`，`genId` 用时间戳+计数器。

| 库 | 存储字段 | 存什么 | 特色 |
|---|---|---|---|
| Profile Library | `settings.profileLibraries` | 当前群组所有 `ready` 角色画像 | 智能匹配应用：hash -> avatar+name -> 仅 name 三级匹配；可选跳过已 ready 角色；**自动加载**；导出附带 generator prompt / schema / render template |
| NPC Library | `settings.npcLibraries` | 当前群组 NPC | 预览区分 new / overwrite 数量 |
| Story Blueprint Library | `settings.storyBlueprintLibraries` | 当前故事蓝图（可选含进度） | 统计节点数；导入兼容裸蓝图与已包装格式 |

**Profile 库自动加载**（核心能力）：`settings.profileLibraryAutoLoad` 配置 `enabled` / `mode('best'|'fixed')` / `fixedId` / 匹配规则 / `overwriteExisting` / `importTemplate`。`findBestLibrary` 按"可用匹配数×100 + 总匹配数×10 + 匹配率"打分选最优库；在 `CHAT_CHANGED` 和 `APP_READY` 事件中（且 `profileEnabled` 时）自动触发 `autoLoadForCurrentGroup`，成功后弹 toastr 并刷新 UI；用 `lastAutoLoadKey` 去重避免重复应用。

**库持久化事务边界**：Profile 与 Story Blueprint Library 的保存、删除、文件导入和 Profile 自动加载配置更新均串行执行并等待已确认的设置持久化。“保存当前”在进入队列前即捕获当前聊天名称和内容副本，排队等待期间切换聊天不会改变已请求的来源。失败补偿只移除本次新增项、按存活相邻项恢复本次删除项，或恢复仍由本次操作占有的配置字段，不用整库快照覆盖并发修改。专用卡片和仪表盘必须等待 Promise，成功后才刷新和提示。导出无论创建节点或点击是否失败都会清理临时节点与 Blob URL。Profile Library 应用复用 Profile Import 自己的单次聊天保存；Story Blueprint Library 通过 `applyImportTextAndSave()` 统一执行一次保存并回读原聊天头验证蓝图状态。明确回读不一致时三方回滚导入状态、保留等待期间的对象字段和数组增量，并再次确认补偿保存；补偿保存也失败时明确报告回滚不完整。若回读请求本身失败，持久化结果无法判定，此时保留可能已经落盘的内存状态并以 `persistenceUnknown` 拒绝，避免反向覆盖成功写入。

**与配置档案的关系**：库条目是"可复用内容数据"，在 `config-profile-system` 中被 `INTENTIONALLY_UNCOVERED_KEYS` 显式排除，不随配置档保存/还原。

**Profile 持久化事务边界**：`saveProfile()` 负责单角色写入，`archiveProfiles()` 负责活动档案到归档区的移动；两者都必须 `await saveChatConditional()`。保存失败时按头像分别补偿，只恢复仍等于本次应用状态的槽位，因此不会用整仓快照覆盖等待期间同角色或其他角色的并发编辑。同步、角色变动检测和卡片删除统一调用该事务 API，UI 不再直接改写两个存储映射。

**Profile 管理 UI 安全边界**：所有异步加载、生成、保存和删除处理器必须捕获拒绝、显示失败提示，并在 `finally` 恢复按钮。导入头像值只通过 HTML 属性编码进入标记；编辑面板通过卡片 DOM 层级查找，不从头像拼接 HTML `id` 或 CSS 选择器。

### 3.7 群组 ZIP 导入导出

`export-import-system.js` 导出当前群组启用角色的 PNG 卡、已激活世界书与 `group.json`。群组和世界书名称在首次异步请求前快照化；角色卡请求失败时不把该角色写进归档清单，全部角色失败则不生成无法导入的 ZIP。部分导出给出警告，下载的临时节点与 Blob URL 无论点击成功或失败都必须清理。

导入先解析并验证完整归档：`group.json` 的成员及选项类型、单层安全路径、无重复文件、每个成员有且仅有对应 PNG，以及世界书 JSON 可解析且包含 `entries`。所有条目可读取后才开始宿主 POST。角色导入不传 `preserved_name`，由 SillyTavern 分配不冲突的文件名；成员重映射只使用已经验证的完整角色文件名，basename 或归档路径别名不能覆盖另一成员。世界书根据宿主实时名称和当前系统实例已经分配的名称选择避让名。宿主角色接口可能以 HTTP 200 返回 `{ error: true }`，只有有效的 `file_name` 才算成功。仅当所有必需角色导入成功时才创建群组，并用实际返回的头像文件名重映射成员。

远端角色/世界书上传是不可逆的独立副作用，不声称整体事务回滚。导入结果明确区分完整成功、已发出写请求但未完整成功、以及预检失败等确定的零写入；请求发出后即使响应失败也提示用户检查宿主资源，不能断言未创建资源或显示成功提示。UI 捕获意外拒绝并恢复按钮与文件输入。同一插件实例会在上传前同步预留世界书名称，因此连续或并发导入不会互相覆盖；宿主导入接口本身没有原子“不覆盖”条件，因此跨页面或跨客户端并发同名写入仍需宿主支持才能完全排除。

### 3.8 编码规则

- Provider 有开关时在 `render()` 内返回空字符串，不用 `enabled` 跳过
- 可变值用 getter 传入
- `settings.js` 是唯一默认值来源

---

## 4. 模板渲染引擎（prompt-renderer.js）

### 4.1 五阶段管线

```
Phase 0   — {[{...}]} 直通槽位 → 哨兵替换
Phase 1   — 并行执行所有 Provider（Promise.allSettled + per-provider 超时 + signal 中断），缓存到 cache[id] = { content, data }
Phase 1.5 — 块循环 {{#provider:path}}...{{/provider}}
Phase 2   — 简单占位符 {{name}} → cache[id].content
Phase 3   — 路径查询 {{?name:path|fallback}}
Post      — 递归稳化 → 恢复直通槽位
```

### 4.2 路径查询语法

```
{{?directorLedger:scripts.$character}}
{{?history:plans[reason=开场].scripts}}
{{?directorLedger:events[-1].title}}
{{?worldBooks:allEntries[comment=地理与空间].content}}
```

### 4.3 运行时变量

| 变量 | 场景 | 含义 |
|------|------|------|
| `$character` | Script Wrapper | 当前角色名 |
| `$speakerIndex` | Script Wrapper | 发言顺序 (1-based) |
| `$speakerIndex0` | Script Wrapper | 发言顺序 (0-based) |
| `$speakerCount` | Script Wrapper | 本轮总发言人数 |
| `$it` | 块循环内部 | 当前迭代元素 |

---

## 5. 世界书管线

`settings.worldBookSourceMode` 决定 `worldBookScanner.getSelectedNames()` 扫描哪些世界书：`st`（默认）跟随 SillyTavern 当前激活的世界书（汇总 chat metadata `world_info`、`selected_world_info`、`charLore`，见 `getActivatedWorldBookNames()`）；`gd` 则完全使用用户在 GD 面板手动勾选的 `worldBookSelection`，脱离 ST 激活状态。扫描器另提供 `getRenderedBooks()` / `buildSnapshot()`，对条目内容做 `substituteParams` 宏替换后产出 `fullText` / `constantText` 与字符数统计，供 `{{gdWorldBooksFull}}` / `{{gdWorldBooksConstant}}` / `{{gdWorldBooksNames}}` 三个 Provider 使用。

```
用户勾选世界书
  ↓
worldBookScanner.scanAll()
  ↓
{{worldBookImportance}} → Director Prompt: 条目名 + 关键词 + 重要性
  ↓
Director 返回 loreAssignments: { "Alice": ["条目1", "条目2"] }
  ↓
{{characterLore}} → Script Wrapper: [World lore: 条目1, 条目2]
  ↓
ST checkWorldInfo 检测到关键词 → 激活条目 → 注入正文
```

---

## 6. 模式

### 6.1 `off` — 关闭
不干预 ST 默认行为。force-speak 不受影响。

### 6.2 `formula` — 公式判断
本地评分，零 API 调用：

```
score(c) = mention(c)×w_mention + trigger(c)×triggerScore
         + recency(c)×w_recency − consecutive(c)×w_consecutivePenalty
         + talkativeness(c)×w_talkativeness + initiative(c)
```

CJK 角色名使用 `indexOf` 子串匹配，ASCII 名使用 `\b` 单词边界正则。

### 6.3 `llm` — 大模型判断
通过 Director Agent 调用 LLM：
1. Agent context 阶段收集上下文
2. Agent prompt 阶段渲染模板
3. Runtime managedCall 发送请求
4. Agent parse 阶段解析 JSON（支持透传额外字段到 ledger）
5. Agent validate 阶段校验 speakers

失败回退：3 次重试 → 复用历史计划 → 阻塞轮次。

**JSON Schema 自动注入**：Director 和 ForceSpeak 两个 Agent 在 prompt 阶段，如果检测到自定义模板不含 `{{llmJsonSchema}}` 占位符，会自动调用 `buildJsonSchema()` 追加 schema 文本到 prompt 末尾。`buildJsonSchema()` 使用 `??`（而非 `||`）处理空值，尊重用户清空 textarea 的意图；同时 strip `{{llmJsonSchema}}` 字面量防止自引用递归膨胀。`{{scriptField}}` 占位符在内被展开为 scripts 字段片段（剧本启用时）或空字符串（禁用时）。

**ledger_update 自由记录字段**：默认 schema 预留 `"ledger_update": {}` 作为 LLM 的 catch-all 输出口。这是一个完全开放的 object 字段，LLM 可自行决定将任何观察到的信息（剧情、伏笔、情绪、新 NPC 等）写入其中，数据随导演账本持久化，通过 `{{?directorLedger:ledger_update.xxx}}` 查询。不需要预先声明字段结构。

---

## 7. 拦截器状态机

```
GROUP_WRAPPER_STARTED
  ├─ takeoverGenCount > 0 → return (nested sub-call)
  ├─ takeoverFailed → 复用旧计划
  ├─ swipe/regenerate → 重建/透传/复用
  └─ 正常新轮次 → 清空状态

Interceptor
  ├─ force-speak 检测（最先执行，不受模式关闭影响）
  ├─ 首个角色 → Formula/Agent 初始化
  ├─ takeover → 验证身份 + 注入剧本
  └─ 过滤 → 不在 pickedSet → abort

GROUP_WRAPPER_FINISHED
  ├─ takeoverPending → runManualOrderedGeneration()
  └─ 清理

GENERATION_STOPPED → generationStopped = true
MESSAGE_DELETED → 裁剪账本 + 裁剪总结 + 清空状态
CHAT_CHANGED → 裁剪账本 + 裁剪总结（分支/切换）
```

### 7.1 回合编排器与状态所有权

`systems/round-orchestrator.js` 是 takeover 回合的有状态协调层。`index.js` 负责接收 SillyTavern 事件和执行生成副作用，但不再自行推导剩余人数、重试状态或终结条件。

| 模块 | 职责 |
|------|------|
| `round-state.js` | 单次 wrapper/takeover 状态转换；纯函数，不持有运行时状态 |
| `takeover-scheduler.js` | 按 Director 原始顺序建立队列，排除已完成或不可用角色 |
| `round-finalization.js` | 判断是否允许执行 round-end 收尾 |
| `round-orchestrator.js` | 持有 takeover 状态，并组合上述规则供 `index.js` 调用 |

关键不变量：

- 计划外角色被阻止时不消耗 `takeoverRemaining`。
- swipe/regenerate 不消耗计划，只累计安全限制计数。
- takeover 未完成、失败、等待手动生成或用户停止时，禁止 round finalization。
- 嵌套 wrapper 保留当前 takeover；失败计划在下一次正常 wrapper 中进入重试路径。
- `takeoverCompleted` 跨重试保留，恢复调度时不会重复生成已完成角色。

---

## 8. 如何添加新 Agent

1. 创建 `agents/xxx.js` → 声明 `{ id, displayName, contextAccess, pipelineOrder, pipeline }`
2. 在 `index.js` 中 `AgentRegistry.register(createXxxAgent({...}))`
3. UI 自动从 `AgentRegistry.list()` 生成配置块

---

## 9. UI 架构 (v2)

### 9.1 总体结构

```
┌── 仪表盘（始终可见）──────────────────────────────────────────────┐
│  状态灯 · 上次决策 · 统计 · 快捷按钮 · 预设选择                      │
├──────────────────────────────────────────────────────────────────┤
│  ▼ 导演 — 模式 / LLM参数 / 剧本 / 连贯性 / 世界书 / 强制发言        │
│  ▼ 角色 — 档案卡片 / 记忆卡片 / NPC卡片 / 身份锚定卡片              │
│  ▼ 连续性 — 总结卡片 / 账本卡片 / 世界书卡片                        │
│  ▼ 反应 — PostSpeech消息卡片 / PostSpeech回合卡片 / 能力卡片        │
│  ▼ 工具 — 配置档卡片 / 导出导入卡片 / Agent卡片 / 自定义Prompt卡片   │
│          / 用户扩展卡片 / 接口参考卡片 / 脚本执行器卡片 / 调试卡片      │
└──────────────────────────────────────────────────────────────────┘
```

### 9.2 设计原则

- **仪表盘是信息层**：模式指示灯、上次决策摘要、数据统计（含世界书）、快捷操作。不属于任何抽屉，永远可见。打开设置面板时 MutationObserver 自动触发刷新；其他 section 通过 `window.__gdRefreshDashboard` 触发更新。
- **卡片是内容层**：每个功能模块是一张折叠卡片。标题栏显示名称 + 状态标签（如 `3 ready`、`off`）。折叠状态通过 `settings.uiState.cardStates` 持久化。
- **抽屉是分类层**：5 个抽屉按用户心智模型分类（导演/角色/连续性/反应/工具），替代旧版 10 个按代码模块划分的抽屉。

### 9.3 自注册模式

UI section 通过 `registerSection(name, initFn)` 注册，`initAllSections(ctx)` 统一初始化。各 section 之间通过以下机制通信：

| 机制 | 用途 |
|------|------|
| `window.__gdRefreshDashboard` | 触发仪表盘数据刷新 |
| `window.__gdRefreshConfigList` | 触发配置档列表刷新 |
| `ctx` 共享依赖 | settings, saveSettings, 各 system 实例 |

### 9.4 打开时自动刷新

通过 `MutationObserver` 监听 `#gd-settings-panel` 的 `closedDrawer` class 变化——当用户点击 GD 标签页时，面板展开，observer 检测到 class 移除，立即触发 `refreshAll()`。无需手动拉动抽屉触发刷新。

### 9.5 统计面板展开与行内编辑

所有 5 个统计方块均可点击展开内联面板。各面板共用 `statPanels` 配置和统一的 `togglePanel()` 控制，互斥展开（打开一个会自动关闭上一个）。展开项支持行内编辑：悬停字段浮现「编辑」按钮 → textarea → 保存/Ctrl+Enter 写回底层数据 → `saveChatConditional()` 持久化。编辑按钮使用事件委托，保存后重建的按钮仍可继续编辑。

### 9.6 世界书选择面板

仪表盘统计栏第五个方块「世界书」显示当前勾选数/总数。点击展开一个内联面板，包含全选/取消全选按钮和逐个勾选列表，与连续性抽屉中的世界书列表共享同一份 `settings.worldBookSelection`。

### 9.7 仪表盘快捷按钮

| 按钮 | 实现 | 显示条件 |
|------|------|----------|
| 扫描存档 | 触发 profile scan + memory refresh | profile 或 memory 启用 |
| 生成档案 | 触发 `#gd-profile-regenerate-all` | profile 启用 |
| 提取记忆 | 直接调用 `memorySystem.generateForCharacter()` | memory 启用 |
| 执行总结 | 触发 `#gd-summary-execute`，未启用则自动开启 | 始终（群聊中） |
| 配置档下拉 | 内置预设 + 用户配置档（optgroup 分组），选择后点应用 | 始终 |

### 9.8 配置档同步

仪表盘和工具抽屉各有一个配置档下拉框（`#gd-dash-cfg-preset` 和 `#gd-cfg-preset`），通过 `refreshPresetSelector()` 同时更新。选项以 `<optgroup>` 分组：
- **内置配置档**：从 `getConfigPresetNames()` 读取，选择后需先 `loadConfigPreset` 再 `applyProfile`
- **我的配置档**：从 `configProfileSystem.getProfiles()` 读取，value 前缀 `__prof__:id`，选择后直接 `applyProfile`

保存/删除/导入操作后自动刷新两个下拉框和配置档列表。

### 9.9 可测试的 UI 安全边界

UI section 保留事件绑定和 DOM 修改；输入归一化、输出编码、展示/编辑值分离等安全敏感规则放在同目录纯 helper 中，并由生产 section 直接调用。当前包括：

- `custom-agent-helpers.js`：UI 数值输入边界与 `data-id` 精确比较；导入契约由系统层 validator 统一负责。
- `execution-trace-helpers.js`：Trace 汇总及阶段 HTML 安全编码。
- `profile-summary-helpers.js`：档案摘要的复合展示文本与原始编辑值分离。

这些 helper 使用零 DOM 的 `node:test` 行为契约；只有事件传播、焦点、布局或 SillyTavern 自有控件行为才需要浏览器级测试。

---

## 10. 目录结构

```
SillyTavern-GroupWorld/
├── manifest.json
├── index.js                   # 入口：组装层、运行时状态、拦截器、事件监听
├── settings.js                # 常量 + 默认设置（单一真相源）
├── settings.html              # 设置面板（仪表盘 + 5 抽屉 + 卡片）
├── style.css                  # 仪表盘 + 卡片 + 状态灯动画
├── prompt-renderer.js         # 五阶段模板渲染引擎
├── provider-registry.js       # Provider 注册表
├── DESIGN.md                  # 本文件
├── USER-GUIDE.md              # 用户手册
├── TEMPLATE-SYNTAX.md         # 模板语法参考
│
├── assets/                    # 可插拔资源
│   ├── profiles/              # 预设文件（JSON）
│   │   ├── manifest.js        # profilePresets[] + npcPresets[] + configPresets[]
│   │   ├── fantasy-rpg.json
│   │   ├── npc-fantasy-tavern.json
│   │   └── group-world-default.json
│   ├── providers/             # 29 个内置 Provider
│   │   ├── manifest.js
│   │   ├── chatSummary.js
│   │   ├── director-critique.js
│   │   ├── character-critique.js
│   │   ├── char-critique.js
│   │   ├── variables.js          # 变量系统 Provider（5 个占位符）
│   │   ├── gd-world-books.js     # GD 自管世界书 Provider（3 个占位符）
│   │   └── ...
│   └── capabilities/          # 3 个内置 Capability
│       ├── manifest.js
│       ├── emotion.js
│       ├── tts.js
│       └── image.js
│
├── agents/                    # Agent 层 — 每个 Agent 一个文件
│   ├── director.js
│   ├── force-speak.js
│   ├── profile.js
│   ├── summary.js
│   ├── critique.js
│   ├── npc.js
│   ├── memory.js
│   └── post-speech.js
│
├── systems/                   # 有状态业务逻辑
│   ├── agent-runtime.js       # execute + managedCall + createScopedPool + AgentRegistry + Trace
│   ├── round-state.js         # wrapper/takeover 纯状态转换
│   ├── takeover-scheduler.js  # takeover 有序队列与跳过原因
│   ├── round-finalization.js  # 回合收尾门控规则
│   ├── round-orchestrator.js  # takeover 状态所有者与协调入口
│   ├── capability-registry.js # CapabilityRegistry（多模态能力注册）
│   ├── executor.js            # PostSpeech Executor (resolve→schedule→execute)
│   ├── history-system.js      # 导演账本 CRUD
│   ├── world-info-system.js   # ST checkWorldInfo() 封装
│   ├── asset-loader.js        # 动态导入 + 注册 assets/ 模块
│   ├── user-provider-loader.js # 用户 Provider/Capability 导入
│   ├── profile-system.js      # 角色档案全流程
│   ├── profile-export-system.js
│   ├── profile-library-system.js  # 档案可复用库（含自动加载）
│   ├── npc-system.js          # NPC 生成 + 导入角色卡
│   ├── npc-export-system.js
│   ├── npc-library-system.js  # NPC 可复用库
│   ├── memory-system.js       # 角色记忆全流程
│   ├── memory-export-system.js
│   ├── post-speech-system.js  # PostSpeech 决策持久化
│   ├── config-profile-system.js # 配置档管理（含 JSZip fallback 加载）
│   ├── custom-prompt-validation.js # 自定义 Prompt 共享导入/字段契约
│   ├── custom-prompts-system.js # 自定义 Prompt 模板
│   ├── variable-system.js      # 变量系统（定义/值/校验/日志/回滚/stale 检测）
│   ├── world-book-scanner.js  # 世界书扫描
│   ├── chat-summary-system.js # 上下文总结
│   ├── critique-validation.js # 批判数据与导入文件共享契约
│   ├── critique-parser.js     # LLM JSON 平衡提取与规范化
│   ├── critique-repository.js # 历史、激活链、回退与保存事务
│   ├── critique-execution.js  # LLM 运行锁与静默 Prompt 清理
│   ├── critique-auto-coordinator.js # 自动批判 checkpoint 策略
│   ├── critique-system.js     # AI 批判业务门面
│   ├── custom-agent-validation.js # Custom Agent / 导入 / 配置档共享数据契约
│   ├── custom-agent-system.js # CRUD、导入导出、结果存储与 Provider 生命周期
│   ├── custom-agent-execution.js # 串行执行、去重、stale 检测与结果事务
│   ├── custom-agent-auto-coordinator.js # 自动触发纯调度策略
│   ├── story-blueprint-system.js  # 故事蓝图系统
│   ├── story-blueprint-library-system.js # 故事蓝图可复用库
│   ├── summary-export-system.js
│   ├── export-import-system.js # 群聊导出/导入（JSZip fallback）
│   └── script-executor-system.js # 脚本执行器引擎
│
├── utils/                     # 纯函数工具
│   ├── custom-api.js          # createCaller (ST/OpenAI/Anthropic)
│   ├── path-resolver.js
│   ├── counter.js
│   ├── json-utils.js
│   └── string-utils.js
│
└── ui/                        # UI 层（自注册模式）
    ├── settings-init.js       # loadSettingsUI() 入口
    ├── i18n.js                # 中英文字典（单一 zh + 单一 en 块）
    ├── dom.js                 # $c() + bind helpers + bindSetting
    └── sections/              # 每个设置区域一个自注册模块
        ├── registry.js        # registerSection() / initAllSections()
        ├── dashboard.js       # 仪表盘（v2 新增）
        ├── modes.js           # 模式选择
        ├── formula.js         # 公式模式参数
        ├── director.js        # LLM 参数、剧本
        ├── continuity.js      # 连贯性模式
        ├── worldinfo.js       # 世界书开关
        ├── worldBooks.js      # 世界书选择
        ├── variables.js       # 变量设置 + 仪表盘面板
        ├── ledger.js          # 账本浏览器
        ├── forceSpeak.js      # 强制发言
        ├── chatSummary.js     # 上下文总结
        ├── storyBlueprint.js   # 故事蓝图
        ├── storyBlueprintLibrary.js # 故事蓝图可复用库 UI
        ├── critique.js        # AI 批判
        ├── summaryExport.js   # 摘要导出/导入
        ├── templateTester.js  # 模板测试器
        ├── profile.js         # 角色档案
        ├── profileExport.js   # 角色档案导出/导入
        ├── profileLibrary.js   # 档案可复用库 UI
        ├── npc.js             # NPC 生成
        ├── npcExport.js       # NPC 导出/导入
        ├── npcLibrary.js       # NPC 可复用库 UI
        ├── memory.js          # 角色记忆
        ├── memoryExport.js    # 记忆导出/导入
        ├── configProfiles.js  # 配置档管理
        ├── quickStart.js      # 快速启动（已被仪表盘取代，保留向后兼容）
        ├── identity.js        # 身份锚定
        ├── exportImport.js    # 群聊导出/导入
        ├── postSpeech.js      # PostSpeech 配置
        ├── executionTrace.js  # 执行追踪
        ├── userProviders.js   # 用户扩展管理
        ├── providerReference.js # 接口参考
        ├── customPrompts.js   # 自定义 Prompt
        ├── agents.js          # Agent API 独立配置（动态生成）
        └── scriptExecutors.js # 脚本执行器 UI
```

---

## 11. 配置项总览

| 字段 | 默认 | 说明 |
|------|------|------|
| `mode` | `formula` | `off` \| `formula` \| `llm` |
| `topN` | 1 | 公式模式放行人数 |
| `recentMessageCount` | 10 | 分析最近消息条数 |
| `consecutivePenalty` | 15 | 连续发言惩罚 |
| `scoreWeights.*` | (见 settings.js) | 评分权重 |
| `triggerEnabled` / `triggerScore` | true / 40 | 触发器引擎 |
| `initiativeEnabled` / `initiativeBaseScore` | true / 5 | 主动性扰动 |
| `llmPrompt` | (内置) | Director Prompt 模板 |
| `llmMaxSpeakers` | 3 | 每轮最多发言人数 |
| `llmRespectOrder` | true | 严格顺序发言 |
| `llmContextDepth` | 10 | 传入 LLM 最近消息条数 |
| `llmCharDescMode` / `llmCharDescLength` | slice / 200 | 角色描述控制 |
| `llmScriptEnabled` | false | 启用导演剧本 |
| `llmScriptPrompt` | '' | 剧本风格要求 |
| `llmScriptWrapper` | (内置) | 剧本注入包装模板 |
| `llmJsonSchema` | (内置) | JSON 输出格式模板，含 `{{scriptField}}` 和 `ledger_update` |
| `llmHistoryEnabled` | true | 记录导演账本 |
| `llmScriptContinuity` | false | 连贯剧本 |
| `llmWorldInfoEnabled` | false | 世界书注入 |
| `templateMaxPasses` | 5 | 递归渲染最大轮数 |
| `templateRecursive` | true | 启用递归渲染 |
| `templateDebugPlaceholders` | false | 保留未注册占位符 |
| `identityPrompt` | '' | 身份锚定提示词 |
| `forceSpeakMode` | `native` | `native` \| `block` \| `llm` |
| `postSpeechMessageEnabled` | false | 每次发言后触发 PostSpeech |
| `postSpeechRoundEnabled` | false | 回合结束后触发 PostSpeech |
| `postSpeechBlocking` | true | PostSpeech 阻塞模式 |
| `agentConfigs` | `{}` | 每个 Agent 的独立 API 配置 |
| `uiState` | `{ cardStates: {} }` | UI 持久化状态（卡片折叠） |
| `customPrompts` | `[]` | 自定义 Prompt 列表 |
| `customPromptsEnabled` | `true` | 自定义 Prompt 总开关 |
| `scriptExecutors` | `[]` | 脚本执行器列表 |
| `autoMemorySpeakers` | `false` | 自动记忆仅提取发言角色 |
| `critiqueEnabled` | `false` | 启用 AI 批判 |
| `critiqueReuse` | `false` | 复用上次批判 |
| `critiqueAuto` | `false` | 自动批判 |
| `critiqueAutoInterval` | `5` | 每 N 条消息触发自动批判 |
| `critiquePrompt` | `''` | 批判系统提示词（自定义） |
| `critiqueSchema` | `''` | 批判输出 JSON Schema（自定义） |
| `worldBookSourceMode` | `'st'` | 世界书来源模式：`st`（跟随 ST 激活）/ `gd`（GD 手动勾选） |
| `profileLibraries` | `[]` | 档案可复用库条目（存 extension_settings） |
| `profileLibraryAutoLoad` | `{ enabled:false, mode:'best', fixedId:'', matchHash:true, matchAvatarName:true, matchNameOnly:false, overwriteExisting:false, importTemplate:false }` | 档案库自动加载配置 |
| `npcLibraries` | `[]` | NPC 可复用库条目 |
| `storyBlueprintLibraries` | `[]` | 故事蓝图可复用库条目 |

---

## 12. 脚本执行器 (Script Executor)

用户编写的 JS 脚本，在导演生命周期的三个触发点执行。不是 Agent，不调用 LLM，纯本地 JS 运行时。

### 12.1 触发点生命周期

```
GROUP_WRAPPER_STARTED  → turnShared = {}，重置去重标志
  ↓
Director 决策 (LLM/Formula)
  ↓
┌─ decision 钩子 (阻塞，await 全部，10s 超时) ──────────┐
│  ctx.decision.speakers / .names / .reason / .scripts  │
│  脚本可修改 ctx.decision (逐脚本隔离副本)               │
│  修改后 snapshot 供 message/round 阶段只读             │
└───────────────────────────────────────────────────────┘
  ↓
角色逐个生成 → message 钩子 (fire-and-forget, 5s 超时)
  ↓
GROUP_WRAPPER_FINISHED → round 钩子 (fire-and-forget, 去重)
  ↓
下一轮 GROUP_WRAPPER_STARTED → turnShared 重置
```

### 12.2 触发模式

| 模式 | 触发点 | 执行方式 | ctx 独有字段 |
|------|--------|----------|-------------|
| `message` | CHARACTER_MESSAGE_RENDERED | fire-and-forget, 5s 超时 | `ctx.message`, `ctx.character`, `ctx.decisionSnapshot` |
| `round` | GROUP_WRAPPER_FINISHED | fire-and-forget, 去重, 5s 超时 | `ctx.decisionSnapshot` |
| `decision` | Director 决策后 | 阻塞 await 全部, 10s 超时 | `ctx.decision` (隔离副本，可修改) |
| `both` | message + round | 同各自模式 | 对应阶段字段 |
| `all` | 全部三个 | 同各自模式 | 对应阶段字段 |

### 12.3 ctx 分形

三个阶段的 `ctx` 形状不同，按阶段提供对应字段：

| 字段 | decision | message | round |
|------|:---:|:---:|:---:|
| `ctx.params` | ✓ | ✓ | ✓ |
| `ctx.shared` (turnShared) | ✓ | ✓ | ✓ |
| `ctx.decision` (隔离副本) | ✓ | - | - |
| `ctx.decisionSnapshot` (read-only) | - | ✓ | ✓ |
| `ctx.message` | - | ✓ | - |
| `ctx.character` | - | ✓ | - |
| `ctx.chat` | ✓ | ✓ | ✓ |
| `ctx.characters` | ✓ | ✓ | ✓ |
| `ctx.group` | ✓ | ✓ | ✓ |
| `ctx.settings` | ✓ | ✓ | ✓ |
| `ctx.getContext` | ✓ | ✓ | ✓ |

### 12.4 共享状态 (turnShared)

系统实例闭包变量，不持久化到 settings；不同执行器系统实例之间不会共享轮次状态：

- **创建**：`GROUP_WRAPPER_STARTED` 时 `resetTurnShared()` 重置为 `{}`
- **写入**：脚本设置 `returnMode: 'shared'` 且返回可校验的普通 object → 克隆后合并到 `turnShared`
- **读取**：所有脚本通过隔离的 `ctx.shared` 副本读取当前快照；直接改动副本不会写回
- **生命周期**：decision → message → round 贯穿，下轮重置

decision 阶段完成后，`decisionSnapshot = deepFreeze({ decision: deepClone, shared: deepClone(turnShared) })` 供 message/round 脚本只读。

### 12.5 数据结构

```js
{
  id: 'se_xxx',
  name: 'My Script',
  triggerOn: 'decision',     // 'message' | 'round' | 'decision' | 'both' | 'all'
  priority: 0,               // 升序执行
  code: '...',               // JS 代码体，通过 new Function('ctx', code) 执行
  enabled: true,
  params: [{ key, label, type, default }],  // 类型化参数
  renderParams: false,       // 是否渲染字符串参数（单次，仅字符串字段）
  returnMode: 'ignore',      // 'ignore' | 'shared'
}
```

### 12.6 执行模型

```
筛选 enabled && triggerOn 匹配 → 按 priority 升序 →
  逐个 new Function('ctx', code) → Promise.race(script, timeout) →
    成功 + returnMode='shared' → 校验并克隆结果，再合并到 turnShared
    超时/异常 → trace 记录 → 继续下一个
```

- **decision**：阻塞，await 全部完成后返回 snapshot
- **message/round**：fire-and-forget，不阻塞角色生成
- 超时不会取消已经启动的异步 JS；其迟到结果和保留的 `ctx.shared`/`ctx.decision` 引用不能再改写执行器内部状态。轮次重置后，旧执行链也不会启动后续脚本。传入脚本的宿主对象及页面全局仍是可访问的，不构成沙箱。
- 执行追踪通过 `AgentTrace` 记录每阶段耗时和状态

### 12.7 导入/导出

导出格式：`{ version: 1, type: 'script-executor-export', exportedAt, executors: [...], migrations: [] }`

导入由 UI 与系统层分工：UI 只读取文件、展示安全警告并收集同名覆盖选择；`script-executor-system` 通过 `script-executor-validation` 先校验完整文件和所有条目，再在候选列表中解决冲突，最后一次替换设置并保存一次。导入与新增、更新、删除、启停共享同一变更队列；等待覆盖选择时其他写入不得插队。任何条目非法、取消事务或保存失败时，现有列表保持不变。覆盖条目保留现有内部 ID，新条目生成可信 ID，外部 ID 不会被采用。

共享数据契约限制触发枚举、返回模式、`-100..100` 整数优先级、布尔字段和参数类型；参数键必须非空且唯一，并拒绝 `__proto__`、`prototype`、`constructor`。系统 CRUD、独立导入和配置档案导入复用同一契约。配置档管理 (Config Profile) 同步包含 `scriptExecutors`。

新增、更新、删除与开关操作都返回 Promise，在系统实例内串行执行并等待注入的 `saveSettings` 回调；该回调可观察到的失败会回滚本次操作，保留保存等待期间其他执行器的编辑。UI 在 Promise 完成后才刷新，失败时显示警告。当前 SillyTavern 的 `saveSettingsDebounced` 不返回实际保存 Promise，宿主的直接保存函数也会自行捕获网络错误，因此插件不能据此保证服务器落盘成功；上述回滚契约适用于回调实际抛错或拒绝的情形。

---

## 13. PostSpeech 多模态策略

### 13.1 架构

```
角色发言 → CHARACTER_MESSAGE_RENDERED → PostSpeech Agent (per-message)
回合结束 → GROUP_WRAPPER_FINISHED      → PostSpeech Agent (per-round)
                                              ↓
                                    LLM 输出 policy JSON
                                              ↓
                                    Executor: resolve → schedule → execute
                                              ↓
                                    Capability.executor() → TTS / Image / ...
```

### 13.2 Capability 系统

**CapabilityRegistry** — 独立于 AgentRegistry：

```
注册: CapabilityRegistry.register({ id, displayName, description, promptHint, schema, executor, constraints })
查询: CapabilityRegistry.get(id) / list() / listEnabled()
开关: CapabilityRegistry.setEnabled(id, true/false)
```

**Executor 边界：** 畸形意图或非字符串 `type` 会被跳过；有效意图按精确 Capability ID、Schema alias、最后才是 ID 子串的顺序解析，禁用项不进入计划。Schema 数字参数只接受有限数字或可转换的非空数字字符串，并在执行前应用默认值、范围截断和枚举回退。传给 Capability 的嵌套参数与 Schema 默认值均为隔离副本，Capability 的修改不会污染 LLM policy 或后续执行。`immediate`、`deferred`、`round_end` 是唯一调度模式；未知值记录警告并回退为立即执行。blocking 与 non-blocking 都在每项完成后调用并隔离 `onExecuted`，non-blocking 的 `completion` 在 Capability 与异步回调均完成后结算。

---

### 13.3 Critique 模块边界

Critique 按数据契约、解析、持久化、LLM 副作用和自动调度拆分。`critique-system.js` 只编排这些边界并向 UI、Provider 和入口提供稳定 API。

| 模块 | 唯一职责 |
|------|----------|
| `critique-validation.js` | 校验核心容器、角色条目和 JSON 兼容值，并供 LLM 与导入文件共用 |
| `critique-parser.js` | 从 Markdown/杂乱输出提取平衡 JSON，清理尾随逗号并交给 validator |
| `critique-repository.js` | 维护单一活动记录、basedOn 回退、裁剪和失败回滚 |
| `critique-execution.js` | 共享运行锁、调用 LLM，并在成功或异常后清理静默 Prompt |
| `critique-auto-coordinator.js` | 计算 first-enable、interval、rollback 动作并事务化 checkpoint |
| `ui/sections/critique.js` | DOM、按钮状态和反馈；结果编辑必须调用系统门面 |

生成请求捕获开始时的 chat 与 metadata 引用。请求结束时若会话已切换，结果以 `StaleExecutionError` 拒绝，不写入新会话。导入导出复用相同 validator，CRUD 保存失败时恢复内存状态。

Critique 仓库的 add/update/revert/reset/prune 保存失败时，仅按条目身份与字段版本撤销本次仍有效的写入；并发完成的较新修改不得被旧回滚覆盖。自动计数器同样按 checkpoint 版本回滚。自动执行在 `beforeExecute`、生成和计数器保存后检查会话引用；生成与重新生成在结果保存后再检查一次。若保存已成功但随后发现切换，会报告 stale，不撤销旧会话中已保存的结果；结果保存与自动计数器保存是两个独立步骤。

导入的 Critique 与实时评语历史独立存储。导入记录的新增失败时按条目身份移除，更新失败时仅回滚本操作仍持有的字段，删除失败时参照仍存在的相邻条目恢复顺序；保存完成后检查 metadata 所属会话，切换时报告 `StaleExecutionError`，不把旧会话结果写进新会话。导出下载无论成功或异常都清理临时节点与 Blob URL；UI 对导入、删除、启用和导出失败显示错误而不显示成功提示。

---

## 14. Custom Agent — 用户自定义 LLM Agent

用户自定义的轻量 LLM Agent，每 N 轮自动触发或手动执行。用户写 prompt + 可选 JSON schema，结果通过 `{{providerName}}` Provider 暴露给 DSL 消费。

### 14.1 设计要点

- **薄入口编排** — `index.js` 只消费纯调度动作；执行、计数器和持久化由系统层负责
- **共用一个 API 配置** — `agentConfigs['custom-agent']`，不按实例拆分
- **每个实例独立计数器** — `_autoCAG_{id}` 在 chat_metadata，互不影响
- **排序** — 用户填 order 数字，按升序串行执行
- **Provider 动态注册** — `providerName` 字段 → `{{providerName}}` → DSL 查询
- **禁用 = Provider 停用** — enabled=false 时 render() 返回 ''
- **数据不主动清理** — 删实例时 Provider 反注册，数据静默留在 chat_metadata
- **单一写入口** — UI 不直接修改设置或聊天结果；CRUD、导入、编辑结果均走 `customAgentSystem`，并等待保存成功后才刷新和提示成功
- **配置事务** — CRUD 与导入串行提交、等待 `saveSettings`；失败时补偿本次列表和 Provider 变更，不覆盖保存等待期间的无关字段编辑
- **执行隔离** — 同一实例并发请求合并，全局按 order 串行；聊天切换、删消息或配置变化会使旧结果失效，包括聊天保存等待期间发生的切换
- **事务提交** — 自动执行的结果和 `_autoCAG_{id}` checkpoint 一次保存；保存失败时分别按结果/计数器版本回滚本次仍拥有的写入，不抹掉较新的编辑

### 14.2 数据模型

settings:
```js
customAgents: [
  {
    id: 'ca_xxx',
    name: '派系追踪',
    providerName: 'factionTracker',
    prompt: '分析最近消息...',
    schema: '',     // 可选 JSON schema，留空不解析
    enabled: false,
    autoEnabled: false,
    autoInterval: 10,
    order: 1,
  }
]
```

chat_metadata 存储：
```js
chat_metadata[EXT_KEY]._caData = {
  'ca_xxx': {
    rangeEnd: 42,
    content: 'raw LLM output',
    data: { ... },  // 解析后的 JSON（如果有 schema）
    timestamp: ...,
  }
}
```

### 14.3 自动触发

在 GROUP_WRAPPER_FINISHED 中，Critique 之后执行。`custom-agent-auto-coordinator.js` 以纯函数按 order 生成 `execute`、`checkpoint`、`reset` 动作，入口只负责逐项消费。

每个实例独立的 checkpoint 存为 `chat_metadata[EXT_KEY]._autoCAG_{id}`，三路分支（first-enable / deletion / normal）复用 Summary/Critique 同一模式。

### 14.4 模块边界

| 模块 | 唯一职责 |
|------|----------|
| `custom-agent-validation.js` | 字段、Schema、ID/providerName 唯一性和外部导入禁用策略 |
| `custom-agent-system.js` | 候选副本校验后提交、Provider 注册/回滚、导入冲突和结果编辑 |
| `custom-agent-execution.js` | 请求快照、串行队列、同 ID 去重、stale 判定与聊天保存事务 |
| `custom-agent-auto-coordinator.js` | 无副作用地计算自动触发动作 |
| `ui/sections/customAgents.js` | DOM 渲染、事件采集和用户反馈，不拥有业务状态 |

配置档导入复用同一 validator，外部 ID 会替换且 Agent 默认禁用；配置档应用先在副本中验证 Provider 冲突，失败时恢复设置和注册表。

### 14.5 Provider 渲染

Provider render 闭包捕获 `instance.id`，每次调用检查 `settings.customAgents.find(a => a.id === capturedId && a.enabled)` 确认实例还存在且已启用。不存在或禁用时返回 `''`。

---

## 15. 导出/导入系统

Group World 为五种数据类型提供完整的导出/导入能力：

| | Profile | NPC | Summary | Memory | Config |
|------|------|------|------|------|------|
| 粒度 | 逐角色 | 逐条 | 一键 | 逐角色 | 按抽屉 |
| 格式 | `.json` | `.json` | `.json` | `.json` | `.zip` |
| 存储 | chat_metadata | chat_metadata | 独立 key | chat_metadata | extension_settings |

### Summary 导出/导入边界

导入文件必须校验根对象、版本、摘要对象及内容字段，不能只检查外层容器；旧聊天中畸形的导入条目在列表和 Provider 渲染时跳过。更新导入摘要只接受 `name`、`content`、`enabled`，内部 ID 不允许由调用方覆盖。新增、更新、删除均等待聊天保存；失败时按条目身份、字段版本和仍存在的相邻条目补偿，尽量保留等待期间的较新修改。保存完成后若会话引用已切换，报告 stale，不改写新聊天；已成功保存的旧聊天结果不再撤销。导出下载在异常路径也清理临时节点和 Blob URL，UI 对异步失败显示错误而非成功提示。

### Chat Summary 持久化事务边界

上下文总结正文与上面的“导入摘要”属于不同存储集合。生成、重新生成、正文编辑、回退、重置、裁剪和清空统一由 `chat-summary-system.js` 串行写入，并绑定操作开始时的 `chat_metadata`；UI 只能调用系统门面，不能直接修改摘要数组或自行保存。扫描列表的编号只在当前视图有效，裁剪或清空等待持久化期间必须锁定编号相关编辑；无论操作成功、明确失败并回滚，还是以 `persistenceUnknown` 保留当前内存结束，都必须先按实时仓库重建扫描内容和编号，再解除编辑锁，避免旧编号映射到压缩后的数组。由于宿主 `saveChatConditional()` 会吞掉内部保存失败，生产入口通过 `chat-metadata-save-confirmation.js` 回读操作开始时的群聊或角色聊天头，仅在已提交摘要状态或同次保存带入的当前并发状态可见时确认成功。明确回读不一致时按条目身份或字段应用值只补偿本次仍拥有的变更，保留并发新增、编辑及顺序；无法安全补偿时通过 `rollbackIncomplete` 明确报告。回读接口失败属于 `persistenceUnknown`，保留可能已落盘的内存状态而不执行破坏性补偿。保存成功后切换聊天则报告 `StaleExecutionError`，不撤销旧聊天已保存状态。公开读取返回隔离副本，调用方不能通过查询接口绕过事务修改实时仓库。

### 全局配置导出/导入 (Config Profile System)

**存储**：`settings.configProfiles = [{ id, name, description, drawers, settings }]`

**导出格式**：`.zip` = `manifest.json` + 可选的 `user-providers/*.js` + `user-capabilities/*.js`

**导入与应用边界**：JSON、ZIP 和内置预设共用 `config-profile-validation.js`，统一校验根对象、版本、settings/drawers/variables 结构及 Prompt、Provider、Capability 数组元素。JSON 导入会剥离 `agentConfigs` 和仅含名称的 Provider/Capability 桩；ZIP 可从匹配的 `.js` 文件恢复源码。应用配置档时先在 settings 副本上完成默认值合并和 Prompt 冲突处理，再导入变量并一次性提交；等待变量持久化期间发生的无关 settings 编辑会在提交时重放。后续 settings 提交失败时，通过变量导入事务执行三方补偿，保留同一变量上的并发更新。保存、删除、JSON/ZIP 导入和预设加载只有在持久化成功后才保留列表变更；失败时 UI 显示错误且不执行成功刷新。工具抽屉的应用处理器会在整个异步成功路径中保留 Prompt 合并模式，使刷新完成后仍可安全生成 `keep`/`skip` 结果提示。

**JSZip 加载**：使用 `ensureJSZip()` 含 script 标签 fallback — 先尝试 `import()`，失败后注入 `<script>` 标签加载，兼容非模块环境。

**变量事务会话边界**：导入及后续补偿绑定原聊天和变量仓库引用，不得改写切换后的聊天。只有保存真正失败才回滚内存；保存成功后发现会话切换则报告 stale，同时保留旧聊天已保存的值，避免内存与持久层分叉。

**UI 位置**：
- 仪表盘：配置档下拉框（内置 + 用户，optgroup 分组）+ 应用按钮 + 导入按钮
- 工具抽屉 → 配置档卡片：完整的管理面板（保存/导出/删除/预设加载）

### 可复用库（Profile / NPC / Story Blueprint Library）

三类库提供与上述导出/导入同源但独立持久化的"可复用包"：把当前群组数据存为命名的库条目（存 `extension_settings`，不随聊天导出），可跨群聊应用。库条目复用各自的 export payload，仅加 `libraryMeta`（名称/描述/时间戳/计数）。

| 库 | 入口卡片 | 存储字段 | 自动加载 |
|---|---|---|---|
| Profile Library | 角色抽屉 → 角色档案卡片 | `profileLibraries` + `profileLibraryAutoLoad` | 支持（best/fixed，APP_READY 与 CHAT_CHANGED 触发） |
| NPC Library | 角色抽屉 → NPC 生成卡片 | `npcLibraries` | 无 |
| Story Blueprint Library | 连续性抽屉 → 故事蓝图卡片 | `storyBlueprintLibraries` | 无 |

NPC Library 的保存、删除和文件导入必须等待注入的设置保存适配器；失败时按条目身份或仍存在的相邻条目补偿，保留等待期间其他库条目的修改。生产适配器直接调用宿主 `saveSettings()`，并要求收到成功保存后发出的 `SETTINGS_UPDATED` 事件；防抖包装函数不提供完成结果，宿主直接保存也会吞掉请求错误，因此不能只等待其 Promise。事件没有请求 ID，极端并发宿主保存仍无法严格归因。旧设置中的畸形条目不阻断有效条目展示；无效导出数据直接报错，下载异常也清理临时节点和 Blob URL。专用卡片与仪表盘删除入口均等待操作，失败时刷新回滚状态且不提示成功。库的“应用”和独立文件导入共用 `npc-export-system.applyImport()`。

Profile 与 Story Blueprint Library 使用同一个已确认设置保存适配器和串行写入原则。Profile 自动加载开关由系统层字段事务管理，`getAutoLoadSettings()` 只返回快照，UI 不直接改写设置对象；蓝图库应用由 Story Blueprint System 独占聊天保存和并发安全补偿，避免内部未等待保存与外层重复保存。

**NPC 导入应用事务：** 先改当前聊天的 NPC 列表并等待 `saveChatConditional()`；失败时只对本次新增/覆盖的条目做三方补偿，保留其他 NPC 和同一 NPC 的并发字段编辑。聊天保存成功后若已切换会话，报告 stale，不回滚已保存的旧会话，也不应用全局 Prompt。可选 Prompt 在聊天保存成功后才写入并等待 `saveSettings()` 的可观察结果；若该回调失败，则恢复本次仍拥有的 Prompt 值，并尝试将 NPC 补偿再次保存。跨聊天元数据与插件设置的操作不是原子提交：补偿保存失败、会话切换或同一新增 NPC 被并发编辑时会明确报告补偿可能不完整，而不伪称全部回滚。生产环境的 `saveSettings()` 只调度防抖保存，因此等待它不能证明后续磁盘写入成功。

**NPC 系统写入边界：** 生成、手动编辑和删除先更新原聊天的 NPC 列表，必须等待 `saveChatConditional()` 后才返回成功。保存失败时，生成只移除本次仍未被编辑的新增项，编辑按字段及同实例写入版本补偿，删除按仍存活的相邻 NPC 恢复顺序；其他 NPC 和后续同值编辑不得被旧操作抹掉。并发修改使补偿无法完整完成时抛出明确错误。保存成功后切换聊天报告 stale，但不撤销旧聊天已保存的值。生成返回实际入库的 NPC，而不是被去重或容量限制排除的原始模型输出。NPC 编辑/删除 UI 等待系统 Promise，失败不提示成功或刷新仪表盘。角色卡创建后的远端副作用及导入跟踪仍由独立边界处理。

库条目是内容数据，被 `config-profile-system` 的 `INTENTIONALLY_UNCOVERED_KEYS` 显式排除，不随配置档保存/还原。详见 3.6 节。

---

## 16. 自定义 Prompt 模板

用户创建自定义占位符，自动注册为 `{{name}}` Provider。

**存储**：`settings.customPrompts = [{ id, name, content, dataJson, scope, enabled }]`

**命名规则**：仅限 `\w+`，自动检测与内置 Provider 的命名冲突。

**两级控制**：总开关 `customPromptsEnabled` + 每条独立 `enabled`。

**边界与事务**：`custom-prompt-validation.js` 是 CRUD、独立导入和配置档导入共享的结构契约。批量导入在修改列表前先校验所有名称与 Provider/占位符冲突，后续条目非法不能留下前面条目的部分导入。所有变更在系统层串行执行并等待 `saveSettings`；失败时只补偿本操作仍未被并发改写的字段。Provider 使用稳定 Owner/条目 ID 注册，热重载通过已管理台账清理配置档中已移除的旧占位符，禁止跨模块覆盖或删除同名 Provider。

---

## 17. 资产管理 & 用户导入

### AssetLoader

统一加载 `assets/` 下的扩展模块。每个子目录有 `manifest.js` → AssetLoader 动态 `import()` + `register(deps)`。

### 用户导入系统

选 `.js` → FileReader → 存 `extension_settings` → Blob URL → `import(url)` → `register(deps)`。重启自动恢复。核心 API 通过 `register(deps)` 参数或 `window.GroupDirector` 全局注入。模块求值和异步 `register()` 均有 10 秒生命周期上限；完成、失败或超时后关闭本次注册令牌，迟到的 Provider/Capability 写入会被拒绝，已产生的同 Owner 注册则按操作回滚。

---

## 18. 失败回退

- Agent 调用失败 → managedCall 重试 `retries` 次 → 复用历史 → 阻塞轮次
- 用户主动暂停 → `generationStopped` 标记 → 静默切断
- `selected_group` 为空 → 透明放行
- `type` 为 `quiet` / `impersonate` / `continue` → 不拦截
- Takeover 中途失败 → `takeoverFailed = true`，下次重试复用
- JSZip 加载失败 → `import()` 失败 → script 标签注入 → 10 秒超时抛错

### 18.1 异步生成一致性

Summary、Critique、Memory、NPC、Profile、Story Blueprint 和 Custom Agent 的异步结果都必须在系统层完成“捕获 → 等待 → 校验 → 提交”，UI 不得直接接管提交逻辑。

- `systems/execution-snapshot.js` 捕获当前 `chat_metadata` 引用、聊天数组引用、聊天内容序列化值和业务资源快照。
- 每个可能让控制权交还事件循环的 LLM/渲染等待之后、持久化之前，都要调用 `assertExecutionSnapshot()`；切换聊天、原地追加/编辑消息、手动编辑结果、回退或重置都会使旧请求以 `StaleExecutionError` 结束。
- 业务资源只序列化会影响当前请求输入或输出归属的字段；保存失败时仅在没有更新版本覆盖的情况下回滚。
- 不可逆外部副作用不能套用普通 stale 回滚。NPC 角色卡导入在 POST 前做最终快照校验，POST 成功后按稳定 `importId` 协调当前 NPC；若角色已创建但跟踪状态持久化失败，则抛出带 `avatarName` 的 `NpcImportTrackingError`，UI 以“部分成功”提示处理，并保留内存收据供后续保存刷新。

---

## 19. 开发速查

| 任务 | 改哪些文件 |
|------|-----------|
| 加新 Agent | `agents/xxx.js`（新建）+ `index.js` register + UI 自动生成 |
| 改 Agent 行为 | `agents/xxx.js` → pipeline 对应阶段方法 |
| 加新协议 | `utils/custom-api.js` → 加 `makeXxxCaller()` |
| 加 Prompt 占位符 | `assets/providers/xxx.js` + manifest.js + `index.js` import/register |
| 加业务逻辑模块 | `systems/*.js`（新建）+ `index.js` import/组装 |
| 加变量定义 | UI 变量卡片 → 新建/模板；或 `variableSystem.upsertDefinition()` |
| 加设置项 | `settings.js` + `settings.html` + `ui/sections/*.js` |
| 加/改 UI 区域 | `settings.html` + `ui/sections/newname.js` + `ui/settings-init.js` import |
| 加 UI 文字 | `ui/i18n.js`（zh+en 各一行） |
| 改仪表盘 | `ui/sections/dashboard.js` |
| 改渲染引擎 | `prompt-renderer.js` |
| 改 LLM 响应解析 | `utils/json-utils.js` |
| 加脚本执行器触发点 | `systems/script-executor-system.js` + hook 注册点 in `index.js` |
| 改脚本执行器 UI | `ui/sections/scriptExecutors.js` |
| 加新 Capability | `assets/capabilities/xxx.js` + manifest 加一行 |
| 用户导入扩展 | 工具 → 用户扩展 → 选 `.js` 文件 |
| 改拦截器事件接线 | `index.js` → `groupDirector_Interceptor` / wrapper 事件监听 |
| 改 takeover 状态规则 | 优先修改 `round-state.js` / `takeover-scheduler.js` / `round-finalization.js`，由 `round-orchestrator.js` 组合 |
| 加静态检查器 | 新建 `tools/gd-test/checks/*.check.mjs` + 对应 unit test；无需修改 CLI/runner |
| 加行为测试 | 按业务所有权放入 `tests/{unit,regression,integration,contract}`；遵循 `tests/README.md`，无需修改 CLI/runner |

### 19.1 GD Test Lab 模块边界

- `core/project-index.mjs` 只建立文件、源码、JSON、import graph 和可达性等事实，不产生规则结论。
- `checks/*.check.mjs` 一个文件一个规则域，自动发现，彼此不调用。
- `core/check-runner.mjs` 只负责契约校验、稳定排序、Worker 硬隔离和结果聚合；checker 的加载与执行均不进入主线程，超时会等待 `worker.terminate()` 后再继续。
- `core/test-runner.mjs` 只负责调用 Node `node:test`；行为测试继续由 `tests/**/*.test.js` / `tests/**/*.test.mjs` 自动发现。
- `reporters/*` 只消费结构化结果；CLI 只负责接线和退出码。
- Checker v1 的完整开发标准见 `tools/gd-test/checks/README.md`。
- Behavior Test v1 的目录职责、命名、并发隔离、回归契约和规模门槛见 `tests/README.md`。

---

## 20. 开发规范

### Agent 规范

```
1. 必须声明 contextAccess  — 只访问声明的 pool key。Proxy 强制约束。
2. 必须声明 pipelineOrder — 不在其中的阶段不执行，天然可选。
3. pipeline.call = null    — 由 Runtime managedCall 统一治理。
4. Agent 不碰网络         — 只接收 caller.generate()，协议细节完全隔离。
5. 新增 Agent 只需三步    — agents/xxx.js → index.js register → 自动 UI。
```

### Context Pool 规范

```
1. buildContextPool 的 getter 名 = contextAccess 声明 key。
2. Agent 特有数据通过 overrides 传入 → pool 必须注册对应 getter。
3. 忘了注册 pool getter → Agent 拿到 undefined → 静默失败。
4. 可变值用 getter 闭包传递，不直接引用。
```

### renderPrompt 调用规范

```
1. 数据替换必须在 renderPrompt 之前或通过 locals，严禁事后 {{...}} 字符串替换。
2. 递归渲染会二次扫描替换后的文本——若替换内容包含 {{...}} 会被清除。
3. 包含用户数据的文本 → 用 locals 注入 + recursive: false。
```

---

## 21. 踩坑记录

| 坑 | 原因 | 教训 |
|----|------|------|
| CJK `\b` 永远匹配不到中文名 | JS 正则 `\b` 对 CJK 字符无单词边界 | `indexOf` 循环子串匹配 |
| `{{...}}` 两套系统冲突 | renderPrompt Phase 2 把 Agent locals 当未注册 Provider 清除 | 添加 `locals` 机制 |
| Director history 存 avatars 混 names | 两条保存路径格式不一致 | 统一使用 names 存储 |
| i18n 文件多个 `en:` 键 | 多次追加导致重复对象键，最后一个覆盖前面全部 | 合并为单一 zh + 单一 en 块 |
| `cp` 不覆盖已有文件 | 部分环境 `cp` 静默跳过同内容文件 | `rm -f` 后 `cp` |
| JSZip `import()` 失败 | 非模块 JS 文件无法通过 `import()` 加载 | script 标签注入 fallback |
| 配置档下拉不同步 | 仪表盘和卡片共用同一个 ID，两套代码互相覆盖 | 分用两个 ID，`refreshPresetSelector()` 同时更新 |
| 工厂捕获 `characters` 数组 | SillyTavern 可能替换整个数组，闭包继续读取旧引用 | 注入 `getCharacters()`，在使用点读取实时值 |
| 编辑器复用展示摘要 | 展示文本混入标签、动机和 HTML，保存后污染原始数据 | 编辑值与展示 formatter 分离 |
| 只校验导入数组容器 | `entries: [null]` 等畸形元素在后续字段读取时抛错 | 在解析边界同时校验容器和每个元素 |
| 只比较聊天数组引用 | SillyTavern 会在同一数组上原地追加或编辑消息，引用不变但提示词输入已变 | 快照同时保存数组引用和序列化内容 |
| 远端成功后继续按 stale 回滚 | POST 已创建角色卡，本地再抛普通失效错误会把真实成功伪装成失败 | 外部副作用前校验；成功后用稳定 ID 协调，并显式报告部分成功 |

---

## 22. 安全说明

### 22.1 用户代码信任模型

Group World 允许用户导入和编写自定义代码（用户 Provider、用户 Capability、脚本执行器）。这些代码运行在 SillyTavern 的页面上下文中，拥有与 SillyTavern 本身相同的权限——包括访问 localStorage、发送 HTTP 请求、操作 DOM。

**设计决策**：系统信任用户自己编写的代码，但对外部导入（他人分享的配置档、脚本执行器包）采取防御性措施。

### 22.2 防御措施

| 层面 | 措施 | 说明 |
|------|------|------|
| 用户 Provider/Capability 导入 | 静态扫描 `DANGEROUS_PATTERNS` | 检测 `eval`、`Function`、`fetch`、`XMLHttpRequest`、`WebSocket`、`import(` 等危险 API，匹配后展示红色安全警告 |
| 用户 Provider/Capability 导入 | GUI 安全警告条 | 导入时在文件列表上方的醒目位置展示检测到的危险 API |
| 用户 Provider/Capability 生命周期 | 所有权隔离 | 导入项按文件名标记所有权；拒绝覆盖内置或其他导入项的 ID，删除和失败回滚也只能移除自身注册项 |
| 用户 Provider/Capability 生命周期 | 异步事务与恢复对账 | 等待异步 `register()` 和设置保存；失败时按本次变更补偿。启动/热重载会刷新实际 ID，并清理已从设置移除的旧注册项 |
| 脚本执行器导入 | GUI 安全警告条 | 同样展示检测到的危险 API |
| 配置档导入 | 确认弹窗 | 导入配置档会同时导入 userProviders、userCapabilities，点击导入按钮时弹出 ST 原生确认框提醒用户检查 |
| 配置档导出 | API Key 剥离 | `agentConfigs` 中的 `apiKey` 在导出时自动清空 |
| 配置档导入 | API Key 剥离 | `agentConfigs` 在导入时被丢弃，防止端点劫持 |
| 自定义 Agent 导入 | 字段白名单与 ID 归一化 | 忽略外部 ID，限制数值范围，导入后默认禁用，并避免把 ID 拼入 jQuery 选择器 |
| 记忆导入 | 嵌套结构校验 | 校验角色对象、名称、`entries` 数组及每个条目，畸形数据返回结构化错误 |
| Execution Trace | 输出转义 | stage 摘要和对象键在插入 DOM 前进行 HTML 转义 |
| 脚本执行器 | 执行超时 | decision 脚本 10 秒、message/round 脚本 5 秒超时；超时后跳过继续执行，但不会取消脚本自身的异步副作用 |
| 脚本执行器 | 异常隔离 | 单个脚本异常不影响其他脚本和导演流程 |

### 22.3 破坏性操作确认

所有破坏性操作均使用 ST 原生 `callGenericPopup` + `POPUP_TYPE.CONFIRM` 弹窗确认，不再使用浏览器原生 `confirm()`：

- 上下文总结：重置、导入、手动生成
- 角色记忆：重置、提取、压缩、删除、回退
- 配置档：导入
- 脚本执行器：导入
- 自定义 Prompt：导入
- 仪表盘：重置
- 用户 Provider：删除
- 导演账本：清除
- NPC：重置、删除
- 档案：全部重新生成

### 22.4 静态代码扫描规则

`systems/user-provider-loader.js` 中定义的 `DANGEROUS_PATTERNS` 正则数组：

```js
const DANGEROUS_PATTERNS = [
    /\beval\s*\(/,
    /\bnew\s+Function\s*\(/,
    /\bfetch\s*\(/,
    /\bXMLHttpRequest\b/,
    /\bWebSocket\b/,
    /\bimport\s*\(/,
    /\bdocument\.cookie\b/,
    /\blocalStorage\b/,
    /\bsessionStorage\b/,
    /\bindexedDB\b/,
];
```

注意：`fetch` 被标记为危险并非完全禁止使用，而是提醒用户该代码会发起外部网络请求。脚本执行器中同样使用此规则扫描。`localStorage` / `sessionStorage` / `indexedDB` 也被标记以提醒用户代码可能读写持久化数据。
