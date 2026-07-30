const messageDeletedSubscriptions = new WeakMap();

export function formatLedgerTitle(entry, realIndex) {
    const speakers = Array.isArray(entry?.speakers) ? entry.speakers.join(', ') : '';
    const reason = String(entry?.reason || '');
    return `#${realIndex + 1} ${speakers} — ${reason.slice(0, 60)}${reason.length > 60 ? '...' : ''}`;
}

/**
 * Build the title through jQuery.text(), keeping character names and model
 * reasons out of an HTML parsing sink.
 */
export function createLedgerTitle($, entry, realIndex) {
    const title = $('<span class="gd-ledger-card-title"></span>');
    title.text(formatLedgerTitle(entry, realIndex));
    return title;
}

/**
 * Keep one physical listener per event source/type while allowing repeated UI
 * initialization to replace the active refresh callback.
 */
export function bindLedgerMessageDeleted(eventSource, eventType, handler) {
    let byType = messageDeletedSubscriptions.get(eventSource);
    if (!byType) {
        byType = new Map();
        messageDeletedSubscriptions.set(eventSource, byType);
    }
    let state = byType.get(eventType);
    if (!state) {
        state = { handler };
        byType.set(eventType, state);
        eventSource.on(eventType, (...args) => state.handler?.(...args));
    } else {
        state.handler = handler;
    }
}
