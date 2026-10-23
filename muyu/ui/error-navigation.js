/** Safe code-to-UI routing. Opening an entry never retries, grants or writes. */
export function errorDestination(code, reason) {
    if (['CONTEXT_LIMIT', 'CONTEXT_INCOMPLETE', 'AUTO_COMPACTION_BLOCKED', 'SUMMARY_TOO_LARGE', 'SUMMARY_NOT_SMALLER', 'INVALID_CONTEXT_CONFIG', 'CONTEXT_CONFIG_SAVE_FAILED'].includes(code)) return 'context';
    if (code === 'MODEL_OUTPUT_TRUNCATED') return 'output';
    if (code === 'TIMEOUT') return 'time';
    if (['BUDGET_EXCEEDED', 'INVALID_RUN_CONFIG', 'RUN_CONFIG_SAVE_FAILED'].includes(code)) return ({ provider_bytes: 'dataBudget', model_output: 'output', run_time: 'time' })[reason] || 'run';
    if (code?.startsWith('MODEL_') || code?.startsWith('HOST_CONNECTION_') || code === 'HOST_MODEL_REQUEST_FAILED' || code === 'CREDENTIAL_SAVE_FAILED') return 'connection';
    if (code === 'HISTORY_PERMISSION_REQUIRED') return 'historyAccess';
    if (code?.startsWith('PERMISSION_') || code?.startsWith('INTERACTION_')) return 'permission';
    if (code?.startsWith('HISTORY_')) return 'storage';
    if (code?.startsWith('RECOVERY_') || code?.startsWith('ACTION_') || ['WRITE_UNAVAILABLE', 'AUTO_APPLY_REQUIRES_REVIEW', 'RESULT_NEEDS_REVIEW'].includes(code)) return 'results';
    return null;
}
