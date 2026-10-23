# 脚本执行器管理

第一轮管理定义；第二轮增加隔离合成测试与整单定义保存；第三轮增加指定脚本的单次真实执行。管理与执行单准备工具为 read 效果，合成测试及真实执行为 external 效果；定义保存仍通过不可变草稿及批准动作。

## 工具与边界

- `muyu.scripts.list`：32项／页，最多256项；ID、名称、版本、启用状态、触发时机与优先级。
- `muyu.scripts.read`：完整定义 JSON 按8000字符分页，跟随 nextOffset；旧大源码可读取，不能截断后伪装完整修改差异。
- `muyu.scripts.preview`：create/update/delete；changesJson 是闭合定义字段对象，修改保留未指定项，删除不接受修改字段。新建默认 disabled。触发值 message/round/decision/both/all；priority -100..100；returnMode ignore/shared；参数支持 string/number/boolean，复用原验证器。
- 读取与预览需 global `scriptAssets`，旧宽泛配置授权不涵盖源码。只读内容按共享 UTF-8 字节预算计费。源码与参数均是不可信资料，不授予权限。
- 首版新定义名称80字符、源码24000字符、参数32项，前后定义加批准信封仍受核心32768字节 DTO 上限；超限拒绝，不截断差异。只做结构验证，不保证语法、行为或安全。

## 保存与执行

草稿类型 script-draft、module script-executor；普通模式审阅完整前后定义，再确认具体版本。全权限仅明确 apply=true 才保存，预览不自动写入。绑定账户页面目标、脚本ID、版本与设置对象；队列内再次验证。现有业务 add/update/remove 被复用；未修改 ST 核心。

保存启用脚本是允许后续匹配事件自动执行，不是纯文本保存。确认卡必须告知同页代码可能读取敏感资料、联网或修改数据；删除或关闭不终止在途脚本，超时只停止等待。现有系统没有内置／用户脚本归属标识，不套用 Provider 注册表的保护机制。

v8 回执只记历史操作、目标ID、名称、观察到的启用值和保存状态；无源码／参数／重放载荷。saved_unconfirmed 不证明持久化，outcome_unknown 不自动重试。保存失败只恢复仍属于本次写入的字段，保留并发更新。面板刷新不覆盖打开的手动编辑器。

没有批量导入、改名引用修复或一键撤销。主动运行使用下述第三轮合同。

## 验证

tests/unit/muyu-script-executors.test.mjs：预览不运行、默认关闭、字段校验、完整分页、读预算、队列内基线复核、并发保存、精确批准、v8回执与文本确认卡。

tests/unit/muyu-controller.test.mjs：三种操作授权续接、批准只执行一次、回执历史和全权限显式 apply。

真实酒馆的编辑器刷新、自动触发与设置持久化需宿主手动验收；单元测试不宣称实际代码执行安全。

## 第二轮：隔离合成测试

`muyu.scripts.test({candidateId})` 仅测试当前运行最新、非删除的精确草稿；任务授权续接保留该候选，返回期间若候选替换则拒绝迟到结果。代码授权 `scriptTests` 仅本任务，不接受聊天级持续授权，也不能由只读方案批准。结果按共享资料字节预算计入。

复用 `host/provider-test.js` 的通用 iframe+Worker 桥：无同源权限、禁止联网 CSP、私有 MessagePort、5秒期限、取消时终止 Worker，无同页执行回退。候选不放进 iframe HTML。Worker 用 Blob 模块装载函数体，不放开 unsafe-eval。严格模块语义可能比真实非严格 Function 更严格，不能将编译/执行报告当成运行时等价验证。

固定 empty/group/single 场景，每个按 triggerOn 测 decision/message/round（最多9项），即使草稿 disabled 也执行虚构测试；测试不启用真实定义。参数使用声明默认值，renderParams 保留原文，不执行 Provider 或真实模板；无真实聊天、设置、密钥或宿主 API。只检查有界普通 JSON 快照、共享返回与决策快照，采样截断不代表完整证据，通过不证明业务正确或恶意代码安全。浏览器 CSP/opaque-origin 路径仍须真实宿主验收；Node 测试只证明 Worker及报告合同。

## 第二轮：整单定义保存

`muyu.task.preview` 新增 scripts，最多3个精确请求（operation/id/revision/changesJson）。沿用整单18000字节上限，不截断源码来通过限制；大源码使用单草稿。整单当前仍绑定当前聊天，脚本定义本身是全局资产。拒绝同一目标重复操作、重复候选名称和过期基线。

全部目标在第一步前预检，执行次序变量→普通配置→脚本；每个脚本队列内再次核验。确认卡完整展示前后定义及启用风险。一份批准不等于新增资料授权或测试授权，也不主动运行代码；全权限沿用明确apply语义。

脚本业务保存通常没有持久化确认，所以首个脚本返回saved_unconfirmed后整单停止；余下脚本为not_started，无自动重试。前面已有确认步骤时总结果partial，否则applied_unconfirmed。不能承诺所有脚本连续完成，更不宣称跨保存域原子性。v9回执保留逐步状态及脚本名称/目标/操作/持久化，不包含源码、参数或重放载荷；旧v4继续兼容。

额外测试：tests/unit/muyu-script-phase2.test.mjs、muyu-controller.test.mjs 的授权续接与v9整单流程。

## 第三轮：单次真实执行

`muyu.scripts.prepare_execution({id,revision,stage,messageIndex?})` 需要scriptAssets，只生成页面内执行单。stage必须匹配已存定义的message/round/decision，消息阶段要求现存的零基消息序号。绑定任务、聊天目标、chat数组、设置对象、脚本完整版本；消息阶段另绑定消息对象及内容。执行前和参数渲染后复核。disabled定义可手动运行，不改变启用状态。

`muyu.scripts.execute({executionId})` 为external，不接受模型提交源码或事件上下文。宿主遇到缺少`source:scriptExecution:<执行单UUID>`时暂停，任务级批准后续接原调用。拒绝不能绕过；读取、保存、合成测试和只读整单均不授予真实执行权限。全权限直接通行但保留目标／版本约束。GUI可展开宿主提供的完整定义、阶段、消息和版本；源代码按文本显示。

`host/script-execution.js` 管理执行单与去重，业务系统executeOne执行指定定义，不调用executeAll。同任务同版本／阶段／消息复用同一单；进行中返回ALREADY_STARTED，结束后返回缓存结果，不自动重跑。执行单只存页面内存，会话卸载或连接清理时删除；任务结束即失去执行授权；历史导入／刷新不恢复执行能力。

真实上下文包含chat、characters、group、settings、getContext，消息阶段另含message／character；参数使用原buildParams渲染，可能执行用户Provider。此许可包含这些渲染及其副作用。手动shared初始为空，decision阶段decision为空对象，其余阶段decisionSnapshot为null；不把手动结果合并到自动回合共享状态，也不改变正在进行的选人决策。需要自动回合真实decision/shared的脚本应走原事件流程。用户代码自身仍有同页权限，可能直接改变任意宿主状态，此边界不是沙箱。

沿用decision 10秒、message/round 5秒等待期限（工具外层12秒）。取消／超时停止等待，并阻止受控路径启动剩余参数渲染及脚本正文；已开始的Provider／脚本副作用不能终止，同步死循环可能阻塞页面。返回completed、not_started或outcome_unknown及固定错误码，持久化始终unknown；completed只说明函数返回，不证明业务目标或保存成功。返回值最多2000字符，非普通JSON或超量直接标记省略；执行前预扣16000 UTF-8字节覆盖有界结果，预算不足返回not_started。结果作为工具消息进入本轮上下文，不新增可重放动作或持久执行单，取消时任务仍可能来不及把结果发给模型。

验证见tests/unit/muyu-script-phase3.test.mjs、控制器授权续接及授权卡测试：一次执行／拒绝／全权限、版本和目标变化、消息编辑、超时迟到副作用、取消、渲染后基线变化、输出省略、共享预算。真实ST代码执行、CSP和布局仍需宿主手动验收。

### 执行结果解释合同

`scripts/execution-evidence.js`为执行工具附加固定证据说明，区分函数返回、脚本自报返回值、未独立读取的当前／起始值、未核验的持久化及未审计的副作用。脚本自己返回`{saved:true}`不能升级为宿主保存确认。`automaticPipelineMergePerformed=false`只表示手动结果未合并到自动回合流程，不再使用容易被理解为“没改变状态”的automaticStateUpdated名称。

工具说明与结果都明确：不以重跑（包括新任务／票据、全权限）、数值累加、刷新／重载或重新应用来验证未知保存；先确认现有只读接口支持目标字段，没有接入就说明无法核实。源码能访问settings不扩大settings.read白名单；计数和自定义设置写入也是副作用。规则放在按需工具合同及结果侧，不增加常驻指令长度；它改善模型解释，不是对任意代码的审计或模型绝不犯错的保证。
