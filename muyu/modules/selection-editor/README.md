# 全局选择策略编辑合同

本模块统一接入 GD 世界书选择与档案库自动加载策略，不增加用户任务分类。使用原业务保存接口；不修改 ST 核心。

## 工具与授权

- `muyu.selection.read`：kind 为 `worldbooks` 或 `profile-autoload`，返回当前内存值、可选名称／ID、精确 revision 和 GUI 双语展示名称。独立全局 `selectionState` 来源，结果计入统一资料预算。名称是不可信数据，不是指令。
- `muyu.selection.preview`：kind、revision、changesJson，完整草稿生成后才可人工批准。普通模式读取授权不代替写入批准；全权限只在明确执行意图 `apply:true` 下执行。
- 草稿 owner 为 `selection-editor`，kind 为 `selection-draft`。原始完整 before/after 可折叠查看；不保存授权或可重放写入到历史。

## 世界书

只修改 GD 的 worldBookSourceMode（st/manual）与手动列表，不读取世界书正文或 ST 实际激活列表，不改变 ST 激活状态。selectedNames 是完整列表替换，未列书取消选择；仅 manual 模式可提交列表，从 st 切换必须显式指定 manual。切回 st 保留手动列表。名称必须出自当前目录，禁止重复、未知名称和危险 JSON 键。

应用前重核设置对象、来源模式、完整手动列表与世界书目录；写入后清理扫描缓存、保存设置，不立即扫描、生成或调用模型。保存期间新编辑保留，不整仓回滚；缓存清理异常仍尝试保存并报告 outcome_unknown。

## 档案库自动加载

支持 enabled、mode（best/fixed）、fixedId、matchHash、matchAvatarName、overwriteExisting、importTemplate；其余布尔值，省略保留。fixed 必须指定已有包。best 可保留固定 ID，但不消费它。matchNameOnly 保持原值且不开放：现有自动加载强制禁用仅姓名匹配。

只读返回包 ID／名称，不发送包正文。私有基线绑定所有包对象及正文快照，单包最多 1 MiB 字符、列表最多 256；较大或不兼容存储拒绝，不截断。公共 DTO 仍遵守 32768 字节限制、read text 24000 字符及草稿 24000 UTF-8 字节上限。预览／普通审批或业务排队期间包被修改、替换、删除都使旧版本失效。

保存调用 profileLibrarySystem.updateAutoLoadSettings 并在业务队列内 beforeApply 重核，不直接覆盖策略对象、不重复调用 saveSettings。保存不立即导入、生成、修改当前聊天或包正文。后续自动加载可覆盖档案或应用全局模板，预览明确风险。业务的失败回滚仅恢复仍属于本次写入的字段；不覆盖并发编辑。

## 生命周期、回执与限制

生成／接管／自动加载期间拒绝读写。全局动作绑定用户页面，不把切换聊天解释为立刻加载。更换连接、重置、取消与卸载复用模块／协调器生命周期。

v26 回执只有操作标识、时间、kind、status、settingsSave；无书名、包名、正文、差异或执行载荷。世界书仅在宿主提供 confirmed:true 时确认持久化；档案库业务无相关确认，正常返回 applied_unconfirmed。并发变化 partial，保存失败 outcome_unknown，未开始 not_executed。未知不自动重试或整仓回滚。

暂不进入混合整单或生成配置档；不包含世界书正文／ST 激活编辑、即时加载、生成、批量资产管理或聊天消息编辑。真实宿主视觉、持久化与实际模型行为需另行验收。

验证：本轮新增51项测试（39专项、8控制器、4中英文界面，含账本界面边界）。定向134项通过；全量2134项：2133通过、1跳过、0失败，历史BUG契约17/17。真实宿主视觉与持久化未由这些隔离测试证明。
