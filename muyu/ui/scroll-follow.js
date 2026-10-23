/** Page-local reading intent. No grants, message bodies or storage protocol changes. */
export function createScrollFollow({ viewport, onState = () => {}, onPosition = () => {}, win = viewport.ownerDocument?.defaultView, now = () => Date.now() }) {
    const records = new Map(), listeners = [];
    let key, current, anchor = [], metrics = null, switching = false, interactionKey = null, newInteraction = false;
    let disposed = false, queued = false, frame = null, programTop = null, gestureUntil = 0, restorePending = false;
    const size = () => ({ height: viewport.scrollHeight, client: viewport.clientHeight });
    const validSize = value => Number.isFinite(value.height) && Number.isFinite(value.client) && value.client > 0;
    const nearBottom = () => viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 60;
    const publish = () => { if (current) onState({ following: current.following, unread: current.unread }); };
    const position = () => { if (current && viewport.clientHeight !== 0 && Number.isFinite(viewport.scrollTop)) { current.top = viewport.scrollTop; onPosition(key, current.top); } };
    function listen(target, type, handler, options) {
        if (!target?.addEventListener) return;
        target.addEventListener(type, handler, options); listeners.push(() => target.removeEventListener?.(type, handler, options));
    }
    function capture() {
        const box = viewport.getBoundingClientRect?.(); if (!box || box.height <= 0) return [];
        const candidates = [];
        function visit(root) {
            if (root.hidden) return;
            const tag = (root.tagName || root.tag || '').toLowerCase();
            if (['p', 'pre', 'tr', 'li', 'summary'].includes(tag)) {
                const rect = root.getBoundingClientRect?.();
                if (rect && rect.height > 0) candidates.push({ node: root, offset: rect.top - box.top, bottom: rect.bottom - box.top });
            }
            for (const child of Array.from(root.children || [])) visit(child);
        }
        visit(viewport);
        const index = candidates.findIndex(row => row.bottom > 0 && row.offset < box.height);
        return index < 0 ? [] : [index, index + 1, index - 1, index + 2, index - 2].filter(i => candidates[i]).map(i => candidates[i]);
    }
    function write(top) {
        if (!Number.isFinite(top) || viewport.clientHeight === 0) return;
        if (Math.abs((viewport.scrollTop || 0) - top) > .5) { viewport.scrollTop = Math.max(0, top); programTop = viewport.scrollTop; }
        gestureUntil = 0; position();
    }
    function compensate() {
        const box = viewport.getBoundingClientRect?.();
        if (box && box.height > 0) for (const row of anchor) {
            if (!viewport.contains?.(row.node)) continue;
            const rect = row.node.getBoundingClientRect?.();
            if (!rect || rect.height <= 0) continue;
            write((viewport.scrollTop || 0) + rect.top - box.top - row.offset); return;
        }
        write(current?.top);
    }
    function settle() {
        if (!current || disposed || switching || !validSize(size())) return;
        if (restorePending) { write(current.following ? viewport.scrollHeight : current.top); restorePending = false; }
        else if (current.following) write(viewport.scrollHeight); else compensate();
        metrics = size(); anchor = capture();
    }
    function schedule() {
        if (disposed || queued) return;
        queued = true;
        const flush = () => { queued = false; frame = null; if (!disposed) settle(); };
        if (win?.requestAnimationFrame) frame = win.requestAnimationFrame(flush); else queueMicrotask(flush);
    }
    function scroll() {
        if (disposed || !current || switching) return;
        const measured = size();
        if (programTop !== null && Math.abs(viewport.scrollTop - programTop) < 1) { programTop = null; position(); return; }
        if (metrics && (measured.height !== metrics.height || measured.client !== metrics.client)) { schedule(); return; }
        if (now() <= gestureUntil) {
            current.following = nearBottom(); if (current.following) current.unread = false;
            gestureUntil = now() + 200; publish();
        }
        programTop = null; metrics = measured; position(); anchor = capture();
    }
    const gesture = () => { programTop = null; gestureUntil = now() + 1200; };
    listen(viewport, 'wheel', gesture, { passive: true });
    listen(viewport, 'touchmove', gesture, { passive: true });
    listen(viewport, 'pointerdown', event => { if (event.target === viewport) gesture(); });
    listen(viewport, 'keydown', event => {
        if (['input', 'textarea', 'select'].includes((event.target?.tagName || event.target?.tag || '').toLowerCase()) || event.target?.isContentEditable) return;
        if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) gesture();
    });
    listen(viewport, 'scroll', scroll, { passive: true });
    listen(viewport, 'toggle', schedule, true); listen(viewport, 'load', schedule, true);
    listen(win, 'resize', schedule); listen(win?.visualViewport, 'resize', schedule);
    listen(win?.visualViewport, 'scroll', schedule); listen(viewport.ownerDocument?.fonts, 'loadingdone', schedule);
    const Observer = win?.ResizeObserver;
    const observer = Observer ? new Observer(schedule) : null;
    observer?.observe(viewport);
    for (const child of Array.from(viewport.children || [])) observer?.observe(child);
    return {
        begin(state) {
            if (disposed) return false;
            const nextKey = state.viewKey ?? state.viewToken;
            switching = !current || key !== nextKey;
            if (switching) {
                position(); key = nextKey;
                current = records.get(key);
                if (!current) {
                    current = { following: !Number.isFinite(state.scrollTop), top: state.scrollTop, unread: false, seen: new Set() };
                    records.set(key, current);
                    if (records.size > 128) records.delete(records.keys().next().value);
                }
                gestureUntil = 0; programTop = null; anchor = [];
                restorePending = true;
            } else {
                const measured = size();
                if (!restorePending && measured.client !== 0) {
                    if (queued || metrics && (measured.height !== metrics.height || measured.client !== metrics.client)) settle();
                    position(); anchor = capture();
                }
            }
            const pending = state.interaction?.status === 'pending';
            interactionKey = pending ? JSON.stringify([state.interaction.kind, state.interaction.id]) : null;
            newInteraction = pending && !current.seen.has(interactionKey);
            return newInteraction;
        },
        end(changed) {
            if (disposed || !current) return;
            if (viewport.clientHeight === 0) { switching = false; return; }
            if (restorePending) { write(current.following ? viewport.scrollHeight : current.top); restorePending = false; }
            switching = false;
            if (newInteraction) {
                current.seen.add(interactionKey);
                if (current.seen.size > 512) current.seen.delete(current.seen.values().next().value);
                write(viewport.scrollHeight);
            } else if (current.following) {
                if (changed || metrics && (size().height !== metrics.height || size().client !== metrics.client)) write(viewport.scrollHeight);
            } else {
                compensate(); if (changed) current.unread = true;
            }
            metrics = size(); anchor = capture(); publish(); newInteraction = false;
        },
        latest() { if (disposed || !current) return; current.following = true; current.unread = false; write(viewport.scrollHeight); anchor = capture(); metrics = size(); publish(); },
        locate(element) {
            if (disposed || !current || viewport.clientHeight === 0 || !viewport.contains?.(element)) return false;
            for (let parent = element; parent && parent !== viewport; parent = parent.parentElement || parent.parent) {
                if ((parent.tagName || parent.tag || '').toLowerCase() === 'details') parent.open = true;
            }
            const box = viewport.getBoundingClientRect?.(), rect = element.getBoundingClientRect?.();
            if (!box || !rect) return false;
            current.following = false;
            write((viewport.scrollTop || 0) + rect.top - box.top - 8);
            metrics = size(); anchor = capture(); publish(); return true;
        },
        dispose() {
            if (disposed) return; disposed = true; position();
            for (const remove of listeners) remove(); observer?.disconnect();
            if (frame !== null) win?.cancelAnimationFrame?.(frame);
            records.clear(); current = null; anchor = []; metrics = null;
        },
    };
}
