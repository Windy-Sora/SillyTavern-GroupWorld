---
name: prompt-template-workbench
display-name: Prompt与模板设计
description: 用户希望修改GroupWorld功能Prompt、创建自定义Prompt数据源、调整输出示例或GroupWorld模板引用时使用；区别提示词、Schema和可执行Provider，第三方EJS转专项技能。
version: "1.6"
---

# Prompt 与模板设计

ST原生宏、ST-Prompt-Template的EJS和GroupWorld DSL是不同解释器。EJS语法／动态注入加载“EJS提示词模板”，酒馆助手前端协议加载“酒馆助手与交互前端”；不要把第三方模板直接当作GroupWorld数据源，也不为分析执行模板。跨预设、正则与变量链路可配合“角色卡与预设协作分析”。

“不读取当前资料／不修改”不禁止查阅本技能及其他技能的公共参考；这些参考不含用户聊天。给精确语法前必须加载相关参考，不能用猜测示例代替。自定义提示词正文是content，结构化数据是单独的dataJson字段：正文里的JSON代码块不会自动变成data。

固定商品样本可填写name=shop_rules、content=商品目录说明、dataJson=`{"stock":[{"id":"heal","name":"药水","price":5}]}`；在经过GroupWorld渲染器的模板中用`{{?shop_rules:stock[id=heal].price}}`取5。具体启用与注册条件按workflow核对，不能把示例当作已经安装或已注入。

需要核对“实际构建了什么”时，可使用用户已开启的提示词构建快照；概况和正文独立授权，不能把注册注入项或构建事件说成最终网络发送证明。

酒馆聊天补全预设是独立对象，不等于 GroupWorld 功能 Prompt。涉及预设复制、另存、修改或激活时，读取工作流中的专门合同；保存不激活，激活会替换当前运行配置并丢失未保存修改。

先完整读取 references/workflow.md。先确定模板在哪个功能使用和想改变什么行为。直接承接已有对象，不把所有 Prompt 混成一个入口。

涉及Provider的data、路径查询、数组过滤或循环时配合“DSL与结构化模板”技能，先读其syntax参考；复杂嵌套再读runtime。没有模板语法问题时不加载额外资源，不凭JSON文本推断结构化data或调用上下文。

查询实际字段合同或自定义条目，读齐原文，保留未要求的规则和占位符。优化文字不顺便补开总开关、不实际渲染、不调用业务模型。需要代码数据源时与 Provider 技能配合，但不把普通模板改成脚本。

输出示例、JSON Schema、Prompt 正文和模板包装是不同对象；按具体模块的验证语义设计。只有真实渲染和模型结果才能验证效果，保存或格式通过不等于可用。

用“自定义提示词”“生成提示词”“输出示例”等界面名称，必要时补字段名。引用重命名／删除风险和后续 Provider 运行开销要说清楚。
