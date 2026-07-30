# 模板占位符语法参考

## 1. 概述

Group World 的模板系统支持六种占位符语法，可在**任何模板**中使用（Director Prompt、Script Wrapper、自定义 Prompt）：

| 语法 | 用途 | 示例 |
|------|------|------|
| `{{name}}` | 渲染 Provider 的完整文本内容 | `{{recentMessages}}` |
| `{{?name:path\|fallback}}` | 从 Provider 的 JSON 数据中按路径提取值 | `{{?directorLedger:memory.location}}` |
| `{{#name:path}}...{{/name}}` | 遍历数组，对每个元素渲染内部模板 | `{{#ledger:items}}...{{/ledger}}` |
| `{[{content}]}` | 零渲染直通——内容完全不被解析 | `{[{ {{characters}} }]}` → `{{characters}}` |
| `{{counter}}` / `{{counter0}}` | 自增计数器 | `{{counter}}` |

---

## 2. 简单占位符 `{{name}}`

```
{{recentMessages}}  {{characters}}  {{previousPlan}}  {{directorLedger}}
{{worldInfo}}  {{character_profiles}}  {{maxSpeakers}}  {{previousPlans}}
{{worldBookImportance}}  {{characterLore}}  {{worldBooks}}
{{gdWorldBooksFull}}  {{gdWorldBooksConstant}}  {{gdWorldBooksNames}}
{{globalVars}}  {{charVars}}  {{vars}}  {{varsJson}}  {{variableMaintenance}}
{{storyBlueprintCurrent}}  {{storyBlueprintProgress}}  {{storyBlueprintCurrentJson}}
{{storyBlueprintSchemaHint}}  {{storyBlueprintFullJson}}  {{storyBlueprintDoneField}}
```

将 `name` 对应的 Provider 渲染结果直接插入模板。未注册的占位符行为由 `templateDebugPlaceholders` 设置控制：

| 设置 | 行为 |
|------|------|
| `false`（默认） | 未注册 → 静默清除为 `''`，不污染 LLM 上下文 |
| `true` | 未注册 → 保留原样 `{{typoName}}`，方便排查拼写错误 |

### 2.1 自增计数器 `{{counter}}` / `{{counter0}}`

| 占位符 | 生命周期 | 起始值 | 重置条件 |
|--------|---------|--------|---------|
| `{{counter}}` | 整轮（跨多次 `renderPrompt`） | 0 | `GROUP_WRAPPER_STARTED` 正常新轮次 |
| `{{counter0}}` | 单次 `renderPrompt` | 0 | 每次 `renderPrompt` 进入时自动重置 |

**`{{counter}}` swipe 保护：** 每个角色首次渲染脚本时，计数器值被快照并持久化到 `chat_metadata._counterSnapshots`。后续 swipe 该角色时，计数器恢复到快照值。页面重载后也能从 chat_metadata 恢复。

示例：
```
新轮次 → counter=0
Director Prompt 中出现 3 次 → 0, 1, 2
Alice 脚本首次 → 快照=3 → 渲染中出现 2 次 → 3, 4
Bob   脚本首次 → 快照=5 → 渲染中出现 2 次 → 5, 6
用户重新生成 Bob → 恢复快照=5 → Bob 重新渲染 → 5, 6（一致）
页面重载后 swipe Bob → chat_metadata 恢复快照 → 5, 6（一致）
```

---

## 3. 块循环 `{{#name:path}}...{{/name}}`

### 3.1 基本格式

```
{{#provider:path.to.array}}
  ... 内部模板，可使用任何 {{...}} 占位符 ...
{{/provider}}
```

- `path.to.array` 解析为数组后，对每个元素渲染内部模板
- 结果用换行符 `\n` 拼接
- 自动 Set 去重（适用于字符串/数字等原始类型）
- 空数组/null/非数组 → 整块输出空字符串（silent fallback）
- 最内层优先处理，支持嵌套块循环

### 3.2 `$it` 变量

块循环内部，`$it` 绑定当前迭代元素：

```
{{#directorLedger:loreAssignments.$character}}
  {{?worldBooks:allEntries[comment=$it].content}}
{{/directorLedger}}
```

`$it` 同样可用于 `$variable` 展开和嵌套路径查询。

### 3.3 渲染顺序

块循环在 Phase 1.5 执行（Provider 已缓存，占位符尚未替换）。内部模板随后走完整 Phase 2+3。因此内部可以使用任何占位符，包括计数器：

```
{{#ledger:steps}}
  Step {{counter}}: {{?ledger:details[$speakerIndex0]}}
{{/ledger}}
```

---

## 4. 路径查询 `{{?name:path|fallback}}`

### 4.1 基本格式

```
{{?provider:path.to.value}}
{{?provider:path.to.value|默认值}}
```

- `?` — 路径查询标记
- `path.to.value` — JSON 路径表达式
- `|默认值` — 路径不存在或值为空时使用

### 4.2 路径语法

#### 点号访问
```
{{?directorLedger:memory.location}}        → data.memory.location
{{?directorLedger:scripts.Alice}}          → data.scripts.Alice
```

#### 数组下标（支持负下标倒数）
```
{{?directorLedger:events[0].title}}        → 第一个
{{?directorLedger:events[-1].title}}       → 最后一个
{{?previousPlans:[-2].reason}}             → 倒数第二个
```

#### 属性过滤
```
{{?worldBooks:allEntries[comment=地理与空间].content}}
{{?history:plans[reason=开场].scripts}}
```
`[key=value]` 在数组中查找第一个匹配元素。

#### 引号键名（含特殊字符）
```
{{?directorLedger:["key.with.dots"]}}
{{?directorLedger:['weird-key']}}
```

#### 组合使用
```
{{?directorLedger:chapters[0].["scene.title"].text}}
```

### 4.3 嵌套路径查询

路径中可包含内层 `{{...}}` 占位符，从最内层向外逐级解析：

```
{{?directorLedger:scripts[{{?ledger:currentSpeaker}}]}}
{{?worldBooks:allEntries[comment={{?ledger:entryName}}].content}}
```

### 4.4 运行时变量 `$`

| 变量 | 可用场景 | 含义 |
|------|---------|------|
| `$character` | Script Wrapper | 当前角色名 |
| `$speakerIndex` | Script Wrapper | 发言顺序（1-based） |
| `$speakerIndex0` | Script Wrapper | 发言顺序（0-based） |
| `$speakerCount` | Script Wrapper | 本轮总发言人数 |
| `$it` | 块循环内部 | 当前迭代元素 |

变量值包含路径特殊字符时自动用 `["..."]` 包裹。

### 4.5 取值规则

| 类型 | 输出 |
|------|------|
| `string` | 原文输出 |
| `number` | `String(value)` |
| `boolean` | `String(value)` |
| `object` / `array` | `JSON.stringify(value, null, 2)` |
| `null` / `undefined` | 返回默认值；无默认值则返回空字符串 |

---

## 5. Provider 数据契约

### 5.1 格式

```js
// 文本型
return { content: '一段文本' };
return '一段文本';  // 向后兼容

// 结构化（支持路径查询）
return {
    content: '给 {{name}} 用的摘要文本',
    data: { key1: 'val1', nested: { key2: 'val2' } },
};
```

### 5.2 已注册 Provider 一览

| Provider | 占位符 | content | data | 注册位置 |
|----------|--------|---------|------|---------|
| `recentMessages` | `{{recentMessages}}` | 最近消息文本 | — | `providers/recent-messages.js` |
| `characters` | `{{characters}}` | 角色列表 | — | `providers/characters.js` |
| `character_profiles` | `{{character_profiles}}` | 角色档案 | — | `providers/character-profiles.js` |
| `maxSpeakers` | `{{maxSpeakers}}` | 数字字符串 | — | `index.js` |
| `worldInfo` | `{{worldInfo}}` | ST 世界书条目 | — | `providers/world-info.js` |
| `previousPlan` | `{{previousPlan}}` | 上一轮计划 | 上一轮原始对象 | `providers/history.js` |
| `previousPlans` | `{{previousPlans}}` | 历史计划数组 | 历史原始数组 | `providers/history.js` |
| `directorLedger` | `{{directorLedger}}` | 最新计划 JSON | 最新计划原始对象 | `providers/director-ledger.js` |
| `directorHistory` | `{{directorHistory}}` | 全部历史 JSON | 全部历史原始数组 | `providers/director-ledger.js` |
| `worldBooks` | `{{worldBooks}}` | 世界书清单 | `{ books, allEntries }` | `providers/world-books.js` |
| `worldBookImportance` | `{{worldBookImportance}}` | 重要性排名 | 排序数组 | `providers/world-book-importance.js` |
| `gdWorldBooksFull` | `{{gdWorldBooksFull}}` | 当前激活世界书的全部条目文本（含宏替换） | `{ books, entries, names, stats }` | `providers/gd-world-books.js` |
| `gdWorldBooksConstant` | `{{gdWorldBooksConstant}}` | 当前激活世界书的无条件（always-on）条目文本 | `{ entries, names, stats }` | `providers/gd-world-books.js` |
| `gdWorldBooksNames` | `{{gdWorldBooksNames}}` | 当前激活世界书名称列表（逗号分隔） | 名称数组 | `providers/gd-world-books.js` |
| `characterLore` | `{{characterLore}}` | 角色触发词 | — | `providers/character-lore.js` |
| `chatSummary` | `{{chatSummary}}` | 上下文总结 | — | `providers/chat-summary.js` |
| `newRecentMessages` | `{{newRecentMessages}}` | 智能上下文（总结+新消息） | — | `providers/new-recent-messages.js` |
| `knowledge` | `{{knowledge}}` | 知识库原文（零渲染） | — | `providers/knowledge.js` |
| `systemTime` | `{{systemTime}}` | 当前日期时间 | 结构化时间字段 | `providers/system-time.js` |
| `randomDice` | `{{randomDice}}` | 0.00–1.00 随机数 | `{ value }` | `providers/random-dice.js` |
| `dice` | `{{dice}}` | 骰子 1–6 | `{ die, luck }` | `providers/dice.js` |
| `moonPhase` | `{{moonPhase}}` | 月相（8 相 + 光照） | 结构化月相字段 | `providers/moon-phase.js` |
| `timeOfDay` | `{{timeOfDay}}` | 时段 + 季节 | `{ timeOfDay, season }` | `providers/time-of-day.js` |
| `test` | `{{test}}` | 测试文本 | 测试数据 | `providers/test-provider.js` |
| `globalVars` | `{{globalVars}}` | 全局变量列表 | `{ [id]: { ...def, value } }` | `providers/variables.js` |
| `charVars` | `{{charVars}}` | 角色变量列表（按角色分组） | `{ [id]: { ...def, values, names } }` | `providers/variables.js` |
| `vars` | `{{vars}}` | 完整变量快照 JSON | `{ global, character, currentCharacter, log }` | `providers/variables.js` |
| `varsJson` | `{{varsJson}}` | 完整变量快照 JSON（同 vars） | 同上 | `providers/variables.js` |
| `variableMaintenance` | `{{variableMaintenance}}` | 变量维护说明（注入 Director Prompt） | 完整快照对象 | `providers/variables.js` |
| `storyBlueprintCurrent` | `{{storyBlueprintCurrent}}` | 当前故事蓝图推进块；完成提示仅 Director 消费一次 | `{ blueprint, progress, current, doneSignals }` | `providers/story-blueprint.js` |
| `storyBlueprintCurrentJson` | `{{storyBlueprintCurrentJson}}` | 当前推进节点 JSON | 当前节点对象 | `providers/story-blueprint.js` |
| `storyBlueprintProgress` | `{{storyBlueprintProgress}}` | 蓝图进度摘要 | `{ current, done, total, complete, currentIndex }` | `providers/story-blueprint.js` |
| `storyBlueprintSchemaHint` | `{{storyBlueprintSchemaHint}}` | 完成变量协议提示 | `{ completionVariable }` | `providers/story-blueprint.js` |
| `storyBlueprintFullJson` | `{{storyBlueprintFullJson}}` | 完整蓝图 JSON | 蓝图对象 | `providers/story-blueprint.js` |
| `storyBlueprintDoneField` | `{{storyBlueprintDoneField}}` | Director JSON Schema 专用字段片段 | `{ enabled, variableName }` | `index.js` |

### 5.3 变量系统 Provider 详解

Group World v0.7 新增变量追踪系统，以下 5 个 provider 全部由 `providers/variables.js` 注册。

#### `{{globalVars}}` — 全局变量列表

渲染所有 `scope: "global"` 的变量为可读文本：

```
- Story Phase (story_phase): 序幕
- Current Goal (current_goal): 探索废都
- Party Funds (party_funds): 150
- Danger Level (danger_level): 25
```

**data 结构：**
```json
{
  "story_phase": { "id": "story_phase", "label": "Story Phase", "scope": "global", "type": "string", "value": "序幕", "rule": "..." },
  "party_funds": { "id": "party_funds", "label": "Party Funds", "scope": "global", "type": "number", "value": 150, "min": 0, "updateMode": "delta" }
}
```

**路径查询示例：**
```
{{?globalVars:story_phase.value}}          → 序幕
{{?globalVars:party_funds.value}}          → 150
{{?globalVars:danger_level.value|0}}       → 25（无值时回退 0）
```

---

#### `{{charVars}}` — 角色变量列表

根据上下文渲染角色变量。有当前角色时只渲染该角色，无当前角色时渲染全部活跃角色：

```
[Alice]
  - Trust Toward User (trust_user): 60
  - Emotion (emotion): 好奇
  - Health (health): 95
[Bob]
  - Trust Toward User (trust_user): 30
  - Emotion (emotion): 警惕
  - Health (health): 80
```

**data 结构：**
```json
{
  "trust_user": {
    "id": "trust_user", "label": "Trust Toward User", "scope": "character", "type": "number", "updateMode": "delta", "min": 0, "max": 100,
    "values": { "alice_avatar_hash": 60, "bob_avatar_hash": 30 },
    "names": { "alice_avatar_hash": "Alice", "bob_avatar_hash": "Bob" }
  }
}
```

**路径查询示例：**
```
{{?charVars:trust_user.values.$character}}          → 当前角色的信任度
{{?charVars:health.values.$character|100}}          → 当前角色生命值，无值默认 100
```

> **注意：** `$character` 只在 Script Wrapper 上下文中可用（值为当前角色名）。在 Director Prompt 中需要用具体 avatar 或角色名。

---

#### `{{vars}}` / `{{varsJson}}` — 完整快照 JSON

两者输出相同，均为完整变量快照的 JSON 字符串。

**data 结构：**
```json
{
  "global": {
    "story_phase": { "id": "story_phase", "label": "Story Phase", "type": "string", "value": "序幕", "rule": "..." },
    "party_funds": { "id": "party_funds", "type": "number", "value": 150, "min": 0, "updateMode": "delta" }
  },
  "character": {
    "trust_user": { "id": "trust_user", "type": "number", "values": { "alice_hash": 60, "bob_hash": 30 }, "names": { "alice_hash": "Alice", "bob_hash": "Bob" } }
  },
  "currentCharacter": "alice_hash",
  "log": [ /* 最近 20 条变更日志 */ ]
}
```

**路径查询示例：**
```
{{?vars:global.story_phase.value}}                    → 序幕
{{?vars:character.trust_user.values.alice_hash}}      → 60
{{?vars:currentCharacter}}                            → alice_hash
```

---

#### `{{variableMaintenance}}` — 变量维护说明

**这是变量系统与 LLM 交互的核心桥梁。** 它被自动注入到 Director 的 system prompt 末尾，告知 LLM 有哪些变量需要维护、各自的更新规则，以及如何通过 JSON 返回更新。

**渲染内容示例：**
```md
[Variables to maintain]
Update these only when the conversation gives clear evidence. Use small numeric deltas when updateMode is delta.
For character variables, use only the character names listed below as keys in the character object.

Valid character names: "Alice", "Bob", "Charlie"

- global.story_phase (string, replace) current=序幕
  Rule: Update when the story phase clearly changes. Keep it short.
- global.party_funds (number, delta) current=150
  Rule: Adjust when the group gains or spends money. Use deltas for changes.
- character.*.trust_user (number, delta) default=50
  Rule: Adjust only when this character gains or loses trust in the user. Use small deltas.
- character.*.emotion (string, replace) default=
  Rule: Track the character current dominant emotion in a few words.

Return updates in this optional JSON field:
"variable_update": {
  "global": { "var_id": { "value": "...", "reason": "..." } },
  "character": { "Exact Character Name": { "var_id": { "value": "+1 or new value", "reason": "..." } } }
}
```

**LLM 返回格式规范：**

```json
{
  "speakers": ["Alice", "Bob"],
  "reason": "...",
  "variable_update": {
    "global": {
      "story_phase": { "value": "第二章 - 启程", "reason": "故事从序幕过渡到第二章" },
      "party_funds": { "value": "-30", "reason": "在酒馆花费了 30 金币" }
    },
    "character": {
      "Alice": {
        "trust_user": { "value": "+5", "reason": "用户救了她" },
        "emotion": { "value": "感激" }
      },
      "Bob": {
        "suspicion": { "value": "+10", "reason": "用户行为可疑" }
      }
    }
  },
  "scripts": { ... }
}
```

**更新模式说明：**

| updateMode | 值格式 | 示例 | 行为 |
|---|---|---|---|
| `replace` | 任意匹配类型 | `"第二章"` | 直接替换旧值 |
| `delta`（仅 number） | `"+5"` / `-10` / `3` | `"+5"` | 旧值 + delta，钳制到 [min, max] |
| `append`（array/string） | 单个值或数组 | `"新条目"` / `["a","b"]` | 追加到末尾 |
| `merge`（仅 object） | JSON 对象 | `{"key": "val"}` | 浅合并到旧对象 |

**注入位置：** `{{variableMaintenance}}` 在 `index.js` 的 `buildDirectorSystemPrompt()` 中被拼接到 system prompt 末尾（`{{llmJsonSchema}}` 之前），因此 LLM 在每轮 Director 回合和 Force Speak 中都能看到变量维护指令。

**`variable_update` 处理流程：**

```
LLM 返回 JSON
  → initRoundWithLLM() / initForceSpeakLLM() 解析 parsed.variable_update
    → variableSystem.applyUpdates(update, { source: 'director' | 'force-speak' })
      → 遍历 global 和 character 字段
        → 逐个变量检查 autoUpdate / locked
          → 调用 setValue() → coerceValue() 类型校验
            → 写入 chat_metadata → saveChatConditional()
              → pushLog() 记录变更
                → 刷新仪表盘 UI
```

**自动更新控制：**
- `autoUpdate: false` — LLM 的更新被记录为 `ignored`（日志保留，值不变）
- `locked: true` — 同上，且仪表盘显示锁定图标
- `injectMode: "manual"` — 变量不出现于 `{{variableMaintenance}}` 输出中（LLM 不会看到它）

---

## 6. 零渲染直通 `{[{...}]}`

`{[{...}]}` 内的内容**完全不被解析**——Phase 0 将其替换为哨兵，所有渲染阶段结束后恢复原文。

```
{[{ {{recentMessages}} }]}     → 渲染结果：{{recentMessages}}
{[{ {{?ledger:reason}} }]}     → 渲染结果：{{?ledger:reason}}
```

**用途**：在 Director Prompt 中教 LLM 使用 DSL 接口。

与 `{{knowledge}}` 的区别：`{[{...}]}` 是内联语法，可以在提示中任意位置嵌入。`{{knowledge}}` 是专用的设置面板文本框，方便输入大段参考文档。

---

## 7. 渲染管线

```
Phase 0   — {[{...}]} 直通槽位 → 哨兵替换
Phase 1   — 执行所有 Provider，缓存到 cache[id] = { content, data }
Phase 1.5 — 块循环 {{#name:path}}...{{/name}}（最内层优先，去重后逐元素渲染）
Phase 2   — 简单占位符 {{name}} → cache[id].content
            {{counter}}/{{counter0}} 递增替换
Phase 3   — 路径查询 {{?name:path|fallback}}
            1. resolveInnerPlaceholders(path) — 展开路径中的嵌套 {{...}}
            2. expandVariables(path) — 展开 $variable
            3. parsePath → resolvePath → formatValue

Post-loop — 重复 Phase 1.5+2+3，最多 maxPasses 轮
Final     — 恢复 Phase 0 直通槽位 + unescapeKnowledge（{{knowledge}} 内容）
            每轮检查 result === before，无变化则提前退出
            重轮中 counter 保留原样不递增
```

---

## 8. 完整示例

### 7.1 Director Prompt（出厂默认）

```
{{worldInfo}}{{previousPlans}}{{previousPlan}}Recent messages:
{{recentMessages}}

Available characters:
{{characters}}

Character profiles:
{{character_profiles}}

---
You are a Group Chat Director.

Knowledge reference:
{{knowledge}}

Available world book entries:
{{worldBookImportance}}

For EACH picked character, optionally assign relevant world book entries
by their exact displayed names. Only assign entries actually relevant
to that character's current situation.

Reply with ONLY a JSON object:
{
  "speakers": ["Name1", "Name2"],
  "reason": "short justification",
  "scripts": { "Name1": "stage direction", "Name2": "stage direction" },
  "loreAssignments": { "Name1": ["entry name"], "Name2": [] }
}
```

### 7.2 Script Wrapper（出厂默认）

```
{{characterLore}}[Director's stage direction for this character:
{{script}}

Follow this guidance. NEVER mention the director, the script,
or that you are following stage directions. Act naturally as your character.]
```

### 7.3 `{{worldBookImportance}}` 输出示例

```
1. [地理与空间] _Girl world_ importance=0.850 (always-on)
2. [eldoria] _Eldoria_ importance=0.420 (keys:eldoria,wood,forest)
3. [娱乐室/游戏区] _girls world location indoor_ importance=0.330 (keys:台球,飞镖)

## Always-On (10)
- [地理与空间] _Girl world_ importance=0.850
- [社会结构] _Girl world_ importance=0.850
```

### 7.4 `{{characterLore}}` 输出示例

当 Director 返回 `loreAssignments: { "Alice": ["地理与空间", "社会结构"] }` 时：

```
[World lore: 地理与空间, 社会结构]
```

ST 检测到这些关键词后，自动激活对应世界书条目并注入正文。

---

## 9. 新增 Provider 指南

### 8.1 仅提供文本

```js
import { registerProvider } from '../provider-registry.js';
export function register() {
    registerProvider({
        id: 'myProvider',
        placeholder: '{{myProvider}}',
        render: (ctx) => ({ content: '文本内容' }),
    });
}
```

### 8.2 提供结构化数据

```js
render: (ctx) => ({
    content: '摘要文本',
    data: { key1: 'value1', nested: { key2: 'value2' } },
}),
```

用户即可使用 `{{?myProvider:key1}}`、`{{?myProvider:nested.key2}}`。

### 8.3 提供数组（可被块循环遍历）

```js
render: (ctx) => ({
    content: '...',
    data: { items: ['a', 'b', 'c'] },
}),
```

用户可用 `{{#myProvider:items}}{{?other:$it}}{{/myProvider}}` 遍历。

---

## 10. 限制

- **不支持通配符遍历**：`{{?provider:events[*].title}}` 不合法。用块循环替代。
- **不支持表达式**：路径只能是纯字段访问。
- **不支持递归模板展开**：`data` 中的字符串值不会被二次当模板解析（但递归渲染后处理会再次扫描）。
- **回退值不含 `}`**：默认值中不能出现 `}`。
