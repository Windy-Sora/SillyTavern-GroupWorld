export const generalRuleDefinitions = {
    lang: { domain: 'general', schema: { type: 'string', enum: ['zh', 'en'] }, source: 'ui/settings-init.js', description: '插件界面语言：zh 中文，en English；影响所有聊天的插件界面及后续按语言选取的内置提示文本，不翻译已有聊天、自定义 Prompt 或模型历史回答。更新静态界面文字，保留已打开的暮羽窗口及其未保存输入；该窗口下次打开时使用新语言。不是切换 ST 全局语言。生成剧情配置档不携带此个人偏好。' },
    debugLogging: { domain: 'general', schema: { type: 'boolean' }, source: 'ui/sections/modes.js', description: '插件调试日志总开关，影响后续调试输出与启用追踪的调用；可能记录业务输入、输出和运行资料，开启前确认隐私需求。关闭不删除已有日志或执行记录，也不中止已开始的采集。本字段不授予服务器终端、日志正文或密钥读取权限；不等于模板占位符调试开关。生成剧情配置档不携带此个人偏好。' },
};
