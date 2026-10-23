import { LITERAL_LIMITS, searchRecords } from '../../retrieval/literal.js';

export const SEARCH_LIMITS = Object.freeze({ messages: LITERAL_LIMITS.records, chars: LITERAL_LIMITS.chars, hits: LITERAL_LIMITS.hits, query: LITERAL_LIMITS.query, snippet: LITERAL_LIMITS.snippet });

/** Pure bounded literal lookup. No embeddings, regex execution, storage or grants. */
export function searchHistory(messages, args) {
    if (!Number.isSafeInteger(args.offset) || !Number.isSafeInteger(args.start)) throw Error('HISTORY_INVALID_SEARCH');
    // Keep the existing history tool output contract; this metric is Provider-only.
    const { scannedRecords, ...page } = searchRecords({ length: messages.length, at: index => messages[index] }, args);
    return page;
}
