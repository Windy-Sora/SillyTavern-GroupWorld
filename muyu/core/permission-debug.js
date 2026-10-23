/** Opt-in, page-local diagnostics. Never log content, credentials or raw target IDs. */
const targets = new Map();
let sequence = 0;
export function tracePermission(event, { target, taskId, runId, source, decision, granted, taskGrant, chatGrant, missingSources, toolId, requestId, errorCode } = {}) {
    try {
        if (globalThis.GD_MUYU_PERMISSION_DEBUG !== true) return;
        if (sequence >= 2000) return;
        let targetId = null;
        if (target) {
            const key = JSON.stringify([target.kind, target.userKey, target.chatKey]);
            if (!targets.has(key)) targets.set(key, 'target:' + (targets.size + 1));
            targetId = targets.get(key);
        }
        // Serialize immediately: console object expansion must not show later mutations.
        console.log('[GD Muyu Permission] ' + JSON.stringify({ version: 1, seq: ++sequence, event,
            target: targetId, targetKind: target?.kind, taskId, runId, source, decision,
            granted, taskGrant, chatGrant, missingSources, toolId, requestId, errorCode }));
    } catch { /* Diagnostics must never change authorization or task execution. */ }
}
export function permissionTraceError(error) {
    const known = ['HISTORY_INVALID', 'HISTORY_CAPACITY', 'HISTORY_VERSION', 'HISTORY_PERMISSION_REQUIRED', 'NOT_READY', 'INTERACTION_STALE', 'SESSION_BUSY', 'QUEUE_FULL', 'RUN_CAPACITY'];
    return known.includes(error?.message) ? error.message : ['TypeError', 'RangeError', 'ReferenceError'].includes(error?.name) ? error.name : 'UNKNOWN_ERROR';
}
