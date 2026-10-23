import { safeProcessCode, processTools } from './process-store.js';
import { providerCatalog } from '../modules/providers/catalog.js';
import { projectBudget } from '../core/budget.js';
import { projectContext, projectCoverage } from '../context/policy.js';
import { modelDiagnosticStage } from '../core/model-diagnostics.js';

const number = (value, max = 16000000000) => Number.isSafeInteger(value) && value >= 0 && value <= max ? value : null;
const pick = (value, choices) => choices.includes(value) ? value : null;
const phases = ['queued', 'running', 'cancelling', 'yielded', 'succeeded', 'failed', 'cancelled', 'interrupted', 'model.started', 'model.completed', 'model.failed', 'tool.requested', 'tool.started', 'tool.reused', 'tool.completed', 'tool.failed'];
const readStatuses = ['ok', 'empty', 'SOURCE_UNAVAILABLE', 'SOURCE_DISABLED', 'SOURCE_TOO_LARGE', 'SOURCE_UNSUPPORTED', 'INVALID_SELECTOR', 'INVALID_READ_ARGUMENTS', 'INVALID_CONTINUATION', 'STALE_SOURCE', 'BUDGET_EXCEEDED', 'TARGET_UNAVAILABLE'];

/** Explicit local export: reconstruct an allowlist, never serialize the controller snapshot. */
export function diagnosticExport(snapshot, now = Date.now()) {
    const all = Array.isArray(snapshot?.runs) ? snapshot.runs : [], retained = all.slice(-128);
    const sessions = new Map(), tasks = new Map();
    const alias = (map, id, prefix) => {
        if (typeof id !== 'string' || !id) return null;
        if (!map.has(id)) map.set(id, prefix + (map.size + 1));
        return map.get(id);
    };
    const runs = retained.map((run, index) => {
        const p = run.process || {}, rows = Array.isArray(p.rows) ? p.rows : [];
        return { run: 'run-' + (index + 1), session: alias(sessions, run.sessionId, 'session-'), task: alias(tasks, run.taskId, 'task-'),
            status: pick(run.status, phases), phase: pick(p.phase, phases), terminal: pick(p.terminal, phases),
            error: safeProcessCode(p.error), cleaned: p.cleaned === true, toolFailures: number(p.toolFailures),
            droppedRows: number(p.dropped), exportOmittedRows: Math.max(0, rows.length - 48), loadedSkillCount: Array.isArray(run.skills) ? number(run.skills.length, 256) : null,
            budget: projectBudget(p.budget), context: projectContext(p.context),
            inputTokenLimit: p.context?.inputTokenLimit === null ? null : number(p.context?.inputTokenLimit, 1000000),
            coverage: projectCoverage(p.coverage), summaryError: safeProcessCode(p.summaryError),
            rows: rows.slice(-48).map(row => {
                const safe = { type: pick(row.type, phases), attempt: number(row.attemptId, 64),
                    tool: Object.hasOwn(processTools, row.tool) ? row.tool : null,
                    elapsedMs: number(row.elapsedMs, 86400000), durationMs: number(row.durationMs, 86400000),
                    error: safeProcessCode(row.error), diagnosticStage: modelDiagnosticStage(row.diagnosticStage) };
                if (row.read && providerCatalog.some(source => source.id === row.read.source)) safe.read = {
                    source: row.read.source, status: pick(row.read.status, readStatuses) || 'UNKNOWN_ERROR',
                    characters: number(row.read.characters, 2000), paged: row.read.paged === true,
                    sourceLimited: row.read.limited === true, truncated: row.read.truncated === true,
                    nextOffset: row.read.nextOffset === -1 ? -1 : number(row.read.nextOffset, 131072),
                };
                return safe;
            }),
        };
    });
    return JSON.stringify({ format: 'muyu-diagnostics', version: 1,
        exportedAt: new Date(now).toISOString(), scope: 'current-conversation-retained-runtime',
        privacy: 'No message/Prompt/Skill bodies, thinking text, raw errors, names, URLs, credentials, permissions or continuation tokens. Runtime identifiers are local aliases.',
        limitations: 'Retained in-memory observations only; older rows/runs may be missing. Not server/CMD logs, persisted history or proof of writes. Export does not grant model access.',
        state: { enabled: snapshot?.enabled === true, busy: snapshot?.busy === true, draining: snapshot?.draining === true,
            error: safeProcessCode(snapshot?.error) },
        configuredBudgets: { ...Object.fromEntries(['modelCalls', 'toolCalls', 'timeMs', 'maxTokens', 'providerBytes']
            .map(key => [key, number(snapshot?.runConfig?.[key])])),
            inputTokens: number(snapshot?.contextConfig?.inputTokens, 1000000),
            inputTokenMode: snapshot?.contextConfig?.inputTokens === null ? 'request-body-only' : number(snapshot?.contextConfig?.inputTokens, 1000000) !== null ? 'manual' : 'unknown',
            autoSummary: snapshot?.contextConfig?.autoSummary === true,
            summaryTokens: number(snapshot?.contextConfig?.summaryTokens, 32768), summaryTimeMs: number(snapshot?.contextConfig?.summaryTimeMs, 1800000) },
        omittedRuns: Math.max(0, all.length - retained.length), runs }, null, 2);
}
