# 记忆配置草稿模块

2026-09-24。只生成、校验和预览内存草稿，不接GUI、不写GD配置、不导入配置档、不导出ZIP。Broker仍只允许read，无新增业务写入权限。参考Claude Code的提案/执行分离和DeepSeek harness的协作状态/权限分离，未复制代码。

## 文件职责

- contracts.js：四个字段的合同、来源、范围和说明。支持memoryEnabled、autoMemoryEnabled、autoMemoryInterval、autoMemorySpeakers。间隔1–200整数是首版草稿支持范围，对应UI标注；不是宣称运行时硬上限。默认值只作说明，不填入草稿。
- preview.js：白名单基线读取与纯函数预览。拒绝未知字段、类型转换、空候选及越权字段；生成最小config-profile结构。diff只保留相对基线实际变化，未指定字段不变；开关未启用只产生警告，不补开。
- index.js：只读工具注册、可信Run绑定、候选缓存、发布与已保存草稿复核。没有apply/import/saveSettings回调或业务系统依赖。

## 可信组装

createConfigDraftModule({getSettings,getTarget,maxRuns?})每个应用实例独占。getter必须同步、无副作用，只在白名单投影中读取配置；默认最多128个Run记录。组合层在startRun调用前执行bindRun({runId,taskId,target,allowedFields,previousArtifact?})，再注入registry/handlers/allowedTools/policy。allowedFields由可信任务所有者指定，模型不能扩大；目前没有自动解析自然语言为可信授权范围的机制。未来GUI需要展示/确认字段范围，不能直接信任模型的范围声明。

模型工具：muyu.config.contract查询合同；muyu.config.preview({changes})提交候选。合法返回candidateId、空errors和一个previews元素；语义范围/空候选错误返回errors及空previews，不能冒充成功。JSON结构/类型错误由Broker拒绝。候选为Run内最后一次成功预览，显式语义拒绝会清除它；Broker层拒绝不会执行handler，可信调用方不能把旧候选说成最新失败尝试的结果。

publishDraft(app,runId,candidateId)只供可信应用调用，检查运行成功、任务/目标归属、显式候选ID和四字段基线未变。新建config-draft或更新绑定的同任务旧产物，版本/内容不匹配则拒绝。候选不是可供模型调用的保存权限；最终自然语言/代码块不参与正式草稿提取。出版后清除Run缓存；放弃调用forgetRun，应用卸载调用dispose。

## 草稿版本与校验

产物content包括module、producedByRunId、baseline和preview；artifact.sourceRunId保留初次创建来源，续问版本由content.producedByRunId说明本次来源。previousArtifact必须由可信应用从同任务工作区读取；续问changes合并在旧草稿上，未涉及的已有草稿字段保留。若希望撤销旧字段变化，显式改回基线值，则最小manifest中移除该变化。

发布只保存草稿，workspace.validation为null。validateSaved(app,id,expectedRevision)随后重新计算预览、验证最新基线并写入独立校验记录；校验失败不会删除已保存草稿，也不会留下伪造成功结果。修改后旧revision的校验留在旧版本，新版本校验清空。

校验区分structural/range、semantic警告和intent:requires_user_review。字段范围不能完全证明自然语言意图。基线只含四个白名单值（不读凭据、Prompt等），校验记录与基线绑定，不是永久实时有效标记；使用前须重新调用validateSaved。当前只能检查读取时的目标/字段相等，无法发现期间变更又恢复的ABA变化。全局任务同用户可跨聊天，聊天任务仍固定目标；所有生成设置都明确影响所有聊天。

预览生成的drawers固定为profilesAndData，不接受模型提供drawers；它不是权限边界，settings字段白名单才是本模块的限制。结构有效不代表有应用权限，产品当前不提供应用能力。

## 验证

tests/unit/muyu-config-draft.test.mjs含14项测试：最小变更、不补开开关、明确授权开启、拒绝无关字段/越界、无敏感属性读取、版本失效、跨任务与配置过期拒绝、并发草稿编辑和模块清理。测试中的隔离config-profile-system实例运行真实applyProfile，与纯预览差分对比并检查其他设置/变量不变；生产模块不调用该接口。

外部config-run.mjs使用真实DeepSeek思考模式、合成配置与实际应用服务/工作区，3/3场景通过，10请求，报告12560 Token。包含受控注入的非法间隔纠正，不是自然错误率统计。跨Run续问和并发目前由离线测试验证，未做真实宿主/浏览器/GUI验收。
