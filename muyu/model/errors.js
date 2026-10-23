import { ExecutionError } from '../core/execution.js';

// Closed public vocabulary: never preserve provider bodies, URLs, credentials or causes.
export const modelError = code => new ExecutionError(code);
export function httpError(status) {
    return modelError(status === 401 || status === 403 ? 'MODEL_AUTH_ERROR' : status === 429 ? 'MODEL_RATE_LIMIT' : status >= 500 ? 'MODEL_SERVICE_ERROR' : 'MODEL_HTTP_ERROR');
}
