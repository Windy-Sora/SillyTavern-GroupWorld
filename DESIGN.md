# Group Director — 设计文档

## 1. 概述

Group Director 是一个 **群聊上下文管线（Group Context Pipeline）**：收集外部数据 → LLM 决策 → 按角色分发注入。

默认出厂配置是"群聊导演"（决定谁发言、按什么顺序），但 prompt 模板可以替换为地牢主宰、辩论裁判、战斗系统、社会模拟等任何需要"收集上下文 → 结构化决策 → 逐角色分发"的场景。框架本身不绑定任何特定用例。

### 1.1 核心管线

```
Provider 层           LLM 决策层            DSL 注入层
──────────           ──────────           ──────────
拉取任意外部数据 →  一张 prompt 模板   →  按角色分发、
(世界书、角色档案、   决定"这次产出      展开、拼接、
对话历史、账本、     什么 JSON"          注入角色 prompt
时间/天气/随机...)     
```

### 1.2 关键设计决策

| 决策 | 理由 |
|------|------|
| 零修改 ST 核心代码 | 纯 Extension API：`generate_interceptor` + `abort(false)` |
| Provider 注册表 | 任何占位符都是可插拔插件，新增不碰核心 |
| 可变值全用 getter | `chat`/`characters`/`chat_metadata` 是 ST 的 `export let`，聊天切换时被替换 |
| 账本存在 `chat_metadata` | 跟随对话导出/导入/分支，不依赖内存 |
| LLM 失败透明放行 | 导演故障不阻塞聊天 |
| send_date 锚定 | 账本裁剪基于不可变时间戳，删中间消息不错乱 |

---

## 2. 目录结构

```
SillyTavern-GroupDirector/
├── manifest.json              # 插件元数据 + generate_interceptor 声明
├── index.js                   # 入口：运行时、拦截器、事件监听、系统组装
├── settings.js                # 常量 + 默认设置（单一真相源）
├── settings.html              # 设置面板模板（折叠抽屉）
├── style.css                  # UI 样式
├── prompt-renderer.js         # 五阶段模板渲染引擎
├── provider-registry.js       # Provider 注册表（Map 存储）
│
├── providers/                 # Provider — 每个占位符一个文件
│   ├── recent-messages.js     # {{recentMessages}}
│   ├── new-recent-messages.js # {{newRecentMessages}} — 智能上下文窗口
│   ├── characters.js          # {{characters}}
│   ├── character-profiles.js  # {{character_profiles}}
│   ├── world-info.js          # {{worldInfo}}
│   ├── history.js             # {{previousPlan}} + {{previousPlans}}
│   ├── director-ledger.js     # {{directorLedger}} + {{directorHistory}}
│   ├── world-books.js         # {{worldBooks}} — 激活世界书清单
│   ├── world-book-importance.js # {{worldBookImportance}} — 条目重要性排名
│   ├── character-lore.js      # {{characterLore}} — 角色世界书触发词
│   ├── chat-summary.js        # {{chatSummary}} — 上下文总结
│   ├── system-time.js         # {{systemTime}} — 系统时间
│   ├── random-dice.js         # {{randomDice}} — 0-1 随机数
│   ├── dice.js                # {{dice}} — 骰子 + 幸运值
│   ├── moon-phase.js          # {{moonPhase}} — 月相
│   ├── time-of-day.js         # {{timeOfDay}} — 时段 + 季节
│   └── test-provider.js       # {{test}} — 模板语法测试
│
├── systems/                   # 有状态业务逻辑（工厂函数 + 显式依赖注入）
│   ├── history-system.js      # 导演账本 CRUD + send_date 锚定裁剪
│   ├── world-info-system.js   # ST checkWorldInfo() 封装
│   ├── profile-system.js      # 角色档案全流程
│   ├── world-book-scanner.js  # 世界书扫描 + 重要性计算
│   └── chat-summary-system.js # 上下文总结（生成/回退/裁剪联动）
│
├── utils/                     # 纯函数工具
│   ├── path-resolver.js       # parsePath / resolvePath / formatValue
│   ├── counter.js             # {{counter}} / {{counter0}} 自增计数器
│   ├── json-utils.js          # extractJsonObject / sanitizeJson
│   └── string-utils.js        # djb2Hash / hashChar
│
└── ui/                        # UI 层（自注册模式）
    ├── settings-init.js       # loadSettingsUI() 入口
    ├── i18n.js                # 中英文字典 + applyI18n()
    ├── dom.js                 # $c() + bindNumber/Checkbox/Textarea/Radio
    └── sections/              # 每个设置区域一个自注册模块
        ├── registry.js        # registerSection() / initAllSections()
        ├── modes.js           # 模式选择
        ├── formula.js         # 公式模式参数
        ├── director.js        # LLM 参数、剧本、账本清空
        ├── continuity.js      # 连贯性模式
        ├── worldinfo.js       # 世界书开关
        ├── worldBooks.js      # 世界书选择
        ├── ledger.js          # 账本浏览器（卡片 + JSON 编辑 + Raw 模式）
        ├── forceSpeak.js      # 强制发言（三种模式）
        ├── chatSummary.js     # 上下文总结（生成/回退/查看编辑）
        ├── templateTester.js  # 模板测试器
        └── profile.js         # 角色档案 UI
```

### 2.1 分层架构

```
┌──────────────────────────────────────────────────────────────┐
│  index.js  — 组装层（bootstrap）                               │
│  运行时状态 · 拦截器 · 事件监听 · 系统组装                       │
├──────────────────────────────────────────────────────────────┤
│  prompt-renderer.js  — 渲染引擎（5 阶段）                       │
│  provider-registry.js — Provider 注册表                        │
├──────────┬──────────────────┬────────────────┬───────────────┤
│providers/│  systems/        │  utils/        │  ui/          │
│ 数据注入  │  业务逻辑         │  纯函数         │  设置面板      │
│ (无状态)  │  (工厂+依赖注入)   │  (无副作用)     │  (自注册模式)  │
└──────────┴──────────────────┴────────────────┴───────────────┘
```

---

## 3. 模板渲染引擎（prompt-renderer.js）

### 3.1 五阶段管线

```
Phase 1   → 执行所有 Provider，缓存到 cache[id] = { content, data }
Phase 1.5 → 块循环 {{#provider:path}}...{{/provider}}（最内层优先，去重）
Phase 2   → 简单占位符 {{name}} → cache[id].content
Phase 3   → 路径查询 {{?name:path|fallback}} → resolvePath(data, path)
            ● resolveInnerPlaceholders(path) — 嵌套 {{...}} 从内向外
            ● expandVariables(path) — $variable 展开
Post-loop → 重复 Phase 1.5+2+3，直到无新匹配或达到 maxPasses
```

**关键保证：**
- 每个 Provider 的 `render()` 在一次 `renderPrompt()` 中只执行一次
- 块循环自动 Set 去重，空数组/null → 空字符串
- Counter 仅在第一轮递增，后续轮次保留
- 未注册占位符：`templateDebugPlaceholders` 控制保留/清除

### 3.2 块循环 `{{#provider:path}}...{{/provider}}`

```
{{#directorLedger:loreAssignments.$character}}
  {{?worldBooks:allEntries[comment=$it].content}}
{{/directorLedger}}
```

- `$it` 绑定当前元素
- 结果用 `\n` 拼接
- 最内层优先处理（支持嵌套）

### 3.3 嵌套路径查询

路径中可包含 `{{...}}` 占位符，从最内层向外解析：

```
{{?directorLedger:scripts[{{?ledger:currentSpeaker}}]}}
```

### 3.4 递归渲染

渲染后的文本可能包含新占位符，后处理循环重新扫描直到稳定：

| 设置 | 默认 | 说明 |
|------|------|------|
| `templateRecursive` | `true` | 启用递归渲染 |
| `templateMaxPasses` | `5` | 最大递归轮数（内部钳 1000）|
| `templateDebugPlaceholders` | `false` | 保留未注册占位符用于调试 |

### 3.5 运行时变量

| 变量 | 可用场景 | 含义 |
|------|---------|------|
| `$character` | Script Wrapper | 当前角色名 |
| `$speakerIndex` | Script Wrapper | 发言顺序（1-based）|
| `$speakerIndex0` | Script Wrapper | 发言顺序（0-based）|
| `$speakerCount` | Script Wrapper | 本轮总发言人数 |
| `$it` | 块循环内部 | 当前迭代元素 |

---

## 4. Provider 系统

### 4.1 接口

```js
registerProvider({
    id: 'myFeature',
    placeholder: '{{myFeature}}',
    render: async (ctx) => ({
        content: '摘要文本',     // {{myFeature}} → 此文本
        data: { key: 'val' },  // 可选：{{?myFeature:key}} → "val"
    }),
});
```

### 4.2 已注册 Provider 一览

| Provider | 占位符 | 说明 |
|----------|--------|------|
| `recentMessages` | `{{recentMessages}}` | 最近 N 条消息 |
| `newRecentMessages` | `{{newRecentMessages}}` | 智能上下文窗口（总结+新消息） |
| `characters` | `{{characters}}` | 角色列表 |
| `character_profiles` | `{{character_profiles}}` | 角色档案 |
| `maxSpeakers` | `{{maxSpeakers}}` | 最大发言人数 |
| `worldInfo` | `{{worldInfo}}` | ST 世界书激活条目 |
| `previousPlan` | `{{previousPlan}}` | 上一轮导演计划 |
| `previousPlans` | `{{previousPlans}}` | 历史导演计划数组 |
| `directorLedger` | `{{directorLedger}}` | 最新导演计划 JSON |
| `directorHistory` | `{{directorHistory}}` | 全部导演历史 JSON |
| `worldBooks` | `{{worldBooks}}` | 激活世界书清单 |
| `worldBookImportance` | `{{worldBookImportance}}` | 条目重要性排名 |
| `characterLore` | `{{characterLore}}` | 角色世界书触发词 |
| `chatSummary` | `{{chatSummary}}` | 上下文总结 |
| `systemTime` | `{{systemTime}}` | 系统日期时间 |
| `randomDice` | `{{randomDice}}` | 0.00-1.00 随机数 |
| `dice` | `{{dice}}` | 骰子(1-6) + 幸运值(1-100) |
| `moonPhase` | `{{moonPhase}}` | 月相（8 相 + 光照） |
| `timeOfDay` | `{{timeOfDay}}` | 时段（6 段）+ 季节 |
| `test` | `{{test}}` | 测试占位符 |

### 4.3 编码规则

- Provider 有开关时在 `render()` 内返回空字符串，不用 `enabled` 跳过
- 可变值（`chat`、`characters`、`chat_metadata`）用 getter 传入
- `settings.js` 是唯一默认值来源，不硬编码 fallback

---

## 5. 世界书管线（World Book Pipeline）

### 5.1 数据流

```
用户勾选世界书（GUI）
  ↓
worldBookScanner.scanAll() → 只扫勾中的书
  ↓
{{worldBookImportance}} → Director Prompt: 条目名 + 关键词 + 重要性分数
  ↓
Director 返回 loreAssignments: { "Alice": ["条目名1", "条目名2"] }
  ↓
{{characterLore}} → Script Wrapper: [World lore: 条目名1, 条目名2]
  ↓
ST checkWorldInfo 检测到关键词 → 自动激活条目 → 注入正文
```

### 5.2 重要性计算

```
score = constant(0.50|0.10) + depth×0.15 + probability×0.10 + sticky(0.05)
      + keywords×0.10 + secondaryKeys×0.05 + order×0.05
max = 1.000, disabled → 0.000
```

---

## 6. 上下文总结系统（Chat Summary）

### 6.1 数据流

```
用户点"执行总结"
  ↓
首次：全量 chat → LLM 生成摘要 → 存入 chat_metadata.summaries[]
  ↓
后续：上次摘要 + 新增片段 → LLM 生成新摘要
  ↓
{{chatSummary}} → Director Prompt 可用
{{newRecentMessages}} → 自动拼装摘要 + 新消息
```

### 6.2 设置

| 设置 | 默认 | 说明 |
|------|------|------|
| `summaryEnabled` | `false` | 总开关 |
| `summaryReusePrevious` | `true` | 复用上次总结 |
| `summaryPrompt` | `''` | 空 = 内置默认 |

### 6.3 安全设计

- 生成期间 `{{chatSummary}}` 返回空（`summarizing` 标志）
- `MESSAGE_DELETED` 自动裁剪失效总结
- 结果可查看编辑，不满意可回退/重新总结/重置

---

## 7. 强制发言（Force Speak）

### 7.1 三种模式

| 模式 | 行为 |
|------|------|
| `native`（默认） | confirm 弹窗 → 透传给 ST |
| `block` | `abort(false)` 阻断 |
| `llm` | 复用 Director Prompt + 强制指令 → LLM 出 script → 记账本 |

### 7.2 安全性

- 仅群聊生效（`getCurrentGroup()` 检查）
- LLM 模式锚点到最近用户消息，删除联动正常
- 空 chat 直接返回
- 关闭主模式不影响 force-speak

---

## 8. UI 架构

### 8.1 自注册模式

```js
// ui/sections/registry.js
const sections = [];
export function registerSection(name, initFn) { sections.push({ name, initFn }); }
export function initAllSections(ctx) { sections.forEach(s => s.initFn(ctx)); }
```

新增 UI 区域只需：
1. `settings.html` 加 DOM 结构
2. 创建 `ui/sections/newname.js` → `registerSection('name', initFn)`
3. `ui/settings-init.js` 加 `import './sections/newname.js'`

### 8.2 折叠抽屉

使用 ST 原生 `inline-drawer` 组件，全局点击委托使用 `closest('.inline-drawer')` + `find('>.inline-drawer-content')` 直接子选择器，嵌套正确。

当前抽屉：公式判断配置、Director LLM 参数、Director Prompt 模板、导演剧本 & 连贯性、世界书注入、世界书选择、强制发言、上下文总结、导演账本浏览器、角色档案系统、模板测试器。

### 8.3 账本浏览器

- 卡片列表（最新在上）：`#3 Alice, Bob — 两人正在对峙...`
- 展开 JSON 编辑（`_anchorDate`/`_chatLength` 不可见）
- 清空单条（替换为 `{}`）
- Raw 模式（不允许增删）
- 生成锁 + 自动刷新

---

## 9. 模式

### 9.1 `off` — 关闭
不干预 ST 默认行为。force-speak 不受影响。

### 9.2 `formula` — 公式判断
本地评分，零 API 调用：

```
score(c) = mention(c)×w_mention + (trigger(c)?triggerScore:0)
         + recency(c)×w_recency − consecutive(c)×w_consecutivePenalty
         + talkativeness(c)×w_talkativeness + initiative(c)
```

### 9.3 `llm` — 大模型判断
- Prompt 经 Provider 系统渲染后调用 `ctx.generateRaw()`
- 返回 JSON：`{"speakers": [...], "reason": "...", "scripts": {...}, "loreAssignments": {...}}`
- 严格顺序模式：`force_chid` 接管 ST 循环
- 用户暂停 → 静默切断
- 网络错误 → 最多重试 3 次 → 复用历史

---

## 10. 拦截器状态机

```
GROUP_WRAPPER_STARTED
  ├─ takeoverGenCount > 0 → return
  ├─ takeoverFailed → 复用旧计划
  ├─ swipe/regenerate → 重建/透传/复用
  └─ 正常新轮次 → 清空状态

Interceptor
  ├─ force-speak 检测（最先执行，类型无关）
  ├─ 首个角色 → LLM/Formula 初始化
  ├─ takeover → 验证身份 + 注入剧本
  └─ 过滤 → 不在 pickedSet → abort

GROUP_WRAPPER_FINISHED
  ├─ takeoverPending → runManualOrderedGeneration()
  └─ 清理

GENERATION_STOPPED → generationStopped = true
MESSAGE_DELETED → 裁剪账本 + 裁剪总结 + 清空状态
```

---

## 11. Crash/重载恢复

| 状态 | 存储 | 恢复 |
|------|------|------|
| 用户设置 | `extension_settings` | 自动 |
| 导演账本 | `chat_metadata.directorHistory` | STARTED swipe 分支重建 |
| 角色档案 | `chat_metadata.characterProfiles` | 自动 |
| 上下文总结 | `chat_metadata.summaries` | 自动 |
| Counter 快照 | `chat_metadata._counterSnapshots` | swipe 时合并 |
| 运行时变量 | 内存（丢失） | 下一轮重置 |

---

## 12. 配置项总览

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
| `llmHistoryEnabled` | true | 记录导演账本 |
| `llmScriptContinuity` | false | 连贯剧本 |
| `llmScriptContinuityMode` | last | `last` \| `history` |
| `llmScriptContinuityCount` | 0 | 历史模式轮数 |
| `llmWorldInfoEnabled` | false | 世界书注入 |
| `worldBookSelection` | {} | 手动选择世界书 |
| `worldBookMaxEntries` | 20 | 最大注入条目数 |
| `templateMaxPasses` | 5 | 递归渲染最大轮数 |
| `templateRecursive` | true | 启用递归渲染 |
| `templateDebugPlaceholders` | false | 保留未注册占位符 |
| `forceSpeakMode` | `native` | `native` \| `block` \| `llm` |
| `forceSpeakPrompt` | '' | 强制发言 Prompt 注入 |
| `summaryEnabled` | false | 启用上下文总结 |
| `summaryReusePrevious` | true | 复用上次总结 |
| `summaryPrompt` | '' | 总结 Prompt |
| `profileEnabled` | false | 角色档案系统 |
| `profileTokenBudget` | 2000 | 档案 Token 预算 |
| `profileConcurrency` | 0 | 档案生成并发数 |
| `debugLogging` | false | 调试日志 |
| `lang` | zh | 语言 |

---

## 13. 失败回退

- LLM 调用失败 / JSON 解析失败 → 透明放行（有历史则复用）
- 用户主动暂停 → 静默切断，不重试，不复用历史
- `selected_group` 为空 → 透明放行
- `type` 为 `quiet` / `impersonate` / `continue` → 不拦截
- Takeover 中途失败 → `takeoverFailed = true`，下次重试复用

---

## 14. 开发速查

| 任务 | 改哪些文件 |
|------|-----------|
| 加 Prompt 占位符 | `providers/*.js`（新建）+ `index.js` 底部 import/register |
| 加业务逻辑模块 | `systems/*.js`（新建）+ `index.js` import/组装 |
| 加设置项 | `settings.js` + `settings.html` + `ui/sections/*.js` |
| 加 UI 抽屉 | `settings.html`（inline-drawer）+ `ui/sections/newname.js` + `ui/settings-init.js` import |
| 加 UI 文字 | `ui/i18n.js`（zh+en）+ `settings.html` data-i18n |
| 改渲染引擎 | `prompt-renderer.js` |
| 改 LLM 响应解析 | `utils/json-utils.js` |
| 改拦截器行为 | `index.js` → `groupDirector_Interceptor` |
