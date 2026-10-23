export const RUN_DEFAULTS = Object.freeze({ modelCalls: 12, toolCalls: 48, timeMs: 300000, maxTokens: 32768, providerBytes: 2 * 1024 * 1024 });
export const RUN_RANGES = Object.freeze({ modelCalls: [2, 16], toolCalls: [1, 64], timeMs: [10000, 1800000], maxTokens: [256, 32768], providerBytes: [6000, 16 * 1024 * 1024] });
export function validateRunConfig(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== Object.keys(RUN_DEFAULTS).length) throw Error('INVALID_RUN_CONFIG');
    const out = {};
    for (const [key, [min, max]] of Object.entries(RUN_RANGES)) {
        if (!Object.hasOwn(value, key) || !Number.isSafeInteger(value[key]) || value[key] < min || value[key] > max) throw Error('INVALID_RUN_CONFIG');
        out[key] = value[key];
    }
    return out;
}
export const BUDGET_REASONS = Object.freeze(['model_calls', 'tool_calls', 'corrections', 'tool_batch', 'provider_bytes', 'run_time', 'model_output']);
/** Closed safe process projection, independent of model and host data. */
export function projectBudget(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const numeric = ['modelCalls', 'modelLimit', 'toolCalls', 'toolLimit', 'corrections', 'correctionLimit', 'elapsedMs', 'timeLimitMs', 'providerBytes', 'providerLimit', 'maxTokens', 'inputTokens', 'outputTokens', 'usageReports'];
    if (numeric.some(k => !Number.isSafeInteger(raw[k]) || raw[k] < 0 || raw[k] > 16000000000)) return null;
    return { ...Object.fromEntries(numeric.map(k => [k, raw[k]])), reason: BUDGET_REASONS.includes(raw.reason) ? raw.reason : null, finalizing: raw.finalizing === true };
}
