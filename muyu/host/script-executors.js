import { randomUUID } from '../runtime/crypto.js';
import { normalizeScriptExecutor } from '../../systems/script-executor-validation.js';
import { checkedScriptReport } from '../scripts/test-contract.js';
import { copyJson, jsonKey } from '../core/json-contract.js';
import { createScriptExecutionPort } from './script-execution.js';

const keys = ['name', 'triggerOn', 'priority', 'code', 'enabled', 'params', 'renderParams', 'returnMode'];
function definition(input) {
    if (!input || Object.keys(input).some(key => !keys.includes(key))) throw Error('INVALID_SCRIPT_DRAFT');
    const result = normalizeScriptExecutor(input);
    if (result.name.length > 80 || result.code.length > 24000 || result.params.length > 32 || JSON.stringify(result).length > 32000) throw Error('SCRIPT_ASSET_UNSUPPORTED');
    return result;
}
export function createScriptExecutorPort({ getSettings, getTarget, getContext, system, testRunner, changed = () => {} }) {
    const versions = new Map();
    const rows = () => {
        const list = getSettings()?.scriptExecutors ?? [];
        if (!Array.isArray(list) || list.length > 4096) throw Error('SCRIPT_STORE_UNAVAILABLE');
        return list;
    };
    function revision(row) {
        const fingerprint = JSON.stringify(row), old = versions.get(row.id);
        if (!old || old.row !== row || old.fingerprint !== fingerprint) versions.set(row.id, { row, fingerprint, revision: randomUUID() });
        return versions.get(row.id).revision;
    }
    function existing(id, expected) {
        const matches = rows().filter(row => row.id === id);
        if (matches.length !== 1 || revision(matches[0]) !== expected) throw Error('STALE_SCRIPT_ASSET');
        return matches[0];
    }
    function preview({ operation, id = '', revision: expected = '', changes = {} }) {
        if (!['create', 'update', 'delete'].includes(operation)) throw Error('INVALID_SCRIPT_DRAFT');
        if (operation === 'create' && (id || expected)) throw Error('INVALID_SCRIPT_DRAFT');
        if (operation === 'create' && rows().length >= 256) throw Error('SCRIPT_ASSET_CAPACITY');
        const previous = operation === 'create' ? null : copyJson(existing(id, expected));
        if (operation === 'delete' && Object.keys(changes).length) throw Error('INVALID_SCRIPT_DRAFT');
        if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw Error('INVALID_SCRIPT_DRAFT');
        if (Object.keys(changes).some(key => !keys.includes(key))) throw Error('INVALID_SCRIPT_DRAFT');
        const base = previous ? Object.fromEntries(keys.map(key => [key, previous[key]]).filter(([, value]) => value !== undefined)) : { enabled: false };
        const next = operation === 'delete' ? null : definition({ ...base, ...changes });
        if (next && rows().some(row => row.id !== id && row.name === next.name)) throw Error('SCRIPT_ASSET_EXISTS');
        if (previous && JSON.stringify(previous).length > 32000) throw Error('SCRIPT_ASSET_UNSUPPORTED');
        return copyJson({ module: 'script-executor', operation, id, baseRevision: expected, previous, next,
            warnings: ['只保存此脚本定义，不主动运行。保存成功不代表持久化已确认。',
                next?.enabled ? '此脚本将保持或变为启用：后续匹配的消息、回合或决策事件可自动执行。代码具有酒馆页面权限，可能读取密钥、联网或修改数据；超时不保证终止副作用。' : '删除或关闭不终止已经开始的脚本；已有副作用不能保证撤销。'] });
    }
    function assertDraft(content) {
        const rebuilt = preview({ operation: content.operation, id: content.id, revision: content.baseRevision, changes: content.next || {} });
        if (jsonKey(content) !== jsonKey(rebuilt)) throw Error('INVALID_SCRIPT_DRAFT');
    }
    return Object.freeze({
        ...createScriptExecutionPort({ getTarget, getContext, getSettings, system, existing }),
        list(offset = 0) {
            const list = rows();
            for (const id of versions.keys()) if (!list.some(row => row.id === id)) versions.delete(id);
            return { items: list.slice(offset, offset + 32).map(row => ({ id: row.id, name: row.name, revision: revision(row), enabled: row.enabled, triggerOn: row.triggerOn, priority: row.priority })), nextOffset: offset + 32 < list.length ? offset + 32 : -1 };
        },
        read(id, expected, offset = 0) {
            const row = existing(id, expected), text = JSON.stringify(row);
            if (text.length > 1048576 || offset > text.length) throw Error('SCRIPT_ASSET_UNSUPPORTED');
            return { id, revision: expected, text: text.slice(offset, offset + 8000), nextOffset: offset + 8000 < text.length ? offset + 8000 : -1, format: 'json', untrusted: true };
        },
        preview, assertDraft,
        async test(content, { signal } = {}) {
            assertDraft(content);
            if (!content.next || content.operation === 'delete') throw Error('INVALID_SCRIPT_DRAFT');
            if (signal?.aborted) return { status: 'cancelled', phase: 'startup', rows: [] };
            if (!testRunner) return { status: 'unavailable', phase: 'startup', rows: [] };
            return checkedScriptReport(await testRunner(content.next, { signal }), content.next);
        },
        async save(content) {
            assertDraft(content);
            if (!system?.mutateApproved) throw Error('WRITE_UNAVAILABLE');
            const settings = getSettings();
            const result = await system.mutateApproved({ operation: content.operation, id: content.id, definition: content.next, expectedSettings: settings,
                validate: () => { if (getSettings() !== settings) throw Error('STALE_SCRIPT_ASSET'); assertDraft(content); } });
            try { changed(); } catch { /* Observer cannot change the result. */ }
            return getSettings() === settings ? result : { ...result, status: 'outcome_unknown', persistence: 'unknown' };
        },
    });
}
