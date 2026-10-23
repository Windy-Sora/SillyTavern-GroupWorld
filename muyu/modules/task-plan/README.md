# 任务方案与步骤关联

2026-10-06：可选`bindRead`port提供`task.bind_read`，用宿主生成的读取证据ID关联当前方案read步骤，元数据类别与当前来源授权仍独立校验，不代表分析完成。`bind_step`可通过`bundleSteps:[{bundleStepId,stepId}]`引用task.preview返回的精确子步骤ID；整单发布布局及真实回执的私有业务身份匹配后才投影子步骤关联，未指定项继续unmapped。旧版本失效，不猜位置／名称，不授予执行权。

`task.plan`只提出方案，必须单独调用，结束规划执行段以供UI读范围审查。读取批准不等于写入或代码授权。步骤稳定身份由application/task-state在生产发布后生成，不由模型自行创建。

可选`bindStep`应用port提供`task.bind_step`。无port时不注册工具／handler，组装时同步能力与中英文标签。输入为精确planArtifactId、planRevision、宿主stepIds与已生成candidateId；关联只在当前Task生效。工具为read effect/public-knowledge，因为仅处理已有私有身份，不读取宿主内容；其handler仍须由应用校验真实方案及候选归属，不可据此获取写入权限。

支持范围和128观察／32关联容量见[状态合同](../../application/TASK-EVIDENCE.md)。草稿生成、步骤关联、应用批准、历史回执与用户目标完成是不同事件。关联标记model-proposed、intentVerification=not-assessed；失败不得按名称／顺序／相同kind自动匹配或重执行。

规划中的availability仍是已有操作能力说明，不是资料来源存在性探测。新关联能力不改变task.plan的交接时机，也不把整单回执子步骤自动对应到提案步骤。
