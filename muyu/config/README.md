# 暮羽配置领域契约

本目录管理可编辑配置的登记、选择性读取、纯预览与写入前条件。业务值仍存放于插件 settings；没有新增配置仓库，也不使用配置档导入作为通用写入器。

## 有业务效果的开关

当前字段与覆盖分类以 registry.js 和 coverage.js 为准；新增默认键须通过覆盖断言。supported 含部分接入对象：`profileLibraryAutoLoad` 仅三项叶字段已接入，目录用 partial/pendingFields 明示剩余子字段，不表示整个对象任意可改。

- 开放 `profileLibraryAutoLoad.enabled / overwriteExisting / importTemplate`，保留整个既有策略作为前置基线，但不把资源正文放进上下文。这三个布尔选项可共同预览，不可与其他设置混合；缺失或不支持的旧策略拒绝，不在暮羽路径静默补默认值。
- 调用原 `updateAutoLoadSettings` 队列保存，不执行 autoLoadForCurrentGroup、不导入包、不生成。自动补缺影响后续启动或聊天切换；覆盖已有、应用模板也影响原手动导入所用默认选项。预览显示现有匹配模式及风险开关；不宣称当前存在可用包或匹配角色。
- 模式、固定包 ID 与匹配规则在普通开关草稿中只读作依赖，修改走 [选择策略模块](../modules/selection-editor/README.md)。自动加载路径强制 matchNameOnly=false；GUI 的该选项仍可能用于手动导入。固定模式但空 fixedId 在现有运行时退回最佳匹配；普通开关草稿不隐含选书／选包。
- 开放单字段 `customPromptsEnabled`，调用原 `setMasterEnabled` 业务队列注册／注销自定义 Prompt Provider，不删除条目、不改正文、不执行 render 或模型请求。启用只注册当前有效且单项启用的条目；后续 Prompt 引用可能将内容送入模型或参与递归解析。此开关不授予独立 Provider 执行权限。
- `muyu/host/settings-switches.js` 负责窄适配；两个业务 API 新增可选同步 beforeApply 钩子，在队列实际轮到操作时复核基线及忙碌状态，旧 GUI 调用不变。自动加载正在执行时拒绝暮羽修改加载策略。不要将注册等业务效果放在可忽略异常的 UI 回调里。
- 保存失败沿用各业务系统原有的字段级条件恢复及注册状态重建，保留无关并发修改；writer 报 outcome_unknown，不宣称落盘成功或绝对未执行，不自动重试。成功无本操作持久化凭据则 applied_unconfirmed。复用 v2 回执和 configSettings 来源权限。
- 暂不进入混合整单或生成配置档，避免对象合并或遗漏业务注册。UI 仅同步开关与摘要，保留编辑器和输入草稿。
- 回归入口：`muyu-settings-switches.test.mjs`；控制器分别覆盖普通审批、全权限及仅预览。未做真实模型或真实宿主 UI 验收。

## 蓝图总开关

- `storyBlueprintEnabled` 必须单独成草稿。读取开关只需 configSettings；预览还需当前聊天 variables 读取授权，绑定当前聊天、完成变量定义与存储值、开关及自动续写设置基线。
- 启用：完成变量不存在时创建插件所有的布尔 global 变量；已有兼容变量按现有蓝图语义设为自动更新、手动注入，保留规则等其他字段。启用和禁用都重置当前聊天完成值为 false；禁用且变量不存在则不创建、不保存聊天。
- 名称须为运行时可直接使用的规范 ID；非规范名称、孤立值、重复定义、锁定、非布尔/非 global、外部 owner 或内部 guard 冲突均拒绝，不擅自覆盖。这比旧 GUI 更保守；应先在原变量编辑器处理冲突。
- 两域顺序：完成变量修改并确认聊天保存 → 再检查目标、变量和设置基线及忙碌状态 → 写入全局开关并请求保存。切聊天、相关并发变化或保存失败阻止后续步骤；无关变量更新保留，不进行整仓回滚。全局保存未知不伪装成持久化成功。
- 不修改蓝图正文、节点或模式进度；不修改其他聊天完成变量。不立即生成；开启后已有自动续写规则可能带来后续模型调用。
- v2 回执增加可选 `blueprintToggle`，分别记录 chatSave/settingsSave；历史携带 variables 来源权限，导入不会恢复批准。完成变量日志保留有界记录，不伪造消息锚点。
- 当前不允许放入 task-bundle 或 generated-profile；全权限仅在用户明确要求应用且模型设置 apply=true 后经原协调器执行，单纯预览仍不写入。
- 回归：`muyu-blueprint-toggle.test.mjs`，控制器普通审批/全权限/仅预览，以及中英文卡片渲染。

## 语言与调试

general 领域：`lang`（仅 zh/en）与 `debugLogging`（严格布尔）。

- 复用 settings 的读取、合同、纯预览、精确批准及全权限显式 apply；读权限沿用 configSettings。可进入现有 settings-only 或混合整单，不创建新的工具。未指定字段保持不变。
- 语言只影响插件界面及后续语言相关内置文本，不翻译历史、自定义 Prompt，不修改 ST 全局语言。`ui/general-settings-view.js` 只更新普通标签和控件，不把已保存历史文本覆盖到编辑器；悬浮框以 preserveActive 更新外壳语言，当前业务视图保持挂载，完整翻译下次打开生效。保留未发送消息、当前窗口编辑内容；部分旧动态内容仍遵循原刷新时机。
- 调试开关控制后续插件调试输出及相关追踪；开启提示可能记录业务输入／输出等隐私资料。关闭不清除旧日志，不停止已开始的采集，不授予终端、日志正文或密钥读取权。
- 这两项是用户个人偏好，不加入暮羽生成的剧情配置档；profile.preview 明确提示使用 settings.preview。已有外部配置档导入契约不在本轮扩展范围。
- 保存沿用普通配置写入结果：异常不声称落盘成功，内存可能已变化；不整仓回滚或覆盖并发编辑。UI 刷新失败不改变保存结果。
- memoryTokenBudget 和 llmJsonSchemaHint 无运行消费者，不开放无效写入；蓝图与业务开关使用上方专用合同。
- 回归：`muyu-general-settings.test.mjs`、控制器全权限实际保存／仅预览、floating-ui 保留挂载测试，并检查整单和生成配置档边界。

## 用户可读展示

推断边界：`read-evidence.js` 只计算单次读取的 requestedCount／returnedCount／missingFields，null、false、空串是返回值，不视为缺失；数量不证明值类型合法、执行成功或持久化。标注coverage=this-read-only、runtime=not-observed、persistence=unknown。整任务覆盖应合并成功读取的原字段ID，不数合同查询、目录条目或尝试调用。catalog补代码计算的fieldCount/domainCount，仅是目录规模，不是已读数量。

自动提取间隔的字段合同及readCaution由memory-rules所有者维护，settings.read按本次请求附上，不自动扩读开关或运行状态。间隔是新增消息阈值，不能从单值读推出“每N条必触发”。账本开关不证明决策产生、历史写入或落盘；导演世界书注入不控制worldBooks/worldBookImportance等独立Provider，开启也不证明激活或注入。空串按各字段合同解释：提取/压缩Prompt回退内置、Schema保留宽松解析、渲染模板保留旧版格式，不统一称默认。所有修改仅用于读取表达/合同，原值、schema、依赖、权限和写入不变。

范围承接：目录只负责发现，不要求后续全量读取。局部问题选择目标及必要依赖；判断当前生效的选人人数须读取判断模式，不能从人数值猜模式。只读取人数且本响应没有模式值时，工具补充 applicability 证据缺口说明；不自动增读模式，不改变返回的 fields/values 或读取授权。单独问一个开关或间隔仍可只读那一项；模型不可把有条件机制解释成已启用或已执行。

表达合同补充：设置目录明确区分 supported／pending／专用 writer／动态来源；目录不是 GUI 清单，出现键或 writer 不证明可读写、有界面入口或已授权。设置读取新增本次内存观察的时效说明；最多8个字段时提供复用原 GUI 名称与单位的 `answerView`，只含开关、数值及已映射枚举，不重复 Prompt 正文。大批读取返回 null，继续使用完整原值和已有 labels/displayValues，不截掉原证据。

预览工具给模型的响应增加草稿解释：before 是当时捕获的比较基线，after 是提案，不证明当前值、执行或持久化。解释只加入工具响应，不写入私有草稿、批准内容或保存结构；全权限 apply 仍需运行成功及宿主新鲜度校验，以操作回执为准。不得从展示说明反向创建执行权限。

`presentation.js` 显式映射已登记字段到现有 UI 的中英文名称、功能区、单位和枚举文案，通过 `ui/i18n.js` 的纯文本 `uiLabel()` 复用字典，不读取 DOM。目录与读取结果提供 `labels`，字段合同提供 `presentation`；暮羽默认使用界面名称说明配置，只有代码、JSON或排错需求才附原字段 ID。名称不是生效机制或缺省行为的证据，仍需查原合同。

配置草稿、整单内的配置差异、配置档和操作回执共用展示层；技术详情保留原始字段和完整值。长文本只在摘要中截断并标明，完整差异可展开检查。空文本、缺失与 null 分别显示，不泛化为空文本沿用默认。聊天变量差异不套用插件字段映射。执行、批准、校验及持久化结构仍使用原 ID / 原值，不接受显示名称作为写入别名。

记忆参数收口：`memoryKeepRecent` 已开放，范围为全局设置，只有随后点击手动压缩或“撤销最近一次提取”按钮时才使用；后者实际按条数删除，并非按提取批次撤销。`memoryTokenBudget` 没有被记忆生成或注入运行时读取，经典界面标为暂未生效，暮羽不提供写入。`memoryMaxEntries` 使用专用流程：只在当前聊天内预览各角色预计裁剪条数，草稿不可混入其他字段；审批前复核聊天与记忆快照，先写全局设置，再裁剪当前聊天超额旧记忆。全局设置和聊天记忆属于两个保存域，回执分别报告，任一步失败或目标变化可能部分完成，不自动重试或回滚。配置档仍可能携带上限字段，但其应用路径不是暮羽的专用审批流程。

`memoryPrompt` 用于之后的手动或自动记忆提取，先替换角色及已有记忆字段，再经通用 Provider 渲染器处理最近消息与已注册 Provider；缺少 `{{newRecentMessages}}` 时给预览警告，不禁用自定义 Provider 表达。`memoryCompressPrompt` 只用于之后的手动压缩，运行时仅替换四个固定占位符，不执行通用 Provider 渲染；非空新草稿须包含 `{{memories}}`，避免把旧记忆从请求中漏掉。两项均可用空串恢复内置 Prompt，修改设置本身不会提取、压缩或删除记忆；经典编辑器在批准后同步显示，聚焦的未保存草稿不覆盖。

`memoryJsonSchema` 与 `memoryRenderTemplate` 现在也有运行时消费者。Schema 的空串保留原有宽松解析（包括直接数组）；非空文本须符合有界的 `memories` 数组、`event` 字符串、可选 `mood` 字符串结构，不支持新增持久化字段。运行时将 Schema 附于后续提取 Prompt，并在写入前校验输出；这不是所有模型连接的原生 JSON Schema 模式保证。无效的历史 Schema 会明确阻止新提取，不删除旧记忆。渲染模板仅改变之后 `{{charMemory}}` 的纯文本输出，不改变 `{{charMemoryCurrent}}` 或存储数据；空串保留旧版角色分组格式。模板只支持 `charMemory:all/groups` 块和其中的字段查询，不执行其他 Provider。历史无效模板会记录警告并回退旧格式。两项均需预览与单次批准；聚焦的经典编辑器草稿不覆盖。

## 已支持字段

| 领域 | 字段 | 约束与影响 |
| --- | --- | --- |
| memory | memoryEnabled、autoMemoryEnabled、autoMemoryInterval、autoMemorySpeakers、memoryKeepRecent、memoryMaxEntries、memoryPrompt、memoryCompressPrompt、memoryJsonSchema、memoryRenderTemplate | interval 为新增消息条数；工具范围 1–200；keepRecent 工具范围 1–100，仅影响之后的手动压缩和按条数撤销；maxEntries 工具范围 10–2000，独立预览当前聊天裁剪；四项高级文本最多 4000 字符；不开启隐含前置开关 |
| director | mode、topN、llmMaxSpeakers | mode 为 off/formula/llm；人数 1–20；生成/快捷任务进行中不写入 |
| scoring | scoreWeights.mention、keyword、recency、talkativeness | 实际使用完整 scoreWeights.* 路径；非负整数，talkativeness 至少 1；只修改选定叶字段 |
| prompt | llmPrompt | 原始文本，最多 4000 字符；空串使用插件默认 Prompt；不作为 JSON 解析 |
| provider | providerTimeoutMs | 非负安全整数，单位毫秒；0 不超时；保存入口同步后续渲染调用的默认值 |
| scoring | recentMessageCount、consecutivePenalty | 公式最近消息数支持 1–200；连续发言按每条消息扣分，0 为不扣分 |
| scoring | triggerEnabled、triggerScore、initiativeEnabled、initiativeBaseScore | 触发词来自角色资料；主动性为每轮随机加分，基础分不是每个角色的固定得分 |
| director | llmContextDepth、llmRespectOrder、llmHistoryEnabled、llmWorldInfoEnabled | 上下文条数支持 1–200，并被导演、记忆、NPC、强制发言共用；严格顺序会接管 LLM 模式的发言循环；历史开关控制后续决策写入当前聊天的导演记录；世界书开关可能把激活条目正文送入后续模型请求 |
| director | llmCharDescMode、llmCharDescLength | full/slice；切片长度支持 1–4000；角色档案启用时可能改用档案文本 |
| director | llmScriptEnabled、llmScriptPosition、llmScriptContinuity、llmScriptContinuityMode、llmScriptContinuityCount、forceSpeakMode、templateMaxPasses、templateRecursive、templateDebugPlaceholders | 舞台指导只用于后续 LLM 导演/角色生成，注入位置 0/1；连续性依赖导演历史，last/history，history 数量支持 0–100 且 0 表示全部；强制发言为 native/block/llm，block 截停、llm 可能增加模型调用；递归渲染轮数本工具保守支持 1–10，影响多个功能的 Prompt |
| director | llmScriptPrompt、llmScriptWrapper | 剧本风格要求与角色 Prompt 包装模板分别作为原文叶字段预览/批准，各最多 4000 字符。风格要求为空则不附加；包装模板为空时运行时退回纯 `{{script}}`，不等于恢复出厂模板。包装模板先替换剧本，再由通用 Provider 渲染器处理剩余占位符；缺少 `{{script}}` 预览警告 |
| director | llmJsonSchema | Director 与 LLM 强制发言共用的 JSON 输出格式提示文本，不是原生 JSON Schema，也不用于按模板严格校验回复；最多 4000 字符。运行时替换 `{{scriptField}}`、`{{storyBlueprintDoneField}}` 并移除自引用；空串不提供格式提示，只有经典界面的“默认”按钮会写回内置文本。缺少 speakers、剧本或蓝图字段、其他占位符均作预览警告，不自动改写文本；`llmJsonSchemaHint` 尚无运行消费者，不开放 |
| director | llmScriptContinuityWrapper、llmScriptContinuityHistoryWrapper | 分别包装上一份计划及 history 模式中的计划列表，各最多 4000 字符；需历史与连续性开启且当前聊天有计划。只替换第一个 `{{previousPlan}}` 或 `{{previousPlans}}`；空串退回纯 JSON，不恢复出厂说明。默认主 Prompt 显式使用 Provider；自定义主 Prompt 没有两个历史占位符时仅 Director 自动前置，Force Speak 不自动前置。history 轮数 0 是全部历史，可能增加上下文与费用；预览对缺失/重复占位符、模式不适用及自定义主 Prompt 仅引用错误模式给出警告，不读取历史正文 |
| director | llmWorldInfoWrapper | 全局世界书包装模板，最多 4000 字符。后续显式 `{{worldInfo}}` Provider 可在多类 Prompt 中使用；Director 与 LLM 强制发言主 Prompt 未显式引用时也可能自动前置。仅替换第一个 `{{worldInfo}}`；非空模板缺失该占位符会丢失世界书正文，重复或混用其他 Provider 占位符会警告。空串退回纯正文，不恢复出厂包装；总开关关闭、无激活条目时不注入。预览仅读取配置依赖，不读取世界书正文；正文可能发送给配置模型 |
| director | forceSpeakPrompt | 仅后续 LLM 强制发言使用，追加到主 Prompt 尾部；`{charName}` 替换指定角色名，缺失时预览警告。空串使用界面语言对应的内置指令；追加段不再经过通用 Provider 渲染。最多 4000 字符，预览复核模式和语言 |
| prompt | knowledgeText、identityPrompt | 全局文本。知识库仅在 Prompt 引用 `{{knowledge}}` 时输出，内部占位符按字面保留；空串输出为空，工具上限 8000 字符。身份锚定仅在引用 `{{identity}}` 时注入，空串使用内置身份模板；其内部占位符是否继续渲染取决于调用方，工具上限 4000 字符。两者可能把正文发送给模型，不修改旧聊天 |
| npc | npcPrompt | 后续手动 NPC 生成使用；空串使用内置模板，非空 Prompt 单轮渲染 Provider 与 NPC 局部变量。缺少 `{{newRecentMessages}}` 时预览警告；模型仍须返回可解析的 NPC JSON。最多 4000 字符，不立即生成或修改已有 NPC |
| summary | summaryEnabled、autoSummaryEnabled、autoSummaryInterval、summaryReusePrevious、summaryPrompt | 总开关与自动开关独立；间隔按聊天消息条数，工具支持 1–200；接续开关也影响手动总结；Prompt 为原始文本，空串使用默认值 |
| critique | critiqueEnabled、autoCritiqueEnabled、autoCritiqueInterval、critiqueReusePrevious、critiquePrompt、critiqueSchema | 总开关与自动开关独立；间隔按聊天消息条数，工具支持 1–200；接续开关也影响手动点评；Prompt 为原始文本；critiqueSchema 实际是 JSON 输出示例而非标准 JSON Schema，空串使用内置示例 |
| profiles | profileEnabled、profileTokenBudget、profileConcurrency、profileGeneratorPrompt、profileJsonSchema、profileRenderTemplate | 启用后已有档案可参与后续注入，不立即生成；预算为估算值，并发 0 表示不限；生成 Prompt 为原始文本；Schema 使用有界对象结构校验，空串在界面显示默认示例但生成时不传自定义 Schema；渲染模板只替换五个内置字段，未知占位符原样保留 |
| storyBlueprint | storyBlueprintAutoContinue、storyBlueprintMaxNodes、storyBlueprintPrompt、storyBlueprintContinuePrompt、storyBlueprintJsonSchema、storyBlueprintProviderTemplate | 自动续写只在蓝图推进完成后可能触发；节点数是后续生成/续写 Prompt 中的约略目标，本工具支持 1–50；两个原始 Prompt 各最多 4000 字符、空串使用当前界面语言的内置值；输出格式文本与 Provider 模板亦各最多 4000 字符、空串恢复内置值；只影响后续生成、续写或注入；总开关仅作为只读前置状态，不通过通用写入器修改 |
| npc | npcEnabled、npcMaxCount、npcBatchSize、npcGenerateFirstMes | 开关控制新生成；数量上限和每批目标数工具支持 1–200；首条消息只影响新 NPC |
| worldBook | worldBookSourceMode、worldBookMaxEntries | st 跟随 ST 激活书、manual 使用现有手动勾选；不会替用户勾选书。条目上限只作用于后续 worldBookImportance Provider 的结果，本工具支持 1–200 |
| postSpeech | traceMaxEntries、postSpeechMessageEnabled、postSpeechMessagePrompt、postSpeechRoundEnabled、postSpeechRoundPrompt、postSpeechBlocking、postSpeechDecisionLimit | 两个启用开关分别在后续角色消息／合格轮次触发额外模型调用，并可能执行已注册 Capability；Prompt 为原始文本，空串用内置值；blocking 只控制动作等待；两个记录上限分别支持 1–200、1–500 |

当前可编辑字段由 `registry.js` 的闭合白名单登记。导演和公式规则定义集中于 `speaker-rules.js`，自动总结、自动点评、档案、蓝图、NPC、世界书、PostSpeech 与记忆参数分别定义于对应领域规则文件，复用原有注册表与保存端口。消息条数、描述长度、档案预算/并发数与 NPC 数量上限是本工具支持范围，不代表旧 UI 或运行时的强制上限。`coverage.js` 显式登记全部默认顶层键，以及 configProfiles/userProviders/userCapabilities/uiState 四个动态键。尚未接入或明确暂缓的字段分别标为 pending、special-editor-pending 或 deferred，均不提供通用配置写入；未来字段的细粒度校验、生效时机和业务保存适配需在接入时确认。覆盖测试拒绝遗漏或重复的默认键，以及未登记的新评分权重。

## 运行接口

PostSpeech／执行追踪的七项普通配置已开放暮羽写入，普通模式需预览及精确批准；本配置通道不开放 Capability 或脚本源码写入。消息级启用后每条合格角色消息、轮次级启用后每个合格轮次各可能增加一次策略模型调用；两项同时开启时都可能调用。模型结果可执行已注册 Capability，用户扩展实现可能有外部副作用或费用。两个 Prompt 仅影响后续策略分析，渲染时会调用已注册 Provider。`postSpeechBlocking` 在每个执行批次开始时读取当前设置：开启逐个等待 Capability 动作，关闭可并发后台完成并追踪结果；它不取消或跳过前面的模型分析。执行器将每次策略最多处理 8 个意图及 8 个动作、把延迟限制在 30 秒内，并执行 Capability 的每批次数和冷却约束。记录上限的写入仅调整当前页面内存保留量或显示条数，不裁剪聊天中已保存的决策记录。

导演历史与世界书两个普通开关只影响后续导演及强制发言流程，不自动重跑旧轮次。关闭历史记录不会由本次写入清空已存记录；消息删除后的常规历史清理仍可能发生。开启世界书会在后续流程查询 ST 激活条目，可能增加上下文并把世界书正文发给已配置的模型，预览必须提示这一点；不修改世界书本体。两项写入只改各自全局叶字段，忙碌时拒绝，成功后同步经典界面复选框。

导演普通控制另开放九项。`llmScriptEnabled` 生成的是舞台指导文本，不是可执行脚本；`llmScriptPosition=1` 放在对话附近，可能比 0 的 Prompt 开头影响更直接。连续性仅在 LLM 模式且已有当前聊天导演历史时有内容可注入；关闭历史记录开关不删除旧历史，`llmScriptContinuityCount=0` 会使用全部保存的计划，可能显著增加上下文。`forceSpeakMode=llm` 需要独立模型连接并可能增加调用，`block` 则直接截停对应强制发言。模板递归/轮数/未知占位符调试影响导演、强制发言、蓝图等后续渲染；本工具的 1–10 轮限制比旧 UI 和运行时更保守，递归复用同次 Provider 结果而非重新执行 Provider。以上均只写入批准的全局叶字段，不立即启动生成；经典复选框、单选项、数值和相关显隐在应用后同步。

`scriptExecutors` 标为 `special-editor-supported`，通过独立脚本模块读取定义、预览增删改及精确批准保存，不属于普通叶字段写入器。新脚本默认关闭；保存启用版本会允许后续匹配事件自动执行，确认卡必须提示页面权限和超时不能终止副作用。合成测试用scripts.test且仅任务授权；整单可包含精确脚本定义，未确认保存停止后续项。指定脚本真实执行使用prepare_execution→execute，绑定版本／聊天／阶段并单独申请任务代码授权；全权限跳过弹窗但不跳过基线核验。用户 Provider 工作台已独立开放；Capability 写入仍未开放。

统一助手使用 `muyu.settings.catalog` 查询支持状态，`contract` 按领域取契约，`read` 按字段读取当前内存值，`preview` 提交闭合 changes。工具 wire 版本为 1，配置草稿契约版本为 2。字段多时仍按领域逐步提供契约，不发送整个 settings。

memory 沿用 memoryConfig 读取授权，其他第一批领域使用独立 configSettings 授权；旧的宽泛 diagnostics 授权不包含新 Prompt 内容。模型只能生成草稿，真实写入仍由用户在 UI 确认准确差异。未知工具默认拒绝。目录不读取宿主，读取器不访问密钥或未选字段，不调用 Provider render。

预览与实际写入只保留有效差异；草稿另存 requestedChanges，保留所有显式请求字段（包括已等于目标值的字段）及其校验依赖。记忆字段的依赖包括两个开关；公式规则校验当前模式，触发加分与主动性基础分还分别依赖对应开关；描述长度依赖 full/slice 模式；自动总结和自动点评的间隔各依赖其总开关及自动开关。蓝图普通设置依赖总开关；该开关是只读基线字段，不在可编辑目录或通用写入 Schema 内。模式或开关不适用时给出警告，不隐式切换。发布、重新校验和执行前均检查完整请求基线，因此旧 UI 的直接编辑也能产生冲突；无关编辑不会被覆盖。旧 v2 草稿缺少 requestedChanges 时沿用其已有差异契约。模型修订预览是替代候选，不隐式累加；失败的新候选不发布旧草稿。

自动总结只在符合条件的群聊轮次结束后判断阈值，滑动和重新生成不触发。首次开启时，若当前聊天已有足够消息，下一次合格轮次可能立即生成。调低间隔不清空该聊天的覆盖计数。总结生成或重新生成期间拒绝本通道的运行中配置写入；生成失败不会推进覆盖计数。总结内容与覆盖计数仍归属当前聊天，五项设置本身影响所有聊天；Prompt 只影响之后的新总结，重生成上一份时优先沿用该份记录的旧 Prompt。

自动点评同样只在符合条件的群聊轮次结束后判断阈值，滑动和重新生成不触发。首次开启时已有消息达到阈值，下一次合格轮次可能生成；调低间隔不重置覆盖计数。点评生成或重新生成期间，包括异步保存阶段，拒绝本通道的配置写入。点评内容与覆盖计数归属当前聊天，六项设置影响所有聊天；Prompt 只影响之后的新点评，重生成上一份时优先沿用该份记录的旧 Prompt。`critiqueSchema` 的非空新草稿必须是有界 JSON 输出示例，保留对象型的导演与角色点评结构；缺少默认细项时预览警告，不把示例当成严格结果验证器。空串恢复内置示例；更新影响之后的新生成和重新生成，不改写已有点评，经典界面原有自由输入不迁移。

角色档案设置开放六个全局叶字段：启用、注入预算、批量生成并发数、生成 Prompt、JSON Schema 和渲染模板。启用后已有就绪档案可能进入后续提示词，不因该设置写入立即生成；若用户另行开启档案库自动加载，下次启动或切换聊天可能加载档案。预算按字符估算 Token，渲染可能保留首份并压缩后续档案，不是严格上限。并发数 0 表示不限并发；工具支持预算 1–20000、并发 0–20。生成 Prompt 最多 4000 字符，空串恢复内置值；运行时先替换四个角色字段，再交给 renderPrompt 处理已注册 Provider 占位符，不能把其他占位符一律判错。Prompt 只影响后续生成，不改写已有档案或档案 Schema 哈希。`profileJsonSchema` 的非空新草稿须通过暮羽专用的有界对象 Schema 结构校验；这不是完整 JSON Schema 或所有 ST 模型后端兼容性的保证。运行时会解析非空文本并以 `strict: true` 传入生成接口；空串虽然在经典界面显示默认示例，实际生成不传自定义 Schema。调整 Schema 会改变随后计算的 Schema 哈希，但不重写已有档案，也不自动修改 `profileSchemaVersion`。`profileRenderTemplate` 仅替换 `name`、`summary`、`tags`、`motivation`、`relationships` 五个占位符，未知占位符原样留在注入文本中，不执行 Provider，也不自动渲染自定义 Schema 字段；空串恢复内置模板。它只影响后续注入，不改已存档案或 Schema 哈希；预算不足时后续档案可能降级成姓名和摘要。经典编辑器及配置档导入仍保留原有自由输入行为。非启用状态调整参数会预警，但不隐式开启。直接单角色和批量生成到异步保存结束前，均拒绝本通道配置写入。档案库仍走专用入口。

NPC 基础设置只修改四个全局叶字段，不读取或修改当前聊天的 NPC 列表。关闭开关会在业务生成入口阻止新任务，不取消已开始的生成，也不删除已有 NPC；开启不会自动生成。数量上限调低后若已有 NPC 达到或超过上限，新生成会被拒绝；每批目标数超过上限或剩余额度时按运行时规则收紧，模型也可能返回更少。工具仅支持 1–200，旧界面的 `parseInt(...) || 10` 不能可靠设置上限 0，因此本轮不开放 0。关闭状态调整参数、批量数大于上限分别预警，不隐式修改另一字段。生成到异步保存结束前拒绝本通道配置写入；NPC Prompt、列表编辑和角色卡导入仍走专用入口。

世界书普通设置只修改来源模式与重要条目数量上限，不读取世界书正文或手动勾选列表。切到 manual 时预览提示必须已有手动选书；本操作不会替用户勾选、刷新当前聊天世界书注入，或执行 Provider。最大条目数只限制 `worldBookImportance` 的后续结果，不限制其他世界书 Provider 的完整快照。应用后清除扫描缓存并同步经典设置控件，来源模式变化时刷新列表。手动勾选资源仍走原编辑入口。

当前同一草稿只跨越同一个 settings 保存域。运行中限制及属性可写性先检查，然后同步赋值并调用宿主保存入口。没有自动重试、全仓库回滚或跨域原子提交。保存异常、并发更新和持久化未确认如实写入回执。UI 只通知共享快捷操作刷新，不重建整个设置面板或覆盖编辑器草稿。

故事蓝图已开放自动续写、生成节点数、推进模式、层级、生成 Prompt、续写 Prompt、输出格式说明和 Provider 模板八个普通全局叶字段。自动续写仅在启用蓝图、存在可推进蓝图且随后完成时可能启动；节点数仅进入后续生成/续写 Prompt，作为约略目标，不裁剪或改写已有蓝图。本工具支持节点数 1–50、层级 0–1000；经典界面与运行时没有同等硬上限。两条 Prompt 独立生效：空串使用当前界面语言的内置值；运行时先替换 `{{storyBlueprintMaxNodes}}`，再渲染已注册 Provider 和 `{{storyBlueprintFullJson}}`、`{{storyBlueprintProgress}}` 局部资料，最后追加输出格式文本。续写必须有当前聊天蓝图；Prompt 修改本身不生成或续写。非空生成 Prompt 缺少 `{{newRecentMessages}}`、续写 Prompt 缺少蓝图全文或进度局部占位符时预览警告，不禁止自定义 Provider 表达；引用的聊天资料可能发送给配置的模型。经典编辑器在应用后同步，聚焦草稿不覆盖。推进进度现在按 `leaf`、`all`、`level:N` 分槽保存在各聊天中；切换配置不会删除其他槽，目标槽可能从零开始。旧版没有模式标记的完成信号在首次读取时归入当时所选模式，并保留 `legacyDoneSignals` 备份，无法反推它原本的模式。蓝图替换会清空全部槽；“重置进度”只清当前槽。导出和导入可保留全部槽。正在生成或保存蓝图时，本通道拒绝配置写入。`storyBlueprintEnabled` 仍作为这些字段的前置基线参与复核，其自身写入走上述专用双域单字段流程。模式／层级草稿提示分槽切换，不承诺全局进度统计。

完成变量名称是专用单字段草稿，除 `configSettings` 外还需要当前聊天的 `variables` 读取授权。新 ID 必须是 1–64 位小写字母、数字或下划线且当前聊天未占用；不静默规范化、不与其他字段合并。批准后先创建初值为 `false` 的变量并确认当前聊天保存，再写全局名称。旧变量及旧值保留；其他聊天不会立即迁移。首次使用新名称时，如果当地已有同名非插件变量，运行时拒绝覆写和推进并提示冲突。`storyBlueprintCompletionVariableGuard` 是内部归属标记，不暴露为可编辑字段。两次保存不是原子事务；聊天保存未知时不改全局名称，设置保存失败时会留下新变量并逐域回执，不自动删除或重试。已占用的旧名称不能通过此简版动作直接改回。

`storyBlueprintJsonSchema` 沿用旧字段名，但运行时只是把原始文本附加到新建与续写 Prompt 的 `[Output Format]` 后；不解析为 JSON Schema、不交给模型原生 Schema 参数，也不按它验证输出。空串使用内置输出示例；结果仍须能解析出非空 `nodes` 或 `chapters`。`storyBlueprintProviderTemplate` 只控制 `storyBlueprintCurrent` 在可推进阶段的注入文本，使用 `{{current.nodeJson}}` 等点分数据路径作字面替换；未知路径变为空，不执行通用 Provider、循环或代码。空串使用内置模板，蓝图完成时另用固定完成提示。预览对缺少节点数组说明、未知路径、遗漏节点详情或完成变量作警告，不静默补写其他字段；两者均是影响所有聊天的全局设置，只作用于后续请求或注入，经典编辑器同步时保留聚焦草稿。

## 版本、历史与容量

旧 memory-config 草稿和无 version 字段的旧回执继续按原契约处理。新 settings-config 草稿使用 contractVersion=2，回执使用 version=2，保留完整差异。导入历史只恢复历史事实和读取依赖，不恢复操作批准。核对当前配置走只读工具，仅检查该回执字段需要的授权，不受其他回执已过期授权阻塞；异步核对绑定原回执与会话，不跟随当前选中会话变化。模型解释仍遵守历史资料授权。核对不重复应用，也不证明持久化。

Prompt 不截断保存。草稿内容限 24000 UTF-8 字节，另受公共 DTO 32768 字节限制；4000 字符以内仍可能因旧值、编码或组合字段而超预算，此时拒绝生成候选。单独操作记录分别检查边界，避免多条有效记录合并后误触单 DTO 上限。发送给模型的长回执值仅取标记清楚的 500 字符摘录，原始回执与草稿不修改。

## 扩展要求

新增领域应声明闭合字段 Schema、语义依赖、来源/读取授权、运行限制及保存端口，再扩展预览和回归测试。不可执行任意路径赋值。结构化资源、密钥和可执行代码仍需专用流程，不通过扩大这份叶字段白名单绕过注册、输入保护或执行审批。

分层参考了本地 DeepSeek harness 的 settings namespace/validate/applies/revision 和秘密字段投影思路；未引入其框架或复制实现。这里的并发检查依赖真实值，而不是仅供 Agent 自己递增的修订号。

验收入口：`tests/unit/muyu-settings.test.mjs`、`tests/unit/muyu-unified.test.mjs`，以及原有 config-apply/receipts/history/permissions 回归。真实浏览器验收仍需人工进行。

## 自定义 Agent 专用定义编辑器

`customAgents` 已归类为 special-editor-supported，但不进入普通叶字段 settings.read/preview。通过 `muyu.agents.list/read/preview` 与 `customAgentAssets` 来源读取、预览，另由精确批准保存；模型连接和密钥仍不在此范围内。

支持用户定义的八个字段；新增默认关闭，启用注册结果 Provider，自动运行会带来后续模型调用和费用。定义编辑工具本身不生成、不读取或编辑聊天结果。第三轮另设独立执行授权，可按指定保存版本试跑或生成并替换当前聊天结果；不开放结果任意编辑。第二轮已支持纯 Agent 批量操作和用户提供的导出 JSON 导入预览；尚未接入与变量／普通配置／脚本混合的整单步骤。完整容量、并发和语义约束见 [自定义 Agent 模块](../modules/custom-agents/README.md)。

## 自定义 Prompt 单条管理

`customPrompts` 已接入专用编辑器，仍不允许用普通 settings 字段整体覆盖。使用 `muyu.prompts.list/read/preview` 与 `customPromptAssets` 来源，支持单条创建、更新（含改名／启停）和删除，新增默认关闭。普通模式需另行批准完整差异；全权限只对显式 apply 执行。保存走原业务队列、重核版本，保持总开关不变，不渲染 Provider 或调用模型。v12 回执仅记录操作元数据，不携带正文／JSON，不确认持久化。第二轮已支持最多6条批量与导入预览，以及指定版本的只读JSON导出；批量单次审批／保存使用v13回执。导入条目统一关闭，导出不自动下载文件；混合整单尚未开放。详见 [模块合同](../modules/custom-prompts/README.md)。

## 角色档案库第一轮（2026-10-03）

profileLibraries已接专用资源编辑器；通过独立profileLibraryAssets授权与muyu.libraries.list/read/export/preview管理保存的包。支持单包创建／导入／修改／删除和有界JSON导出；不读取当前聊天打包，不立即应用档案或全局模板。删除固定目标会按预览清除选择并关闭自动加载；队列内重核包版本与加载关联，v14回执只含操作元数据。未来自动加载仍可能使用保存的库内容。完整合同见[档案库模块](../modules/profile-libraries/README.md)；当前聊天应用、批量及NPC/蓝图库另轮实现。
### 按领域发现（B轮第二切片）

`muyu.settings.catalog({domain})`仅返回指定领域的字段与GUI标签，附`nextCalls.read/contract`的完整参数。`fieldCount/domainCount`只计本页目录，`totalFieldCount/totalDomainCount`计整个已接入目录；都不是已读值数。其他领域及未接入键在这个投影中省略，不代表不存在。空参数`{}`仍保留原完整目录。

调用建议不读取值、不授权、不要求随后读全领域。已知具体字段时直接按`fields`查询所需合同，跨领域省略`domain`；全领域探索才用返回的领域合同参数。业务Schema、原值、权限及预览审批不变，无缓存。
