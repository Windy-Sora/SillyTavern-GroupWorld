# 代码与模型模块合同

## 脚本定义

`muyu.scripts.list/read/preview` 管理用户 Script Executor，先读完整 code／params 和 revision。code 是带 ctx 的 Function 函数体，不是整份 ES module；可编辑字段为 name、triggerOn、priority、code、enabled、params、renderParams、returnMode，按实际 schema 的触发阶段、参数类型和范围组织。

create 默认禁用，更新省略字段保留。保存 enabled 代码允许后续自动事件以页面权限执行，需明确告知，不能说成只保存静态文本。符合整单边界时可将明确请求的最多三个脚本定义放入 task.preview；普通设置请求不隐含脚本意图。

`muyu.scripts.test` 测试当前运行的 preview 候选，在隔离 Worker 的合成空／群聊／单聊上下文运行。无真实 ST 状态／API／Provider 渲染，renderParams 保持字面量，严格模块语义可能不同于真实 Function。passed 仅说明这些有界快照通过，不证明业务正确、安全或可直接启用。

## 脚本真实执行

先读取保存定义，再 prepare_execution 指定 id、revision、stage；message 还需现有零基 messageIndex。禁用脚本也可明确手动运行，不需要偷偷启用。手动 shared／decision 是独立空上下文，不重放自动事件或改变实时共享决策。

execute 只用返回的 executionId。页面代码可以读密钥、改数据、联网；超时／取消只停止等待，不能保证任意代码或同步死循环被中止。只读诊断不得转真实执行。未知结果不另造票据再执行，也不承诺回滚。

## 自定义 Agent 定义与实际运行

`muyu.agents.list/read/preview` 管理用户自定义 Agent，不是暮羽连接配置。字段 name、providerName、prompt、schema、enabled、autoEnabled、autoInterval、order 依据真实 schema；providerName 唯一且非系统占用。新建禁用／自动关闭，禁用时自动也关闭。开启自动允许之后额外模型调用，不是立即运行。

batch_preview／import_preview 可处理最多六项；导入使用用户提供的 custom-agent-export v1，所有导入项禁用且自动关闭，replace 明确覆盖；重命名／删除不修复模板引用，删除保留已存聊天产物。定义 schema 仅格式校验，不保证模型输出正确。

读取定义后 prepare_execution 选择 trial／save；trial 真实渲染并调用业务模型但不保存，save 替换当前聊天该 Agent 结果，不改变自动计数或启用状态。连接可能是业务模块或 ST 原生模型，不一定是暮羽接口。Prompt 渲染可能运行 Provider 代码，trial 不是沙箱。

execute 使用精确票据及独立任务许可，不以资料读取或草稿批准代替。调用尝试不是确认发送／扣费，产物不是持久化证明；saved_unconfirmed 只是内存赋值，trial_completed 仅产物。正文被省略不等于失败，outcome_unknown 不重试或改 mode。

## 报告

阶段不等于固定审批次数。根据实际preview合同，定义内容与启用／自动字段可在同一候选中审阅；实际业务执行按票据及独立执行许可核对，产物保存取决于trial／save模式，并非必然要第三、第四份批准。不能把定义已保存写成自动事件已运行，或把用户“先预览”扩大成启用及调用。

展示修改内容、自动触发时机、权限和潜在费用。普通模式走宿主精确批准；全权限只省审批，不省用户意图、版本、预算和系统保护。先预览始终不 apply。用户拒绝执行就给代码或方案，不换 Provider 执行同一请求。

核对版本：2026-10-05；`muyu/modules/script-executors/index.js`、`muyu/modules/custom-agents/index.js`、`muyu/scripts/execution-evidence.js`、`muyu/agents/execution-evidence.js`。这些路径仅为维护索引。
