# 资源保存与应用合同

## 分清库和配置档

角色档案库用 `muyu.libraries`，NPC 库用 `muyu.npc_libraries`，蓝图库用 `muyu.blueprint_libraries`；均 list→完整 read→精确 preview，export 返回对应格式 JSON。库源授权不自动允许当前聊天读取／写入。create 导入用户提供的包；update 的 exportData 是整包替换，不是自动深度合并。删除使用空对象，保留未指定字段。

包各有格式与容量限制：档案 profile-export、NPC npc-export、蓝图原始 v1 树或 group-director-story-blueprint 包。按当前 schema 生成，不把一个包换个 type 当另一种。完整前后差异超过当前 24000 UTF-8 字节就拒绝，不截断资源。导出不是后台文件写入，不自称已下载或已备份。

## 从聊天存包

`muyu.library_chat.capture_preview` 将当前群聊启用成员的 ready 档案存成新包，含当前有效生成 Prompt／Schema／渲染模板，不含旧归档或禁用成员档案。

区分“包里保存了模板”和“模板已应用”：档案包的 exportData.template 保存 generatorPrompt／jsonSchema／renderTemplate，不得说“不含生成模板”。capture 的顶层 template:null 只表示此次不修改全局模板，不表示嵌套资源没有模板。以实际候选的嵌套 exportData 和警告解释，不能把顶层空值外推到整个包。

`muyu.npc_library_chat.capture_preview` 存 NPC 内容及有效 NPC Prompt，不携带角色卡导入跟踪。`muyu.blueprint_library_chat.capture_preview` 默认不携带进度；includeProgress=true 须明确要求。新包不覆盖同名旧包，不改变当前聊天或触发模型。

## 应用到聊天

档案 apply_preview 默认按内容 hash、再头像＋姓名匹配，保留所有已有记录，不导入模板、不只按姓名匹配。overwriteExisting、matchNameOnly 仅明确请求时开启。importTemplate 会替换全局档案生成 Prompt／Schema／渲染模板，影响所有聊天；聊天先保存、模板后保存，可能部分完成。无匹配／全跳过不产生模板单独写入。

NPC apply_preview 按姓名忽略大小写匹配，默认保留同名记录，不导入 Prompt。明确覆盖时保留已有卡跟踪，但不更新卡；importTemplate 会修改全局 npcPrompt。其他 NPC 保留，无角色卡创建／业务生成；全跳过不产生 Prompt 单独修改。

蓝图 apply_preview 是整树替换，不合并节点。includeProgress 默认 false，重置所有旧模式／层级及旧版进度；true 也会按导入规则整理成连续前缀并限制消息位置，不保证原样恢复。当前推进模式／层级不改；已有兼容完成变量重置 false，不自动创建。先展示完整最终状态，不把“携带进度”说成剧情已完成。

“携带进度”携带的是资源包内的进度，不是保留当前聊天旧蓝图的进度。不能建议“想保留当前进度就勾选携带进度”：包内无进度时勾选也不能保住旧记录；即使有，也不是将两套进度合并或原样恢复。用户要求保留当前全部进度时说明整树应用不保证这个目标，不自动覆盖；可先讨论现有树的定向编辑方案，具体进度后果仍以其精确预览为准。

## 加载策略与全局配置档

档案自动加载用 `muyu.selection.read/preview` 的 profile-autoload 专用入口，核对现有包和策略。保存策略不立即加载；matchNameOnly 不可写，不能用全局 settings 绕过。删除固定档案包可能清空固定选择并关闭自动加载，须展示该关联变化。

`muyu.profile.preview` 生成命名的可复用 GroupWorld 配置档；settingsJson 为支持的叶字段，省略字段应用时保持原值。只预览，不修改实时配置；全权限明确保存到“我的配置档”才使用 save=true，不是 apply。此路径排除密钥、代码、聊天数据、特殊开关／容量／蓝图完成字段、scoreWeights 和个人语言／调试偏好等，按当前合同核对，不能承诺全插件无损备份。

所有回执是历史结果。partial／outcome_unknown 不重跑应用，不以整包旧快照覆盖并发修改。

## 无变化不是损坏

返回 state=no_changes／LIBRARY_NO_CHANGES 时，按本次匹配与保留已有策略没有可应用的差异，未生成可执行草稿，也未启动聊天或全局模板保存。NPC同名且不覆盖时全跳过是正常结果；档案无匹配也可能无需变更，不能说库损坏或建议原样再试。只有用户提出新的明确覆盖／匹配要求后才重新预览，不能为了产出草稿自行打开覆盖或模板导入。

包内Prompt为空不等于导入模板不会修改全局Prompt：有实际NPC变更且明确importTemplate时，空值也可能覆盖旧值。此次无变化不写模板，是全跳过规则的结果，不是Prompt为空的推论。

核对版本：2026-10-05；`muyu/modules/profile-libraries/`、`profile-library-chat/`、`npc-libraries/`、`npc-library-chat/`、`blueprint-libraries/`、`blueprint-library-chat/`、`profile-draft/`、`selection-editor/`。实际合同优先。
