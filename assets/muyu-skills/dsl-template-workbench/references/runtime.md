# 嵌套、递归与执行成本

## 嵌套作用域

输入 `keys:['heal','torch']`、`children:{heal:['a'],torch:['b']}`、`labels:{heal:'药水',torch:'火把',a:'治疗',b:'照明'}` 时：

```text
{{#skill_shop:keys}}{{?skill_shop:labels.$it}}:{{#skill_shop:children.$it}}{{?skill_shop:labels.$it}}{{/skill_shop}}/{{?skill_shop:labels.$it}}{{/skill_shop}}
```

输出 `药水:治疗/药水`，换行，`火把:照明/火把`。内层数组路径仍用外层$it；内层正文使用内层$it；结束后恢复外层。不能在内层正文用$parent访问外层对象。标签同Provider嵌套也要完整配对。

结束标签只接受Provider ID，例如`{{/skill_shop}}`；`{{/skill_shop:keys}}`和`{{/skill_shop:children}}`都不识别，不要为区分内外层在结束标签添加路径。

## 动态模板与递归

Provider的content可以返回占位符或循环文本。根位置新产生的循环依赖后续递归pass，recursive=false或maxPasses=1时可能保持原样。循环正文中新产生的子循环在产生它的作用域处理，不能把它提前放到根位置解析$it。多级占位符链受剩余pass额度限制。

data里的字符串是取值，不是JS执行或独立模板注册；但输出进入后续渲染pass后，其中的GroupWorld占位符可能继续展开。不要把data一概说成永远不解析，也不要依赖这种行为建立隐藏执行链。需要传给模型的语法教学文本，优先输入模板的 `{[{...}]}` 直通区域；knowledge专用Provider也保护其中的占位符文字。

## 缓存、额度和副作用

完整renderPrompt会并行执行所有未禁用的已注册Provider，每个在该次调用缓存一次；不只是模板引用到的Provider。后续pass复用缓存，不重新调用render；另一次renderPrompt重新执行。减少占位符并不必然减少Provider代码运行次数。

输入模板直通区域 `{[{ {{skill_shop}} }]}` 保留占位符文字，但不会取消Phase 1的Provider执行。因此真实模板测试不等于纯文本格式检查，更不是只读沙箱。Provider应避免在render中记账、扣款、网络写入或依赖调用顺序。

每个pass共用最多200次循环块展开，包括不同外层元素产生的内层块；超限保留未展开文本，不保证完整输出。提高递归pass可能增加模板展开和长度，不保证修复循环或错误路径。未知Provider默认清空，调试选项可保留原占位符；空输出也可能是无data、空数组、错误或超时，不能只凭空输出判定唯一原因。

单个Provider的timeoutMs优先于渲染选项providerTimeoutMs，其后才是默认值；0会禁用该Provider超时。取消／超时传递signal并拒收迟到结果，但不保证任意同页JS副作用停止。合成Worker测试、真实单Provider执行与完整模板渲染是不同验证层。

计数器counter是整轮跨渲染计数，counter0是本次renderPrompt计数；它们不是金币余额或持久交易ID。计数位置和循环展开顺序有关，空循环不执行正文计数器，不把计数器当记账机制。

核对：2026-10-07，prompt-renderer.js、utils/counter.js、tests/unit/prompt-renderer.test.mjs。当前能力未提供任意模板纯沙箱执行工具，不编造muyu.dsl.eval；可用工具以本轮目录为准。
