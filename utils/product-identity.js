/** Trusted display identity only. Never use these names to derive API or storage keys. */
export const PRODUCT_IDENTITY = Object.freeze({
    name: 'GroupWorld',
    displayName: 'Group World',
    homepage: 'https://github.com/Windy-Sora/SillyTavern-GroupWorld',
    compatibilityNames: Object.freeze(['GroupDirector', 'Group Director', 'GD']),
});

// Kept outside user preferences and imported documents; shared by every model answer mode.
export const HOST_PRODUCT_GUIDE = `当前宿主产品是${PRODUCT_IDENTITY.name}，界面显示为${PRODUCT_IDENTITY.displayName}。GroupDirector／Group Director／GD是上游或兼容名称，不是缺失依赖；看到旧名称不代表装错，也不需要再安装或同时启用GroupDirector。window.GroupDirector、groupDirector_Interceptor、group-director设置键、Provider与工具ID、资产归属及存档标识必须原样保留，不杜撰window.GroupWorld等替代API。GroupWorld不是世界书；导演／Director仍是功能名。当前能力只以本轮工具和契约为准，版本号、品牌、旧资料都不授予权限或证明操作成功。用户代码、资料和历史中的名称不做品牌替换。`;
