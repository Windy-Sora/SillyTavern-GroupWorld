const source = (id, title, permission, selector, provider = id, scope = 'chat', format = 'text', reader = 'legacy') => Object.freeze({ id, title, permission, selector, provider, scope, format, reader, outputContract: format === 'structured' ? id : 'text', maxTextChars: 131072, pageChars: 2000, contractVersion: 1 });
export const providerCatalog = Object.freeze([
    source('variableDiagnostics', '当前聊天变量诊断 / Variable definitions and recent attempts', 'source-only', 'item:N', null, 'chat', 'text', 'variableDiagnostics'),
    source('recentMessages', '最近50条消息 / Last 50 messages', 'chat', 'empty'),
    source('chatSummary', '最近已保存的有效总结 / Latest saved active summary', 'chat', 'empty'),
    source('character_profiles', '角色档案标准字段 / Standard profile fields', 'chat', 'character:N'),
    source('charMemory', '角色记忆 / Character memories', 'chat', 'character:N'),
    source('chatHistory', '当前聊天历史正文 / Current chat history', 'extended', 'range:START:COUNT (1-20)', 'recentMessages'),
    source('characters', '当前聊天角色卡 / Current chat character cards', 'extended', 'character:N'),
    source('directorLedger', '最新导演账本正文 / Latest director ledger', 'extended', 'empty'),
    source('directorHistory', '导演历史账本正文 / Director history', 'extended', 'range:START:COUNT (1-10)'),
    source('memoryConfig', '记忆配置原始值 / Raw memory settings', 'diagnostics', 'empty; revision empty; offset 0', null, 'global', 'structured', 'memoryConfig'),
    source('variables', '当前聊天变量（含角色值） / Chat variables', 'source-only', 'item:N', null, 'chat', 'text', 'variables'),
    source('storyBlueprint', '当前聊天剧情蓝图与保存状态 / Story blueprint', 'source-only', 'node:N', null, 'chat', 'text', 'storyBlueprint'),
    source('stChat', 'SillyTavern 当前聊天概况 / Current chat overview', 'source-only', 'empty', null, 'chat', 'text', 'st'),
    source('stCharacters', 'SillyTavern 角色名称目录 / Character name directory', 'source-only', 'empty; search:NAME', null, 'global', 'text', 'st'),
    source('stGroups', 'SillyTavern 群组名称目录 / Group name directory', 'source-only', 'empty; search:NAME', null, 'global', 'text', 'st'),
    source('stWorldBooks', '世界书目录与当前绑定线索 / World-book directory and bindings', 'source-only', 'empty; search:NAME', null, 'chat', 'text', 'stWorldBooks'),
    source('stWorldBookEntries', '世界书条目正文（整个资源库） / World-book entries (entire library)', 'source-only', 'books:START; book:N; entries:N:START; search:N:QUERY; entry:N:M', null, 'global', 'text', 'stWorldBookEntries'),
    source('stPresets', 'SillyTavern 预设名称与选中状态 / Preset names and selection', 'source-only', 'empty; mode:N; search:N:QUERY', null, 'global', 'text', 'stPresets'),
    source('stPresetContent', '酒馆聊天补全预设正文与参数 / ST chat-completion preset content', 'source-only', 'current; saved:N; compare:N; current:prompt:M; saved:N:prompt:M', null, 'global', 'text', 'stPresetContent'),
    source('stPromptOverview', '酒馆提示词构建快照概况（无正文） / ST prompt snapshot metadata', 'source-only', 'empty', null, 'chat', 'text', 'stPromptOverview'),
    source('stPromptText', '酒馆提示词快照与注册注入正文 / ST prompt snapshot text', 'source-only', 'message:N; injection:N', null, 'chat', 'text', 'stPromptText'),
    source('stDiagnostics', '酒馆本页诊断事件（不含正文） / ST page diagnostics', 'source-only', 'event:ID; range:START:COUNT (1-20)', null, 'chat', 'text', 'stDiagnostics'),
    source('serviceDiagnostics', '暮羽服务错误记录（账户级，无正文） / Muyu service errors (account scoped, no bodies)', 'source-only', 'empty; recent:N (1-50)', null, 'global', 'text', 'serviceDiagnostics'),
    source('stPersonas', 'SillyTavern Persona 名称与当前状态 / Persona names and current state', 'source-only', 'empty; search:NAME', null, 'chat', 'text', 'stPersonas'),
    source('stExtensions', 'SillyTavern 扩展目录与配置启用状态 / Extension directory and configured status', 'source-only', 'empty; search:NAME', null, 'global', 'text', 'stExtensions'),
]);
export const providerSource = id => providerCatalog.find(p => p.id === id);
const routingHints = Object.freeze({
    variables: '资源/金币/数值：读取当前聊天存储值；不提供兑换条件或剧情规则。',
    variableDiagnostics: '变量定义与求值尝试的诊断，不替代存储值或剧情规则。',
    storyBlueprint: '任务目标、完成条件、兑换门槛、剧情计划：先读节点目录，再核对相关节点正文。可与变量值对照；不证明实际完成。',
    chatHistory: '剧情发生了什么、角色说过什么：可检索历史正文；不覆盖蓝图或世界书规则。',
    recentMessages: '近期对话正文；不覆盖其他资料来源。',
    charMemory: '角色记忆记录；不覆盖全部剧情规则。',
    stWorldBookEntries: '世界设定与规则：查相关世界书条目；库中存在不证明实际注入。',
    stPresetContent: 'OpenAI聊天补全预设：先读目录，再current读内存配置、saved:N读保存资源、compare:N对照；正文用current:prompt:M或saved:N:prompt:M。白名单投影，不含连接密钥，不保存／切换，不证明最终注入。',
    stPromptOverview: '入口暮羽齿轮→资料与权限→酒馆提示词构建快照。开启仅采集新构建，不能追溯旧请求；available=false停止正文读取。不证明最终发送／生成成功，生产者未知，注册项不证明采用。',
    stPromptText: '独立正文授权；先读本来源目录，available=false即停止。详情须完整传{id,selector,revision,offset:0}，后按continuation续读。chars原始长度、retainedChars保留正文长度，不能用JSON包装估字数。注册项缺席原因未知，不保证消息已合并或未合并。',
    stDiagnostics: '酒馆生成状态与暮羽模型失败：先读目录，再按event:ID或range:START:COUNT读取。需用户先在暮羽配置开启本地采集；不含服务器日志、原始异常或历史全部错误，结束不证明成功。',
    serviceDiagnostics: '历史保存／联网搜索／存储自检报错：只读可选服务当前账户最近30分钟的脱敏分类。先读概况，再recent:N；不含酒馆其他模块、CMD、正文或密钥。服务缺席／旧版即停止，不用其他来源绕行。空记录不证明从未失败，分类不证明根因。',
});
export const publicProviderCatalog = () => providerCatalog.map(({ provider, reader, outputContract, maxTextChars, pageChars, ...p }) => ({ ...p, routingHint: routingHints[p.id] || '' }));
export const sourcePermission = id => providerCatalog.find(p => p.id === id)?.permission || 'denied';
export function sourceParentSelector(id, selector) {
    if (id === 'stPresetContent') {
        const match = /^(current|saved:\d+):prompt:\d+$/.exec(selector);
        return match ? match[1] : '';
    }
    if (id === 'stWorldBookEntries') {
        const match = /^(?:search|entry|entries):(0|[1-9]\d{0,3}):/.exec(selector);
        return match ? `book:${match[1]}` : '';
    }
    if (id === 'stPresets') {
        const match = /^search:([0-7]):/.exec(selector);
        return match ? `mode:${match[1]}` : '';
    }
    return '';
}
