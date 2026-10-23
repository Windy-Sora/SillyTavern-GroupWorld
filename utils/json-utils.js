/**
 * Extract a balanced JSON object from text that may contain code fences, markdown, or extra prose.
 */
export function extractJsonObject(text) {
    const cleaned = text;

    const firstBrace = cleaned.indexOf('{');
    if (firstBrace === -1) return null;

    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = firstBrace; i < cleaned.length; i++) {
        const ch = cleaned[i];

        if (escape) { escape = false; continue; }
        if (ch === '\\') { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;

        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) {
                return cleaned.slice(firstBrace, i + 1);
            }
        }
    }
    return null;
}

/**
 * Fix common JSON formatting errors from LLM output.
 */
export function sanitizeJson(raw) {
    let result = '';
    for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (ch === '"' || ch === "'") {
            const quote = ch;
            let token = ch, value = '', closed = false;
            while (++i < raw.length) {
                const next = raw[i];
                token += next;
                if (next === '\\' && i + 1 < raw.length) {
                    const escaped = raw[++i];
                    token += escaped;
                    value += escaped === "'" && quote === "'" ? escaped : `\\${escaped}`;
                } else if (next === quote) { closed = true; break; }
                else value += JSON.stringify(next).slice(1, -1);
            }
            result += quote === "'" && closed ? `"${value}"` : token;
        } else if (ch === ',' && /^\s*[}\]]/.test(raw.slice(i + 1))) {
            continue;
        } else if (/[​-‍﻿]/.test(ch)) {
            continue;
        } else result += /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(ch) ? ' ' : ch;
    }
    return result.trim();
}

export function parseLlmResponse(text, logFn) {
    if (!text) return null;

    const extracted = extractJsonObject(text);
    if (!extracted) {
        if (logFn) logFn('parseLlmResponse: no JSON object found in response');
        return null;
    }

    const sanitized = sanitizeJson(extracted);

    try {
        return JSON.parse(sanitized);
    } catch (e1) {
        if (logFn) logFn('parseLlmResponse: JSON.parse failed after sanitize:', e1.message);

        // Strategy 2: try extracting the speakers array directly
        const arrMatch = sanitized.match(/"speakers"\s*:\s*(\[(?:"(?:\\.|[^"\\])*"|[^\]])*\])/);
        if (arrMatch) {
            let items = [];
            try { items = JSON.parse(arrMatch[1]).filter(item => typeof item === 'string' && item.trim()); } catch { /* No reliable speaker array. */ }
            if (items.length > 0) {
                if (logFn) logFn('parseLlmResponse: extracted speakers array directly:', items);
                return { speakers: items, reason: '' };
            }
        }

        return null;
    }
}
