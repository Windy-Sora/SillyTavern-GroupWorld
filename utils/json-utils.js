/**
 * Extract a balanced JSON object from text that may contain code fences, markdown, or extra prose.
 */
export function extractJsonObject(text) {
    let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '');

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
    let s = raw;

    // Remove trailing commas before closing brackets/braces
    s = s.replace(/,(\s*[}\]])/g, '$1');

    // Convert single-quoted keys/values to double-quoted (carefully)
    s = s.replace(/'([^']+)'(\s*:)/g, '"$1"$2');
    s = s.replace(/(:\s*)'([^']+)'/g, '$1"$2"');

    // Remove BOM / zero-width characters
    s = s.replace(/[​-‍﻿]/g, '');

    // Remove control characters (except \n, \r, \t) that break JSON
    s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ');

    return s.trim();
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
        const arrMatch = sanitized.match(/\[([\s\S]*?)\]/);
        if (arrMatch) {
            const items = arrMatch[1]
                .split(/["'],\s*["']/)
                .map(s => s.replace(/^["'\s]+|["'\s]+$/g, '').trim())
                .filter(Boolean);
            if (items.length > 0) {
                if (logFn) logFn('parseLlmResponse: extracted speakers array directly:', items);
                return { speakers: items, reason: '' };
            }
        }

        return null;
    }
}
