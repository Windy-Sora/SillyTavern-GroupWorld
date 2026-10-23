const flag = { type: 'boolean' };

export const critiqueRuleDefinitions = {
    critiqueEnabled: { domain: 'critique', schema: flag, idle: true, source: 'ui/sections/critique.js', description: '点评总开关；关闭后已有点评保留，但不注入后续上下文，也不自动生成。重新开启可能再次使用已有点评。影响所有聊天。' },
    autoCritiqueEnabled: { domain: 'critique', schema: flag, dependencies: ['critiqueEnabled'], idle: true, source: 'ui/sections/critique.js', description: '自动点评开关；还需 critiqueEnabled 开启。只在符合条件的群聊轮次结束后检查，不会立即生成；启用时已有消息达到阈值，下一次符合条件的轮次可能触发。影响所有聊天。' },
    autoCritiqueInterval: { domain: 'critique', schema: { type: 'integer', minimum: 1, maximum: 200 }, dependencies: ['critiqueEnabled', 'autoCritiqueEnabled'], idle: true, source: 'ui/sections/critique.js', description: '自动点评阈值，单位为聊天消息条数；本工具支持 1..200，原界面及运行时没有 200 的强制上限。修改后不会重置当前聊天的覆盖计数；降低阈值可能在下一次符合条件的轮次触发。影响所有聊天。' },
    critiqueReusePrevious: { domain: 'critique', schema: flag, dependencies: ['critiqueEnabled'], idle: true, source: 'ui/sections/critique.js', description: '生成新点评时是否将上一份有效点评与新增消息一起作为输入；同时影响手动和自动生成，不会改写已有点评。影响所有聊天。' },
    critiquePrompt: { domain: 'critique', schema: { type: 'string', maxLength: 4000 }, dependencies: ['critiqueEnabled'], idle: true, source: 'ui/sections/critique.js', description: '点评生成使用的原始 Prompt 文本，不是输出示例；空字符串使用当前语言的内置 Prompt。运行时仍会附加独立的 JSON 输出示例，本字段不修改 critiqueSchema。只影响之后的新点评；重新生成上一份点评时优先使用其记录的旧 Prompt。本工具最多 4000 字符，草稿还受 UTF-8 字节预算限制，不截断保存。' },
    critiqueSchema: { domain: 'critique', schema: { type: 'string', maxLength: 4000 }, dependencies: ['critiqueEnabled'], idle: true, source: 'ui/sections/critique.js', description: '点评模型的 JSON 输出示例，并非标准 JSON Schema；非空值须为 JSON 对象，包含对象型 directorCritique 与 characterCritiques，后者每个角色示例也须为对象。空字符串恢复内置示例。只影响之后的生成及重新生成，不改写已有点评；不会按示例逐字段验证模型输出。影响所有聊天。本工具最多 4000 字符，草稿仍受 UTF-8 字节预算限制。' },
};
