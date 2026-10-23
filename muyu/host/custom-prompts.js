import { randomUUID } from '../runtime/crypto.js';
import { normalizeCustomPrompt } from '../../systems/custom-prompt-validation.js';
import { copyJson, jsonKey } from '../core/json-contract.js';
import { createCustomPromptBatchPort } from './custom-prompt-batch.js';
const keys = ['name', 'content', 'dataJson', 'scope', 'enabled'];
const record = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function definition(value) {
    let result;
    try { result = normalizeCustomPrompt(value); } catch { throw Error('INVALID_PROMPT_DRAFT'); }
    if (result.name.length > 80 || result.content.length > 12000 || result.dataJson.length > 8000) throw Error('PROMPT_ASSET_UNSUPPORTED');
    return result;
}
/** Raw definitions only. Never invokes Provider.render or template expansion. */
export function createCustomPromptPort({ getSettings, system, changed = () => {} }) {
    const versions = new Map();
    const rows = () => {
        const list = getSettings()?.customPrompts ?? [];
        if (!Array.isArray(list) || list.length > 256 || list.some(row => !record(row) || typeof row.id !== 'string' || !row.id || row.id.length > 100)) throw Error('PROMPT_STORE_UNAVAILABLE');
        return list;
    };
    function revision(row) {
        const fingerprint = JSON.stringify(row), old = versions.get(row.id);
        if (!old || old.row !== row || old.fingerprint !== fingerprint) versions.set(row.id, { row, fingerprint, revision: randomUUID() });
        return versions.get(row.id).revision;
    }
    function existing(id, expected) {
        const matches = rows().filter(row => row.id === id);
        if (matches.length !== 1 || revision(matches[0]) !== expected) throw Error('STALE_PROMPT_ASSET');
        return matches[0];
    }
    function preview({ operation, id = '', revision: expected = '', changes = {} }) {
        if (!['create', 'update', 'delete'].includes(operation) || !record(changes) || Object.keys(changes).some(key => !keys.includes(key))) throw Error('INVALID_PROMPT_DRAFT');
        if (operation === 'create' && (id || expected) || operation === 'delete' && Object.keys(changes).length) throw Error('INVALID_PROMPT_DRAFT');
        const previous = operation === 'create' ? null : copyJson(existing(id, expected));
        if (previous) {
            definition(previous);
            if (Object.keys(previous).some(key => ![...keys, 'id'].includes(key))) throw Error('PROMPT_ASSET_UNSUPPORTED');
        }
        const base = previous ? Object.fromEntries(keys.filter(key => previous[key] !== undefined).map(key => [key, previous[key]])) : { enabled: false };
        const next = operation === 'delete' ? null : definition({ ...base, ...changes });
        if (operation === 'create' && rows().length >= 256) throw Error('PROMPT_STORE_UNAVAILABLE');
        if (!system?.validateName || !system?.mutateApproved) throw Error('WRITE_UNAVAILABLE');
        if (next && !system.validateName(next.name, id || undefined).ok) throw Error('PROMPT_NAME_CONFLICT');
        const content = { module: 'custom-prompt', operation, id, baseRevision: expected, previous, next,
            warnings: [
                '仅修改全局自定义 Prompt 条目；保存不渲染 Provider、不调用模型，也不改变自定义 Prompt 总开关。',
                '启用还受总开关限制。重命名／删除不会修复现有模板引用；后续模板渲染可能调用正文中的其他 Provider。',
                'scope 仅为已保存的分类元数据，目前不隔离角色读取权限。',
                ...(next && system.hasSelfReference(next.name, next.content) ? ['正文引用自身，渲染可能为空或受递归上限限制。'] : []),
            ] };
        if (new TextEncoder().encode(JSON.stringify(content)).length > 24000) throw Error('PROMPT_DRAFT_TOO_LARGE');
        return copyJson(content);
    }
    const batches = createCustomPromptBatchPort({ rows, revision, preview });
    function assertDraft(content) {
        if (content?.operation === 'batch') return batches.assertBatch(content);
        const rebuilt = preview({ operation: content.operation, id: content.id, revision: content.baseRevision, changes: content.next || {} });
        if (jsonKey(rebuilt) !== jsonKey(content)) throw Error('INVALID_PROMPT_DRAFT');
    }
    return Object.freeze({
        list(offset = 0) {
            if (!Number.isInteger(offset) || offset < 0 || offset > 256) throw Error('INVALID_PROMPT_ARGUMENTS');
            const list = rows();
            for (const id of versions.keys()) if (!list.some(row => row.id === id)) versions.delete(id);
            return { masterEnabled: getSettings()?.customPromptsEnabled !== false,
                items: list.slice(offset, offset + 32).map(row => ({ id: row.id, name: String(row.name).slice(0, 80), enabled: row.enabled === true, scope: String(row.scope ?? 'global').slice(0, 80), revision: revision(row) })),
                nextOffset: offset + 32 < list.length ? offset + 32 : -1 };
        },
        read(id, expected, offset = 0) {
            const row = existing(id, expected);
            const text = JSON.stringify(Object.fromEntries(['id', ...keys].filter(key => row[key] !== undefined).map(key => [key, row[key]])));
            if (text.length > 1048576 || !Number.isInteger(offset) || offset < 0 || offset > text.length) throw Error('PROMPT_ASSET_UNSUPPORTED');
            return { id, revision: expected, text: text.slice(offset, offset + 8000), nextOffset: offset + 8000 < text.length ? offset + 8000 : -1, format: 'json', untrusted: true };
        },
        preview, assertDraft, previewBatch: batches.batch, previewImport: batches.importPreview,
        exportEntries(targets) {
            if (!Array.isArray(targets) || !targets.length || targets.length > 6 || new Set(targets.map(t => t.id)).size !== targets.length) throw Error('INVALID_PROMPT_EXPORT');
            const prompts = targets.map(t => {
                if (!record(t) || Object.keys(t).some(k => !['id', 'revision'].includes(k))) throw Error('INVALID_PROMPT_EXPORT');
                return definition(existing(t.id, t.revision));
            });
            const result = { type: 'custom-prompt-export', version: 1, prompts };
            if (new TextEncoder().encode(JSON.stringify(result)).length > 20000) throw Error('PROMPT_EXPORT_TOO_LARGE');
            return copyJson(result);
        },
        async save(content) {
            assertDraft(content);
            const settings = getSettings();
            const mutate = content.operation === 'batch' ? system.mutateBatchApproved : system.mutateApproved;
            if (!mutate) throw Error('WRITE_UNAVAILABLE');
            const result = await mutate({ entries: content.entries, operation: content.operation, id: content.id, definition: content.next, expectedSettings: settings,
                validate: () => { if (getSettings() !== settings) throw Error('STALE_PROMPT_ASSET'); assertDraft(content); } });
            try { changed(); } catch { /* UI observer cannot alter the result. */ }
            return getSettings() === settings ? result : { ...result, status: 'outcome_unknown', persistence: 'unknown' };
        },
    });
}
