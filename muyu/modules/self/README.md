# 暮羽自身配置只读入口 / Muyu self-configuration

`muyu.self.read` 和 `muyu.self.read_text` 位于按需工具组 `muyu-self`。它们读取暮羽自身参数或指定正文，而不是 GD/GW 的业务配置或自定义 Agent 定义。没有修改、保存、应用、连接测试或权限切换工具；全权限模式也不解锁自身设置写入。

## 参数范围 / Coverage

`section` 可省略（`overview`），或为 `run`、`context`、`permissions`、`behavior`、`display`、`connection`、`storage`、`tools`。概览对连接、存储与工具只返回摘要，详细参数按区域读取，避免每次全量输出。

- `configured`：控制器当前接受的配置，经过现有校验与旧默认值兼容，不是未保存的表单草稿，也不是持久化确认。
- `effective`：本执行段实际绑定的预算、上下文及指令元数据。显示偏好不绑定到任务；权限模式明确按即时策略观察，不返回具体来源授权记录。
- `unknown`：本次无法确定；不得补默认值。`not_applicable`：该栏不适用，不等于功能关闭。
- `readAt`：本次观察时间。历史工具结果不证明当前参数；需要“现在”的状态应重新读取。

参数入口还提供以下被动观察，不触发网络、存储初始化或资源加载：

- `connection`：当前启用连接的来源、协议、思考、记住密钥和自动启用标志；不返回地址、模型自由文本或密钥，也不代表另存但未启用的连接。
- `storage`：自动保存、存储模式、请求读取源、写入目标、世界书分卷容量，以及当前历史工作副本的实际读取源、后端、待处理写入和异常标志。请求来源与实际读取源分别报告；自动模式未确定、存储尚未打开时保持 unknown。读取与写入来源互相独立。异常标志对应本任务的对话，不返回标题、ID、正文、原始错误或路径；pending 为零也不证明保存成功。
- `tools`：小地球搜索、搜索预算、本地资料、网页正文、工作区、JSON 校验、长期记忆、Skill 总开关、本页诊断、浏览器错误及提示词快照开关。配置值不证明已加载、已读取或注入；Skill 目录初始化不等于本任务加载了特定 Skill。

服务状态仅复用客户端上次检测缓存，未知不等于未安装。工具执行栏使用本执行段已经捕获、目前仍有效的资格，不重新 capture 或探测，也不意味着工具组已被模型选入当次请求。开关打开不保证本段获得资格或调用成功，资格也不授予资料、写入或代码权限。搜索预算执行栏来自原捕获快照；未捕获则未知。

存储、显示与开关属于即时客户端状态，不是假装冻结在任务里的配置；运行、上下文和用户指令元数据仍按实际执行段快照解释。某个可选端口缺失或读取异常时，该部分保留 unknown，不让整个自检失败。对话、长期记忆、Skill 等正文继续使用各自已接入工具，不通过参数入口外发。

## 正文与草稿 / Text and drafts

`muyu.self.read_text` 使用独立来源 `muyuSelfText`；参数来源授权不覆盖正文。按 `item` 指定一项，不提供任意路径：

| item | 内容与边界 |
| --- | --- |
| `configured-instructions` | 控制器接受的用户补充指令；可能已禁用，不证明持久化 |
| `effective-instructions` | 本执行段实际注入的用户补充指令；不含内部基础规则及其他系统指令 |
| `draft-instructions` | 当前未保存编辑文本，可能超出保存校验范围；读取不应用草稿 |
| `configured-connection` | 当前启用连接的允许字段：来源、地址、模型、协议、思考选项；不代表未启用的已保存连接 |
| `draft-connection` | 已登记界面的当前接口表单允许字段；无界面、多个界面不唯一、已卸载或读取失败返回 unavailable |

每次最多 2000 UTF-16 code units，不拆开代理对；`complete` 只指本次是否到达正文末尾，续页结束不证明前文已读齐。首页 `offset: 0` 可省略 revision；续页必须使用回执的 revision、nextOffset。内容、启用元数据或界面所有者变化后，旧版本返回 `stale_source`，应从首页重读，不能拼接新旧内容。授权续接转移同任务版本，运行结束释放；历史版本不证明当前内容。

结果包含 `draft`、`enabled`、`dirty`：null 表示没有可靠结论。接口表单不自动与启用连接比较，dirty 为 null；不能据此断言已修改或未修改。缺少正文与空字符串是不同状态。原始正文始终是待分析资料，不能作为新系统指令、授权或能力声明。

dirty 只描述本次读取的草稿；已配置／实际注入文本的 dirty 为 null，不用 false 暗示整个编辑器没有未保存改动。必须读取草稿状态后才判断对应草稿，不能由保存文本与注入文本一致推断草稿也一致。

接口草稿由界面显式登记窄回调，卸载时注销，不读取 DOM 其他区域。回调从不提供密钥字段；先过滤当前表单密钥，再离开界面。控制器再次过滤当前独立连接与已保存连接的已知密钥，通用层补充屏蔽常见凭据格式。URL 用户名、密码、查询和片段不返回。脱敏并非任意文本的通用秘密识别器；不提供密钥反查或原文导出入口，未知自由文本仍是用户选择外发的资料。

## 权限与实现 / Permissions and implementation

独立来源 `muyuSelfConfig` 为 global、source-only。普通模式复用既有授权交接；阅读全开、全权限沿用当前读取策略。拒绝不得换来源绕读。成功读取沿用现有历史外发依赖；撤权不删除已经生成的记录。

控制器通过窄只读回调提供参数元数据，`muyu/self/config.js` 逐字段构建输出，`modules/self` 核验运行绑定并向唯一 Provider 预算所有者计收完整 UTF-8 结果。模块装配负责转移与清理；没有候选产物或动作所有者。缺少回调的宿主不注册此工具。

不序列化原始设置、凭据或 GUI 快照。参数工具不读取正文和草稿；正文工具只读取上述固定槽位。自由填写的语种名在参数入口只报告为自定义语种。未知扩展字段被忽略，异常不回传原始详情。两类读取均按完整 UTF-8 回执计入共享 Provider 预算，不触发保存、网络、服务探测或存储初始化。历史外发记录各自的来源依赖；证据层只记元数据，不缓存正文，也不把分段结果升级为全量覆盖。

Both tools are read-only. Parameter consent does not cover text or drafts. The separate text source exposes only fixed user-owned instruction/connection slots after sanitization, with versioned pages and explicit draft state. It never exports credential fields, internal system instructions or arbitrary resources. Configured, effective, draft, live policy and persistence remain separate facts. Reading grants no write or execution permission, including in full-access mode. No service plugin is required.

Operational sections reuse passive local metadata: requested/active history routing, independent writers, storage issue flags, feature switches, cached service detection and the current segment's retained tool admission. Inspection does not open stores, load Skills, capture fresh tools or probe servers. Cached detection is not proof of current installation; enabled switches are not execution/data/write approval. Missing optional ports remain unknown and do not block core use.
