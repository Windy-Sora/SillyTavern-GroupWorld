const flag = { type: 'boolean' };

export const postSpeechRuleDefinitions = {
    traceMaxEntries: { domain: 'postSpeech', schema: { type: 'integer', minimum: 1, maximum: 200 }, source: 'ui/sections/executionTrace.js', description: '执行追踪在页面内存中保留的最大条数；本工具支持 1..200。调低会立即裁剪旧追踪，不修改聊天记录；仅在启用调试采集时产生新追踪。影响所有聊天。' },
    postSpeechMessageEnabled: { domain: 'postSpeech', schema: flag, idle: true, source: 'ui/sections/postSpeech.js', description: '启用后，之后每条符合条件的群聊角色消息可能增加一次策略模型调用，并按结果执行已启用的 message/both Capability；用户扩展 Capability 可能有外部副作用或费用。不立即分析旧消息。影响所有聊天。' },
    postSpeechMessagePrompt: { domain: 'postSpeech', schema: { type: 'string', maxLength: 4000 }, dependencies: ['postSpeechMessageEnabled'], idle: true, source: 'ui/sections/postSpeech.js', description: '消息后策略模型的原始 Prompt；空串使用内置 Prompt。只影响后续分析，不改已有决策。渲染 Prompt 会运行已注册 Provider；本工具最多 4000 字符。' },
    postSpeechRoundEnabled: { domain: 'postSpeech', schema: flag, idle: true, source: 'ui/sections/postSpeech.js', description: '启用后，之后每个符合条件的群聊轮次结束可能增加一次策略模型调用，并按结果执行已启用的 round/both Capability；用户扩展 Capability 可能有外部副作用或费用。不立即分析旧轮次。影响所有聊天。' },
    postSpeechRoundPrompt: { domain: 'postSpeech', schema: { type: 'string', maxLength: 4000 }, dependencies: ['postSpeechRoundEnabled'], idle: true, source: 'ui/sections/postSpeech.js', description: '轮次结束策略模型的原始 Prompt；空串使用内置 Prompt。只影响后续分析，不改已有决策。渲染 Prompt 会运行已注册 Provider；本工具最多 4000 字符。' },
    postSpeechBlocking: { domain: 'postSpeech', schema: flag, idle: true, source: 'ui/sections/postSpeech.js', description: '控制 Capability 动作是否逐个等待完成。true 顺序等待，false 可并发在后台完成并继续跟踪结果；不跳过或异步化前面的策略模型分析。只影响之后开始的执行批次。' },
    postSpeechDecisionLimit: { domain: 'postSpeech', schema: { type: 'integer', minimum: 1, maximum: 500 }, source: 'ui/sections/executionTrace.js', description: '执行追踪页面显示的最近 PostSpeech 决策记录条数；本工具支持 1..500。不是每轮可执行 Capability 数量，也不裁剪已保存的聊天决策。' },
};
