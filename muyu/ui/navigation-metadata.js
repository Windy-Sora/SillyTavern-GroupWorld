import { configPresentation } from '../config/presentation.js';
import { uiLabel } from '../../ui/i18n.js';
import { PRODUCT_IDENTITY } from '../../utils/product-identity.js';

// Public interface facts shared by the UI and its read-only reference catalog.
export const SETTINGS_PAGES = Object.freeze([
    ['connection', '模型连接', 'Connection', '配置暮羽使用的模型服务。', 'Choose the service used for your requests.'],
    ['data', '资料与权限', 'Data & permissions', '管理资料授权与危险操作权限；不管理对话存储。', 'Manage data grants and dangerous actions, separately from storage.'],
    ['behavior', '对话与显示', 'Conversation & display', '定制回答方式与执行过程显示，不改变工具权限。', 'Customize response style and process display, without changing permissions.'],
    ['limits', '上下文与预算', 'Context & budgets', '管理输入上下文与执行上限；保存后下一轮生效。', 'Manage input context and execution limits; saved changes apply next run.'],
    ['storage', '存储与记忆', 'Storage & memory', '管理暮羽对话保存与长期记忆，不修改角色记忆。', 'Manage Muyu conversation storage and long-term notes, not character memories.'],
    ['skills', '技能与工具', 'Skills & tools', '管理技能和联网搜索；技能不授予额外权限。', 'Manage Skills and web search; Skills do not grant extra permissions.'],
].map(Object.freeze));
export const UI_LABELS = Object.freeze({
    testConnection: Object.freeze(['测试连接', 'Test connection']),
    fetchModels: Object.freeze(['获取模型', 'Fetch models']),
    enableConnection: Object.freeze(['启用此连接', 'Enable connection']),
    exportJSON: Object.freeze(['导出当前对话 JSON', 'Export current conversation JSON']),
    exportMarkdown: Object.freeze(['导出当前对话 Markdown', 'Export current conversation Markdown']),
    showBall: Object.freeze(['显示暮羽悬浮球', 'Show Muyu floating ball']),
});
export function navigationDocument() {
    return { id: 'muyu.interface', version: 2, title: '暮羽界面入口与按钮', source: 'muyu/ui/navigation-metadata.js', scope: 'public-interface', text: JSON.stringify({
        kind: 'gui-reference-not-tool-capabilities', product: PRODUCT_IDENTITY, settingsEntry: '暮羽聊天窗口的齿轮配置 / Muyu window settings gear',
        pages: SETTINGS_PAGES.map(([id, zh, en, descriptionZh, descriptionEn]) => ({ id, label: { zh, en }, description: { zh: descriptionZh, en: descriptionEn } })), buttons: UI_LABELS,
        connection: { page: 'connection', sources: ['使用酒馆当前连接（推荐）', '使用暮羽独立接口'], defaultForNewUsers: 'st', stModelSelectionInHost: true, stDoesNotInheritRoleplayContext: true, independentFields: ['协议', '完整接口地址', 'API 密钥', '模型'], activateButton: 'enableConnection', autoEnableOptional: true, noAutomaticPathAppend: true, deepseekEndpointExample: 'https://api.deepseek.com/chat/completions', testSendsFixedMessage: true, testMayCost: true, fetchOnlyUpdatesDraft: true, rememberedKeyPlaintextInSettings: true },
        historyExport: { location: '对话历史侧栏 → 当前对话操作 ⋯ / History sidebar → current conversation actions ⋯', source: '当前会话库记录，可能包含恢复内容；导出不是持久化确认。' },
        ballVisibility: { location: `${PRODUCT_IDENTITY.displayName} 经典设置 → 工具 → 暮羽 Agent`, button: 'showBall' },
        notes: { page: 'storage', section: '暮羽长期记忆', distinctFromCharacterMemory: true },
        characterMemory: {
            location: { zh: `${PRODUCT_IDENTITY.displayName} 经典设置 → ${uiLabel('memoryCard', 'zh')}`, en: `${PRODUCT_IDENTITY.displayName} classic settings → ${uiLabel('memoryCard', 'en')}` },
            controls: Object.fromEntries(['memoryEnabled', 'autoMemoryEnabled', 'autoMemoryInterval', 'autoMemorySpeakers'].map(id => {
                const { label, unit } = configPresentation(id);
                return [id, { label, ...(unit ? { unit } : {}) }];
            })),
            intervalMeaning: '每 N 条新消息提取一次；减少触发频率应增大间隔，不是减小间隔。',
            boundary: '这些是插件角色记忆控件，不在暮羽齿轮的存储与记忆页；按location直达，不增加未列出的分区。全局参数影响所有聊天。这里只提供入口，不读取当前值。',
        },
        display: { page: 'behavior', field: '执行过程显示', choices: ['紧凑', '标准', '详细', '完整'], default: '紧凑', effective: '保存后立即改变显示，不改变权限、执行或模型上下文' },
        skills: { page: 'skills', importOnlyFillsUnsavedEditor: true, reviewThenSave: true, newDefaultDisabled: true },
        boundary: '静态入口，不返回用户连接当前值，不授予连接读取或修改工具；不证明页面已打开、按钮可用、连接或保存成功。没有模型工具不代表没有GUI功能。',
    }) };
}
