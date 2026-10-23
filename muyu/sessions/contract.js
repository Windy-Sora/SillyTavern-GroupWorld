/** Storage DTOs contain conversation text, never executable tasks, grants or credentials. */
import { permissionSources, parseExecutionSource, parseGenerationBatchExecutionSource, parseNpcExecutionSource, parseProfileExecutionSource, parseMemoryExecutionSource, parseAgentExecutionSource, parseScriptExecutionSource } from '../permissions/contract.js';
import { validateReceipt, receiptSources } from '../actions/receipts.js';
import { MAX_CONTEXT_MESSAGES, MAX_MESSAGE_BYTES } from '../context/policy.js';
import { validSummaryText } from '../context/summary-contract.js';
export const HISTORY_LIMITS = Object.freeze({ sessions: 64, messages: MAX_CONTEXT_MESSAGES, recordBytes: 32 * 1024 * 1024, totalBytes: 256 * 1024 * 1024 });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const validHistoryId = value => typeof value === 'string' && uuid.test(value);
export const historyBytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
export function historyScope(mode, target) {
    return JSON.stringify([mode, target?.kind || 'none', target?.kind === 'chat' ? target.chatKey : null]);
}
export function validateRecord(value) {
    if (value && ![1, 2, 3, 4, 5, 6, 7].includes(value.version)) throw Error('HISTORY_VERSION');
    // This boundary accepts only the fixed versioned DTO, including on reads from local storage.
    const fields = ['version', 'id', 'revision', 'scope', 'title', 'createdAt', 'updatedAt', 'messages', 'required', 'status', ...(value?.version >= 2 ? ['archived', 'imported'] : []), ...(value?.version >= 3 ? ['contextSummary'] : []), ...(value?.version >= 4 ? ['receipts'] : []), ...(value?.version >= 6 ? ['scopeChanges'] : [])];
    if (!value || Object.keys(value).some(k => !fields.includes(k)) || fields.some(k => !Object.hasOwn(value, k))) throw Error('HISTORY_INVALID');
    if (value.version >= 2 && (typeof value.archived !== 'boolean' || typeof value.imported !== 'boolean')) throw Error('HISTORY_INVALID');
    if (value.version >= 4) {
        if (!Array.isArray(value.receipts) || value.receipts.length > 64 || new Set(value.receipts.map(r => r.operationId)).size !== value.receipts.length) throw Error('HISTORY_INVALID');
        value.receipts.forEach(validateReceipt);
        if (value.receipts.some(r => r.version >= 2 ? receiptSources(r).some(source => !value.required?.includes(source)) : !value.required?.includes('diagnostics') && !value.required?.includes('source:memoryConfig'))) throw Error('HISTORY_INVALID');
    }
    if (value.version >= 6 && (!Array.isArray(value.scopeChanges) || value.scopeChanges.length > 32 || value.scopeChanges.some(change =>
        !change || Object.keys(change).sort().join(',') !== 'at,from,messageIndex,to' ||
        ![change.at, change.messageIndex].every(n => Number.isSafeInteger(n) && n >= 0) ||
        change.messageIndex > value.messages?.length ||
        ![change.from, change.to].every(scope => typeof scope === 'string' && scope.length <= 4096 && scope.startsWith('["assistant",'))))) throw Error('HISTORY_INVALID');
    if (value.version >= 3 && value.contextSummary !== null) {
        const s = value.contextSummary;
        if (!s || Object.keys(s).sort().join(',') !== 'createdAt,fingerprint,text,through' || !Number.isSafeInteger(s.through) || s.through < 2 || s.through > HISTORY_LIMITS.messages || typeof s.fingerprint !== 'string' || !/^\d+:\d+:\d+$/.test(s.fingerprint) || s.fingerprint.length > 50 || !validSummaryText(s.text) || !Number.isSafeInteger(s.createdAt) || s.createdAt < 0) throw Error('HISTORY_INVALID');
    }
    if (!validHistoryId(value.id) || !Number.isSafeInteger(value.revision) || value.revision < 0) throw Error('HISTORY_INVALID');
    if (typeof value.scope !== 'string' || value.scope.length > 4096 || typeof value.title !== 'string' || value.title.length > 100) throw Error('HISTORY_INVALID');
    let scope; try { scope = JSON.parse(value.scope); } catch { throw Error('HISTORY_INVALID'); }
    if (!Array.isArray(scope) || scope.length !== 3 || !['chat', 'memory', 'director', 'draft', ...(value.version >= 5 ? ['assistant'] : [])].includes(scope[0]) || !['chat', 'global'].includes(scope[1]) || (scope[1] === 'chat' ? typeof scope[2] !== 'string' || !scope[2] : scope[2] !== null)) throw Error('HISTORY_INVALID');
    if (scope[0] !== 'assistant' && (scope[0] === 'draft') !== (scope[1] === 'global')) throw Error('HISTORY_INVALID');
    if (![value.createdAt, value.updatedAt].every(n => Number.isSafeInteger(n) && n >= 0)) throw Error('HISTORY_INVALID');
    if (!['idle', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted'].includes(value.status)) throw Error('HISTORY_INVALID');
    if (!Array.isArray(value.required) || value.required.length > 3 + permissionSources.length + 64 || new Set(value.required).size !== value.required.length || value.required.some(k => !['diagnostics', 'chat', 'extended', ...permissionSources].includes(k) && !(value.version >= 5 && (parseExecutionSource(k) || parseScriptExecutionSource(k) || parseAgentExecutionSource(k) || parseGenerationBatchExecutionSource(k) || parseNpcExecutionSource(k) || parseProfileExecutionSource(k) || parseMemoryExecutionSource(k))))) throw Error('HISTORY_INVALID');
    if (!Array.isArray(value.messages) || value.messages.length > HISTORY_LIMITS.messages) throw Error('HISTORY_CAPACITY');
    for (const m of value.messages) {
        if (!m || Object.keys(m).some(k => !['role', 'content', 'runId', ...(value.version >= 7 ? ['origin'] : [])].includes(k)) || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string' || historyBytes(m.content) > MAX_MESSAGE_BYTES || typeof m.runId !== 'string' || m.runId.length > 150 ||
            Object.hasOwn(m, 'origin') && (m.role !== 'user' || !['question', 'continuation'].includes(m.origin))) throw Error('HISTORY_INVALID');
    }
    if (historyBytes(value) > HISTORY_LIMITS.recordBytes) throw Error('HISTORY_CAPACITY');
    const normalized = { ...value, version: value.version >= 4 ? value.version : 3, archived: value.archived ?? false, imported: value.imported ?? false, contextSummary: value.contextSummary ?? null };
    if (historyBytes(normalized) > HISTORY_LIMITS.recordBytes) throw Error('HISTORY_CAPACITY');
    return structuredClone(normalized);
}
export function summarizeRecord(record) {
    const { messages, required, contextSummary, receipts, scopeChanges, ...summary } = record;
    return { ...summary, count: messages.length, bytes: historyBytes(record) };
}
export function validateSummary(summary) {
    if (!summary || Object.keys(summary).some(k => !['version', 'id', 'revision', 'scope', 'title', 'createdAt', 'updatedAt', 'status', 'count', 'bytes', 'archived', 'imported'].includes(k))) throw Error('HISTORY_INVALID');
    const { count, bytes, ...record } = summary;
    const normalized = validateRecord({ ...record, messages: [], required: [], ...(record.version >= 3 ? { contextSummary: null } : {}), ...(record.version >= 4 ? { receipts: [] } : {}), ...(record.version >= 6 ? { scopeChanges: [] } : {}) });
    if (!Number.isSafeInteger(count) || count < 0 || count > HISTORY_LIMITS.messages || !Number.isSafeInteger(bytes) || bytes < 0 || bytes > HISTORY_LIMITS.recordBytes) throw Error('HISTORY_INVALID');
    return { ...structuredClone(summary), version: normalized.version, archived: normalized.archived, imported: normalized.imported };
}
/** Recent complete turns only. Failed/orphaned turns and an oversized turn are not spliced. */
export function selectHistory(messages, { maxChars = 24000, maxTurns = 12 } = {}) {
    const turns = [];
    for (let i = 0; i < messages.length - 1; i++) {
        const a = messages[i], b = messages[i + 1];
        if (a.role === 'user' && b.role === 'assistant' && a.runId === b.runId) { turns.push([a, b]); i++; }
    }
    let chars = 0; const selected = [];
    for (const turn of turns.reverse()) {
        const size = turn.reduce((n, m) => n + m.content.length, 0);
        if (selected.length >= maxTurns || chars + size > maxChars || turn.some(({ role, content }) => historyBytes({ role, content }) > 32700)) break;
        selected.unshift(turn); chars += size;
    }
    const result = selected.flat().map(({ role, content }) => ({ role, content }));
    return { messages: result, omitted: messages.length - result.length };
}
