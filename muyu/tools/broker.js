import { copyJson, jsonKey, validateJson } from '../core/json-contract.js';
import { assertActive, bounded, ExecutionError, safeFailure, systemClock } from '../core/execution.js';
import { tracePermission } from '../core/permission-debug.js';

/** A run-local serial executor; external effects require an explicit tool-ID allowlist. */
export function createToolBroker({ registry, handlers, runId, target, allowedTools = [], externalTools = [], policy = () => false, signal, maxCalls = 16, clock = systemClock, track, onEvent = () => {} }) {
    if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 64) throw new TypeError('Invalid tool budget');
    const origin = copyJson(target), allowed = new Set(allowedTools);
    const definitions = new Map(registry.list().map(d => [d.id, copyJson(d)]));
    const functions = new Map(Object.entries(handlers));
    const records = new Map();
    let attempts = 0, pending = false, tail = Promise.resolve();
    const notify = (type, attemptId, toolId) => { try { onEvent({ type, attemptId, toolId }); } catch { /* Observers cannot affect execution. */ } };
    async function execute(raw) {
        assertActive(signal);
        if (++attempts > maxCalls) throw new ExecutionError('BUDGET_EXCEEDED');
        const attemptId = attempts;
        let call;
        try {
            call = copyJson(raw);
            if (!call || Object.keys(call).sort().join(',') !== 'args,callId,toolId,version' || typeof call.callId !== 'string' || !call.callId || call.callId.length > 128 || typeof call.toolId !== 'string' || !Number.isInteger(call.version)) throw new Error();
        } catch { return safeFailure('INVALID_ARGUMENT'); }
        const key = jsonKey(call), previous = records.get(call.callId);
        if (previous) {
            if (previous.key !== key) return safeFailure('CALL_ID_CONFLICT');
            notify('tool.reused', attemptId, call.toolId); return copyJson(previous.result);
        }
        const remember = result => { records.set(call.callId, { key, result: copyJson(result) }); return copyJson(result); };
        const d = definitions.get(call.toolId);
        if (!d || !allowed.has(call.toolId)) return remember(safeFailure('PERMISSION_DENIED'));
        if (d.version !== call.version || !(d.effect === 'read' || d.effect === 'external' && externalTools.includes(d.id))) return remember(safeFailure('UNSUPPORTED_CAPABILITY'));
        if (d.scope === 'chat' && origin.kind !== 'chat') return remember(safeFailure('TARGET_UNAVAILABLE'));
        let args;
        try { args = validateJson(d.inputSchema, call.args); } catch { return remember(safeFailure('INVALID_ARGUMENT')); }
        let granted = false, needsPermission = false, requestInvalid = false, denialReason = null, missingSources = [];
        try {
            const decision = policy({ definition: copyJson(d), args: copyJson(args), target: copyJson(origin), runId });
            tracePermission('broker.policy', { target: origin, runId, toolId: d.id,
                decision: typeof decision === 'object' ? decision?.decision : decision,
                missingSources: decision?.missingSources });
            if (decision && typeof decision.then === 'function') Promise.resolve(decision).catch(() => {});
            else {
                granted = decision === true;
                needsPermission = decision === 'permission_required' || decision?.decision === 'permission_required';
                requestInvalid = decision === 'permission_request_invalid';
                if (!granted && !needsPermission && !requestInvalid && typeof decision?.decision === 'string' &&
                    ['user_denied', 'policy_forbidden', 'invalid_request', 'target_unavailable'].includes(decision.decision)) denialReason = decision.decision;
                if (needsPermission && Array.isArray(decision?.missingSources)) {
                    missingSources = decision.missingSources.filter(source => typeof source === 'string' && /^source:[A-Za-z][A-Za-z0-9_:-]{0,180}$/.test(source)).slice(0, 8);
                }
            }
        } catch { /* Fail closed. */ }
        assertActive(signal);
        if (!granted) {
            const result = safeFailure(needsPermission ? 'PERMISSION_REQUIRED' : requestInvalid ? 'PERMISSION_REQUEST_INVALID' : denialReason === 'invalid_request' ? 'INVALID_ARGUMENT' : denialReason === 'target_unavailable' ? 'TARGET_UNAVAILABLE' : 'PERMISSION_DENIED');
            if (needsPermission && missingSources.length) result.error.missingSources = missingSources;
            if (denialReason === 'user_denied' || denialReason === 'policy_forbidden') result.error.reason = denialReason;
            return remember(result);
        }
        const handler = functions.get(d.id);
        if (typeof handler !== 'function') return remember(safeFailure('UNSUPPORTED_CAPABILITY'));
        if (pending) return remember(safeFailure('UPSTREAM_PENDING'));
        try {
            const data = await bounded(async childSignal => {
                pending = true;
                try {
                    let result;
                    try { result = handler(args, { runId, callId: call.callId, target: copyJson(origin), signal: childSignal }); }
                    finally { notify('tool.started', attemptId, d.id); }
                    return await result;
                }
                finally { pending = false; }
            }, { signal, timeoutMs: d.timeoutMs, clock, track });
            assertActive(signal);
            let output;
            try { output = validateJson(d.outputSchema, data); } catch { return remember(safeFailure('OUTPUT_INVALID', 'unknown')); }
            return remember({ ok: true, data: output });
        } catch (error) {
            assertActive(signal);
            // Only closed, read-only selection and preview contract errors are safe to disclose.
            // Other handler exceptions may contain secrets or have unknown effects.
            const selection = d.id === 'muyu.tools.select' && error instanceof ExecutionError &&
                ['INVALID_TOOL_GROUP', 'TOOL_GROUP_CAPACITY'].includes(error.code);
            if (selection) {
                const result = safeFailure('INVALID_ARGUMENT');
                result.error.message = error.code === 'INVALID_TOOL_GROUP'
                    ? 'Use only group IDs returned by muyu.tools.list, without duplicates, and select at most 8 groups.'
                    : 'Selected groups exceed the visible tool limit. Use muyu.tools.list counts to select fewer groups.';
                return remember(result);
            }
            const splitDraft = d.id === 'muyu.settings.preview' && error instanceof ExecutionError &&
                ['MEMORY_LIMIT_REQUIRES_SEPARATE_DRAFT', 'COMPLETION_VARIABLE_REQUIRES_SEPARATE_DRAFT'].includes(error.code);
            return remember(safeFailure(splitDraft ? error.code : error instanceof ExecutionError && error.code === 'TIMEOUT' ? 'TIMEOUT' : 'TOOL_FAILED', splitDraft ? 'not_started' : 'unknown'));
        }
    }
    return Object.freeze({
        call(raw) {
            // Capture immediately; callers cannot mutate an enqueued request.
            let input;
            try { input = copyJson(raw); } catch { input = null; }
            const result = tail.then(() => execute(input));
            tail = result.catch(() => {});
            return result;
        },
        get attempts() { return attempts; },
    });
}
