# 单角色档案业务生成底座

2026-10-04 第一轮完成底座；第二轮已装配暮羽工具、独立精确执行许可、预算和GUI。当前仅标准单角色试生成／缺失保存，不支持覆盖已有、自定义Schema或批量／整单生成。用户入口与授权见[模块合同](../muyu/modules/profile-generation/README.md)。

## 分层与接口

- `profile-system.js` 维持原界面接口，另暴露纯 `inspectGeneration(avatar, { fingerprint })`、`generateApproved(avatar, options)` 和包含物理排空的 `isGenerating()`。
- `profile-generation.js` 负责业务 Prompt、真实 Provider 渲染、档案模型 caller、标准输出检查和只创建缺失记录的确认保存。它不授予权限。
- `muyu/host/profile-generation.js` 提供页面内 `listTargets / prepareExecution / describeExecution / execute / forgetExecutions / clearExecutions`。目录每页16、最多512角色，仅名称／是否已有／能否新建及版本；执行单最多128份，一次执行去重与缓存，不从历史恢复。
- 已注册三工具与独立读取／精确执行来源、调用前结果预算、控制器续接和双语授权卡；禁止直接暴露此宿主端口，或将读权限、配置草稿、任务方案许可当作业务付费生成许可。

## 当前范围

`trial` 只返回生成结果，不初始化或修改档案仓库。`save` 仅创建指定角色缺失的记录；已有任何记录（包括 null、pending、failed、ready、手工档案）均拒绝覆盖。新记录使用实际角色 hash、ready、manualEdited=false 及宿主时间。ready 仅是状态，不证明内容事实正确或持久化成功。功能关闭时拒绝，不替用户开启。

本轮仅支持标准 summary / tags / motivation / relationships 四字段结构；空配置沿用默认结构，显式原默认 Schema 可以转交原生 ST 请求。其他自定义 Schema 在渲染／付费前明确拒绝，不假装通过完整 JSON Schema 校验，不重写 Schema。四字段类型、标签数量／长度、字符串、JSON复杂度及UTF-8容量均检查；不填补模型遗漏字段，不保存未知字段。不改变原界面的自定义 Schema／归一化行为。覆盖已有档案、其他 Schema、批量／整单另行设计。

## 当前性与执行隔离

执行单绑定聊天目标、任务、角色及顺序、聊天／元数据引用与内容、已有指定档案、共享 Schema 标记、业务设置／模型连接以及 Provider 对象与 render 实现。准备不渲染、不请求、不写入；目录不为每个角色复制聊天。muyu 前缀存档及界面设置不进入业务指纹。无关角色的同仓库并发编辑保留，所选角色、容量或业务基线变化阻止保存。

真实 Prompt／Provider 渲染不是沙箱，可能读资料、执行代码、修改数据或联网。最多一次业务模型调用，无自动重试；独立费用与暮羽模型费用分开。宿主 timeoutMs 可为1..290000毫秒，默认290000；模型／渲染收到取消后停止等待，但物理工作未排空仍占忙碌锁，并阻止旧界面或新任务启动档案生成。取消不能保证原生计费、Provider副作用或已经开始的保存被撤销。

原生 QUIET_PROMPT 仅在物理请求排空时清理，清理异常不篡改结果；独立模型不清理 ST 全局提示词。任务释放取消私有执行单；重复执行仅返回缓存，不能形成第二次付费调用或保存。

## 保存与结果

保存必须传入可确认的 saveChatConfirmed(metadata)，不回退 saveChatConditional。仅初始化当前聊天必需的 characterProfiles，不创建／迁移 profileVersion、profileSchemaHash 或 archivedProfiles，不覆盖归档。旧 Schema 哈希不匹配／不支持版本提前拒绝。

保存返回后分别核验持久化确认与当前性：applied_confirmed、partial、outcome_unknown；未知保存不自动重试或整仓回滚。并发编辑、切换聊天、取消后的结果不当作当前事实。通知只允许当前目标且需采用状态更新，不使用会迁移 Schema 或替换编辑草稿的旧全量刷新。模型长结果超过6000 UTF-8字节时仅从宿主工具DTO中省略，不影响已确认保存；安全代码不输出原始异常、密钥或角色描述。

首轮73项确定性专项涵盖纯读取／准备、试跑、新建、已有保护、Schema、输出、一次性执行、取消、物理排空、Provider／角色／聊天／配置变更、并发、容量、保存未知与安全结果。相关档案测试共93项通过；第二轮另增31项授权／预算／控制器／GUI及历史集成回归。未调用付费模型、未做真实ST验收。
