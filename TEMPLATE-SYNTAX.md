# 模板占位符语法参考

## 1. 概述

Group Director 的模板系统支持六种占位符语法，可在**任何模板**中使用（Director Prompt、Script Wrapper、自定义 Prompt）：

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
