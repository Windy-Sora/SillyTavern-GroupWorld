const hooks = ['list', 'prepare', 'approve', 'cancel', 'invalidate', 'drain', 'clear'];

/** Trusted composition only. Registration neither prepares nor approves an action. */
export function createActionAssembly(entries) {
    if (!Array.isArray(entries) || !entries.length || entries.length > 64) throw Error('INVALID_ACTION_ASSEMBLY');
    const byId = new Map(), byKind = new Map(), owners = new Set();
    for (const entry of entries) {
        if (!entry || typeof entry.id !== 'string' || !entry.id || byId.has(entry.id) ||
            !['global', 'chat'].includes(entry.scope) || !Array.isArray(entry.artifactKinds) || !entry.artifactKinds.length ||
            !entry.coordinator || owners.has(entry.coordinator) || typeof entry.coordinator.busy !== 'boolean' ||
            hooks.some(key => typeof entry.coordinator[key] !== 'function')) throw Error('INVALID_ACTION_OWNER');
        const kinds = [...entry.artifactKinds];
        for (const kind of kinds) {
            if (typeof kind !== 'string' || !kind || byKind.has(kind)) throw Error('DUPLICATE_ACTION_KIND');
            byKind.set(kind, entry.coordinator);
        }
        owners.add(entry.coordinator);
        byId.set(entry.id, Object.freeze({ id: entry.id, scope: entry.scope,
            artifactKinds: Object.freeze(kinds), coordinator: entry.coordinator }));
    }
    const rows = [...byId.values()];
    function visit(method) {
        const errors = [];
        for (const { coordinator } of rows) {
            try { coordinator[method](); } catch (error) { errors.push(error); }
        }
        if (errors.length) throw new AggregateError(errors, 'ACTION_LIFECYCLE_FAILED');
    }
    return Object.freeze({
        get busy() { return rows.some(({ coordinator }) => coordinator.busy); },
        get(id) { const row = byId.get(id); if (!row) throw Error('UNKNOWN_ACTION_OWNER'); return row.coordinator; },
        forKind(kind) { const owner = byKind.get(kind); if (!owner) throw Error('UNKNOWN_ACTION_KIND'); return owner; },
        describe: () => rows.map(({ id, scope, artifactKinds }) => ({ id, scope, artifactKinds: [...artifactKinds] })),
        list: () => rows.flatMap(({ coordinator }) => coordinator.list()),
        invalidate: () => visit('invalidate'),
        async drain() {
            // Invoke every owner even if another owner throws synchronously; do not
            // release the instance until every physical operation has settled.
            const results = await Promise.allSettled(rows.map(({ coordinator }) => Promise.resolve().then(() => coordinator.drain())));
            const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
            if (errors.length) throw new AggregateError(errors, 'ACTION_DRAIN_FAILED');
        },
        clear() {
            // Preflight all owners: an in-flight write must not cause partial cleanup.
            if (rows.some(({ coordinator }) => coordinator.busy)) throw Error('ACTION_BUSY');
            visit('clear');
        },
    });
}
