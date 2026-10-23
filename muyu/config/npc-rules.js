const flag = { type: 'boolean' };
const count = { type: 'integer', minimum: 1, maximum: 200 };

export const npcRuleDefinitions = {
    npcEnabled: { domain: 'npc', schema: flag, idle: true, source: 'ui/sections/npc.js', description: 'NPC 生成功能总开关，影响所有聊天。关闭后不能新生成 NPC；不会删除当前聊天已保存的 NPC。开启本身不启动生成，后续仍需手动触发。' },
    npcMaxCount: { domain: 'npc', schema: count, dependencies: ['npcEnabled', 'npcBatchSize'], idle: true, source: 'ui/sections/npc.js', description: '当前聊天允许保存的 NPC 数量上限；本工具支持 1..200，运行时没有 200 的强制上限。调低上限不会删除已有 NPC；若现有数量达到或超过上限，后续生成会被拒绝。' },
    npcBatchSize: { domain: 'npc', schema: count, dependencies: ['npcEnabled', 'npcMaxCount'], idle: true, source: 'ui/sections/npc.js', description: '每次手动生成的目标 NPC 数；本工具支持 1..200，运行时会按剩余额度收紧，模型也可能返回更少。修改不会立即生成。' },
    npcGenerateFirstMes: { domain: 'npc', schema: flag, dependencies: ['npcEnabled'], idle: true, source: 'ui/sections/npc.js', description: '生成新 NPC 时是否要求首条消息；只影响后续生成，不补写已保存的 NPC，也不执行角色卡导入。' },
    npcPrompt: { domain: 'npc', schema: { type: 'string', maxLength: 4000 }, dependencies: ['npcEnabled'], idle: true, source: 'ui/sections/npc.js', description: 'NPC 生成 Prompt 原文；空串使用内置模板。非空内容在后续手动生成时经已注册 Provider 和局部变量单轮渲染，可能读取并发送当前聊天资料；模型仍需返回可解析的 NPC JSON。修改不立即生成或改变已保存 NPC；最多 4000 字符。' },
};
