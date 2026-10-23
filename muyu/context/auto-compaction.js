import { MAX_REQUEST_BYTES } from './policy.js';

/** Pressure is relative to the configured INPUT budget, not a discovered model window.
 * Leave 20% of input/transport capacity for growth; output windows remain provider-owned. */
export function compactionPressure(measured, config) {
    return measured.requestBytes >= MAX_REQUEST_BYTES * .8 ||
        config.inputTokens !== null && measured.estimatedTokens >= config.inputTokens * .8;
}

/** Ephemeral per-conversation/scope state. Never stores text, grants or archive data. */
export function createCompactionBreaker() {
    const entries = new Map(); let epoch = 0;
    const status = (id, scope) => {
        const entry = entries.get(id), failures = entry && entry.scope === scope ? entry.failures : 0;
        return { failures, blocked: failures >= 3 };
    };
    return {
        status, epoch: () => epoch,
        record(id, scope, succeeded, capturedEpoch) {
            if (capturedEpoch !== epoch) return;
            if (succeeded) entries.delete(id);
            else entries.set(id, { scope, failures: Math.min(3, status(id, scope).failures + 1) });
        },
        reset(id) { entries.delete(id); },
        clear() { entries.clear(); epoch++; },
    };
}
