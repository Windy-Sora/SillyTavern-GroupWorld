import { copyJson, jsonKey } from '../core/json-contract.js';
import { validateCustomPromptExport } from '../../systems/custom-prompt-validation.js';

const keys = ['name', 'content', 'dataJson', 'scope', 'enabled'];
const record = value => value && typeof value === 'object' && !Array.isArray(value);
/** One queued settings save for the complete Prompt batch; not independent per-entry saves. */
export function createCustomPromptBatchPort({ rows, revision, preview }) {
    function batch(requests, { origin = 'batch', skipped = [] } = {}) {
        if (!Array.isArray(requests) || !requests.length || requests.length > 6 || !['batch', 'import'].includes(origin)
            || !Array.isArray(skipped) || skipped.length > 6 || skipped.some(name => typeof name !== 'string' || name.length > 80)) throw Error('INVALID_PROMPT_BATCH');
        const entries = requests.map(request => {
            if (!record(request) || Object.keys(request).some(key => !['operation', 'id', 'revision', 'changes'].includes(key))) throw Error('INVALID_PROMPT_BATCH');
            return preview(request);
        });
        const ids = entries.filter(row => row.id).map(row => row.id), names = entries.filter(row => row.next).map(row => row.next.name);
        if (new Set(ids).size !== ids.length || new Set(names).size !== names.length) throw Error('INVALID_PROMPT_BATCH');
        if (rows().length + entries.filter(row => row.operation === 'create').length - entries.filter(row => row.operation === 'delete').length > 256) throw Error('PROMPT_STORE_UNAVAILABLE');
        if (origin === 'import' && entries.some(row => row.operation === 'delete' || row.next.enabled)) throw Error('INVALID_PROMPT_BATCH');
        const content = copyJson({ module: 'custom-prompt', operation: 'batch', origin, entries, skipped,
            warnings: ['一次批准完整清单，仅保存一次全局设置；不渲染 Provider、不调用模型。',
                origin === 'import' ? '导入条目统一关闭（不改变总开关），覆盖已有条目也会关闭它；不会修改模板中的引用。' : '批量编辑保留未指定字段；启用受总开关限制，后续模板使用可能解析嵌套 Provider。',
                '保存未确认或结果未知时不要自动重试；本批次不包含普通配置、变量或脚本修改。'] });
        // Leave room for the approval envelope and history metadata; never truncate a definition.
        if (new TextEncoder().encode(JSON.stringify(content)).length > 24000) throw Error('PROMPT_BATCH_TOO_LARGE');
        return content;
    }
    function importPreview(data, conflict = 'error') {
        if (!record(data) || Object.keys(data).some(key => !['type', 'version', 'exportedAt', 'prompts'].includes(key))
            || !Array.isArray(data.prompts) || !data.prompts.length || data.prompts.length > 6
            || !['error', 'skip', 'replace'].includes(conflict)
            || data.prompts.some(row => !record(row) || Object.keys(row).some(key => !keys.includes(key)))) throw Error('INVALID_PROMPT_IMPORT');
        let incoming;
        try { incoming = validateCustomPromptExport(data); } catch { throw Error('INVALID_PROMPT_IMPORT'); }
        const requests = [], skipped = [];
        for (const agent of incoming) {
            if (agent.name.length > 80 || agent.content.length > 12000 || agent.dataJson.length > 8000) throw Error('PROMPT_ASSET_UNSUPPORTED');
            const matches = rows().filter(row => row.name === agent.name);
            if (matches.length > 1) throw Error('STALE_PROMPT_ASSET');
            const old = matches[0];
            if (old && conflict === 'error') throw Error('PROMPT_ASSET_EXISTS');
            if (old && conflict === 'skip') { skipped.push(agent.name); continue; }
            requests.push({ operation: old ? 'update' : 'create', ...(old ? { id: old.id, revision: revision(old) } : {}), changes: { ...agent, enabled: false } });
        }
        if (!requests.length) throw Error('PROMPT_IMPORT_NO_CHANGES');
        return batch(requests, { origin: 'import', skipped });
    }
    function assertBatch(content) {
        if (!Array.isArray(content.entries)) throw Error('INVALID_PROMPT_BATCH');
        const rebuilt = batch(content.entries.map(row => ({ operation: row.operation, id: row.id, revision: row.baseRevision, changes: row.next || {} })), { origin: content.origin, skipped: content.skipped });
        if (jsonKey(rebuilt) !== jsonKey(content)) throw Error('INVALID_PROMPT_BATCH');
    }
    return { batch, importPreview, assertBatch };
}
