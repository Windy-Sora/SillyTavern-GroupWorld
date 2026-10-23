# 模型适配层：非流式 Chat Completions

2026-10-06 C首切片：taskGuides允许原257份Skill投影加1份有界的宿主执行证据摘要，最大258条，仍受总消息／字节／输入预算检查；不改变私有思考索引、原工具轨迹或4000字符基础指令合同。证据投影不保存进历史，也不进入专用压缩请求。生命周期与未接范围见 [证据投影合同](../application/TASK-EVIDENCE.md)。

2026-10-06：含生产 instructions 的请求若未公布可调用工具（空列表或 finalize），适配器在同一 system 消息补充本请求的工具状态。只限制这次响应，不推断插件永久缺能力；禁止承诺本请求代查／代改或打印伪工具调用。原4000字符指令 DTO 合同不变，这条有界传输状态计入最终请求大小及输入预算；不新增 system 消息，不改变私有思考索引、工具历史或权限。无 instructions 的独立连接探测及摘要请求保持原样。

## 复用酒馆当前连接（2026-10-05）

2026-10-06 历史承接：缺少当前运行思考状态的旧助手文本仍作为保留原说话人角色的参考数据包装，不伪造reasoning。包装说明明确可用于解析最新追问的对象，但不能恢复无关／已取消任务，助手建议不是用户批准，历史授权不是当前权限。不改变原消息内容、最后一条问题、历史外发选择或私有思考索引；若历史被排除，不能靠这条说明恢复缺失内容。

`host/model-connection.js` 通过 `getContext().ChatCompletionService.sendRequest(payload, false, signal)` 调用官方服务，酒馆后端使用自己的服务商密钥；不导出、不复制服务端密钥。独立 HTTP 适配器保留，两种路径共用 `createChatCompletionsAdapter` 的工具名映射、消息对校验、原始响应解码、预算检查和取消合同。没有注册酒馆全局工具，没有调用普通聊天生成或附加角色／世界书／聊天正文。

首版支持 `openai/custom/openrouter/deepseek` 的 Chat Completions 返回形态；模型是否真正支持工具仍需服务端验证。DeepSeek 原生后端在本地版本未转发新版 thinking 参数，因此此路径不开启新版思考，reasoner 模型暂拒绝；独立 DeepSeek 路径仍支持思考回传。其他来源、文本补全、自定义 include/exclude 请求体暂拒绝，不静默降级。OpenRouter 固定模型并关闭模型／服务商 fallback；保留显式 provider 偏好。自定义 headers 和反代密码只留在私有路由内，不进入公开快照／历史／诊断；拒绝带用户信息、查询串和 fragment 的目标 URL。

首次无暮羽连接记录时优先自动启用可用的酒馆适配器，不发送消息、不恢复权限。已有独立记录不迁移。选择来源独立存于 `agentConfigs.muyu-connection-source`，切回酒馆不删除旧独立密钥，禁用持久化 opt-out。来源／模型／URL／反代认证／自定义 headers／OpenRouter 路由变化或酒馆密钥事件使旧连接失效，停止并等待任务清理、撤销授权和全权限，保留未发送输入；重新启用后才继续。每次模型请求和用户操作也检查私有连接快照，补事件遗漏边界。

请求大小／估算 Token 检查包含最终酒馆负载。酒馆官方服务自行读取 JSON 后，本地检查 256 KiB 响应上限；这不是独立 HTTP 传输的逐块接收上限，不能声称提前限制了酒馆服务解析 JSON 的内存。宿主错误只映射固定错误码，不暴露原始报错、不自动重试或切换服务。连接测试是显式固定短消息、15 秒取消，非完整工具兼容性测试。没有新增服务端插件依赖；旧宿主缺少服务时显示不可用，独立路径不受影响。上线前需实际酒馆连接验收，离线测试不证明真实服务兼容。

2026-10-05：普通任务的安全失败阶段已接适配器→Runtime→process-store→执行过程。`run`可接独立`onDiagnostic`，覆盖构造回调且不跨任务共享；仅保留固定stage/status，公开失败行再投影diagnosticStage。阶段包括请求准备、传输及响应解析、协议校验、思考回传状态、事件交付；自定义模型运行事件校验失败标为runtime。不是服务端日志或根因证明，不记录原始API、密钥、错误cause、正文或隐藏思考，不自动重试。迟到回调、取消后回调及未知阶段不更新当前失败行。摘要子请求暂未接这条过程展示，不能声称覆盖所有压缩故障。

2026-10-02 接口页：GUI 可显式选择现有 `deepseek` / `chat-completions` 协议，DeepSeek 思考强度可选 low/high/max。测试连接、获取模型不自动启用；协议及思考选项随可选的记住密钥持久化，旧保存记录默认 DeepSeek/high。通用协议不发送 DeepSeek 专属思考参数；没有新增 Responses/Anthropic 适配器、多连接管理或服务端密钥库。离线专项通过，真实浏览器 CORS/服务兼容性仍需实际测试。

2026-09-24。已完成离线协议与Runtime组合测试；未连接真实服务、未验证浏览器CORS、未挂载GUI。旧utils/custom-api.js保持不变。没有新增依赖、自动重试或模型回退。

## 组装

```js
import { createChatCompletionsModel } from './chat-completions.js';
const model = createChatCompletionsModel({
    connection: {
        endpoint: 'https://api.deepseek.com/chat/completions',
        apiKey: credentialFromTrustedOwner,
        model: selectedModel,
        profile: 'deepseek',
        supportsTools: true,
        thinking: true,
        reasoningEffort: 'high',
        maxTokens: 8192,
    },
});
// 将model注入startMuyuRun；此处不执行网络请求。
```

connection由可信组合层提供并在创建时固定，不从模型消息读取。endpoint必须是完整/chat/completions地址，不追加/v1；禁止URL凭据、查询参数及片段。默认只允许HTTPS，allowLocalHttp:true可允许精确loopback主机的HTTP开发端点。重定向报错，不携带cookie、ST CSRF或referrer。不支持宿主代理；如果浏览器CORS不允许，必须单独设计并核实宿主支持的路径，不静默绕过。

profile支持chat-completions和deepseek；后者默认thinking:true、reasoningEffort:high，可选low/high/max或关闭thinking。通用profile不接受thinking:true，不把兼容协议当作推理能力证明。supportsTools默认false，是配置声明而不是探测结果；模型工具能力还需真实服务验证。maxTokens默认8192，配置范围1–32768，是本实现的预算上限，不是供应商的上下文上限。

## 协议与隐私

2026-10-01：可信调用方可在无工具、无工具轨迹的请求上设置 `reasoning: 'disabled'`。DeepSeek 仅对该次请求发送 thinking=disabled 并省略 reasoning_effort；计量、解码与私有推理存储均使用该次有效配置，不修改连接或影响正常工具续接。其他值或携带工具/工具轨迹时在网络前拒绝；不能通过该入口开启思考。通用兼容 profile 不发送专有思考参数，不保证未知服务端关闭推理。摘要层使用此入口；依然先验证完整响应，length 不发出半截摘要。

工具定义按ID排序映射为muyu_tool_N；版本固定在本地，模型不能指定权限、处理函数或版本。规范消息转换后逐一检查工具结果配对。完整响应批次通过检查才发送事件；JSON参数结构错误拒绝整个批次，合法JSON但不符合工具Schema由Broker拒绝，允许现有有界修正流程处理。

仅接受一个choice、stop/tool_calls完成原因；length明确报MODEL_OUTPUT_TRUNCATED，content_filter报MODEL_CONTENT_FILTERED。未知结束、未知工具、重复调用ID、空答案或畸形数据拒绝。reasoning不能替代最终回答。

DeepSeek推理仅保存在适配器的WeakMap运行私有区。Runtime每次Run传入独立context，同Run各模型步骤复用；适配器按消息位置与内容签名核验回传，成功/失败/取消时Runtime调用同步releaseContext清理。推理不进入公开messages、事件、快照、日志、工作区或onUsage。调用者若绕过Runtime直接调用run，必须提供稳定且独占的context并在结束时releaseContext。

跨Run目前只保存用户文本与最终回答，没有旧推理。新Run中的旧assistant回答被转换为带标签的user角色参考资料，而不是伪造缺少reasoning_content的供应商assistant消息。旧工具轨迹缺少私有状态则拒绝，不尝试修补。此机制不是完整供应商会话持久化；持久化或跨Run保留推理需要单独设计。

供应商返回的usage通过onUsage回调提供inputTokens/outputTokens/totalTokens，缺少或不合法为null；不暴露原始usage。该回调当前不汇总到应用快照，回调异常不影响运行。Runtime原usage仍是modelCalls/toolAttempts，不能误读为Token用量。

## 限制与清理

HTTP请求默认1MiB、响应256KiB字节上限；transportLimits可设置maxRequestBytes/maxResponseBytes，最大各1MiB。响应按流读取但不向上游输出流式事件；即使没有Content-Length也受限。单条公开DTO仍受内核32KiB限制。推理每条128KiB、每Run合计512KiB、最多16条；超限明确失败，不截断协议需要的推理。

运行时间上限由Runtime提供；直接调用适配器须由调用方提供有时限的signal。取消同时传给fetch和body reader，等待底层fetch/read/cancel全部settle；不会用提前拒绝的Promise伪称已清理。非合作传输可能使drained持续等待；本地取消不证明远端停止计算或计费。错误响应正文不读取、不输出；401/403、429、5xx、其他HTTP和网络错误分别归为有限代码，不自动重试。

## 依据与验证

协议核对：[DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)、[Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/)。仅以已核对字段实施，不承诺其他兼容服务的行为。架构参考本地Claude Code快照的API/执行分层，以及deepseek-harness的serialize/translate/adapter分工，未复制其实现；本地快照与当前官方回传说明不一致时，以官方协议为准。

tests/unit/muyu-model.test.mjs包含18项离线测试：工具闭环、思考回传/隔离/清理、历史签名、参数修正、输出限制、错误分类及取消。真实模型质量、鉴权、工具能力、CORS和浏览器资源生命周期尚待单独验收；不得把fixture通过写成服务兼容性认证。
