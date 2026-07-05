# Group World — 设计文档

## 1. 概述

Group World 是一个 **群聊上下文管线**：收集数据 → Agent 决策 → 注入角色 prompt。

默认搭载 9 组 Agent：Director（导演）、ForceSpeak（强制发言）、Profile（角色档案）、Summary（上下文总结）、NPC（NPC 生成）、Memory（角色记忆）、PostSpeech（多模态策略）、Critique（批判）、Custom Agent（用户自定义 —— 不注册为 Agent，直接通过 system 调用 LLM）。前 8 个 Agent 拥有独立的 API 配置，Custom Agent 共用 `custom-agent` API 配置。

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

### 3.2 已注册 Provider（33 个内置 + N 个自定义 Agent 动态注册）

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
| `worldBooks` | `{{worldBooks}}` | 激活世界书清单 |
| `worldBookImportance` | `{{worldBookImportance}}` | 条目重要性排名 |
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

### 3.3 编码规则

- Provider 有开关时在 `render()` 内返回空字符串，不用 `enabled` 跳过
- 可变值用 getter 传入
- `settings.js` 是唯一默认值来源

---

## 4. 模板渲染引擎（prompt-renderer.js）

### 4.1 五阶段管线

```
Phase 0   — {[{...}]} 直通槽位 → 哨兵替换
Phase 1   — 执行所有 Provider，缓存到 cache[id] = { content, data }
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

### 9.5 配置档同步

仪表盘和工具抽屉各有一个配置档下拉框（`#gd-dash-cfg-preset` 和 `#gd-cfg-preset`），通过 `refreshPresetSelector()` 同时更新。选项以 `<optgroup>` 分组：
- **内置配置档**：从 `getConfigPresetNames()` 读取，选择后需先 `loadConfigPreset` 再 `applyProfile`
- **我的配置档**：从 `configProfileSystem.getProfiles()` 读取，value 前缀 `__prof__:id`，选择后直接 `applyProfile`

保存/删除/导入操作后自动刷新两个下拉框和配置档列表。

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
│   │   └── group-director-default.json
│   ├── providers/             # 29 个内置 Provider
│   │   ├── manifest.js
│   │   ├── chatSummary.js
│   │   ├── director-critique.js
│   │   ├── character-critique.js
│   │   ├── char-critique.js
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
│   ├── capability-registry.js # CapabilityRegistry（多模态能力注册）
│   ├── executor.js            # PostSpeech Executor (resolve→schedule→execute)
│   ├── history-system.js      # 导演账本 CRUD
│   ├── world-info-system.js   # ST checkWorldInfo() 封装
│   ├── asset-loader.js        # 动态导入 + 注册 assets/ 模块
│   ├── user-provider-loader.js # 用户 Provider/Capability 导入
│   ├── profile-system.js      # 角色档案全流程
│   ├── profile-export-system.js
│   ├── npc-system.js          # NPC 生成 + 导入角色卡
│   ├── npc-export-system.js
│   ├── memory-system.js       # 角色记忆全流程
│   ├── memory-export-system.js
│   ├── post-speech-system.js  # PostSpeech 决策持久化
│   ├── config-profile-system.js # 配置档管理（含 JSZip fallback 加载）
│   ├── custom-prompts-system.js # 自定义 Prompt 模板
│   ├── world-book-scanner.js  # 世界书扫描
│   ├── chat-summary-system.js # 上下文总结
│   ├── critique-system.js     # AI 批判
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
        ├── ledger.js          # 账本浏览器
        ├── forceSpeak.js      # 强制发言
        ├── chatSummary.js     # 上下文总结
        ├── critique.js        # AI 批判
        ├── summaryExport.js   # 摘要导出/导入
        ├── templateTester.js  # 模板测试器
        ├── profile.js         # 角色档案
        ├── profileExport.js   # 角色档案导出/导入
        ├── npc.js             # NPC 生成
        ├── npcExport.js       # NPC 导出/导入
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
│  脚本可直接修改 ctx.decision (live reference)          │
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
| `decision` | Director 决策后 | 阻塞 await 全部, 10s 超时 | `ctx.decision` (live, 可修改) |
| `both` | message + round | 同各自模式 | 对应阶段字段 |
| `all` | 全部三个 | 同各自模式 | 对应阶段字段 |

### 12.3 ctx 分形

三个阶段的 `ctx` 形状不同，按阶段提供对应字段：

| 字段 | decision | message | round |
|------|:---:|:---:|:---:|
| `ctx.params` | ✓ | ✓ | ✓ |
| `ctx.shared` (turnShared) | ✓ | ✓ | ✓ |
| `ctx.decision` (live) | ✓ | - | - |
| `ctx.decisionSnapshot` (read-only) | - | ✓ | ✓ |
| `ctx.message` | - | ✓ | - |
| `ctx.character` | - | ✓ | - |
| `ctx.chat` | ✓ | ✓ | ✓ |
| `ctx.characters` | ✓ | ✓ | ✓ |
| `ctx.group` | ✓ | ✓ | ✓ |
| `ctx.settings` | ✓ | ✓ | ✓ |
| `ctx.getContext` | ✓ | ✓ | ✓ |

### 12.4 共享状态 (turnShared)

模块闭包变量，不持久化到 settings：

- **创建**：`GROUP_WRAPPER_STARTED` 时 `resetTurnShared()` 重置为 `{}`
- **写入**：脚本设置 `returnMode: 'shared'` 且返回 object → `Object.assign(turnShared, result)`
- **读取**：所有脚本通过 `ctx.shared` 读取当前快照
- **生命周期**：decision → message → round 贯穿，下轮重置

decision 阶段完成后，`decisionSnapshot = { decision: deepClone, shared: {...turnShared} }` 供 message/round 脚本只读。

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
    成功 + returnMode='shared' → Object.assign(turnShared, result)
    超时/异常 → trace 记录 → 继续下一个
```

- **decision**：阻塞，await 全部完成后返回 snapshot
- **message/round**：fire-and-forget，不阻塞角色生成
- 执行追踪通过 `AgentTrace` 记录每阶段耗时和状态

### 12.7 导入/导出

导出格式：`{ version: 1, type: 'script-executor-export', exportedAt, executors: [...], migrations: [] }`

导入时同名弹窗确认是否覆盖。配置档管理 (Config Profile) 同步包含 scriptExecutors。

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

---

---

## 14. Custom Agent — 用户自定义 LLM Agent

用户自定义的轻量 LLM Agent，每 N 轮自动触发或手动执行。用户写 prompt + 可选 JSON schema，结果通过 `{{providerName}}` Provider 暴露给 DSL 消费。

### 14.1 设计要点

- **不自创编排** — 每个实例跑在 GROUP_WRAPPER_FINISHED，不依赖其他系统
- **共用一个 API 配置** — `agentConfigs['custom-agent']`，不按实例拆分
- **每个实例独立计数器** — `_autoCAG_{id}` 在 chat_metadata，互不影响
- **排序** — 用户填 order 数字，按升序串行执行
- **Provider 动态注册** — `providerName` 字段 → `{{providerName}}` → DSL 查询
- **禁用 = Provider 停用** — enabled=false 时 render() 返回 ''
- **数据不主动清理** — 删实例时 Provider 反注册，数据静默留在 chat_metadata

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

在 GROUP_WRAPPER_FINISHED 中，Critique 之后执行。按 order 排序，逐实例检查 `chat.length - checkpoint >= interval`，满足则调用 `customAgentSystem.execute()`。

每个实例独立的 checkpoint 存为 `chat_metadata[EXT_KEY]._autoCAG_{id}`，三路分支（first-enable / deletion / normal）复用 Summary/Critique 同一模式。

### 14.4 Provider 渲染

Provider render 闭包捕获 `instance.id`，每次调用检查 `settings.customAgents.find(a => a.id === capturedId && a.enabled)` 确认实例还存在且已启用。不存在或禁用时返回 `''`。

---

## 15. 导出/导入系统

Group World 为五种数据类型提供完整的导出/导入能力：

| | Profile | NPC | Summary | Memory | Config |
|------|------|------|------|------|------|
| 粒度 | 逐角色 | 逐条 | 一键 | 逐角色 | 按抽屉 |
| 格式 | `.json` | `.json` | `.json` | `.json` | `.zip` |
| 存储 | chat_metadata | chat_metadata | 独立 key | chat_metadata | extension_settings |

### 全局配置导出/导入 (Config Profile System)

**存储**：`settings.configProfiles = [{ id, name, description, drawers, settings }]`

**导出格式**：`.zip` = `manifest.json` + 可选的 `user-providers/*.js` + `user-capabilities/*.js`

**JSZip 加载**：使用 `ensureJSZip()` 含 script 标签 fallback — 先尝试 `import()`，失败后注入 `<script>` 标签加载，兼容非模块环境。

**UI 位置**：
- 仪表盘：配置档下拉框（内置 + 用户，optgroup 分组）+ 应用按钮 + 导入按钮
- 工具抽屉 → 配置档卡片：完整的管理面板（保存/导出/删除/预设加载）

---

## 16. 自定义 Prompt 模板

用户创建自定义占位符，自动注册为 `{{name}}` Provider。

**存储**：`settings.customPrompts = [{ id, name, content, enabled }]`

**命名规则**：仅限 `\w+`，自动检测与内置 Provider 的命名冲突。

**两级控制**：总开关 `customPromptsEnabled` + 每条独立 `enabled`。

---

## 17. 资产管理 & 用户导入

### AssetLoader

统一加载 `assets/` 下的扩展模块。每个子目录有 `manifest.js` → AssetLoader 动态 `import()` + `register(deps)`。

### 用户导入系统

选 `.js` → FileReader → 存 `extension_settings` → Blob URL → `import(url)` → `register(deps)`。重启自动恢复。核心 API 通过 `register(deps)` 参数或 `window.GroupWorld` 全局注入。

---

## 18. 失败回退

- Agent 调用失败 → managedCall 重试 `retries` 次 → 复用历史 → 阻塞轮次
- 用户主动暂停 → `generationStopped` 标记 → 静默切断
- `selected_group` 为空 → 透明放行
- `type` 为 `quiet` / `impersonate` / `continue` → 不拦截
- Takeover 中途失败 → `takeoverFailed = true`，下次重试复用
- JSZip 加载失败 → `import()` 失败 → script 标签注入 → 10 秒超时抛错

---

## 19. 开发速查

| 任务 | 改哪些文件 |
|------|-----------|
| 加新 Agent | `agents/xxx.js`（新建）+ `index.js` register + UI 自动生成 |
| 改 Agent 行为 | `agents/xxx.js` → pipeline 对应阶段方法 |
| 加新协议 | `utils/custom-api.js` → 加 `makeXxxCaller()` |
| 加 Prompt 占位符 | `assets/providers/xxx.js` + manifest.js + `index.js` import/register |
| 加业务逻辑模块 | `systems/*.js`（新建）+ `index.js` import/组装 |
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
| 改拦截器行为 | `index.js` → `groupDirector_Interceptor` |

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

---

## 22. 安全说明

### 21.1 用户代码信任模型

Group World 允许用户导入和编写自定义代码（用户 Provider、用户 Capability、脚本执行器）。这些代码运行在 SillyTavern 的页面上下文中，拥有与 SillyTavern 本身相同的权限——包括访问 localStorage、发送 HTTP 请求、操作 DOM。

**设计决策**：系统信任用户自己编写的代码，但对外部导入（他人分享的配置档、脚本执行器包）采取防御性措施。

### 21.2 防御措施

| 层面 | 措施 | 说明 |
|------|------|------|
| 用户 Provider/Capability 导入 | 静态扫描 `DANGEROUS_PATTERNS` | 检测 `eval`、`Function`、`fetch`、`XMLHttpRequest`、`WebSocket`、`import(` 等危险 API，匹配后展示红色安全警告 |
| 用户 Provider/Capability 导入 | GUI 安全警告条 | 导入时在文件列表上方的醒目位置展示检测到的危险 API |
| 脚本执行器导入 | GUI 安全警告条 | 同样展示检测到的危险 API |
| 配置档导入 | 确认弹窗 | 导入配置档会同时导入 userProviders、userCapabilities，点击导入按钮时弹出 ST 原生确认框提醒用户检查 |
| 配置档导出 | API Key 剥离 | `agentConfigs` 中的 `apiKey` 在导出时自动清空 |
| 配置档导入 | API Key 剥离 | `agentConfigs` 在导入时被丢弃，防止端点劫持 |
| 脚本执行器 | 执行超时 | 每个脚本 10 秒超时，超时后跳过继续执行 |
| 脚本执行器 | 异常隔离 | 单个脚本异常不影响其他脚本和导演流程 |

### 21.3 破坏性操作确认

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

### 21.4 静态代码扫描规则

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
