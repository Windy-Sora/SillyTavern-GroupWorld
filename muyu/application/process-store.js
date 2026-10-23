// Closed projection: never stores event payloads, call IDs, model text or arbitrary errors.
export { toolLabels as processTools } from '../modules/catalog.js';
import { toolLabels as processTools } from '../modules/catalog.js';
import { providerCatalog } from '../modules/providers/catalog.js';
import { projectBudget } from '../core/budget.js';
import { modelDiagnosticStage } from '../core/model-diagnostics.js';
import { MAX_MANUAL_INPUT_TOKENS, MAX_CONTEXT_MESSAGES, projectContext, projectCoverage } from '../context/policy.js';
const codes = new Set(['PERMISSION_DENIED', 'INVALID_ARGUMENT', 'CALL_ID_CONFLICT', 'UNSUPPORTED_CAPABILITY', 'TARGET_UNAVAILABLE', 'UPSTREAM_PENDING', 'OUTPUT_INVALID', 'TIMEOUT', 'TOOL_FAILED', 'CANCELLED', 'BUDGET_EXCEEDED', 'MODEL_NETWORK_ERROR', 'MODEL_AUTH_ERROR', 'MODEL_RATE_LIMIT', 'MODEL_SERVICE_ERROR', 'MODEL_HTTP_ERROR', 'MODEL_PROTOCOL_ERROR', 'MODEL_HISTORY_UNAVAILABLE', 'MODEL_OUTPUT_TRUNCATED', 'MODEL_FAILED', 'START_FAILED', 'SUMMARY_TOO_LARGE', 'SUMMARY_NOT_SMALLER']);
export const safeProcessCode = value => codes.has(value) ? value : value ? 'UNKNOWN_ERROR' : null;
const safeCode = safeProcessCode;
codes.add('CONTEXT_LIMIT');
codes.add('CONTEXT_INCOMPLETE');
codes.add('AUTO_COMPACTION_BLOCKED');
codes.add('PERMISSION_REQUIRED');
codes.add('PERMISSION_REQUEST_INVALID');
for (const code of ['PERMISSION_LIMIT', 'CLARIFICATION_LIMIT', 'INVALID_CONTINUATION']) codes.add(code);
for (const code of ['MODEL_HISTORY_LIMIT', 'MODEL_RESPONSE_TOO_LARGE', 'MODEL_REQUEST_TOO_LARGE']) codes.add(code);
const elapsed = (end, start) => Math.min(86_400_000, Math.max(0, Math.round(end - start)));
const types = new Set(['run.usage', 'model.started', 'model.completed', 'model.failed', 'tool.requested', 'tool.started', 'tool.reused', 'tool.completed', 'tool.failed', 'run.finished']);

export function createProcessStore({ maxRuns = 128, maxRows = 48, maxTotalRows = 1024 } = {}) {
    for (const n of [maxRuns, maxRows, maxTotalRows]) if (!Number.isSafeInteger(n) || n < 1 || n > 4096) throw new TypeError('INVALID_PROCESS_LIMIT');
    const records = new Map(); let count = 0;
    function add(r, row) {
        r.rows.push(row); count++;
        while (r.rows.length > maxRows) { r.rows.shift(); r.dropped++; count--; }
        while (count > maxTotalRows) {
            const oldest = [...records.values()].find(v => v.rows.length);
            oldest.rows.shift(); oldest.dropped++; count--;
        }
    }
    return Object.freeze({
        create(id) {
            if (records.has(id) || records.size >= maxRuns) return;
            records.set(id, { phase: 'queued', terminal: null, error: null, cleaned: false, toolFailures: 0, rows: [], dropped: 0, seq: 0, start: null, active: null });
        },
        event(id, event) {
            const r = records.get(id);
            if (!r || r.terminal || r.phase === 'cancelling' || event?.runId !== id || !Number.isSafeInteger(event.seq) || event.seq <= r.seq) return;
            r.seq = event.seq;
            if (event.type === 'run.context') {
                const p = event.payload || {}, value = projectContext(p);
                if (p.phase === 'history_coverage' && ['planned', 'skipped', 'summarized', 'fallback', 'blocked'].includes(p.status)) {
                    const coverage = projectCoverage(p.coverage);
                    if (coverage) r.coverage = { ...coverage, status: p.status };
                }
                if (value) r.context = { ...value, inputTokenLimit: Number.isSafeInteger(p.inputTokenLimit) ? Math.max(4096, Math.min(MAX_MANUAL_INPUT_TOKENS, p.inputTokenLimit)) : null, historicalMessages: Number.isSafeInteger(p.historicalMessages) ? Math.max(0, Math.min(MAX_CONTEXT_MESSAGES, p.historicalMessages)) : null, trimmedHistoricalMessages: Math.min(MAX_CONTEXT_MESSAGES, (r.context?.trimmedHistoricalMessages || 0) + (Number.isSafeInteger(p.trimmedHistoricalMessages) ? Math.max(0, Math.min(MAX_CONTEXT_MESSAGES, p.trimmedHistoricalMessages)) : 0)) };
                if (['request', 'summarizing', 'summarized', 'summary_failed'].includes(p.phase)) r.contextPhase = p.phase;
                if (['summarizing', 'summarized', 'summary_failed'].includes(p.phase)) r.summaryPhase = p.phase;
                if (p.phase === 'summarizing') r.summaryUsage = { calls: Math.min(2, (r.summaryUsage?.calls || 0) + 1), reports: r.summaryUsage?.reports || 0, inputTokens: r.summaryUsage?.inputTokens ?? null, outputTokens: r.summaryUsage?.outputTokens ?? null };
                if (p.phase === 'summary_failed') r.summaryError = safeCode(p.error);
                if (p.phase === 'summary_usage' && [p.inputTokens, p.outputTokens].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 1000000000)) r.summaryUsage = { calls: r.summaryUsage?.calls || 1, reports: Math.min(2, (r.summaryUsage?.reports || 0) + 1), inputTokens: Math.min(2000000000, (r.summaryUsage?.inputTokens || 0) + p.inputTokens), outputTokens: Math.min(2000000000, (r.summaryUsage?.outputTokens || 0) + p.outputTokens) };
                return;
            }
            if (!types.has(event.type)) return;
            const p = event.payload || {}, type = event.type;
            if (type === 'run.usage') { const value = projectBudget(p); if (value) r.budget = value; return; }
            if (type === 'run.finished') { r.error = safeCode(p.error); return; }
            if (!Number.isSafeInteger(p.attemptId) || p.attemptId < 1 || p.attemptId > 64) return;
            const at = Number.isFinite(event.at) ? event.at : null;
            if (r.start === null && at !== null) r.start = at;
            const tool = type.startsWith('tool.') ? (Object.hasOwn(processTools, p.toolId) ? p.toolId : 'unknown') : null;
            const row = { type, attemptId: p.attemptId, tool, elapsedMs: at === null || r.start === null ? null : elapsed(at, r.start), durationMs: null, error: type === 'tool.failed' ? safeCode(p.result?.error?.code) : type === 'model.failed' ? safeCode(p.error) : null };
            const stage = type === 'model.failed' ? modelDiagnosticStage(p.diagnosticStage) : null;
            if (stage) row.diagnosticStage = stage;
            if (type === 'tool.completed' && tool === 'muyu.provider.read') {
                const d = p.result?.data;
                if (d && providerCatalog.some(p => p.id === d.source)) {
                    const status = ['ok', 'empty', 'SOURCE_UNAVAILABLE', 'SOURCE_DISABLED', 'SOURCE_TOO_LARGE', 'SOURCE_UNSUPPORTED', 'INVALID_SELECTOR', 'INVALID_READ_ARGUMENTS', 'INVALID_CONTINUATION', 'STALE_SOURCE', 'BUDGET_EXCEEDED', 'TARGET_UNAVAILABLE'].includes(d.status) ? d.status : 'UNKNOWN_ERROR';
                    row.read = { source: d.source, status, characters: d.source === 'memoryConfig' && d.data ? Math.min(2000, JSON.stringify(d.data).length) : typeof d.text === 'string' ? Math.min(2000, d.text.length) : 0, truncated: d.truncated === true };
                    if (typeof d.sourceLimited === 'boolean') {
                        row.read.limited = d.sourceLimited;
                        row.read.paged = Number.isSafeInteger(d.nextOffset) && d.nextOffset >= 0 && d.nextOffset <= 131072;
                    }
                    if (Number.isSafeInteger(d.nextOffset) && d.nextOffset >= -1 && d.nextOffset <= 131072) row.read.nextOffset = d.nextOffset;
                }
            }
            if (type === 'model.started' || type === 'tool.requested') r.active = { kind: type.split('.')[0], attemptId: p.attemptId, at };
            if (['model.completed', 'model.failed', 'tool.completed', 'tool.failed'].includes(type)) {
                if (r.active?.kind === type.split('.')[0] && r.active.attemptId === p.attemptId && r.active.at !== null && at !== null) row.durationMs = elapsed(at, r.active.at);
                r.active = null;
            }
            if (type === 'tool.failed') r.toolFailures++;
            r.phase = type; add(r, row);
        },
        lifecycle(id, phase, error = null) {
            const r = records.get(id); if (!r) return;
            if (phase === 'cleaned') { r.cleaned = true; return; }
            if (r.terminal) return;
            if (['yielded', 'succeeded', 'failed', 'cancelled', 'interrupted'].includes(phase)) { r.terminal = phase; r.error = phase === 'cancelled' ? 'CANCELLED' : r.error || safeCode(error); r.active = null; }
            if (['yielded', 'running', 'cancelling', 'succeeded', 'failed', 'cancelled', 'interrupted'].includes(phase)) r.phase = phase;
        },
        snapshot(id) {
            const r = records.get(id); if (!r) return null;
            const { seq, start, active, ...safe } = r; return structuredClone(safe);
        },
        forget(id) { const r = records.get(id); if (r) { count -= r.rows.length; records.delete(id); } },
        clear() { records.clear(); count = 0; },
    });
}
