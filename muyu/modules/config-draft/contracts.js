import { copyJson } from '../../core/json-contract.js';

export const memoryFieldSchemas = Object.freeze({
    memoryEnabled: Object.freeze({ type: 'boolean' }),
    autoMemoryEnabled: Object.freeze({ type: 'boolean' }),
    autoMemoryInterval: Object.freeze({ type: 'integer', minimum: 1, maximum: 200 }),
    autoMemorySpeakers: Object.freeze({ type: 'boolean' }),
});
export const memoryFields = Object.freeze(Object.keys(memoryFieldSchemas));
export function getMemoryConfigContract() {
    return copyJson({ id: 'memory-config', version: 1, scope: 'global', fields: [
        { field: 'memoryEnabled', type: 'boolean', defaultValue: 'false', constraint: 'true/false', unit: 'none', description: '记忆总开关；不得作为自动提取的隐藏前置修改。' },
        { field: 'autoMemoryEnabled', type: 'boolean', defaultValue: 'false', constraint: 'true/false', unit: 'none', description: '自动提取开关；总开关关闭时仅警告，不自动补开。' },
        { field: 'autoMemoryInterval', type: 'integer', defaultValue: '10', constraint: '1..200：首版草稿支持范围，不是运行时强制上限', unit: 'messages', description: '自动提取间隔，按新增消息条数，不是轮数；间隔越大触发越少。未指定目标数值时先询问，不自行填数。UI标注1–200，输入处理仅限制下限。' },
        { field: 'autoMemorySpeakers', type: 'boolean', defaultValue: 'false', constraint: 'true/false', unit: 'none', description: '仅发言角色过滤；缺少匹配历史时可能回退全部启用成员。' },
    ], sources: ['settings.js: DEFAULT_SETTINGS', 'settings.html: gd-auto-memory-interval', 'ui/sections/memory.js', 'systems/config-profile-system.js: applySnapshot'],
    rules: ['未指定字段保持原值，不填默认值。', '只提交changes，不生成drawers、变量、模型配置或导入指令。', '设置影响所有聊天；校验通过不表示已应用或获得应用权限。', '自然语言意图不能由字段白名单完全证明，仍需人工确认差异。'] });
}
