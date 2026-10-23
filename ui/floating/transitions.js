/** Visual-only motion. No view cloning, deferred teardown, timers or business callbacks. */
export function orbTransform(panel, orb) {
    if (![panel.left, panel.top, panel.width, panel.height, orb.left, orb.top, orb.width, orb.height].every(Number.isFinite) || panel.width <= 0 || panel.height <= 0 || orb.width <= 0 || orb.height <= 0) return null;
    const x = orb.left + orb.width / 2 - panel.left - panel.width / 2;
    const y = orb.top + orb.height / 2 - panel.top - panel.height / 2;
    return `translate(${x}px, ${y}px) scale(${Math.min(1, orb.width / panel.width)}, ${Math.min(1, orb.height / panel.height)})`;
}

export function createSurfaceTransitions({ root, frame, content, ball, doc, win }) {
    let animations = [], proxy = null, ripple = null, mode = null, epoch = 0, disposed = false;
    const media = win.matchMedia?.('(prefers-reduced-motion: reduce)');
    const supported = () => !disposed && typeof frame.animate === 'function' && !doc.hidden;
    function cancel() {
        epoch++; mode = null;
        const previous = animations; animations = [];
        for (const animation of previous) { try { animation.cancel(); } catch { /* Motion cannot break the shell. */ } }
        proxy?.remove(); proxy = null;
        ripple?.remove(); ripple = null;
    }
    function animate(element, frames, options) {
        const animation = element.animate(frames, { fill: 'none', ...options });
        animation.finished?.catch?.(() => {});
        animations.push(animation); return animation;
    }
    function finish(token) {
        Promise.all(animations.map(item => item.finished)).then(() => { if (epoch === token) cancel(); }, () => { if (epoch === token) cancel(); });
    }
    function glow(orb, delay = 0) {
        ripple = doc.createElement('div'); ripple.className = 'gd-floating-ripple';
        ripple.setAttribute('aria-hidden', 'true'); ripple.inert = true;
        Object.assign(ripple.style, { left: orb.left + 'px', top: orb.top + 'px', width: orb.width + 'px', height: orb.height + 'px' });
        root.append(ripple);
        animate(ripple, [{ opacity: 0, transform: 'scale(.85)' }, { opacity: .45, offset: .2 }, { opacity: 0, transform: 'scale(1.65)' }], { duration: 320, delay, easing: 'ease-out', fill: 'backwards' });
    }
    const rectangle = element => { try { return element.getBoundingClientRect?.(); } catch { return null; } };
    function open() {
        cancel(); if (!supported()) return;
        const panel = rectangle(frame), orb = rectangle(ball);
        const transform = panel && orb ? orbTransform(panel, orb) : null;
        if (!transform) return;
        mode = 'open'; const token = epoch;
        try {
            const reduced = media?.matches;
            animate(frame, reduced ? [{ opacity: 0 }, { opacity: 1 }] : [
                { transform, opacity: 0, borderRadius: '50%', offset: 0 },
                { opacity: 1, offset: .35 },
                { transform: 'none', opacity: 1 },
            ], { duration: reduced ? 120 : 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
            if (!reduced && typeof content.animate === 'function') animate(content, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 220, delay: 160, easing: 'ease-out', fill: 'backwards' });
            if (!reduced) glow(orb);
            finish(token);
        } catch { cancel(); }
    }
    function close() {
        // Capture an interrupted opening's visible bounds before cancelling its transform.
        const panel = rectangle(frame), orb = rectangle(ball);
        cancel(); if (!supported() || frame.hidden || !panel || !orb) return;
        const transform = orbTransform(panel, orb); if (!transform) return;
        mode = 'close'; const token = epoch;
        try {
            proxy = doc.createElement('div'); proxy.className = 'gd-floating-window gd-floating-transition-proxy';
            proxy.setAttribute('aria-hidden', 'true'); proxy.inert = true;
            Object.assign(proxy.style, { left: panel.left + 'px', top: panel.top + 'px', width: panel.width + 'px', height: panel.height + 'px' });
            root.append(proxy);
            const reduced = media?.matches;
            const shrinking = animate(proxy, reduced ? [{ opacity: .8 }, { opacity: 0 }] : [
                { transform: 'none', opacity: .85 },
                { transform, opacity: 0, borderRadius: '50%' },
            ], { duration: reduced ? 120 : 320, easing: 'cubic-bezier(.4,0,.2,1)' });
            Promise.resolve(shrinking.finished).then(() => { if (epoch === token) { proxy?.remove(); proxy = null; } }, () => {});
            if (!reduced) glow(orb, 200);
            finish(token);
        } catch { cancel(); }
    }
    media?.addEventListener?.('change', cancel);
    const visibility = () => { root.setAttribute('data-page-hidden', String(!!doc.hidden)); cancel(); };
    root.setAttribute('data-page-hidden', String(!!doc.hidden));
    doc.addEventListener?.('visibilitychange', visibility);
    return { open, close, cancel, settleOpening() { if (mode === 'open') cancel(); }, dispose() { disposed = true; cancel(); media?.removeEventListener?.('change', cancel); doc.removeEventListener?.('visibilitychange', visibility); } };
}
