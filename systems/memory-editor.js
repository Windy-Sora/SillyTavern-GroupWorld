/** Append to a selected list; initialize containers only after exact approval. */
export async function applyApprovedMemoryCreation({ metadata, extensionKey, avatar, after, validate, saveChatConfirmed, isCurrent, changed }) {
    if (typeof saveChatConfirmed !== 'function') throw Error('WRITE_UNAVAILABLE');
    validate();
    const root = metadata[extensionKey] ?? (metadata[extensionKey] = {});
    const store = root.charMemories ?? (root.charMemories = {});
    const next = [...(Object.hasOwn(store, avatar) ? store[avatar] : []), structuredClone(after)];
    store[avatar] = next;
    try { changed?.(); } catch { /* Observers do not change the operation result. */ }
    let confirmed = false;
    try { await saveChatConfirmed(metadata); confirmed = true; } catch { /* Never retry or erase concurrent edits. */ }
    let current = false;
    try { current = isCurrent(next, root, store); } catch { /* Unavailable verification is not success. */ }
    return { status: !confirmed ? 'outcome_unknown' : current ? 'applied_confirmed' : 'partial', chatSave: confirmed ? 'confirmed' : 'unknown' };
}
/** Exact single-entry mutation. Unknown saves retain memory state without whole-store rollback. */
export async function applyApprovedMemoryEdit({ metadata, extensionKey, avatar, index, after, validate, saveChatConfirmed, isCurrent, changed }) {
    if (typeof saveChatConfirmed !== 'function') throw Error('WRITE_UNAVAILABLE');
    validate();
    const entries = metadata[extensionKey].charMemories[avatar];
    const next = entries.slice();
    if (after === null) next.splice(index, 1);
    else next[index] = structuredClone(after);
    metadata[extensionKey].charMemories[avatar] = next;
    try { changed?.(); } catch { /* Observers do not alter the write result. */ }
    let confirmed = false;
    try { await saveChatConfirmed(metadata); confirmed = true; } catch { /* Outcome remains unknown; never retry. */ }
    let current = false;
    try { current = isCurrent(next); } catch { /* Unavailable verification is not success. */ }
    return { status: !confirmed ? 'outcome_unknown' : current ? 'applied_confirmed' : 'partial', chatSave: confirmed ? 'confirmed' : 'unknown' };
}
