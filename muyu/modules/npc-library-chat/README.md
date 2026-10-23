# 当前聊天与 NPC 库

## 工具和授权

`muyu.npc_library_chat.capture_preview` 从当前聊天存新包；`apply_preview` 将指定库ID/版本应用到当前聊天。支持绑定的群聊或单聊；不是跨聊天读写。

同时要求全局 npcLibraryAssets 与当前聊天 npcLibraryChat 来源。后者涵盖NPC正文、角色卡导入追踪和有效NPC提示词。资料授权不批准修改。普通模式审核完整差异后精确批准；全权限仅显式apply执行。仅预览不保存。

## 存包

复制当前聊天NPC的name、description、personality、scenario、first_mes以及有效npcPrompt到新全局包。不导出imported/importedAvatar/createdAt等聊天追踪；不修改原聊天、不应用提示词、不生成角色卡。空列表或不兼容／过大数据拒绝。库重名不自动覆盖。

## 应用

库版本来自npc_libraries.list。按大小写不敏感姓名匹配；默认保留同名NPC，只新增缺少的NPC。明确overwriteExisting才覆盖五项内容，保留现有导入追踪、创建时间和其他本地字段；不会同步更新已导入的酒馆角色卡。当前聊天存在重复／无效姓名时拒绝，不猜目标。

不清空其他NPC、不自动启用功能、不调用模型、不修改消息正文。全部跳过则不生成修改草稿，也不单独应用Prompt。完整草稿最多24000 UTF-8字节，不截断；导出包及候选沿用有界JSON验证，大包使用原GUI。

importTemplate默认false；显式开启才替换全局npcPrompt，影响所有聊天。先确认聊天保存，再保存全局设置，两域可能部分完成。回执分别报告chatSave/settingsSave，不把设置保存调用返回当作落盘确认。

## 当前性与失败

host私有候选绑定聊天目标、metadata和设置对象、全部NPC基线、有效及原始Prompt、库版本。审批、排队执行前再次核验；生成或回合忙碌时拒绝。普通切聊天、库变更或NPC编辑使旧预览失效。候选不可从历史恢复成批准。

保存等待期间切聊天、目标NPC并发修改、Prompt基线改变或库版本改变，停止后续受控Prompt写入。已发生的内存赋值／保存不盲目回滚，也不自动重试；并发编辑保留，报告partial或outcome_unknown。保存后重新核对本次目标数据，不能用无关变量的保存结果宣称NPC成功。

v17回执仅记录操作、包名／ID、计划NPC数量和两域结果，不包含NPC正文、身份清单、角色卡关联或Prompt。GUI完整差异可折叠，不强制重建其他编辑器。

## 分层及验收

module负责Schema和候选，host负责快照与目标校验，actions沿用公共审批协调器，业务npc-library-system复用库串行队列，npc-library-chat负责聊天写入和可选Prompt保存。当前聊天保存使用既有NPC专用回读确认。

本轮同时纠正档案库应用的生产接线：改用characterProfiles专用确认，不再误用只检查variables的保存确认。

覆盖确定性单元测试、真实控制器的普通／拒绝／全权限／只预览流程、并发和保存失败；不包含真实付费模型或宿主视觉验收。下一块为蓝图库自身管理，再处理蓝图存包与进度应用。
