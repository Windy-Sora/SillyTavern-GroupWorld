import { normalizeCritiqueData } from './critique-validation.js';

function removeTrailingCommas(text) {
    let result = '';
    let inString = false;
    let escaped = false;
    for (let index = 0; index < text.length; index++) {
        const char = text[index];
        if (escaped) {
            result += char;
            escaped = false;
            continue;
        }
        if (inString && char === '\\') {
            result += char;
            escaped = true;
            continue;
        }
        if (char === '"') inString = !inString;
        if (!inString && char === ',') {
            let next = index + 1;
            while (/\s/.test(text[next])) next++;
            if (text[next] === '}' || text[next] === ']') continue;
        }
        result += char;
    }
    return result;
}

function sanitizeJson(text) {
    return removeTrailingCommas(text)
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ');
}

function findBalancedObjectEnd(text, start) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index++) {
        const char = text[index];
        if (escaped) { escaped = false; continue; }
        if (inString && char === '\\') { escaped = true; continue; }
        if (char === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (char === '{') depth++;
        else if (char === '}' && --depth === 0) return index;
    }
    return -1;
}

export function extractCritiqueJson(text) {
    if (typeof text !== 'string') return null;
    for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
        const end = findBalancedObjectEnd(text, start);
        if (end < 0) continue;
        const candidate = text.slice(start, end + 1);
        try {
            return JSON.parse(candidate);
        } catch (_) {
            try {
                return JSON.parse(sanitizeJson(candidate));
            } catch (_) {
                // A prose brace or malformed candidate may precede the real JSON object.
            }
        }
    }
    return null;
}

export function parseCritiqueResponse(text) {
    const parsed = extractCritiqueJson(text);
    if (parsed === null) return null;
    return normalizeCritiqueData(parsed, { path: 'LLM critique response' });
}
