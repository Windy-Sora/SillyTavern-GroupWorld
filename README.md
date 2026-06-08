# GroupWorld

🌏 Language

- English: [README_EN.md](README_EN.md)
- 中文：当前页面

---

> 一个面向 **SillyTavern** 群聊场景的可编程运行时（Programmable Runtime）

GroupWorld 是一个 SillyTavern 第三方插件。它最初用于解决群聊中“所有角色一起抢话”的问题，后来逐步演化为一套更通用的叙事运行时：它不仅能决定谁发言，还能组织角色档案、世界知识、导演账本、剧本注入与长期状态管理。

它的目标不是把群聊变成一个更聪明的过滤器，而是把群聊变成一个可持续演化的世界模型。

---

## 它能做什么

GroupWorld 主要提供以下能力：

* 群聊发言控制
* 本地公式导演（无需 API）
* LLM 导演（由主模型做决策）
* 导演剧本注入
* 导演账本（Ledger）持久化
* 角色档案系统（Character Profiles）
* 世界书注入（World Info）
* 统一的 Provider 数据接口
* Prompt DSL 与路径查询
* 递归渲染与模板组合
* 长期剧情状态管理

---

## 为什么需要它

传统 SillyTavern 群聊常见的问题是：

* 所有人同时回应
* 发言顺序混乱
* 角色抢戏
* 剧情失焦
* 长线叙事难以维持
* 世界书、角色卡、上下文彼此割裂

GroupWorld 会在角色生成之前增加一个导演层，让群聊从“随机抢话”变成“有组织的叙事编排”：

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

---

## 这不只是一个导演插件

虽然项目里保留了 Director 作为默认控制器，但它只是系统提供的第一个 Controller。

真正重要的是这套基础设施：

* Provider Runtime
* Prompt DSL
* Ledger
* 递归渲染
* 角色档案系统
* 世界知识接入

这些能力可以组合出远超“导演”的功能，例如：

* 长期记忆系统
* 世界状态系统
* 阵营系统
* 关系系统
* 任务系统
* 剧情状态机
* 自定义 Agent
* 自定义世界控制器

---

## 核心模式

### Formula Director

本地评分模式，不需要 API 调用。

根据以下信息计算每个角色的优先级：

* 名字提及
* 关键词触发
* 最近发言
* 连续发言惩罚
* Talkativeness
* Initiative

适合：

* 大型群聊
* 低成本运行
* 需要稳定控制的角色扮演场景

---

### LLM Director

由大模型负责导演决策。

它可以综合分析：

* 最近消息
* 角色信息
* 角色档案
* 世界书
* 历史导演计划
* 当前状态

然后决定：

* 谁应该发言
* 发言顺序
* 场景推进方式
* 每个角色的独立剧本

---

## 导演剧本（Director Script）

Director 不仅可以选择角色，还可以为每个角色输出独立剧本，然后注入到角色生成 prompt 中。

例如：

```json
{
  "scripts": {
    "Alice": "保持冷静，但逐渐流露出不安。",
    "Bob": "不要直接爆发愤怒，而是先试探对方。"
  }
}
```

这样可以实现：

* 情绪控制
* 氛围塑造
* 剧情张力
* 协同演出
* 隐性引导

---

## 导演账本（Ledger）

导演账本用于保存结构化状态，并跟随聊天持久化。

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

账本结构是开放的，你可以自由扩展为：

* 剧情进度
* 世界状态
* 角色关系
* 阵营关系
* 经济系统
* 政治系统
* 自定义变量

---

## 统一的 Prompt Runtime

GroupWorld 内置一套统一的 Prompt Runtime。多个模板入口共享同一套数据接口：

* Director Prompt
* Script Wrapper
* History Wrapper
* World Info Wrapper
* Profile Generator
* Profile Render Template

### 内置 Provider

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

## Provider 扩展机制

GroupWorld 提供统一的 Provider 注册接口。你可以在不改核心代码的情况下，向运行时注册新的数据源。

一个 Provider 可以同时提供：

* 可读文本内容
* 结构化 JSON 数据
* 长期状态信息
* Prompt 可访问变量

示例：

```js
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

注册后即可在 Prompt 中直接使用：

```text
{{relationshipGraph}}
{{?relationshipGraph:Alice.Bob}}
```

---

## 路径查询

GroupWorld 支持从结构化数据中读取字段：

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

## 递归渲染

GroupWorld 支持递归模板解析。

例如：

```text
{{directorLedger}}
```

渲染后可能产生：

```text
{{?directorLedger:story.chapter}}
```

然后继续解析，直到得到最终结果。

这允许你用 Prompt 组合 Prompt，用结构化数据生成更复杂的结构化数据。

---

## 角色档案系统

内置 Character Profile System，用于把角色卡压缩成更易管理的结构化档案。

支持：

* 批量生成
* 自动同步
* 变化检测
* Token Budget 压缩
* 自定义 Schema
* 自定义渲染模板

默认档案字段包括：

```json
{
  "summary": "",
  "tags": [],
  "motivation": "",
  "relationships": ""
}
```

你也可以定义自己的结构，例如：

```json
{
  "goal": "",
  "fear": "",
  "secret": "",
  "emotional_state": ""
}
```

---

## 世界书与长期剧情

GroupWorld 不要求世界书和长期状态提前被严格标准化。

你可以把世界知识、剧情状态、角色关系、任务状态都纳入同一套运行时中，再通过 Provider 和 Prompt DSL 在任意位置读取。

这使它特别适合：

* 长篇剧情
* 开放世界
* 多角色 RP
* 持续演化的世界模型
* 群聊叙事控制

---

## 工作流程

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

## 安装与使用

1. 将本插件放入 SillyTavern 的扩展目录。
2. 在 SillyTavern 中启用 GroupWorld。
3. 配置导演模式、角色档案、世界书、Prompt 模板。
4. 根据你的叙事需求选择：

   * 公式模式
   * LLM 模式
   * 自定义 Prompt / Provider

---

## 设计理念

GroupWorld 不是一个发言过滤器，也不是一个只管“谁说话”的工具。

它更像一个面向开放式叙事的运行时：

* 角色不再只是卡片
* 世界不再只是文章
* 状态不再只是临时变量
* Director 不再只是一个固定算法

它的目标是让世界能够持续演化，让角色、知识、状态和剧情能够长期积累并相互影响。

最终，SillyTavern 群聊不只是聊天，而是一个可编程的叙事世界。

