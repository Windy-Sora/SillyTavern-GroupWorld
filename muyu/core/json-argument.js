const failures = new WeakMap();
const fields = new Set(['changesJson', 'settingsJson', 'requestsJson', 'exportJson', 'requestJson']);

/** Mark only parsing of explicit model arguments, never arbitrary handler errors. */
export function parseJsonArgument(text, field) {
    try { return JSON.parse(text); }
    catch {
        const error = new TypeError('INVALID_ARGUMENT');
        failures.set(error, fields.has(field) ? field : 'JSON argument');
        throw error;
    }
}

export const jsonArgumentField = error => failures.get(error);
