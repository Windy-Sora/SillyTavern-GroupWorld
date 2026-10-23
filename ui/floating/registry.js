const levels = Object.freeze({ idle: 0, running: 1, attention: 2, error: 3 });
const displayStatuses = Object.freeze({ idle: 'idle', completed: 'idle', thinking: 'running', executing: 'running', waiting: 'attention', error: 'error' });
const defaults = Object.freeze({ idle: 'idle', running: 'executing', attention: 'waiting', error: 'error' });

/** Aggregate already-projected entries without re-reading business snapshots. */
export function floatingPresentation(entries) {
    return entries.filter(e => e.available).reduce((value, e) =>
        levels[e.status] > levels[value.status] || e.status === value.status && value.displayState === 'idle' && e.displayState === 'completed'
            ? { status: e.status, displayState: e.displayState } : value, { status: 'idle', displayState: 'idle' });
}

/** Trusted built-in UI extensions only. No executable user configuration or business payloads. */
export function createFloatingRegistry() {
    const entries = new Map(), listeners = new Set(); let disposed = false;
    const notify = () => { for (const fn of [...listeners]) { try { fn(); } catch { /* Isolate views. */ } } };
    const live = () => { if (disposed) throw new Error('FLOATING_DISPOSED'); };
    function list() {
        return [...entries.values()].map(({ definition: d }) => {
            let available = false, status = 'idle', displayState, completionVersion = 0;
            try {
                available = d.isAvailable?.() !== false;
                const presentation = d.getPresentation?.();
                const value = d.getPresentation ? presentation?.status : d.getStatus?.();
                if (Object.hasOwn(levels, value)) status = value;
                if (Object.hasOwn(displayStatuses, presentation?.displayState) && displayStatuses[presentation.displayState] === status) displayState = presentation.displayState;
                if (Number.isSafeInteger(presentation?.completionVersion) && presentation.completionVersion >= 0) completionVersion = presentation.completionVersion;
            }
            catch { status = 'error'; }
            return { id: d.id, label: { ...d.label }, icon: d.icon, order: d.order, available, status, displayState: displayState || defaults[status], completionVersion };
        }).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    }
    return Object.freeze({
        register(definition) {
            live();
            if (!definition || !/^[a-z][a-z0-9.-]{0,63}$/.test(definition.id) || entries.has(definition.id) ||
                !definition.label || ['zh', 'en'].some(k => typeof definition.label[k] !== 'string' || !definition.label[k] || definition.label[k].length > 80) ||
                typeof definition.icon !== 'string' || definition.icon.length > 8 || !Number.isFinite(definition.order) || typeof definition.mount !== 'function' ||
                ['isAvailable', 'getStatus', 'getPresentation', 'subscribe'].some(k => definition[k] !== undefined && typeof definition[k] !== 'function')) throw new TypeError('INVALID_FLOATING_ENTRY');
            const record = { definition: { ...definition, label: { ...definition.label } }, unsubscribe: null };
            entries.set(definition.id, record);
            try {
                if (definition.subscribe) {
                    record.unsubscribe = definition.subscribe(notify);
                    if (typeof record.unsubscribe !== 'function') throw new TypeError('INVALID_FLOATING_SUBSCRIPTION');
                }
            } catch (error) { entries.delete(definition.id); notify(); throw error; }
            notify(); let removed = false;
            return () => {
                if (removed) return; removed = true;
                if (entries.get(definition.id) !== record) return;
                entries.delete(definition.id);
                try { record.unsubscribe?.(); } finally { notify(); }
            };
        },
        list,
        status() { return floatingPresentation(list()).status; },
        mount(id, root, options) {
            live(); const entry = list().find(e => e.id === id);
            if (!entry?.available) throw new Error('FLOATING_UNAVAILABLE');
            const dispose = entries.get(id).definition.mount(root, options);
            if (typeof dispose !== 'function') throw new TypeError('FLOATING_TEARDOWN_REQUIRED');
            return dispose;
        },
        subscribe(fn) { live(); listeners.add(fn); return () => listeners.delete(fn); },
        dispose() {
            if (disposed) return; disposed = true;
            for (const r of entries.values()) { try { r.unsubscribe?.(); } catch { /* Continue cleanup. */ } }
            entries.clear(); notify(); listeners.clear();
        },
    });
}
