const flag = { type: 'boolean' };

export const summaryRuleDefinitions = {
    summaryEnabled: { domain: 'summary', schema: flag, idle: true, source: 'ui/sections/chatSummary.js', description: '总结总开关。关闭时已保存总结仍保留，但不会注入后续上下文，自动总结也不会执行；重新开启可能再次使用已有总结。影响所有聊天。' },
    autoSummaryEnabled: { domain: 'summary', schema: flag, dependencies: ['summaryEnabled'], idle: true, source: 'ui/sections/chatSummary.js', description: '自动总结开关；还需summaryEnabled开启。仅在符合条件的群聊轮次结束后检查，不立即启动生成。启用时已有消息达到阈值，下一次符合条件的轮次就可能触发。' },
    autoSummaryInterval: { domain: 'summary', schema: { type: 'integer', minimum: 1, maximum: 200 }, dependencies: ['summaryEnabled', 'autoSummaryEnabled'], idle: true, source: 'ui/sections/chatSummary.js', description: '自动总结阈值，单位为聊天消息条数；本工具支持1..200，原界面和运行时没有200的强制上限。修改后不会重置当前聊天的覆盖计数；降低阈值可能在下一次符合条件的轮次触发。' },
    summaryReusePrevious: { domain: 'summary', schema: flag, dependencies: ['summaryEnabled'], idle: true, source: 'ui/sections/chatSummary.js', description: '生成总结时是否把上一份有效总结与新增消息合并作为输入；同时影响手动和自动生成。不会改写已有总结。' },
    summaryPrompt: { domain: 'summary', schema: { type: 'string', maxLength: 4000 }, dependencies: ['summaryEnabled'], idle: true, source: 'ui/sections/chatSummary.js', description: '总结生成使用的原始 Prompt 文本，不是 JSON Schema；空字符串使用当前语言的内置 Prompt。只影响之后的新总结；重新生成上一份总结时优先使用该份记录的旧 Prompt，不会改写已有总结。本工具最多 4000 字符，草稿还受 UTF-8 字节预算限制，不截断保存。' },
};
