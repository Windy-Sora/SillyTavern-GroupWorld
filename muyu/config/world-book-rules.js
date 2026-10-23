export const worldBookRuleDefinitions = {
    worldBookSourceMode: {
        domain: 'worldBook', schema: { type: 'string', enum: ['st', 'manual'] },
        source: 'ui/sections/worldBooks.js',
        description: '世界书来源模式：st 跟随 SillyTavern 当前激活的世界书；manual 使用 GroupWorld 已手动勾选的书。切换模式不更改勾选列表，也不自动加载或注入世界书；影响后续 Provider 读取。',
    },
    worldBookMaxEntries: {
        domain: 'worldBook', schema: { type: 'integer', minimum: 1, maximum: 200 },
        source: 'ui/sections/worldBooks.js',
        description: 'worldBookImportance Provider 返回的重要条目数量上限；本工具支持 1..200，原界面只有下限，没有 200 的强制上限。只影响后续 Provider 结果，不截断原世界书内容或立即刷新当前聊天。',
    },
};
