/** Closed, client-owned protocols. Server metadata never defines executable tools or grants. */
export const SERVICE_TOOL_PROTOCOLS = Object.freeze({
    documentSearch: 1, workspaceRead: 1, webFetch: 1, workspaceWrite: 1, jsonValidate: 1,
});
const TOOL_CAPABILITIES = Object.freeze({
    'muyu.service.list_roots': 'documentSearch',
    'muyu.service.list_files': 'documentSearch',
    'muyu.service.read_file': 'workspaceRead',
    'muyu.service.search_documents': 'documentSearch',
    'muyu.service.read_document': 'documentSearch',
    'muyu.service.fetch_page': 'webFetch',
    'muyu.service.write_file': 'workspaceWrite',
    'muyu.service.validate_json': 'jsonValidate',
});
export function projectToolProtocols(value) {
    return Object.fromEntries(Object.entries(SERVICE_TOOL_PROTOCOLS).map(([key, version]) =>
        [key, !!value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, key) && value[key] === version]));
}
export function serviceToolAllowed(id, capture) {
    if (!id.startsWith('muyu.service.')) return true;
    const capability = TOOL_CAPABILITIES[id];
    try { return !!capability && capture?.allows(capability) === true; } catch { return false; }
}

/** No polling. Capturing never awaits detection and never authorizes access to data. */
export function createServiceToolGate({ check, getEnabled = () => ({}), now = () => Date.now(), ttlMs = 60000 }) {
    let state = 'unchecked', supported = projectToolProtocols(null), checkedAt = null, pending = null, epoch = 0;
    const enabled = () => {
        try { const config = getEnabled(); return Object.fromEntries(Object.keys(SERVICE_TOOL_PROTOCOLS).map(key => [key, config?.[key] === true])); }
        catch { return Object.fromEntries(Object.keys(SERVICE_TOOL_PROTOCOLS).map(key => [key, false])); }
    };
    const snapshot = () => ({ status: state, supported: { ...supported }, checkedAt });
    function detect() {
        if (pending) return pending;
        const generation = epoch;
        state = 'checking';
        // Start transport now so an immediate cancel also aborts this request, not a future microtask.
        let result; try { result = check(); } catch (error) { result = Promise.reject(error); }
        const work = Promise.resolve(result).then(result => {
            if (generation === epoch) {
                state = ['available', 'legacy', 'missing', 'incompatible'].includes(result?.status) ? result.status : 'unavailable';
                supported = state === 'available' ? projectToolProtocols(result.toolProtocols) : projectToolProtocols(null);
                checkedAt = now();
            }
            return result;
        }, error => {
            if (generation === epoch) { state = 'unavailable'; supported = projectToolProtocols(null); checkedAt = now(); }
            throw error;
        });
        pending = work;
        void work.finally(() => { if (pending === work) pending = null; }).catch(() => {});
        return work;
    }
    return Object.freeze({
        snapshot, detect,
        capture() {
            const config = enabled();
            const fresh = checkedAt !== null && now() - checkedAt >= 0 && now() - checkedAt < ttlMs;
            if (Object.values(config).some(Boolean) && !fresh) void detect().catch(() => {});
            const admitted = Object.fromEntries(Object.keys(SERVICE_TOOL_PROTOCOLS).map(key => [key,
                fresh && state === 'available' && config[key] && supported[key]]));
            const generation = epoch, blocked = new Set();
            return Object.freeze({
                allows(key) {
                    if (!Object.hasOwn(admitted, key) || !admitted[key] || blocked.has(key)) return false;
                    if (generation !== epoch || !['available', 'checking'].includes(state) || !supported[key] || !enabled()[key]) { blocked.add(key); return false; }
                    return true;
                },
                // A handler must call this for missing routes, incompatible replies or transport failure.
                unavailable(key) {
                    if (!Object.hasOwn(admitted, key)) return;
                    blocked.add(key);
                    if (generation === epoch) { supported[key] = false; checkedAt = null; }
                },
            });
        },
        reset() { epoch++; pending = null; state = 'unchecked'; checkedAt = null; supported = projectToolProtocols(null); },
    });
}
