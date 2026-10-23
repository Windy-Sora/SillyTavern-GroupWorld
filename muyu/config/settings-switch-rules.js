const prefix = 'profileLibraryAutoLoad.';
export const profileAutoFields = ['enabled', 'overwriteExisting', 'importTemplate'].map(key => prefix + key);
const policy = ['enabled', 'mode', 'fixedId', 'matchHash', 'matchAvatarName', 'matchNameOnly', 'overwriteExisting', 'importTemplate'];
export const settingsSwitchFields = [...profileAutoFields, 'customPromptsEnabled'];
export const settingsSwitchRules = {
    ...Object.fromEntries(profileAutoFields.map(id => [id, { domain: 'profiles', schema: { type: 'boolean' }, idle: true,
        dependencies: ['profileEnabled', ...policy.map(key => prefix + key)], source: 'ui/sections/profileLibrary.js',
        description: ({ enabled: '启用档案库自动加载。启动或切换聊天时在角色档案启用的条件下尝试加载，不因本次保存立即加载。关闭不撤销已导入档案，也不保证取消已经开始的加载。',
            overwriteExisting: '档案库导入时允许覆盖已有匹配角色档案；同时影响手动导入使用的默认选项和后续自动加载。关闭不恢复旧档案。',
            importTemplate: '档案库导入时同时导入包内模板设置，可能改变全局档案生成及渲染设置；同时影响手动导入的默认选项和后续自动加载。关闭不恢复旧模板。' })[id.slice(prefix.length)] +
            '仅保存策略，影响所有聊天；不立即加载档案、读取包正文或调用模型。只可与其他已接入自动加载选项共同预览，不与普通设置混合。模式、固定包选择和匹配条件保持原值；自动加载始终禁用仅姓名匹配，固定模式但无固定ID时现有运行时会退回最佳匹配。' } ])),
    customPromptsEnabled: { domain: 'prompt', schema: { type: 'boolean' }, idle: true, source: 'ui/sections/customPrompts.js',
        description: '启用自定义 Prompt 系统，必须单独预览。通过原业务队列注册当前有效且已启用条目的 Provider，关闭时注销本系统拥有的 Provider；不删除条目、不修改正文或单项开关、不立即渲染或调用模型。后续引用占位符时内容可进入提示词，并可能参与递归解析。名称冲突或条目无效会使应用失败；保存失败按原系统恢复仍未被并发修改的开关并同步注册状态，持久化结果未知，不自动重试。影响所有聊天，不能将此开关的批准解释为执行任意 Provider 的授权。' },
};
export const settingsSwitchDependencies = Object.fromEntries(policy.filter(key => !['enabled', 'overwriteExisting', 'importTemplate'].includes(key)).map(key => [prefix + key, {
    domain: 'profiles', schema: { type: ['mode', 'fixedId'].includes(key) ? 'string' : 'boolean' }, editable: false,
    source: 'ui/sections/profileLibrary.js', description: key === 'matchNameOnly' ? '自动加载始终禁用仅姓名匹配；此依赖不开放写入。' : '普通设置入口仅作为预览基线；通过 muyu.selection.read / muyu.selection.preview 的 profile-autoload 专用入口读取并修改，保存不立即加载。',
}]));
export function validateSettingsSwitchPatch(baseline, changes) {
    const keys = Object.keys(changes), selected = keys.filter(id => settingsSwitchFields.includes(id));
    if (!selected.length) return;
    if (selected.includes('customPromptsEnabled') ? keys.length !== 1 : keys.some(id => !profileAutoFields.includes(id))) throw Error('SETTINGS_SWITCH_REQUIRES_SEPARATE_DRAFT');
    if (selected.some(id => profileAutoFields.includes(id))) {
        for (const key of policy) {
            const value = baseline[prefix + key];
            if (typeof value !== (['mode', 'fixedId'].includes(key) ? 'string' : 'boolean')) throw Error('UNSUPPORTED_BASELINE');
        }
        if (!['best', 'fixed'].includes(baseline[prefix + 'mode']) || baseline[prefix + 'fixedId'].length > 200) throw Error('UNSUPPORTED_BASELINE');
    }
}
