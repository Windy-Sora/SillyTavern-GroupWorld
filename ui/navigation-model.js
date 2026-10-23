// UI-only preferences: never include settings, drafts, keys or chat data.
export const UI_PREFERENCE_KEY = 'group-director.ui-navigation.v1';
// Presentation only: these lists never enable or disable business features.
export const PRIMARY_AREAS = ['overview', 'director', 'story', 'resources'];
export const PRIMARY_FEATURES = {
    overview: ['overview'], director: ['rules'], story: ['profile', 'memory', 'summary'],
    resources: ['agents', 'config-profile'], automation: ['postspeech-msg', 'postspeech-round'],
    advanced: ['help'],
};
export function partitionFeatures(area) {
    const items = FEATURES.filter(f => f.area === area);
    return {
        primary: items.filter(f => PRIMARY_FEATURES[area]?.includes(f.id)),
        more: items.filter(f => !PRIMARY_FEATURES[area]?.includes(f.id)),
    };
}
export const AREAS = [
    ['overview', '导控台', 'Control board'], ['director', '导演', 'Director'],
    ['story', '角色与剧情', 'Cast & story'], ['automation', '自动化', 'Automation'],
    ['resources', '配置与资源', 'Settings & resources'], ['advanced', '高级与帮助', 'Advanced & help'],
];
const feature = (id, area, zh, en, selector, card = null) => ({ id, area, zh, en, selector, card });
export const FEATURES = [
    feature('overview', 'overview', '导控台', 'Control board', '.gd-dashboard'),
    feature('rules', 'director', '发言规则', 'Speaker rules', '#gd-mode-formula'),
    feature('continuity', 'director', '剧本与连续性', 'Scripts & continuity', '[data-card="continuity"]', 'continuity'),
    feature('worldinfo', 'director', '上下文', 'Context', '[data-card="worldinfo"]', 'worldinfo'),
    feature('forcespeak', 'director', '强制发言处理', 'Force-speak handling', '[data-card="forcespeak"]', 'forcespeak'),
    ...[
        ['profile', '角色档案', 'Profiles'], ['memory', '角色记忆', 'Memories'],
        ['npc', 'NPC', 'NPCs'], ['identity', '身份提示词', 'Identity'],
        ['summary', '上下文总结', 'Summary'], ['storyBlueprint', '故事蓝图', 'Story blueprint'],
        ['critique', '剧情评估（批判）', 'Critique'], ['ledger', '导演账本', 'Director ledger'],
        ['variables', '变量', 'Variables'], ['worldbooks', '世界书', 'World books'],
    ].map(([id, zh, en]) => feature(id, 'story', zh, en, `[data-card="${id}"]`, id)),
    ...[
        ['postspeech-msg', '消息反馈（每条角色消息后）', 'After-message feedback'],
        ['postspeech-round', '轮次反馈（每轮对话后）', 'After-round feedback'],
        ['capabilities', '能力模块', 'Capabilities'], ['custom-agents', '自定义 Agent', 'Custom agents'],
        ['script-executors', '脚本执行器', 'Script executors'], ['postspeech-log', '自动化记录', 'Automation records'],
    ].map(([id, zh, en]) => feature(id, 'automation', zh, en, `[data-card="${id}"]`, id)),
    feature('agents', 'resources', '模型连接', 'Model connections', '[data-card="agents"]', 'agents'),
    feature('config-profile', 'resources', '配置档', 'Configuration profiles', '[data-card="config-profile"]', 'config-profile'),
    feature('profile-library', 'resources', '档案库', 'Profile library', '#gd-profile-library-section', 'profile'),
    feature('npc-library', 'resources', 'NPC 库', 'NPC library', '#gd-npc-library-select', 'npc'),
    feature('story-library', 'resources', '蓝图库', 'Blueprint library', '#gd-story-blueprint-library-select', 'storyBlueprint'),
    feature('export-import', 'resources', '导入导出', 'Import / export', '[data-card="export-import"]', 'export-import'),
    ...[
        ['custom-prompts', '提示词数据源', 'Prompt data sources'], ['user-assets', '用户扩展', 'User extensions'],
        ['providerReference', 'Provider 参考', 'Provider reference'], ['template', '模板运行设置', 'Template settings'],
        ['debug', '模板测试与执行追踪', 'Template tester & traces'],
    ].map(([id, zh, en]) => feature(id, 'advanced', zh, en, `[data-card="${id}"]`, id)),
    feature('help', 'advanced', '使用帮助 / 暮羽', 'Help / assistant', '.gd-dashboard-assistant-row'),
];

export function normalizePreference(raw) {
    const value = raw && typeof raw === 'object' ? raw : {};
    const last = {};
    for (const [area] of AREAS) {
        const candidate = FEATURES.find(f => f.id === value.last?.[area] && f.area === area);
        last[area] = (candidate || FEATURES.find(f => f.area === area)).id;
    }
    return {
        version: 1,
        layout: value.version === 1 && value.layout === 'preview' ? 'preview' : 'classic',
        area: AREAS.some(([id]) => id === value.area) ? value.area : 'overview', last,
    };
}

export function readPreference(storage) {
    try { return normalizePreference(JSON.parse(storage?.getItem(UI_PREFERENCE_KEY) || 'null')); }
    catch { return normalizePreference(null); }
}

export function writePreference(storage, state) {
    try { if (!storage) return false; storage.setItem(UI_PREFERENCE_KEY, JSON.stringify(normalizePreference(state))); return true; }
    catch { return false; }
}

export function navigatePreference(state, id) {
    const next = normalizePreference(state);
    const target = FEATURES.find(f => f.id === id);
    if (!target) return next;
    next.area = target.area;
    next.last[target.area] = target.id;
    return next;
}

export function routeForCard(card) {
    const aliases = { jsonSchema: 'rules', variablesMaintenancePreview: 'variables' };
    return FEATURES.find(f => f.id === (aliases[card] || card))?.id || null;
}
