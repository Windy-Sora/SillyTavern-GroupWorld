/** UI state survives DOM rebuilds; never refresh an editor from an asynchronous model write. */
export function createMemoryWorkbench({ port, getTarget, changed = () => {} }) {
    const empty = () => ({ id: null, revision: null, title: '', content: '', scope: getTarget()?.kind === 'chat' ? 'chat' : 'account' });
    let draft = empty(), draftTarget = getTarget(), rows = [], busy = false, error = null, loaded = false, sequence = 0, disposed = false;
    let draftOwner = port?.ownerToken?.();
    const targetKey = target => JSON.stringify(target);
    const stale = () => targetKey(draftTarget) !== targetKey(getTarget()) || draftOwner !== port?.ownerToken?.();
    const emit = () => { if (!disposed) changed(); };
    const unsubscribe = port?.subscribe(() => { void load({ preserveError: true }); });
    async function load({ preserveError = false } = {}) {
        if (!port || disposed) return;
        const ticket = ++sequence, target = getTarget(), owner = port.ownerToken?.();
        try {
            const value = await port.list(target);
            if (!disposed && ticket === sequence && owner === port.ownerToken?.() && targetKey(target) === targetKey(getTarget())) { rows = value; loaded = true; if (!preserveError) error = null; emit(); }
        } catch (e) { if (!disposed && ticket === sequence) { rows = []; loaded = false; error = e.message; emit(); } }
    }
    async function operation(fn) {
        if (!port || busy || disposed) throw Error('NOTE_UNAVAILABLE');
        busy = true; error = null; emit();
        try { await fn(); await load(); }
        catch (e) { error = e.message; throw e; }
        finally { busy = false; emit(); }
    }
    return {
        snapshot() { return { available: !!port, enabled: port?.enabled() === true, loaded, busy, error, rows: rows.map(row => ({ ...row })), draft: { ...draft }, stale: stale() }; },
        load,
        newNote() { if (busy) return; draft = empty(); draftTarget = getTarget(); draftOwner = port?.ownerToken?.(); error = null; emit(); },
        edit(id) { if (busy) return; const row = rows.find(note => note.id === id); if (!row) throw Error('NOTE_CONFLICT'); draft = { id: row.id, revision: row.revision, title: row.title, content: row.content, scope: row.scope }; draftTarget = getTarget(); draftOwner = port?.ownerToken?.(); error = null; emit(); },
        setDraft(fields) { if (busy) return; draft = { ...draft, ...Object.fromEntries(Object.entries(fields).filter(([key]) => ['title', 'content', 'scope'].includes(key))) }; emit(); },
        setEnabled: enabled => operation(() => port.setEnabled(enabled)),
        save() { return operation(async () => {
            if (stale()) throw Error('NOTE_STALE_TARGET');
            const value = await port.save({ title: draft.title, content: draft.content, scope: draft.scope }, { target: draftTarget, id: draft.id, revision: draft.revision });
            draft = { id: value.id, revision: value.revision, title: value.title, content: value.content, scope: value.scope };
        }); },
        remove(id, revision) { return operation(async () => { await port.remove(id, revision, getTarget()); if (draft.id === id) { draft = empty(); draftTarget = getTarget(); draftOwner = port?.ownerToken?.(); } }); },
        targetChanged() { sequence++; rows = []; loaded = false; if (!busy && !draft.id && !draft.title && !draft.content) { draft = empty(); draftTarget = getTarget(); draftOwner = port?.ownerToken?.(); } emit(); void load(); },
        dispose() { disposed = true; sequence++; unsubscribe?.(); },
    };
}
