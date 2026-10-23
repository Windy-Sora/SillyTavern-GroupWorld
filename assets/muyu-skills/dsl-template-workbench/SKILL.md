---
name: dsl-template-workbench
display-name: DSL与结构化模板
description: 用户需要编写或排查GroupWorld路径查询、数组过滤、循环、嵌套$it、Provider结构化data与模板组合时使用；不用于普通参数检查，不把DSL当JavaScript或数据写入工具。
version: "1.0"
---

# DSL 与结构化模板

本技能及其参考是公共开发资料；“不读取聊天／不要操作”不禁止加载它们。必须查本插件合同，不能把已知GroupWorld规则改成“取决于其他模板引擎”：回退只处理null／undefined，保留0、false、空字符串；循环结束标签只能是`{{/provider}}`，禁止`{{/provider:path}}`。

先完整读取 references/syntax.md，确定模板的实际调用位置、Provider ID 和 data 结构；解释语法可用文档中的样本，不必读取私人聊天。修改已有模板则核对其完整原文和依赖。

涉及嵌套循环、动态返回模板、递归、计数器或超时，完整读取 references/runtime.md。需要可运行示例时读取 references/examples.json，并配合“用户 Provider 开发与测试”的结构化示例资源；这些都是静态样本，不是当前聊天值。

DSL 只选择和格式化输入，不计算表达式、不更新状态。区分 Provider 的 content、data，以及调用方的模板；先选已有变量／自定义提示词数据源，确需动态代码才使用用户 Provider 工作台。

“模板不更新”不等于“自动更新做不到”。已有变量更新规则与业务事件可以更新状态；需要确定性计算或交易保证时才另外设计代码通道，不凭Capability编辑是否开放否定全部自动变量更新。render不是只读沙箱，不应在渲染中扣款。

给出模板使用位置、输入结构、预期输出与适用上下文。不编造通配符、父级循环变量或宿主API；模板样本正确不等于已保存、已渲染或已自动记账。实际工具和批准边界沿用各工作台，不因加载本技能获得执行权限。
