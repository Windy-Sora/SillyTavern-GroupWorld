import { RUN_RANGES } from '../core/budget.js';
import { MAX_MANUAL_INPUT_TOKENS, SUMMARY_TIME_RANGE } from '../context/policy.js';
import { REPLY_LANGUAGES } from '../instructions/reply-language.js';
import { WEB_RANGES } from '../web/contract.js';

export const SELF_SECTIONS = Object.freeze(['overview', 'run', 'context', 'permissions', 'behavior', 'display', 'connection', 'storage', 'tools']);
const titles = {
    run: ['运行预算', 'Run budgets'], context: ['上下文预算', 'Context budget'],
    permissions: ['资料与权限', 'Data & permissions'], behavior: ['行为偏好', 'Behavior preferences'],
    display: ['执行过程显示', 'Process display'],
    connection: ['AI 接口配置', 'AI connection setup'], storage: ['对话存储', 'Conversation storage'], tools: ['工具与资料功能', 'Tools and data features'],
};
const unknown = () => ({ state: 'unknown', text: '' });
const absent = () => ({ state: 'not_applicable', text: '' });
const known = text => ({ state: 'known', text });
const number = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max ? known(String(value)) : unknown();
const toggle = value => typeof value === 'boolean' ? known(value ? '开启 / On' : '关闭 / Off') : unknown();
const choice = (value, options) => typeof value === 'string' && Object.hasOwn(options, value) ? known(options[value]) : unknown();
const language = value => typeof value === 'string' ? known(REPLY_LANGUAGES.find(([name]) => name === value)?.join(' / ') || '自定义语种（本入口不返回自由文本） / Custom language (free text omitted)') : unknown();

/** Values are constructed field-by-field. Never serialize the caller's configuration object. */
export function projectSelfConfig(section, state) {
    if (!SELF_SECTIONS.includes(section)) throw Error('SELF_STATE_UNAVAILABLE');
    const configured = state?.configured || {}, effective = state?.effective || {};
    const sections = [];
    function add(id, build) {
        if (section !== 'overview' && section !== id) return;
        const fields = [], row = (key, zh, en, unit, current, active = absent(), note = '') => fields.push({ key, label: { zh, en }, unit, configured: current, effective: active, note });
        build(row); sections.push({ id, title: { zh: titles[id][0], en: titles[id][1] }, fields });
    }
    add('run', row => {
        for (const [key, zh, en, unit] of [
            ['modelCalls', '模型调用次数', 'Model-call limit', 'calls'], ['toolCalls', '工具调用次数', 'Tool-call limit', 'calls'],
            ['timeMs', '单轮超时', 'Run timeout', 'ms'], ['maxTokens', '单次模型输出上限', 'Per-call output limit', 'tokens'],
            ['providerBytes', '资料读取预算', 'Data read budget', 'UTF-8 bytes'],
        ]) row(key, zh, en, unit, number(configured.run?.[key], ...RUN_RANGES[key]), number(effective.run?.[key], ...RUN_RANGES[key]));
    });
    add('context', row => {
        const tokens = value => value === null ? known('仅请求体保护（无估算 Token 上限） / Request-body protection only (no estimated-token cap)') : number(value, 4096, MAX_MANUAL_INPUT_TOKENS);
        row('inputTokens', '手动输入预算', 'Manual input budget', 'estimated tokens', tokens(configured.context?.inputTokens), tokens(effective.context?.inputTokens));
        row('autoSummary', '发送时自动整理较早历史', 'Auto-summarize earlier history on send', '', toggle(configured.context?.autoSummary), toggle(effective.context?.autoSummary));
        row('recentTurns', '整理时保留近期问答的参考值', 'Recent-turn reference for summarization', 'turns', number(configured.context?.recentTurns, 1, 24), number(effective.context?.recentTurns, 1, 24), '参考值，不是固定历史截断轮数。 / A reference, not a fixed history window.');
        row('summaryTokens', '摘要输出预算', 'Summary output budget', 'tokens', number(configured.context?.summaryTokens, 1024, 32768), number(effective.context?.summaryTokens, 1024, 32768));
        row('summaryTimeMs', '压缩时间预算', 'Summarization timeout', 'ms', number(configured.context?.summaryTimeMs, ...SUMMARY_TIME_RANGE), number(effective.context?.summaryTimeMs, ...SUMMARY_TIME_RANGE));
        const policy = { auto: '自动允许 / Allow automatically', ask: '授权失效时确认 / Ask when authorization expires' };
        row('historyAuthorization', '已有对话外发', 'Sending existing conversation history', '', choice(configured.context?.historyAuthorization, policy), choice(effective.context?.historyAuthorization, policy));
    });
    add('permissions', row => {
        const policy = { ask: '逐项审批 / Ask for access', all: '阅读全开，修改审批 / Allow reads; approve changes' };
        row('readAccess', '资料读取模式', 'Data read policy', '', choice(configured.permission?.readAccess, policy), choice(configured.permission?.readAccess, policy), '即时策略，不是授权记录；逐项审批按来源及有效范围复用许可，不是每次调用都确认。 / Live policy, not a grant list. Ask mode reuses source consent within its valid scope; it does not require consent on every call.');
        row('fullAccess', '全权限模式', 'Full-access mode', '', toggle(configured.fullAccess), toggle(configured.fullAccess), '仅当前连接；仍不授予修改自身设置的能力。 / This connection only; does not enable self-configuration writes.');
    });
    add('behavior', row => {
        row('additionalInstructions', '启用补充指令', 'Enable additional instructions', '', toggle(configured.behavior?.enabled), toggle(effective.behavior?.injected), '任务栏表示实际注入了非空补充指令，不返回正文。 / Effective means nonempty additional instructions were injected; no body is returned.');
        row('instructionLength', '补充指令长度', 'Additional instruction length', 'UTF-16 code units', number(configured.behavior?.length, 0, 4000), number(effective.behavior?.length, 0, 4000));
        row('fixedReplyLanguage', '固定回复语言', 'Use a fixed reply language', '', toggle(configured.behavior?.languageEnabled), toggle(effective.behavior?.languageEnabled));
        row('replyLanguage', '语种', 'Language', '', configured.behavior?.languageEnabled === false ? known('跟随用户语言 / Follow user language') : language(configured.behavior?.language),
            effective.behavior?.languageEnabled === false ? known('跟随用户语言 / Follow user language') : language(effective.behavior?.language));
    });
    add('display', row => {
        row('processDetail', '执行过程显示', 'Execution detail', '', choice(configured.display?.processDetail, { compact: '紧凑 / Compact', standard: '标准 / Standard', detailed: '详细 / Detailed', verbose: '完整 / Full' }));
        row('theme', '暮羽界面主题', 'Muyu appearance', '', choice(configured.display?.theme, { host: '跟随酒馆 / Follow Tavern', dusk: '暮夜·深色 / Dusk·Dark', light: '晨光·浅色 / Morning·Light' }));
    });
    add('connection', row => {
        const c = configured.connection;
        row('connectionSource', '连接来源', 'Connection source', '', choice(c?.source, { st: '酒馆当前连接 / Current ST connection', independent: '暮羽独立接口 / Separate Muyu connection' }), absent(), '当前启用连接的元数据，不代表另存但未启用的连接。地址和模型文字走独立正文授权。 / Active connection metadata only; endpoint/model text needs separate text consent.');
        row('connectionProtocol', '接口协议', 'API protocol', '', choice(c?.profile, { deepseek: 'DeepSeek', 'chat-completions': '通用 Chat Completions / Generic Chat Completions' }));
        if (section !== 'overview') {
            row('connectionThinking', '开启 DeepSeek 思考', 'Enable DeepSeek thinking', '', toggle(c?.thinking));
            row('connectionRemembered', '记住 API Key', 'Remember API key', '', toggle(c?.remembered));
            row('connectionAutoConnect', '下次打开时自动启用此连接', 'Enable this connection automatically next time', '', toggle(c?.autoConnect));
        }
    });
    add('storage', row => {
        const c = configured.storage, a = effective.storage;
        const sources = { server: '服务插件文件 / Service files', browser: '浏览器存储 / Browser storage', 'world-book': '世界书 / World book', 'account-settings': '酒馆插件设置 / Extension settings' };
        const targets = value => Array.isArray(value) && value.length <= 4 && value.every(id => typeof id === 'string' && Object.hasOwn(sources, id)) ? known(value.length ? [...new Set(value)].map(id => sources[id]).join('; ') : '不写入任何来源 / No write targets') : unknown();
        const live = '当前存储工作状态，不是本任务冻结配置，也不证明保存成功。读取来源和写入目标互相独立。 / Live storage state, not task-frozen config or proof of saving. Read source and write targets are independent.';
        row('historyAutoSave', '自动保存暮羽对话', 'Automatically save Muyu conversations', '', toggle(c?.autoSave), toggle(a?.enabled), live);
        row('historyReadSource', '读取存储源', 'History read source', '', choice(c?.readSource, sources), choice(a?.readSource, sources), 'configured 仅为选定来源，effective 才是已打开读取来源；后者未知时只说“选定”，不能声称实际正在读取该源。 / Configured is the selected source only; effective is the opened reader. If effective is unknown, report the selection, not actual reading.');
        row('historyWriteTargets', '写入存储源', 'History write targets', '', targets(c?.writeTargets), targets(a?.writeTargets), live);
        if (section !== 'overview') {
            row('historyStorageChoice', '历史存储方式', 'History storage mode', '', choice(c?.choice, { auto: '自动选择 / Automatic', 'world-book': sources['world-book'], 'account-settings': sources['account-settings'], invalid: '配置无效 / Invalid configuration' }));
            row('historyBackend', '当前存储后端', 'Active history backend', '', absent(), choice(a?.backend, { ...sources, 'private-files': sources.server }), live);
            row('worldBookTargetMiB', '世界书分卷目标容量', 'World book volume target', 'MiB', number(c?.worldBookTargetMiB, 1, 16));
            row('historyLoading', '历史正在加载', 'History loading', '', absent(), toggle(a?.loading), live);
            row('historyPendingWrites', '待处理历史写入', 'Pending history writes', 'operations', absent(), number(a?.pending, 0, Number.MAX_SAFE_INTEGER), live);
            row('historyHasError', '历史存在待处理异常', 'History has an unresolved issue', '', absent(), toggle(a?.hasError), '只报告是否存在异常，不返回原始错误或存档内容；开启自动保存不代表保存可用。 / No raw error or archive content; auto-save enabled does not prove storage works.');
        }
    });
    add('tools', row => {
        const c = configured.tools, a = effective.tools;
        const gate = '配置栏为当前开关；执行栏为本段捕获后仍有效的资格，并非单纯缓存或用户授权结果。关闭只说明本段不可用，不提供原因，不能推测拒绝、未安装或故障；资格不授予资料、写入或代码权限。 / Configured is the live switch; effective is this segment’s retained admission, not just a cache or a consent result. Off means unavailable in this segment; cause unknown. Do not infer denial, missing installation or failure. Admission grants no data/write/code consent.';
        row('webSearch', '小地球联网搜索', 'Globe web search', '', toggle(c?.webSearch), toggle(a?.webSearch), gate);
        row('serviceStatus', '服务工具上次检测状态', 'Last service-tool detection', '', choice(c?.serviceStatus, { unchecked: '尚未检测 / Unchecked', checking: '正在检测 / Checking', available: '上次检测可用 / Previously available', missing: '上次检测未发现 / Previously missing', legacy: '旧版服务 / Legacy', incompatible: '协议不兼容 / Incompatible', unavailable: '上次检测失败 / Detection failed' }), absent(), '仅客户端缓存，不主动探测，也不证明当前已安装或未安装。 / Cached observation only; no probe or assertion of current installation.');
        for (const [key, zh, en] of [['documents', '本地资料检索', 'Local document search'], ['pages', '公开网页正文读取', 'Public web page reading'], ['workspace', '工作区文档草稿', 'Workspace document drafts'], ['json', 'JSON 语法校验', 'JSON syntax validation']]) {
            if (section !== 'overview' || key === 'documents' || key === 'pages') row(key, zh, en, '', toggle(c?.[key]), toggle(a?.[key]), gate);
        }
        if (section !== 'overview') {
            for (const [key, zh, en] of [['maxSearches', '每任务最多搜索次数', 'Search limit per task'], ['maxResults', '每次最多结果数', 'Result limit per search'], ['resultBytes', '搜索结果容量', 'Search result budget']]) row(key, zh, en, key === 'resultBytes' ? 'UTF-8 bytes' : 'count', number(c?.webLimits?.[key], ...WEB_RANGES[key]), number(a?.webLimits?.[key], ...WEB_RANGES[key]), gate);
            for (const [key, zh, en] of [['memory', '暮羽长期记忆', 'Muyu long-term memory'], ['skills', '启用 Skill', 'Enable Skills'], ['diagnostics', '本页诊断记录', 'Page diagnostics'], ['browserErrors', '记录浏览器错误', 'Capture browser errors'], ['promptCapture', '提示词构建快照', 'Prompt-build snapshots']]) row(key, zh, en, '', toggle(c?.[key]), absent(), '功能配置不证明本任务已读取、加载或注入内容。正文和清单走各自工具。 / Configuration does not prove reading, loading or injection; use existing tools for content/catalogs.');
            row('skillsLoaded', 'Skill 目录已初始化', 'Skill catalog initialized', '', absent(), toggle(a?.skillsLoaded), '不表示本任务加载了任意特定 Skill。 / Does not mean this task loaded a particular Skill.');
        }
    });
    return { version: 1, readOnly: true, section, sections,
        interpretation: 'A current client observation, not an authorization, model-window guarantee or persistence confirmation. configured is controller-accepted state, not an unsaved draft. Run/context/instruction effective values belong to this execution segment; storage and permission state are live. Tool admission is captured then checked for ongoing validity, not merely cached configuration or consent. Interpret each row separately. Use GUI labels and units. Unknown stays unknown. No writes or tests were performed.',
        coverage: { available: SELF_SECTIONS.filter(id => id !== 'overview'), overviewIsSummary: true, notIncluded: ['instruction-bodies', 'unsaved-drafts', 'resource-bodies', 'raw-errors', 'credentials'] },
        textReading: { tool: 'muyu.self.read_text', source: 'muyuSelfText', notice: 'Separate consent for sanitized instruction/connection text and unsaved drafts. Nothing is written or activated. Conversation, memory and Skill resources use their existing tools.' } };
}
