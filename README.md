# SillyTavern Group Director

🌏 Language

- English: [README_EN.md](README_EN.md)
- 中文：当前页面

---

> 一个面向开放式叙事的可编程运行时（Programmable Narrative Runtime）

Group Director 起源于一个简单问题：

> 在多人群聊中，谁应该说话？

但随着发展，它逐渐演化成了一套更通用的叙事运行时：

* AI 导演（Director）
* 角色剧本（Script）
* 导演账本（Ledger）
* Provider 数据接口
* Prompt DSL
* 递归渲染系统
* 长期剧情状态管理

它不仅能够决定谁发言。

更能够维护一个持续演化的世界模型。

---

# 为什么需要 Group Director？

传统群聊往往会出现：

* 所有人同时回应
* 发言顺序混乱
* 角色抢戏
* 剧情失焦
* 长线剧情难以维持

Group Director 会在角色生成之前增加一个导演层：

```text
用户输入
    ↓
Director
    ↓
选择角色
    ↓
生成剧本
    ↓
角色生成
```

从而让群聊更接近真实的戏剧编排。

---

# 不只是导演

虽然名字叫 Group Director。

但 Director 只是系统提供的第一个 Agent。

真正的核心是：

```text
Provider Runtime
        +
Prompt DSL
        +
Ledger
        +
Recursive Rendering
```

这些能力可以组合出远超“导演”的功能。

例如：

* 长期记忆系统
* 世界状态系统
* 阵营系统
* 关系系统
* 任务系统
* 剧情状态机
* 自定义 Agent

无需修改代码。

仅通过 Prompt 与模板即可实现。

---

# 核心能力

## Formula Director

本地评分模式。

无需 API 调用。

根据：

* 提及情况
* 关键词
* 最近发言
* 连续发言惩罚
* Talkativeness

计算角色优先级。

适合：

* 大型群聊
* 长期 RP
* 低成本运行

---

## LLM Director

由大模型担任导演。

综合分析：

* 最近消息
* 角色信息
* 角色档案
* 世界书
* 历史导演计划
* 当前状态

决定：

* 谁应该发言
* 发言顺序
* 场景推进方式
* 导演剧本

---

## Director Script

导演不仅选择角色。

还可以为每个角色生成独立剧本。

例如：

```json
{
  "scripts": {
    "Alice": "保持冷静，但逐渐流露出不安。",
    "Bob": "不要直接爆发愤怒。"
  }
}
```

每个角色只会看到属于自己的部分。

因此可以实现：

* 情绪控制
* 氛围塑造
* 戏剧张力
* 协同演出

---

## Director Ledger

导演账本用于保存结构化状态。

例如：

```json
{
  "speakers": ["Alice"],

  "story": {
    "chapter": 3
  },

  "relationships": {
    "Alice-Bob": 75
  }
}
```

Ledger 不限制结构。

你可以自由扩展：

* 剧情进度
* 世界状态
* 阵营关系
* 角色关系
* 经济系统
* 政治系统
* 自定义变量

---

# Prompt Runtime

Group Director 内置统一的 Prompt Runtime。

所有 Prompt：

* Director Prompt
* Script Wrapper
* History Wrapper
* WorldInfo Wrapper
* Profile Generator
* Profile Template

共享同一套数据接口。

---

## 内置 Provider

```text
{{recentMessages}}

{{characters}}

{{character_profiles}}

{{worldInfo}}

{{previousPlan}}

{{previousPlans}}

{{directorLedger}}

{{directorHistory}}
```

---

## 标准化 Provider 扩展接口

Group Director 提供统一的 Provider 扩展协议。

开发者无需修改核心代码，即可向运行时注册新的数据源。

一个 Provider 可以同时提供：

可读文本内容
结构化 JSON 数据
长期状态信息
Prompt 可访问变量

例如：
```text
registerProvider({
    id: 'relationshipGraph',

    async render(ctx) {
        return {
            content: '关系图',

            data: {
                Alice: {
                    Bob: 75
                }
            }
        };
    }
});
```
注册后即可在整个运行时中使用：
```text
{{relationshipGraph}}

{{?relationshipGraph:Alice.Bob}}
```
Provider 会自动接入：
```text
Director Prompt
Script Wrapper
Profile Generator
Prompt DSL
路径查询
递归渲染系统
```
因此开发者可以轻松构建：
```text
长期记忆系统
角色关系图
任务追踪系统
阵营系统
世界状态系统
经济模拟系统
外部数据接口
自定义 Agent
```
而无需修改 Group Director 本体。

---

## 路径查询

从结构化数据中直接读取字段：

```text
{{?directorLedger:reason}}

{{?directorLedger:scripts.$character}}

{{?directorHistory:[-1].reason}}

{{?directorLedger:story.chapter}}

{{?directorLedger:relationships.Alice-Bob}}
```

支持：

* 嵌套访问
* 数组索引
* 倒序索引
* 属性过滤
* 默认值
* 运行时变量

---

# 递归渲染

Group Director 支持递归模板解析。

例如：

第一层：

```text
{{directorLedger}}
```

生成：

```text
{{?directorLedger:story.chapter}}
```

第二层继续解析：

```text
第三章
```

最终得到完整结果。

最大递归层数可配置。

并提供调试模式用于查看未解析占位符。

事实上，你甚至可以让大模型自行生成拓展账本json的同时自行在提供给角色的script中或者其他自定义接口中注入查询语句，实现自产自销，或者让大模型帮你动态注入你提供的接口。

---

# 角色档案系统

内置 Profile System。

支持：

* 批量生成
* 自动同步
* 变化检测
* Token Budget 压缩
* 自定义 Schema
* 自定义渲染模板

默认可生成：

```json
{
  "summary": "",
  "tags": [],
  "motivation": "",
  "relationships": ""
}
```

但结构完全开放。

你可以定义自己的字段：

```json
{
  "goal": "",
  "fear": "",
  "secret": "",
  "emotional_state": ""
}
```

---

# 世界状态与长期剧情

Group Director 不要求开发者提前定义状态结构。

状态可以由 Director 在运行过程中自然生成：

```json
{
  "politics": {},
  "economy": {},
  "factions": {},
  "religions": {}
}
```

然后通过 Prompt DSL 在任意位置读取。

这使得系统特别适合：

* 长篇剧情
* 开放世界
* 多角色 RP
* 持续演化的世界模型

---

# 工作流程

```text
用户输入
      ↓
Director
      ↓
读取：
- 世界书
- 角色档案
- 导演账本
      ↓
生成：
- 发言顺序
- 导演剧本
- 状态更新
      ↓
角色生成
      ↓
写回 Ledger
      ↓
下一轮继续
```

---

# 设计理念

Group Director 不是一个发言过滤器。

也不是一个简单的 Speaker Selector。

它更像一个面向开放式叙事的运行时。

不要把世界设计出来。

给它一个能生长世界的机制。

让整个世界拥有持续演化的能力。

让状态、关系、剧情与世界观能够长期积累，并在未来被重新利用、相互影响。

最终实现一个虚拟世界。
