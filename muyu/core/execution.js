/** Internal safe errors; never expose messages from adapters or handlers. */
export class ExecutionError extends Error {
    constructor(code) { super(code); this.code = code; }
}

export const systemClock = Object.freeze({ now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id) });

export function assertActive(signal) {
    if (signal.aborted) throw new ExecutionError(signal.reason === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED');
}

/** Bounds async waiting, not CPU work or a non-cooperative handler's external effects. */
export async function bounded(work, { signal, timeoutMs, clock = systemClock, track = promise => promise }) {
    assertActive(signal);
    const controller = new AbortController();
    let timer, abort;
    const stopped = new Promise((_, reject) => {
        abort = () => { controller.abort(signal.reason); reject(new ExecutionError(signal.reason === 'TIMEOUT' ? 'TIMEOUT' : 'CANCELLED')); };
        signal.addEventListener('abort', abort, { once: true });
        timer = clock.setTimeout(() => { controller.abort('TIMEOUT'); reject(new ExecutionError('TIMEOUT')); }, timeoutMs);
    });
    try {
        const result = await Promise.race([stopped, track(Promise.resolve().then(() => { assertActive(controller.signal); return work(controller.signal); }))]);
        assertActive(signal);
        assertActive(controller.signal);
        return result;
    } finally {
        clock.clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        controller.abort('CANCELLED');
    }
}

/** Logical completion and physical async settlement are separate queue-release conditions. */
export function createDrainTracker() {
    let pending = 0, sealed = false, resolve;
    const drained = new Promise(done => { resolve = done; });
    const check = () => { if (sealed && pending === 0) resolve(); };
    return {
        drained,
        track(promise) {
            pending++;
            const settled = () => { pending--; check(); };
            Promise.resolve(promise).then(settled, settled);
            return promise;
        },
        seal() { sealed = true; check(); },
    };
}

export function safeFailure(code, effectState = 'not_started') {
    return { ok: false, error: { code, message: code, retryable: false }, effectState };
}
