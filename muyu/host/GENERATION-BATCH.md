# 业务生成顺序执行底座

2026-10-04：私有宿主编排端口。第二轮已通过generation-batch模块装配模型工具、精确整单许可和GUI，详见[入口合同](../modules/generation-batch/README.md)。端口本身仍不是授权入口；调用方必须验证精确整单执行权限、预扣整体结果预算与业务调用额度。

## 范围与接口

`createGenerationBatchPort`组合现有memoryGeneration、profileGeneration、npcGeneration受控端口。getTarget、getContext、getSettings、getCharacters、getProviders、getAgents必须来自真实宿主，extensionKey指定当前插件元数据域。

- prepare接受taskId、target和steps；每步仅kind、mode、revision，以及记忆／档案的character或NPC的count。模式为trial／save，1–8步；同领域同角色不能重复，NPC最多一步。档案保存总容量先检查。
- 准备不调用业务模型、不保存。每步使用私有子任务及执行单；公开描述不暴露子单、角色标识或正文。执行单仅驻留页面，最多64份，不存档，不从历史还原。
- describeExecution只描述仍有效的单。execute绑定原任务／聊天；并发重复调用共用同一次执行，完成后返回缓存结果，不重复生成或保存。forgetExecutions／clearExecutions撤销并清理子单。
- 不含蓝图生成／续写（用户要求跳过）、设置修改、库操作、代码资产、ST角色卡导入。既有蓝图文本／结构／进度编辑不受影响。

## 当前性与连续执行

准备时绑定完整聊天元数据、聊天正文与上下文、业务设置、角色、Agent及Provider对象／函数。暮羽自身设置不进入业务设置指纹。仓库与其他角色条目同时比较引用和内容，拒绝相同内容的并发替换。

只有trial_completed、no_result、applied_confirmed允许继续。已确认保存后，只允许本步骤对应角色的记忆／档案路径或NPC仓库变化；其他元数据、角色条目引用、仓库、配置或上下文变化均停止。验证通过才刷新后续子单的修订基线，并核对其公开效果与最初准备完全一致。不能无条件重新读取并接纳新基线。

此规则依赖原受控端口的applied_confirmed合同，不允许接入可伪造状态的任意用户代码端口。未知保存、部分完成、并发变更、取消或超时都停止后续步骤，零自动重试，已确认写入保留，不做整仓回滚。

## 结果与预算边界

整单不是原子事务。结果逐步标记not_started、运行／业务终态及保存确认；整体为completed、partial、outcome_unknown或not_started。历史回执不证明当前状态，也不授予权限。整体超时默认290000ms，支持1–290000ms，不为每一步重置期限。取消不允许原生未排空请求迟到写入，物理busy仍由业务管线管理。

上下文快照有16MiB保护；聚合结果超过22000 UTF-8字节时省略长正文并标记outputOmitted，保留步骤状态，不删除已保存内容。这个返回上限不替代应用层的预扣预算或模型调用限制。

第二轮已接：精确整单prepare／execute工具、task-only一次批准、按选定步骤声明读取依赖、调用前统一预算核验、原调用授权续接及双语卡片。不能把现有变量／配置执行整单的权限扩展到业务生成；未知结果不得重放。

验证：新增38项真实业务管线确定性测试；相关专项201项通过，全量2664项中2663通过、1跳过、0失败，17/17历史BUG契约通过。未调用付费模型，真实ST路径待验收。
