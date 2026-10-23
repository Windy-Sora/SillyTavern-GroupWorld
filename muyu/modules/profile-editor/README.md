## 2026-10-04 手工新建档案与NPC

已接角色档案create_targets/create_preview与NPC create_read/create_preview，新增独立profileCreateState／npcCreateState来源，复用各自owner、草稿与精确批准；全权限仅显式apply执行，预览不会写入。档案绑定已知角色及实际hashChar指纹，只创建标准四字段、标为手工就绪；任何已有记录均保留，归档及共享Schema版本／哈希不变，旧Schema冲突拒绝。NPC按原业务容量和全部酒馆角色／NPC名称检查，大小写及首尾空白重名拒绝；只追加未导入记录，不创建角色卡。两者不开启功能、不额外调用生成模型、不修改资源库或进入整单。专用聊天保存回读，未知不重试或整仓回滚；v30只记类型／状态／保存元数据，无正文或身份。旧v22/v23不变；真实宿主GUI／持久化待验收。下一步为业务付费生成，随后批量／整单、ST消息编辑及整体收口。

# 当前聊天角色档案编辑

2026-10-04。muyu.profile_editor.list/read/preview 编辑 GD 当前聊天角色档案，不是角色卡、全局配置档或档案库。

## 读取与范围

独立 profileEditState 来源包含角色名称、当前档案和同角色归档正文。读取须授权且计入 Provider 共享字节预算；内容是未经信任的资料，不是指令或权限。列表每页16项，读取每页6000字符。使用不透明 profile-role:N 与精确 revision 定位角色；同名或已移除角色不按名称猜匹配，不接受原始头像参数。

只读操作不调用会初始化／迁移仓库的 getProfiles/getProfileContainer。空仓库仍保持原样；最多512个角色桶及角色映射，单档案和私有基线受通用 JSON 32768字节／4096节点／16层等限制。超限拒绝而不截断批准。

## 编辑与删除

update 的 changesJson 仅允许 summary（摘要）、tags（标签）、motivation（动机）、relationships（关系）。三个文本最多12000字符，可为空；tags 是最多64个非空字符串的数组，每项最多200字符，保存时去除首尾空格。未指定字段、自定义字段及来源信息保持原样。

沿用旧界面的手工编辑语义：manualEdited=true、state=ready、updatedAt 为预览时刻，该变化完整可见。无正文变化时拒绝空操作；不接受修改头像、名称、哈希、状态或时间的隐藏参数。缺少 profile 对象的失败／待处理档案只能归档，不能凭编辑工具创建正文。

delete 要求 changesJson={}，沿用旧界面的归档语义：移除当前档案，并用它替换同角色的归档记录。草稿显示当前档案的 before/after，以及 archiveBefore/archiveAfter，明确旧归档覆盖风险。其他角色、全局库、角色卡、模板和归档恢复流程不变。

本轮不提供创建、自动生成、永久删除归档、批量操作、归档恢复、任意自定义字段写入或整单档案步骤。

## 执行与持久化

modules → host/profile-editor → systems/profile-editor。私有计划绑定目标聊天、metadata/root/当前仓库/归档仓库身份、选中档案与归档、角色映射、仓库的 Schema 哈希及版本。同角色或 Schema 变化使旧草稿失效；无关角色正文修改保留且不导致错改。完整差异最多24000 UTF-8字节，不截断。

普通模式精确审批一次；全权限仅用户明确执行意图对应 apply=true 才执行，预览不写入。协调器复核版本并防重复调用；取消或切换目标不重放未执行操作。

一次修改后调用 saveProfileEditorChatConfirmed，沿用官方 ST 聊天保存与读取接口，同时回读 characterProfiles 和 archivedProfiles；仅确认当前档案移除不能证明归档已保存。旧档案库应用的保存合同保持不变。

保存异常／核验失败为 outcome_unknown，保存确认但目标、档案或 Schema 改变为 partial。保留内存与并发修改，不整仓回滚或自动重试。历史结果不能当作当前状态。

v22 回执仅包含操作、角色选择器、草稿版本和聊天保存状态，不含角色名、头像、档案、归档及自定义字段正文。草稿本身仍受来源外发授权约束。真实宿主 GUI 与保存验收待进行，自动测试不调用付费模型。

## 手工创建合同补充

create_targets(offset?)每页16个已知角色，selector为profile-character:N，与旧profile-role:N不混用；已有正文／失败／pending／null槽位均不被覆盖，任何已有own-key都拒绝。新来源只包含角色名称与hashChar指纹、所选槽是否存在、共享Schema元数据和当前Schema哈希，不读取角色卡正文、其他档案正文或归档正文。原profile-system新增纯inspectManualCreation，不调用会初始化／迁移仓库的getter。

create_preview(character,revision,changesJson,apply?)要求summary非空，最多12000字符；可选motivation/relationships同上字符串、tags至多64个非空200字符标签。未指定字段用空字符串／空数组。宿主供avatar/name/hash与ready/manualEdited/updatedAt；不接受伪造源字段、代码或任意Schema对象。不承诺满足用户自定义生成Schema，也不将ready当事实核验或持久化证明。共享Schema哈希过期、非法版本拒绝，不顺手迁移旧记录。总角色／档案仓库边界512，完整草稿24000字节、公共JSON32768字节；超限拒绝、不截断。

计划绑定metadata/root/store/archive身份、角色映射／内容hash、Schema配置与共享元数据、所选槽缺失；不相关档案正文或归档原地编辑允许并保留。执行只初始化必要characterProfiles容器并新增该槽；不写归档、profileVersion、profileSchemaHash。独立saveProfileEditorChatConfirmed仍同时回读当前／归档。创建不会调用旧管理界面自动刷新，因为该getter会迁移Schema并覆盖编辑内容；用户可另行打开旧档案区查看，Muyu卡片与回执显示本操作结果。保存未知保持内存改动、不自动重试／全仓回滚，确认后受控状态变化返回partial。清理销毁私有计划；v30不保留姓名、头像、正文或指纹。
