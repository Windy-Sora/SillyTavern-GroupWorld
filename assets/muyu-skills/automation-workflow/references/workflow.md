# 自动化参数与运行证据

## 总结与点评

用 `muyu.settings.catalog/contract/read` 核对 summary／critique 字段，不凭名字猜。总开关关闭时已有结果保留，但不注入后续上下文，也不自动生成；开启总开关并不隐含自动生成开启。

autoSummaryEnabled／autoCritiqueEnabled 还需对应总开关。自动检查在符合条件的群聊轮次结束执行，但 interval 的单位是消息条数，不是轮数。保存开关不立即生成；已有消息满足阈值时，之后符合条件的轮次可能触发。降低 interval 不重置当前聊天覆盖计数，也不证明刚才漏执行。

reusePrevious 影响之后手动与自动生成的输入，不改写已有结果。Prompt 空字符串按合同恢复内置文本；重新生成旧记录可能使用记录中的旧 Prompt。点评 critiqueSchema 是 JSON 输出示例，非标准 JSON Schema，不承诺模型逐字段验证。

读取总结／点评正文按 Provider 目录单独申请，结果可能过期或被编辑。当前配置只能解释当前条件；没有过去消息、计数、记录和模型结果，不判断历史失败原因。配置工具不自动获得业务生成工具，实际目录没有相应能力时只说明现有界面入口。

## 发言后策略

postSpeechMessageEnabled：之后每条符合条件的群聊角色消息可能增加一次策略模型调用，再按结果执行已启用的 message／both Capability。

postSpeechRoundEnabled：之后符合条件的群聊轮次结束可能增加一次策略模型调用，再执行 round／both Capability。两项同时开启会在各自条件下增加调用，不是保证每轮固定两次；不立即分析旧消息／旧轮次。

渲染策略 Prompt 可能运行 Provider；用户 Capability 可能联网、改变数据或产生费用。postSpeechBlocking 只控制 Capability 动作是否逐个等待，false 允许后台并发跟踪，不跳过或异步化前面的策略模型分析。

postSpeechDecisionLimit 是执行追踪界面显示的最近决策条数，不是可执行动作数量，不裁剪已存聊天决策。traceMaxEntries 是页面内存追踪保留量，调低会裁剪旧追踪，不修改聊天正文；新追踪还需要调试采集启用。

## 调整与报告

用户只想改阈值就不补开总开关；若目标明确需要打开自动化，预览中显式列出两个开关、依赖、后续费用和外部动作风险。生成参数、调用结果、记录存在、保存确认是四类证据，不能相互推导。

Capability 写入未开放；此技能仅指导已接入设置，不创建／替换任意 Capability 代码。必要脚本或自定义 Agent 使用专用技能和执行权限。取消、超时不保证已开始的网络／代码立即停下。

核对版本：2026-10-05；`muyu/config/summary-rules.js`、`critique-rules.js`、`post-speech-rules.js`、`muyu/modules/catalog.js`。以当前工具合同为准。
