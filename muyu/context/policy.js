/** Null means auto: no guessed model-token limit, only the transport byte ceiling. */
export const CONTEXT_DEFAULTS = Object.freeze({ inputTokens: 900000, recentTurns: 12, autoSummary: false, historyAuthorization: 'auto', summaryTokens: 16384, summaryTimeMs: 300000 });
export const SUMMARY_TIME_RANGE = Object.freeze([10000, 1800000]);
export { MAX_REQUEST_BYTES, MAX_CONTEXT_MESSAGES, MAX_MESSAGE_BYTES } from '../core/context-limits.js';
export const MAX_MANUAL_INPUT_TOKENS = 1000000;
export function validateContextConfig(value) {
    if (!value || !['autoSummary,inputTokens,recentTurns', 'autoSummary,historyAuthorization,inputTokens,recentTurns'].includes(Object.keys(value).filter(k => !['summaryTokens', 'summaryTimeMs'].includes(k)).sort().join(',')) ||
        (Object.hasOwn(value, 'summaryTimeMs') && (!Number.isSafeInteger(value.summaryTimeMs) || value.summaryTimeMs < SUMMARY_TIME_RANGE[0] || value.summaryTimeMs > SUMMARY_TIME_RANGE[1])) ||
        (Object.hasOwn(value, 'summaryTokens') && (!Number.isSafeInteger(value.summaryTokens) || value.summaryTokens < 1024 || value.summaryTokens > 32768)) ||
        (Object.hasOwn(value, 'historyAuthorization') && !['auto', 'ask'].includes(value.historyAuthorization)) ||
        !(value.inputTokens === null || Number.isSafeInteger(value.inputTokens) && value.inputTokens >= 4096 && value.inputTokens <= MAX_MANUAL_INPUT_TOKENS) ||
        !Number.isSafeInteger(value.recentTurns) || value.recentTurns < 1 || value.recentTurns > 24 || typeof value.autoSummary !== 'boolean') throw Error('INVALID_CONTEXT_CONFIG');
    return { ...value, historyAuthorization: value.historyAuthorization ?? CONTEXT_DEFAULTS.historyAuthorization, summaryTokens: value.summaryTokens ?? CONTEXT_DEFAULTS.summaryTokens, summaryTimeMs: value.summaryTimeMs ?? CONTEXT_DEFAULTS.summaryTimeMs };
}
export const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
// Deliberately conservative heuristic for mixed-language JSON; never labelled actual tokens.
export const estimateTokens = value => Math.ceil(bytes(value) / 2);
export function measurePayload(payload) {
    const messages = [...(payload.taskGuides || []), ...(payload.messages || [])];
    return { estimatedTokens: estimateTokens(payload), requestBytes: bytes(payload), instructionBytes: payload.instructions ? bytes(payload.instructions) : messages.filter(m => m.role === 'system').reduce((sum, m) => sum + bytes(m), 0),
        toolDefinitionBytes: bytes(payload.tools || []), toolResultBytes: bytes(messages.filter(m => m.role === 'tool')),
        reasoningBytes: bytes(messages.map(m => m.reasoning_content || '')), messageBytes: bytes(messages) };
}
export function projectContext(value) {
    const keys = ['estimatedTokens', 'requestBytes', 'toolDefinitionBytes', 'toolResultBytes', 'reasoningBytes', 'messageBytes'];
    if (!value || keys.some(k => !Number.isSafeInteger(value[k]) || value[k] < 0 || value[k] > 16000000)) return null;
    const instructionBytes = value.instructionBytes ?? 0;
    if (!Number.isSafeInteger(instructionBytes) || instructionBytes < 0 || instructionBytes > 16000000) return null;
    return { ...Object.fromEntries(keys.map(k => [k, value[k]])), instructionBytes };
}

/** Counts only: never a source fingerprint, transcript or authorization. */
export function projectCoverage(value) {
    const keys = ['total', 'summarized', 'raw', 'omitted', 'excluded'];
    if (!value || !['complete', 'window', 'blocked', 'omitted'].includes(value.state) ||
        keys.some(k => !Number.isSafeInteger(value[k]) || value[k] < 0 || value[k] > 4096) ||
        value.summarized + value.raw + value.omitted + value.excluded !== value.total ||
        value.state === 'complete' && (value.omitted || value.excluded) ||
        value.state === 'blocked' && value.raw !== 0) return null;
    return { state: value.state, ...Object.fromEntries(keys.map(k => [k, value[k]])) };
}
