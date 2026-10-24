/** Legacy Agent connections accept either a server base or a trailing /v1. */
export function normalizeApiBase(endpoint) {
    return endpoint.trim().replace(/\/+$/, '').replace(/\/v1$/i, '');
}
