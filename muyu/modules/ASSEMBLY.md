# 联合模块装配

联合描述是工具、候选／报告及生命周期的可信接线合同，不授予读取、写入或代码执行权限。具体能力以宿主端口和启用状态为准，不用历史迁移轮次或固定模块数量判断完整度。

## 描述与消费者

- draft-assembly：基础配置、领域配置、简单变量及受限整单。
- editor-assembly：聊天编辑器、选择策略及 Provider／ST 资产编辑器。
- asset-assembly：自定义 Prompt、Skill 管理、三类库及聊天存包／应用。
- execution-assembly：脚本、自定义 Agent、记忆／档案／NPC 与整单生成。
- read-assembly：基础只读／控制工具、报告及可选 Skill 运行时。
- support-assembly：Provider、任务方案、配置档、联网、笔记及可选服务工具。

[assembly.js](assembly.js) 验证唯一工具与 handler、能力效果、双语标签、分组、候选工具 → content.module → artifact.kind → 动作所有者。旧记忆配置与领域配置共用 config-draft 动作，不能仅按 kind 决定重校验所有者。

toolEntries 接入 tool-plan，artifactEntries 接入 artifact-owners，toolGroups 参与每次运行的工具选择；保留 wire Schema、作用域、顺序、稳定别名与定义数量保护。候选首工具别名属于兼容合同：Prompt 批量、聊天库 capture／apply、蓝图节点／结构／初始化不能随意改为按名称猜测。

全部已启用工具须有声明。缺少宿主端口不发布工具；未启用实例的兼容清理排除已经装配的所有者，避免重复绑定和重复释放。bindAssistant、transferRun、forgetRun、retainArtifacts、forgetTask、dispose 由声明实际驱动。

## 产物、报告与展示

- 写入产物必须精确对应 [动作所有者](../actions/ASSEMBLY.md)；动作描述副本不携带 writer 或批准闭包。
- reports 独立于候选 artifacts：只接受本模块 read 工具与 publishReport，按成功完成的工具发布；单项异常不阻断其他发布。模块仍核验 Run、目标和证据新鲜度。
- task-plan 必须为 read-scope review、actionOwner=null，生产工具为 read。批准只覆盖读取来源，不注册配置应用或 external 执行。
- profile-draft 保存配置档，不直接修改活跃设置。生成工具没有草稿时明确 artifacts=[]，不能借执行结果发布可再次应用的候选。
- [GUI 呈现](../ui/LAYOUT.md) 按可信 kind／renderer／动作归属装配；[回执协议](../actions/RECEIPTS.md) 统一版本、来源与模型／GUI 投影。未知类型不回落配置操作。

## Run 与产物资源

候选替换、失败或取消释放该候选。续接只转移所有权；发布将私有票据交给产物，旧 Run 清理不能使已发布草稿失效。产物删除、内容替换、会话卸载及实例 dispose 只释放自身资源，普通面板解绑不执行这些清理。

artifact-leases 保存实例内有界产物 DTO 副本，不进入历史或模型提示。按 ID 与内容核对；验证元数据变化且内容不变时保留。draft-runs 在发布成功前验证 ID 并保留候选，发布失败不得丢资源归属。同 ID 内容替换即使 ticket 相同，也按旧资源失效处理。

模块不得 clear 共享变量、配置副作用计划、编辑器、聊天库或 Skill 仓库。普通 Provider 资产、Prompt 和库定义 DTO 没有私有计划时提供空 retain，不伪造租约，不在 dispose 中删除已保存资产或注销 Provider。

ST 预设／角色卡／世界书及 Skill 的异步预览须在返回后重核 Run；结束后才产生的票据立即释放，不重新挂回旧运行。库应用全部跳过时返回 no_changes，不发布新草稿、导入模板或擅自开启覆盖。

## Task 与预算

taskLifecycle=true 要求 forgetTask。execution-tasks 跟踪 prepare 及接手已有 execute 的任务；准备前登记，避免宿主分配后抛错泄漏，预算拒绝也保留已接手资源归属。Run 转移／清理不退休 Task 执行票据；Task 结束逐份 forget，单项失败保留归属以便清理，不能整仓 clear。整单宿主负责子任务资源。

Skill 运行时与管理独立。selectedSkill 只绑定一次，同 Task 固定版本跨授权、澄清和方案段保留；停放缓存清理不提前销毁物理执行票据，不清共享 Skill 服务。

Provider 是唯一 budgetLifecycle 所有者：bindAssistant=null，具有 bindRun／usage／预算专用 transfer。bindBudget 使用原有 (id, limit, from) 签名；普通身份 transfer 跳过它。续接采用新旧较低额度，不能重置用量或扩大预算。

联网 Task 配额和连接捕获跨 Run 保留；笔记保持用户原话、明确意图、作用域、修订和幂等语义。清理运行缓存不删除持久仓库。任务钩子异常应访问其余所有者后再聚合报告。

## 验证要求

装配测试覆盖缺项、重复、未知类型、精确分组、无端口、别名兼容与未来测试模块；生命周期覆盖续接、发布失败、迟到票据、内容替换、其他所有者资源保留及重复清理。测试产物应符合真实 DTO，不为简化夹具跳过生产检查。

这些检查验证接线与资源归属，不证明模型理解、回答质量或真实 GUI 已验收。外部调用和保存的中止、部分完成及未知结果仍由原业务合同控制。
