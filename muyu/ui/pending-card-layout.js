/** Local geometry only: no viewport-wide listeners, permissions or execution. */
export function createPendingCardLayout({ doc, root, parent }) {
    let disposed = false, previous = 0;
    const update = () => {
        if (disposed) return;
        const height = Math.floor(parent.clientHeight || 0);
        if (height <= 0 || height === previous) return;
        previous = height;
        root.style?.setProperty?.('--gd-muyu-operation-height', `${Math.max(1, height - 24)}px`);
    };
    const Observer = doc.defaultView?.ResizeObserver;
    const observer = Observer ? new Observer(update) : null;
    observer?.observe(parent); update();
    return { update, dispose() { if (disposed) return; disposed = true; observer?.disconnect(); } };
}

/** Draft text may change; request identity, scope and connection may not. */
export function pendingRequestStamp(state) {
    const interaction = state.interaction ? { ...state.interaction } : null;
    if (interaction) delete interaction.draft;
    return JSON.stringify([state.viewKey, state.viewToken, state.connection, interaction, state.busy, state.resetting, state.readOnly, state.permissions, state.sourceGrants, state.fullAccess]);
}
