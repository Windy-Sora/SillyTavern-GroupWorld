/**
 * Parse a JSON path string into segments.
 * Supports: dot notation, array indices (including negative), quoted keys,
 * and property filters.
 *
 * Examples:
 *   "memory.location"       → ["memory", "location"]
 *   "events[0].title"       → ["events", 0, "title"]
 *   "events[-1].title"      → ["events", {idx:-1}, "title"]
 *   '["key.with.dots"]'     → ["key.with.dots"]
 *   "entries[active=true]"  → ["entries", {key:"active", val:"true"}]
 */
export function parsePath(path) {
    const segments = [];
    let i = 0;

    while (i < path.length) {
        if (path[i] === '.') { i++; continue; }
        if (path[i] === ' ') { i++; continue; }

        // Quoted key: "key" or 'key'
        if (path[i] === '"' || path[i] === "'") {
            const quote = path[i];
            i++;
            let key = '';
            while (i < path.length && path[i] !== quote) {
                if (path[i] === '\\' && i + 1 < path.length) key += path[++i];
                else key += path[i];
                i++;
            }
            if (i < path.length) i++;
            segments.push(key);
            continue;
        }

        // Bracket: [n], [-n], or [key=value]
        if (path[i] === '[') {
            i++;
            let inner = '';
            while (i < path.length && path[i] !== ']') {
                inner += path[i];
                i++;
            }
            if (i < path.length) i++; // skip ]

            const eqIdx = inner.indexOf('=');
            if (eqIdx !== -1) {
                // Property filter: [key=value]
                const k = inner.slice(0, eqIdx).trim();
                const v = inner.slice(eqIdx + 1).trim();
                if (k) segments.push({ key: k, val: v });
                continue;
            }

            if (inner.trim() === '') {
                // Empty brackets — push a sentinel that never resolves,
                // triggering fallback/default instead of silently succeeding
                segments.push({ _empty: true });
                continue;
            }
            const n = parseInt(inner, 10);
            if (!isNaN(n)) {
                // Negative index: wrap so resolvePath knows it's a relative index
                segments.push(n < 0 ? { idx: n } : n);
            }
            continue;
        }

        // Plain identifier key
        let key = '';
        while (i < path.length && path[i] !== '.' && path[i] !== '[' && path[i] !== ' ') {
            key += path[i];
            i++;
        }
        if (key) segments.push(key);
    }

    return segments;
}

/**
 * Walk an object along parsed segments.
 *
 * Segment types:
 *   string       → object property access
 *   number       → array index (0-based, forward)
 *   {idx: -n}    → array index from end (-1 = last)
 *   {key, val}   → find first array element where e[key] == val
 */
export function resolvePath(obj, segments) {
    if (obj === null || obj === undefined) return undefined;
    let current = obj;
    for (const seg of segments) {
        if (current === null || current === undefined) return undefined;

        if (typeof seg === 'object' && seg !== null && 'key' in seg) {
            // Property filter: find first matching element
            if (!Array.isArray(current)) return undefined;
            current = current.find(e =>
                e != null && String(e[seg.key]) === seg.val
            );
            continue;
        }

        if (typeof seg === 'object' && seg !== null && 'idx' in seg) {
            // Negative index
            if (!Array.isArray(current)) return undefined;
            const i = seg.idx < 0 ? current.length + seg.idx : seg.idx;
            current = (i >= 0 && i < current.length) ? current[i] : undefined;
            continue;
        }

        if (typeof seg === 'number') {
            if (!Array.isArray(current)) return undefined;
            current = current[seg];
        } else {
            if (typeof current !== 'object') return undefined;
            current = current[seg];
        }
    }
    return current;
}

/**
 * Format a resolved value for template insertion.
 * - string/number/boolean → direct string
 * - object/array → JSON.stringify
 * - null/undefined → empty string
 */
export function formatValue(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return JSON.stringify(value, null, 2);
}
