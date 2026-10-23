import { bytes, estimateTokens, CONTEXT_DEFAULTS, MAX_REQUEST_BYTES, MAX_CONTEXT_MESSAGES, MAX_MESSAGE_BYTES } from './policy.js';
import { compactionRequest, compactionSegments } from './compaction.js';
import { summaryMessage } from './summary-contract.js';
export { summaryMessage } from './summary-contract.js';

// Change detector only, never an authorization or authenticity check.
export function fingerprint(value) {
    const text = JSON.stringify(value); let a = 2166136261, b = 5381;
    for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ text.charCodeAt(i); }
    return `${text.length}:${a >>> 0}:${b >>> 0}`;
}
export function completeTurns(messages) {
    const turns = [];
    for (let i = 0; i < messages.length - 1; i++) {
        const a = messages[i], b = messages[i + 1];
        if (a.role === 'user' && b.role === 'assistant' && a.runId === b.runId) { turns.push({ end: i + 2, messages: [a, b].map(({ role, content }) => ({ role, content })) }); i++; }
    }
    return turns;
}
export function usableSummary(summary, messages) {
    return !!summary && summary.through <= messages.length && fingerprint(messages.slice(0, summary.through)) === summary.fingerprint;
}
export function planContext(messages, summary, config = CONTEXT_DEFAULTS, omit = false) {
    if (omit) return { messages: [], omitted: messages.length, turns: 0, summaryUsed: false, estimatedTokens: 0,
        coverage: { state: 'omitted', total: messages.length, summarized: 0, raw: 0, omitted: 0, excluded: messages.length } };
    const valid = usableSummary(summary, messages), start = valid ? summary.through : 0;
    const turns = completeTurns(messages.slice(start)), selected = [];
    let size = 0;
    // Reserve space for the actual question, instructions, tool definitions and subsequent results.
    // Keep the default window conservative, but let larger configured windows carry
    // a complete long answer instead of silently treating 12k as a universal cap.
    // Auto mode budgets history against the transport ceiling, not a guessed model window.
    const limit = Math.floor(Math.min(config.inputTokens ?? MAX_REQUEST_BYTES / 2, MAX_REQUEST_BYTES / 2) * 0.9);
    const head = valid ? [summaryMessage(summary.text)] : [];
    size += estimateTokens(head);
    if (valid) {
        const tail = messages.slice(start).map(({ role, content }) => ({ role, content }));
        const all = [...head, ...tail], cost = estimateTokens(all);
        const complete = all.length <= MAX_CONTEXT_MESSAGES - 256 && cost <= limit && all.every(m => bytes(m.content) <= MAX_MESSAGE_BYTES);
        return { messages: complete ? all : [], turns: complete ? turns.length : 0,
            omitted: complete ? 0 : messages.length - start, summaryUsed: complete, estimatedTokens: complete ? cost : 0,
            protectedHistory: true, historyBlocked: !complete, needsSummary: !complete,
            coverage: { state: complete ? 'complete' : 'blocked', total: messages.length, summarized: start, raw: complete ? tail.length : 0, omitted: complete ? 0 : tail.length, excluded: 0 } };
    }
    for (const turn of turns.reverse()) {
        const cost = estimateTokens(turn.messages);
        if ((selected.length + 1) * 2 > MAX_CONTEXT_MESSAGES - 256 || size + cost > limit || turn.messages.some(m => bytes(m.content) > MAX_MESSAGE_BYTES)) break;
        selected.unshift(turn.messages); size += cost;
    }
    const chosen = selected.flat();
    return { messages: [...head, ...chosen], turns: selected.length, omitted: messages.length - chosen.length - (valid ? start : 0), summaryUsed: valid, estimatedTokens: size,
        coverage: { state: chosen.length === messages.length ? 'complete' : 'window', total: messages.length, summarized: 0, raw: chosen.length, omitted: messages.length - chosen.length, excluded: 0 } };
}
/** One bounded extension per operation, anchored to the full original prefix. No gap is skipped. */
export function summaryCandidate(messages, config = CONTEXT_DEFAULTS, previous = null) {
    const start = usableSummary(previous, messages) ? previous.through : 0;
    const turns = completeTurns(messages.slice(start));
    // Retain a contiguous raw suffix within 10% of the configured input budget.
    // Measure originals linearly, including failed/orphan messages between turns.
    // Reserve at least one complete turn for compaction. For tiny histories that
    // entirely fit this allowance, recentTurns remains a manual-summary reference,
    // not a cap on the suffix of a large conversation.
    const rawLimit = Math.floor(Math.min(config.inputTokens ?? MAX_REQUEST_BYTES / 2, MAX_REQUEST_BYTES / 2) * .1);
    const tail = messages.slice(start).map(({ role, content }) => ({ role, content }));
    const costs = tail.map(m => bytes(m));
    let suffixBytes = 2, suffixCount = 0, suffixValid = true, keepFrom = turns.length;
    let cursorEnd = tail.length;
    for (let i = turns.length - 1; i >= 0; i--) {
        const begin = i ? turns[i - 1].end : 0;
        for (let j = begin; j < cursorEnd; j++) {
            suffixBytes += costs[j] + (suffixCount ? 1 : 0); suffixCount++;
            suffixValid &&= bytes(tail[j].content) <= MAX_MESSAGE_BYTES;
        }
        if (!suffixValid || suffixCount > MAX_CONTEXT_MESSAGES - 256 || Math.ceil(suffixBytes / 2) > rawLimit) break;
        keepFrom = i; cursorEnd = begin;
    }
    if (keepFrom === 0) keepFrom = Math.max(1, turns.length - (config.recentTurns ?? CONTEXT_DEFAULTS.recentTurns));
    const old = turns.slice(0, keepFrom);
    const selected = start ? [summaryMessage(previous.text)] : []; let through = 0, cursor = 0;
    // An appended segment adds its serialized bytes and one array separator.
    // Measure each original message once instead of rebuilding every growing prefix.
    const base = compactionRequest({ messages: [] }, config.inputTokens, config.summaryTokens ?? CONTEXT_DEFAULTS.summaryTokens);
    let requestBytes = bytes(base), segmentCount = base.messages.length;
    const measure = (source, offset) => {
        const chunks = compactionSegments(source, offset);
        return { count: chunks.length, bytes: chunks.reduce((sum, chunk) => sum + 1 + bytes(chunk), 0), valid: chunks.every(chunk => bytes(chunk.content) <= MAX_MESSAGE_BYTES) };
    };
    const head = measure(selected, 0); requestBytes += head.bytes; segmentCount += head.count;
    for (const turn of old) {
        const increment = messages.slice(start + cursor, start + turn.end).map(({ role, content }) => ({ role, content }));
        const addition = measure(increment, selected.length), nextBytes = requestBytes + addition.bytes;
        // Each segment must pass the model DTO contract. The aggregate still
        // has to fit the one-call summary budget; never claim an uncovered turn.
        if (!head.valid || !addition.valid || segmentCount + addition.count > MAX_CONTEXT_MESSAGES ||
            (config.inputTokens === null ? nextBytes > MAX_REQUEST_BYTES * 0.98 : Math.ceil(nextBytes / 2) > config.inputTokens * 0.98)) break;
        requestBytes = nextBytes; segmentCount += addition.count;
        selected.push(...increment); cursor = turn.end; through = start + turn.end;
    }
    return through ? { through, fingerprint: fingerprint(messages.slice(0, through)), messages: selected } : null;
}
