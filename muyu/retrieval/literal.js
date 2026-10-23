import { fingerprint } from '../context/planner.js';

export const LITERAL_LIMITS = Object.freeze({ records: 32, chars: 65536, hits: 8, query: 128, snippet: 240 });
const low = char => /[\uDC00-\uDFFF]/.test(char);
const fold = text => text.replace(/[A-Z]/g, char => char.toLowerCase());

/** Bounded literal lookup over a lazy source. No execution, grants or storage. */
export function searchRecords(source, { query, offset = 0, start = 0, fingerprint: expected = '', caseSensitive = false, oneHitPerRecord = true }) {
    if (typeof query !== 'string' || !query.trim() || query.length > LITERAL_LIMITS.query ||
        !Number.isSafeInteger(offset) || offset < 0 || offset > source.length || !Number.isSafeInteger(start) || start < 0 || typeof caseSensitive !== 'boolean' || typeof oneHitPerRecord !== 'boolean') throw Error('HISTORY_INVALID_SEARCH');
    const initial = source.at(offset);
    if (start > 0 && !expected || expected && (!initial || fingerprint(initial) !== expected) ||
        initial && (start > initial.content.length || low(initial.content.charAt(start))) || !initial && start !== 0) throw Error('HISTORY_STALE');
    const needle = caseSensitive ? query : fold(query), items = [];
    let index = offset, position = start, scannedMessages = 0, scannedRecords = 0, lastScannedIndex = -1, scannedChars = 0;
    while (index < source.length && scannedMessages < LITERAL_LIMITS.records && scannedChars < LITERAL_LIMITS.chars && items.length < LITERAL_LIMITS.hits) {
        const message = source.at(index), content = message.content;
        if (index !== lastScannedIndex) { scannedRecords++; lastScannedIndex = index; }
        scannedMessages++;
        const span = Math.min(content.length - position, LITERAL_LIMITS.chars - scannedChars);
        const window = content.slice(position, position + span + needle.length - 1);
        const match = (caseSensitive ? window : fold(window)).indexOf(needle);
        scannedChars += !oneHitPerRecord && match >= 0 && match < span ? Math.min(span, match + needle.length) : span;
        if (match >= 0 && match < span) {
            const matchStart = position + match, matchEnd = matchStart + query.length;
            let snippetStart = Math.max(0, matchStart - 48);
            if (low(content.charAt(snippetStart))) snippetStart--;
            let snippetEnd = Math.min(content.length, snippetStart + LITERAL_LIMITS.snippet);
            if (low(content.charAt(snippetEnd))) snippetEnd--;
            items.push({ index, role: message.role, fingerprint: fingerprint(message), start: snippetStart, end: snippetEnd,
                matchStart, matchEnd, total: content.length, text: content.slice(snippetStart, snippetEnd) });
            if (oneHitPerRecord || matchEnd >= content.length) { index++; position = 0; }
            else { position = matchEnd; if (low(content.charAt(position))) position++; }
        } else if (position + span >= content.length) { index++; position = 0; }
        else { position += span; if (low(content.charAt(position))) position--; break; }
    }
    const complete = index >= source.length;
    return { total: source.length, scannedMessages, scannedRecords, scannedChars, complete, nextOffset: complete ? -1 : index, nextStart: complete ? 0 : position,
        nextFingerprint: !complete && position > 0 ? fingerprint(source.at(index)) : '', items };
}
