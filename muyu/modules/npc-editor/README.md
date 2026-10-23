## 2026-10-04 手工新建档案与NPC

已接角色档案create_targets/create_preview与NPC create_read/create_preview，新增独立profileCreateState／npcCreateState来源，复用各自owner、草稿与精确批准；全权限仅显式apply执行，预览不会写入。档案绑定已知角色及实际hashChar指纹，只创建标准四字段、标为手工就绪；任何已有记录均保留，归档及共享Schema版本／哈希不变，旧Schema冲突拒绝。NPC按原业务容量和全部酒馆角色／NPC名称检查，大小写及首尾空白重名拒绝；只追加未导入记录，不创建角色卡。两者不开启功能、不额外调用生成模型、不修改资源库或进入整单。专用聊天保存回读，未知不重试或整仓回滚；v30只记类型／状态／保存元数据，无正文或身份。旧v22/v23不变；真实宿主GUI／持久化待验收。下一步为业务付费生成，随后批量／整单、ST消息编辑及整体收口。

# 当前聊天 NPC 编辑

2026-10-04。muyu.npc_editor.list/read/preview 只编辑 GD 当前聊天的 NPC 记录，不是角色卡或 NPC 资源库。

## 读取与操作

独立 npcEditState 来源包含名称、NPC 正文、自定义字段与导入状态。读取须授权，分页结果计入 Provider 共享资料预算；正文是未经信任的资料，不是指令或权限。列表每页16项，正文每页6000字符；使用 npc:N 选择器与精确 revision，不按同名猜测，不接受模型指定其他聊天。

读取不调用会初始化仓库的 getNpcs。最多512个条目，目录和单条还受公共 JSON 的32768字节／4096节点／16层等限制；超过容量拒绝，不截断批准。

update 的 changesJson 只允许 name（名称，非空且最多200字符）、description（描述）、personality（性格）、scenario（场景）、已有的 first_mes（首条消息）。其他文本最多12000字符，可为空。指定文本去除首尾空格；未指定字段保持原样。名称不得与其他 NPC 忽略大小写后重复；不存在 first_mes 时不新增该字段，沿用旧编辑界面。

导入状态、角色卡标识、importId、创建时间和自定义字段不允许修改，且保留原值。编辑已经导出的 NPC 记录不会同步修改 ST 角色卡。

delete 要求 changesJson={}，仅删除当前聊天的该 NPC 记录，不归档、没有直接撤销，不删除已经导出的角色卡。草稿显示完整 before/after 和范围说明。

本轮不提供创建、生成、导入为角色卡、角色卡删除、批量清空、库管理或整单 NPC 步骤。

## 并发与执行

modules → host/npc-editor → npcSystem.applyApprovedEdit → systems/npc-editor。NPC 系统提供共用字段修订号：受批准的更新保留条目身份并更新实际改动字段的修订号，防止旧 GUI 保存失败的补偿回调覆盖新的字段编辑。旧 updateNpc/deleteNpc 行为保持。

私有计划绑定目标、metadata/root/list 身份、选中条目身份和完整基线、列表条目顺序及名称/importId。新增、删除、重排、替换条目、改名或导入状态变化使旧批准失效；无关 NPC 的正文修改保留，不导致选错目标。

完整差异最多24000 UTF-8字节，不截断。普通模式精确审批一次；全权限仅用户明确执行意图对应 apply=true 才执行，预览不写入。协调器阻止重复点击；取消、连接或目标变更不重放未执行操作。

一次修改后复用 saveNpcChatConfirmed，以官方 ST 聊天读取接口回读 NPC 仓库，不用变量或档案保存确认代替。保存异常／核验失败报告 outcome_unknown；保存确认但选中条目、列表布局或目标变化报告 partial。保留并发编辑，不整仓回滚或自动重试。已执行保存不能保证撤销。

v23 回执仅操作、选择器、草稿版本和聊天保存状态，不含名称、角色卡标识、正文和自定义字段。历史回执不代表当前数据或授权；草稿仍遵守 npcEditState 的历史外发限制。真实宿主 GUI 和持久化待验收，自动测试不调用付费模型。

## 手工创建合同补充

create_read(offset)每页6000字符，仅列当前NPC名称、全部已知酒馆角色名称、数量、配置上限及独立editorLimit=512；不读取其他NPC正文。新npcCreateState来源与npcEditState分开。纯system.inspectManualCreation不调用getNpcs，因此空仓库读取／预览不初始化。

create_preview(revision,changesJson,apply?)必须给非空name（至多200字符）和description（至多12000字符）；可选personality/scenario/first_mes字符串（至多12000），统一trim。缺省personality/scenario为空；没有指定first_mes则不添加该键。名称以trim＋小写和当前NPC／全部酒馆角色比对，禁止重名；达到配置上限或512编辑器边界拒绝，不裁剪。只供imported=false、importedAvatar=null、createdAt预览时间，不生成importId、角色卡或修改开关。完整草稿24000字节；其他公共JSON上限不变。

私有审批绑定metadata/root/list身份、列表元素身份／顺序、名字与importId布局、角色名单和配置容量；结构／名称／名单／容量变化拒绝。其他NPC正文原地编辑可保留。原system.applyApprovedCreation追加到同一数组，不替换已有元素，维持既有WeakMap字段修订与GUI保存回滚的并发保护；新记录随后可走旧编辑／删除／显式角色卡导入业务。独立saveNpcChatConfirmed保存回读；未知不重试或整仓回滚，确认后受控状态变化partial。v30不含NPC名称、正文、导入标识或角色名单。未接批量、整单、额外生成或角色卡导入工具。
