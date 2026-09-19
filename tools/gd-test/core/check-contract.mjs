const ID_PATTERN = /^[a-z][a-z0-9-]*$/;

export function validateChecker(candidate, file = '<unknown>') {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        throw new TypeError(`Checker ${file} must default-export an object`);
    }
    if (typeof candidate.id !== 'string' || !ID_PATTERN.test(candidate.id)) {
        throw new TypeError(`Checker ${file} has an invalid id`);
    }
    if (typeof candidate.title !== 'string' || !candidate.title.trim()) {
        throw new TypeError(`Checker ${candidate.id} must declare a title`);
    }
    if (candidate.version !== 1) {
        throw new TypeError(`Checker ${candidate.id} must use contract version 1`);
    }
    if (candidate.order !== undefined && !Number.isInteger(candidate.order)) {
        throw new TypeError(`Checker ${candidate.id} order must be an integer`);
    }
    if (candidate.timeoutMs !== undefined && (!Number.isFinite(candidate.timeoutMs) || candidate.timeoutMs <= 0)) {
        throw new TypeError(`Checker ${candidate.id} timeoutMs must be positive`);
    }
    if (typeof candidate.run !== 'function') {
        throw new TypeError(`Checker ${candidate.id} must declare run(context)`);
    }
    return Object.freeze({
        order: 0,
        timeoutMs: 30_000,
        ...candidate,
        file,
    });
}

export function normalizeIssue(value, checkerId) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`Checker ${checkerId} returned an invalid issue`);
    }
    if (value.severity !== 'error' && value.severity !== 'warning') {
        throw new TypeError(`Checker ${checkerId} returned an invalid issue severity`);
    }
    if (typeof value.code !== 'string' || !value.code) {
        throw new TypeError(`Checker ${checkerId} returned an issue without a code`);
    }
    return {
        severity: value.severity,
        code: value.code,
        file: typeof value.file === 'string' ? value.file : '',
        line: Number.isInteger(value.line) && value.line > 0 ? value.line : null,
        message: String(value.message || ''),
    };
}

export function normalizeCheckResult(value, checkerId) {
    if (value === undefined) value = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`Checker ${checkerId} must return an object`);
    }
    const counts = value.counts || {};
    if (!counts || typeof counts !== 'object' || Array.isArray(counts)) {
        throw new TypeError(`Checker ${checkerId} returned invalid counts`);
    }
    const normalizedCounts = {};
    for (const [key, count] of Object.entries(counts)) {
        if (!Number.isFinite(count)) throw new TypeError(`Checker ${checkerId} returned invalid count "${key}"`);
        normalizedCounts[key] = count;
    }
    return {
        counts: normalizedCounts,
        issues: (value.issues || []).map(issue => normalizeIssue(issue, checkerId)),
    };
}
