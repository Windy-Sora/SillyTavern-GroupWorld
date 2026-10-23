const CODES = new Set(['HISTORY_INVALID', 'HISTORY_CONFLICT', 'HISTORY_DELETED', 'HISTORY_CAPACITY', 'HISTORY_UNAVAILABLE',
    'SERVICE_STORAGE_PERMISSION', 'SERVICE_STORAGE_FULL', 'SERVICE_STORAGE_UNAVAILABLE', 'SERVICE_CHECK_BUSY',
    'WEB_AUTH_ERROR', 'WEB_RATE_LIMIT', 'WEB_TIMEOUT', 'WEB_NETWORK_ERROR', 'WEB_UNAVAILABLE', 'WEB_INVALID_RESPONSE', 'WEB_REQUEST_INVALID']);
const OPERATIONS = new Set(['history.list', 'history.read', 'history.write', 'history.delete', 'search.request', 'storage.check']);
const STAGES = new Set(['request', 'prepare', 'write', 'read', 'cleanup']);
export function projectServiceDiagnostics(raw) {
    const number = value => Number.isSafeInteger(value) && value >= 0;
    if (raw?.version !== 1 || raw.capacity !== 200 || raw.retentionMinutes !== 30 || !Array.isArray(raw.records) || raw.records.length > 200) throw Error('SERVICE_INCOMPATIBLE');
    const ids = new Set();
    return { version: 1, capacity: 200, retentionMinutes: 30, records: raw.records.map(row => {
        if (!row || !number(row.id) || row.id < 1 || ids.has(row.id) || !number(row.time) || !number(row.durationMs) || row.durationMs > 3600000 ||
            !OPERATIONS.has(row.operation) || !STAGES.has(row.stage) || !CODES.has(row.code) ||
            row.httpStatus !== undefined && (!Number.isInteger(row.httpStatus) || row.httpStatus < 400 || row.httpStatus > 599)) throw Error('SERVICE_INCOMPATIBLE');
        ids.add(row.id); return { id: row.id, time: row.time, operation: row.operation, stage: row.stage, code: row.code, durationMs: row.durationMs,
            ...(row.httpStatus !== undefined ? { httpStatus: row.httpStatus } : {}) };
    }) };
}
