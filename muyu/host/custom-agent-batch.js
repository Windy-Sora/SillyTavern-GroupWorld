import { copyJson, jsonKey } from '../core/json-contract.js';
import { validateCustomAgentExport } from '../../systems/custom-agent-validation.js';

const keys = ['name', 'providerName', 'prompt', 'schema', 'enabled', 'autoEnabled', 'autoInterval', 'order'];
const record = value => value && typeof value === 'object' && !Array.isArray(value);
/** A single global settings transaction, not a sequence of independently saved agents. */
export function createCustomAgentBatchPort({ rows, revision, preview }) {
    function batch(requests, { origin = 'batch', skipped = [] } = {}) {
        if (!Array.isArray(requests) || !requests.length || requests.length > 6 || !['batch', 'import'].includes(origin)
            || !Array.isArray(skipped) || skipped.length > 6 || skipped.some(name => typeof name !== 'string' || name.length > 80)) throw Error('INVALID_AGENT_BATCH');
        const entries = requests.map(request => {
            if (!record(request) || Object.keys(request).some(key => !['operation', 'id', 'revision', 'changes'].includes(key))) throw Error('INVALID_AGENT_BATCH');
            return preview(request);
        });
        const ids = entries.filter(row => row.id).map(row => row.id), names = entries.filter(row => row.next).map(row => row.next.providerName);
        if (new Set(ids).size !== ids.length || new Set(names).size !== names.length) throw Error('INVALID_AGENT_BATCH');
        if (rows().length + entries.filter(row => row.operation === 'create').length - entries.filter(row => row.operation === 'delete').length > 256) throw Error('AGENT_STORE_UNAVAILABLE');
        if (origin === 'import' && entries.some(row => row.operation === 'delete' || row.next.enabled || row.next.autoEnabled)) throw Error('INVALID_AGENT_BATCH');
        const content = copyJson({ module: 'custom-agent', operation: 'batch', origin, entries, skipped,
            warnings: ['一次批准这份完整清单，在同一全局设置保存中提交；不主动运行模型，不修改聊天结果。',
                origin === 'import' ? '导入的定义总开关与自动运行均关闭。覆盖已有定义也会关闭它，不修改其已有聊天结果。' : '批量编辑保留各项未指定字段；启用自动运行会在后续产生调用及费用，请逐项审阅。',
                '保存未确认或结果未知时不要自动重试；本批次不包含普通配置、变量或脚本修改。'] });
        // Leave room for the approval envelope and history metadata; never truncate a definition.
        if (new TextEncoder().encode(JSON.stringify(content)).length > 24000) throw Error('AGENT_BATCH_TOO_LARGE');
        return content;
    }
    function importPreview(data, conflict = 'error') {
        if (!record(data) || Object.keys(data).some(key => !['type', 'version', 'exportedAt', 'agents'].includes(key))
            || !Array.isArray(data.agents) || !data.agents.length || data.agents.length > 6
            || !['error', 'skip', 'replace'].includes(conflict)
            || data.agents.some(row => !record(row) || Object.keys(row).some(key => !keys.includes(key)))) throw Error('INVALID_AGENT_IMPORT');
        let incoming;
        try { incoming = validateCustomAgentExport(data); } catch { throw Error('INVALID_AGENT_IMPORT'); }
        const requests = [], skipped = [];
        for (const agent of incoming) {
            if (agent.name.length > 80 || agent.providerName.length > 80 || agent.prompt.length > 12000 || agent.schema.length > 8000) throw Error('AGENT_ASSET_UNSUPPORTED');
            const matches = rows().filter(row => row.providerName === agent.providerName);
            if (matches.length > 1) throw Error('STALE_AGENT_ASSET');
            const old = matches[0];
            if (old && conflict === 'error') throw Error('AGENT_ASSET_EXISTS');
            if (old && conflict === 'skip') { skipped.push(agent.providerName); continue; }
            requests.push({ operation: old ? 'update' : 'create', ...(old ? { id: old.id, revision: revision(old) } : {}), changes: agent });
        }
        if (!requests.length) throw Error('AGENT_IMPORT_NO_CHANGES');
        return batch(requests, { origin: 'import', skipped });
    }
    function assertBatch(content) {
        if (!Array.isArray(content.entries)) throw Error('INVALID_AGENT_BATCH');
        const rebuilt = batch(content.entries.map(row => ({ operation: row.operation, id: row.id, revision: row.baseRevision, changes: row.next || {} })), { origin: content.origin, skipped: content.skipped });
        if (jsonKey(rebuilt) !== jsonKey(content)) throw Error('INVALID_AGENT_BATCH');
    }
    return { batch, importPreview, assertBatch };
}
