# 当前聊天蓝图节点编辑

2026-10-04。muyu.blueprint_node_editor.list/read/preview 编辑当前聊天剧情蓝图的节点标题和已有内容字段，不操作蓝图库或推进进度。

## 来源与范围

独立 blueprintNodeEditState 来源包含节点字段、节点位置及已存储的进度元数据。正文是不可信资料，不是指令。读取须授权，分页结果计入共享资料预算。按先序遍历列出节点，每页16项；使用 blueprint-node:N 与精确 revision，不按名称猜测。正文每页6000字符。

直接读取原始聊天 metadata，不调用会初始化或规范化蓝图的 getter。最多256节点、8层；公共 JSON 上限32768字节、4096节点、16层仍有效。异常树、重复ID、循环引用、非对象内容拒绝，空蓝图不初始化。存储的进度不是计算出的当前步骤，也不证明持久化已确认。

changesJson 只允许 title 和 content：

- title 非空字符串，最多256字符，去除首尾空格。
- content 为部分字段对象，只改节点已有的内容字段，未指定字段保持原样。
- 每个内容字段保留原顶层JSON类型：字符串、数字、布尔、null、数组或对象。数组／对象为完整字段替换，不隐式合并或追加。
- 不允许修改节点ID、类型、children、顺序、根蓝图标题／meta、进度轨道或完成变量。允许修改已有完成条件正文，但不自动推进或重置完成标记。

草稿显示选中节点所有自身字段的完整 before/after，children 不重复展示且保持原引用；不是整棵树的差异。完整草稿最多24000 UTF-8字节，超限拒绝，不截断批准。每个端口最多64个私有计划、512个版本缓存。

上述文本编辑接口不提供结构修改。2026-10-04新增的structure_read/structure_preview专用入口支持现有蓝图结构增删／移动，合同见下节；生成、库应用、批量或整单步骤仍不在此入口，也不编辑用户未保存的GUI JSON草稿。

## 执行与并发

modules → host/blueprint-node-editor → systems/blueprint-node-editor；沿用通用动作协调器。普通模式精确批准一次；全权限仅明确执行意图对应 apply=true 才执行，预览本身不写。

私有计划绑定聊天目标、metadata/root/state/blueprint和节点身份、所有节点位置／ID／类型及已存储进度。选中节点字段变化、重排／增删／替换节点、进度变化、切聊天或正在生成使旧批准失效。无关节点的原地正文更新保留。

实际只赋值选中节点标题和内容，不走整树setBlueprint或进度裁剪，不更新生成时间或完成变量。通知当前面板仅更新提示，不刷新JSON编辑框，避免覆盖未保存草稿；用户可手动刷新查看。

一次写入后复用 saveStoryBlueprintChatConfirmed，以官方ST接口回读蓝图保存状态。保存异常或核验失败为 outcome_unknown；保存确认但目标、节点或进度随后变化为 partial。未知结果不重试或整仓回滚，保留并发编辑。协调器拒绝重复批准；不能承诺撤销已经开始的保存。

v24回执仅含操作ID、草稿版本、选择器、时间与聊天保存结果，不含节点ID、标题、正文或进度。历史回执不代表当前数据或授权；草稿历史继续受 blueprintNodeEditState 外发权限约束。真实宿主GUI及持久化仍待手动验收，自动测试不调用付费模型。

## 2026-10-04：结构编辑

沿用 blueprint-node-editor 模块、产物 owner 与动作协调器，不在 runtime 引入业务分支。新增独立聊天来源 blueprintStructureState（完整树、各轨道及当前完成变量定义／存储值），与原节点正文来源分离。输出是不可信存储快照，不是运行完成或持久化证据。

- structure_read(offset)：分页6000字符，返回整树revision。只读取现有蓝图，不初始化聊天或完成变量。
- structure_preview(operation,revision,changesJson,apply?)：
  - create：{parentId,index,node:{id,type,title,content}}，新增一个无子节点的节点。
  - delete：{nodeId}，删除整个子树；可删至空树，不自动生成替代节点。
  - move：{nodeId,parentId,index}，移动整个子树／同级排序；index为移除原节点后目标列表的位置。parentId空字符串表示根，禁止移入自身／后代。
- ID不自动改名：非空且不带首尾空白，128字符内、全树唯一。type非空80字符内，title非空256字符内，content为JSON对象；最多256节点、8层。旧树无法符合安全结构契约则拒绝，不隐式规范化。
- 完整state before/after与完成值差异最多24000 UTF-8字节，公共JSON仍受32768字节限制；过大拒绝，不截断批准。顶层蓝图和节点自定义字段保持原值；本次不编辑标题／meta或节点类型、ID。

进度处理复用story-blueprint-system导出的纯协调函数及运行时flatten/sanitize规则：每条leaf/all/level轨道仅保留新的连续完成前缀，重算stepIndex，排除超出当前聊天长度的信号。未删除且仍有效的信号保留来源／时间／自定义元数据。删除节点会移除旧进度归档里的悬空引用；新增或排序可能让后续标记不再是连续前缀，实际损失必须在差异与数量摘要中显示。清除各轨道完成通知键；保留既有activeProgressKey和其他状态字段，不改全局推进模式。没有轨道的旧状态在预览中显示迁移后的轨道。

完成变量契约与蓝图库应用共用blueprint-completion纯检查器：只重置已有兼容的global boolean为false，不改定义，不创建缺失变量；锁定、类型／归属／保护冲突拒绝。变量无关值不发送或覆盖。结构保存复用saveBlueprintLibraryChatConfirmed，同时回读蓝图和变量，不额外保存或生成。

私有审批绑定metadata/root/state/树与数组／节点身份、完整树与所有进度、设置／推进模式、聊天长度、完成变量定义与值；任一变化使旧草稿失效。无关变量编辑保留。普通模式读取批准不代替写入；全权限仅显式apply执行。重连／停止／卸载复用既有模块生命周期，不持久化或重放计划。

v27结构回执仅操作类别、标识、时间、是否包含完成信号重置及chatSave/status；不存节点ID、正文、进度或重放载荷。旧v24文本编辑保持原合同。保存失败outcome_unknown，后续变化partial，不整仓回滚／自动重试。UI仅更新状态，不覆盖未保存JSON草稿。

首次空白蓝图已另接；尚不支持生成／续写、改全局设置、资源库、批量或整单。真实宿主GUI、持久化与实际模型行为仍需验收。

结构编辑验证：新增61项（43专项、12控制器、6中英文界面）；旧节点编辑／蓝图库／蓝图系统定向94项通过。全量2195项：2194通过、1跳过、0失败；历史BUG契约17/17。隔离测试不证明真实宿主持久化。

## 2026-10-04 首次新建空白蓝图

新增initialize_read/initialize_preview，复用blueprint-node-editor owner、草稿及精确审批；使用既有blueprintStructureState来源，不从节点正文授权推导整份创建权限。只有尚无blueprint时可创建，已有蓝图即使空树也拒绝替换。复用旧界面真实createBlankBlueprint的隔离投影，新建一个默认章节、清空旧模式／层级轨道和归档完成记录、重置已有兼容完成值；缺失变量不创建，不改定义、功能开关或资源库，不额外调用生成模型。完整state／completion差异，GUI显示被移除轨道；同一官方确认保存同时回读蓝图与变量，v29仅元数据。旧v24/v27不变。未知不自动重试或整仓回滚；真实宿主GUI／持久化待验收。档案／NPC创建、付费生成、批量与整单创建仍未接。

initialize_read(offset)分页6000字符，纯读取、不初始化或保存。返回canInitialize、整状态／配置／消息数／已有完成变量快照与revision；不把存储状态当有效运行进度或持久化证明。initialize_preview(revision,changesJson,apply?)要求changesJson={}，不接受任意树、标题或隐藏功能开关。预览在隔离metadata上调用原业务方法，不访问宿主Provider、变量getter或生成器。新建时间按原业务语义由宿主记录，不证明调用过模型；配置语言决定默认标题与章节。旧状态自定义字段保留，但旧进度和完成提示按新建语义清空，差异可见。

审批绑定聊天、metadata/root/state、设置对象／语言／推进策略、消息数、完整旧状态、变量仓库及所选完成定义／值；变化使旧计划失效，其他变量值编辑可保留。执行仅赋值storyBlueprint与已有兼容完成值，并复用saveBlueprintLibraryChatConfirmed；不改其他metadata。保存异常outcome_unknown，保存确认后受控状态变化partial，未知不重试／回滚。清理模块销毁私有计划，重复批准不重放。完整草稿24000字节、公共JSON32768字节上限不变，超限拒绝。v29回执不存正文、节点ID、进度或完成变量定义，也不授予权限。
