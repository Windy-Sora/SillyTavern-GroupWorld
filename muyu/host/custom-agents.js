import { randomUUID } from '../runtime/crypto.js';
import { normalizeCustomAgent } from '../../systems/custom-agent-validation.js';
import { copyJson, jsonKey } from '../core/json-contract.js';
import { createCustomAgentBatchPort } from './custom-agent-batch.js';
import { createCustomAgentExecutionPort } from './custom-agent-execution.js';

const keys = ['name', 'providerName', 'prompt', 'schema', 'enabled', 'autoEnabled', 'autoInterval', 'order'];
const owner = 'group-director/custom-agent';
const record = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function definition(input) {
    let result;
    try { result = normalizeCustomAgent(input); } catch { throw Error('INVALID_AGENT_DRAFT'); }
    if (result.name.length > 80 || result.providerName.length > 80 || result.prompt.length > 12000 || result.schema.length > 8000) throw Error('AGENT_ASSET_UNSUPPORTED');
    return result;
}

/** Definition-only adapter: never gets chat results, renders prompts or calls a model. */
export function createCustomAgentPort({ getSettings, system, getProviders, getTarget, getContext, changed = () => {}, executionTimeoutMs }) {
    const versions = new Map();
    const rows = () => {
        const list = getSettings()?.customAgents ?? [];
        if (!Array.isArray(list) || list.length > 256) throw Error('AGENT_STORE_UNAVAILABLE');
        return list;
    };
    function revision(row) {
        const fingerprint = JSON.stringify(row), old = versions.get(row.id);
        if (!old || old.row !== row || old.fingerprint !== fingerprint) versions.set(row.id, { row, fingerprint, revision: randomUUID() });
        return versions.get(row.id).revision;
    }
    function existing(id, expected) {
        const matches = rows().filter(row => row.id === id);
        if (matches.length !== 1 || revision(matches[0]) !== expected) throw Error('STALE_AGENT_ASSET');
        return matches[0];
    }
    function preview({ operation, id = '', revision: expected = '', changes = {} }) {
        if (!['create', 'update', 'delete'].includes(operation) || !record(changes) || Object.keys(changes).some(key => !keys.includes(key))) throw Error('INVALID_AGENT_DRAFT');
        if (operation === 'create' && (id || expected) || operation === 'delete' && Object.keys(changes).length) throw Error('INVALID_AGENT_DRAFT');
        const previous = operation === 'create' ? null : copyJson(existing(id, expected));
        if (previous) {
            definition(previous);
            if (typeof previous.id !== 'string' || previous.id.length > 100) throw Error('AGENT_ASSET_UNSUPPORTED');
        }
        // Do not silently discard legacy/unknown fields when the system normalizes the list.
        if (rows().some(row => !record(row) || Object.keys(row).some(key => ![...keys, 'id'].includes(key)))) throw Error('AGENT_ASSET_UNSUPPORTED');
        const base = previous ? Object.fromEntries(keys.filter(key => previous[key] !== undefined).map(key => [key, previous[key]])) : { enabled: false, autoEnabled: false };
        const next = operation === 'delete' ? null : definition({ ...base, ...changes });
        if (next && rows().some(row => row.id !== id && row.providerName === next.providerName)) throw Error('AGENT_ASSET_EXISTS');
        if (operation === 'create' && rows().length >= 256) throw Error('AGENT_STORE_UNAVAILABLE');
        if (!getProviders || !system?.validateList) throw Error('WRITE_UNAVAILABLE');
        // A disabled proposal must not reserve a system-owned or another agent's name either.
        if (next && getProviders().some(p => p.id === next.providerName && (p._gdOwner !== owner || p._gdOwnerId !== id))) throw Error('AGENT_PROVIDER_CONFLICT');
        let previewId = '__muyu_preview__';
        while (rows().some(row => row.id === previewId)) previewId += '_';
        const candidate = operation === 'create' ? [...rows(), { ...next, id: previewId }]
            : operation === 'delete' ? rows().filter(row => row.id !== id) : rows().map(row => row.id === id ? { ...next, id } : row);
        try { system.validateList(candidate); } catch { throw Error('INVALID_AGENT_DRAFT'); }
        return copyJson({ module: 'custom-agent', operation, id, baseRevision: expected, previous, next,
            warnings: ['仅保存全局自定义 Agent 定义，不主动调用模型，不修改当前聊天的已有结果或运行计数。持久化是否成功另见回执。',
                '启用会注册结果 Provider；重命名 Provider 或删除定义不会修复已有模板引用。删除后已有聊天结果仍保留。',
                next?.autoEnabled ? '自动运行已开启：后续符合间隔的事件会增加模型调用、资料外发与费用。运行时提示词渲染还可能调用 Provider。' : '本操作不启用自动运行；关闭或删除不保证中止已发出的模型请求。',
                'Schema 仅检查为合法 JSON 对象，不证明模型输出必定满足它。'] });
    }
    function assertDraft(content) {
        if (content?.operation === 'batch') return batches.assertBatch(content);
        const rebuilt = preview({ operation: content.operation, id: content.id, revision: content.baseRevision, changes: content.next || {} });
        if (jsonKey(rebuilt) !== jsonKey(content)) throw Error('INVALID_AGENT_DRAFT');
    }
    const batches = createCustomAgentBatchPort({ rows, revision, preview });
    return Object.freeze({
        ...createCustomAgentExecutionPort({ getSettings, system, getProviders, getTarget, getContext, existing, changed, timeoutMs: executionTimeoutMs }),
        list(offset = 0) {
            const list = rows();
            for (const id of versions.keys()) if (!list.some(row => row.id === id)) versions.delete(id);
            return { items: list.slice(offset, offset + 32).map(row => ({ id: row.id, name: row.name, providerName: row.providerName, revision: revision(row), enabled: row.enabled, autoEnabled: row.autoEnabled, autoInterval: row.autoInterval, order: row.order })), nextOffset: offset + 32 < list.length ? offset + 32 : -1 };
        },
        read(id, expected, offset = 0) {
            const row = existing(id, expected);
            const text = JSON.stringify(Object.fromEntries(['id', ...keys].filter(key => row[key] !== undefined).map(key => [key, row[key]])));
            if (text.length > 1048576 || offset > text.length) throw Error('AGENT_ASSET_UNSUPPORTED');
            return { id, revision: expected, text: text.slice(offset, offset + 8000), nextOffset: offset + 8000 < text.length ? offset + 8000 : -1, format: 'json', untrusted: true };
        },
        preview, assertDraft, previewBatch: batches.batch, previewImport: batches.importPreview,
        async save(content) {
            assertDraft(content);
            const mutate = content.operation === 'batch' ? system?.mutateBatchApproved : system?.mutateApproved;
            if (!mutate) throw Error('WRITE_UNAVAILABLE');
            const settings = getSettings();
            const result = await mutate({ operation: content.operation, id: content.id, definition: content.next, entries: content.entries, expectedSettings: settings,
                validate: () => { if (getSettings() !== settings) throw Error('STALE_AGENT_ASSET'); assertDraft(content); } });
            try { changed(); } catch { /* A view observer cannot change the operation result. */ }
            return getSettings() === settings ? result : { ...result, status: 'outcome_unknown', persistence: 'unknown' };
        },
    });
}
