import { copyJson } from '../core/json-contract.js';

export const providerDraftSchema = { type: 'object', properties: {
    name: { type: 'string', maxLength: 80 }, source: { type: 'string', maxLength: 24000 },
    ids: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 80 } },
    install: { type: 'boolean' },
}, required: ['name', 'source', 'ids'], additionalProperties: false };

/** Format checks only: never import, eval or execute draft code. Not a security proof. */
export function prepareProviderDraft({ name, source, ids }, { existingName = false } = {}) {
    const validName = typeof name === 'string' && name.length > 0 && name.length <= 80 && (existingName ? /^[^\x00-\x1f/\\:*?"<>|]+$/.test(name) && !/^\.{1,2}$/.test(name) : /^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(name));
    if (!validName ||
        typeof source !== 'string' || !source.trim() || source.length > 24000 ||
        !Array.isArray(ids) || !ids.length || ids.length > 8 || new Set(ids).size !== ids.length ||
        ids.some(id => typeof id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(id))) throw Error('INVALID_PROVIDER_DRAFT');
    if (!/\bexport\s+(?:async\s+)?function\s+register\s*\(/.test(source)) throw Error('PROVIDER_REGISTER_EXPORT_REQUIRED');
    // First slice is self-contained modules. Existing imported assets remain readable/executable.
    if (/\bimport\b|\bexport\s*\*/.test(source)) throw Error('PROVIDER_IMPORTS_NOT_SUPPORTED');
    return copyJson({ module: 'provider-asset', name, source, ids,
        warnings: ['导入会执行模块顶层代码及 register()；不是单纯保存文本，可能联网、修改数据或产生费用。',
            '静态检查仅检查格式与声明，不是完整 JavaScript 语法解析、安全审计或合成运行测试。',
            '本轮仅允许新资产和新 Provider ID，不替换现有资产；导入后 render 的执行权限仍单独检查。'] });
}
