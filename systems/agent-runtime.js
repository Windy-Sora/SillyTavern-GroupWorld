/**
 * Agent Runtime — execution engine for the Agent system.
 *
 * Provides:
 *   createScopedPool(pool, access, agent, config) → Proxy-enforced context pool
 *   managedCall(caller, prompt, callConfig) → retry + timeout (returns { text, retries })
 *   execute(agent, { pool, caller, config }) → state-driven pipeline execution
 *   AgentRegistry → register / get / list
 *   Execution Trace → append-only, opt-in (config.enableTrace), ring buffer
 */

// ─── Agent Registry ──────────────────────────────────────────────────

const registry = new Map();

export const AgentRegistry = {
    register(agent) {
        if (!agent || !agent.id) throw new Error('Agent must have an id');
        registry.set(agent.id, agent);
    },

    get(id) {
        return registry.get(id);
    },

    list() {
        return [...registry.values()].map(({ id, displayName, contextAccess, pipelineOrder }) => ({
            id, displayName, contextAccess, pipelineOrder,
        }));
    },
};

// ─── Execution Trace ─────────────────────────────────────────────────

/** Ring buffer for recent execution traces — observable, not controllable. */
const traceBuffer = [];
let _maxTraces = 50;

export const AgentTrace = {
    /** Returns a shallow copy of recent traces (newest last). */
    recent: () => [...traceBuffer],
    /** Add a trace entry directly to the buffer. */
    push: (entry) => { traceBuffer.push(entry); while (traceBuffer.length > _maxTraces) traceBuffer.shift(); },
    /** Clear all traces. */
    clear: () => { traceBuffer.length = 0; },
    /** Get current ring buffer max size. */
    getMax: () => _maxTraces,
    /** Set ring buffer max size. */
    setMax: (n) => { const v = Number(n); _maxTraces = Number.isFinite(v) ? Math.max(1, Math.floor(v)) : 50; if (traceBuffer.length > _maxTraces) traceBuffer.splice(0, traceBuffer.length - _maxTraces); },
};

/**
 * Create an append-only trace object. Entries are frozen after push.
 * Trace never participates in control flow — observe only.
 */
function createTrace(agentId) {
    const entries = [];
    const startTime = Date.now();

    return {
        push(entry) {
            const frozen = Object.freeze({
                ...entry,
                time: Date.now(),
                elapsed: Date.now() - startTime,
            });
            entries.push(frozen);
        },
        snapshot() {
            return {
                agentId,
                startTime: new Date(startTime).toISOString(),
                stages: [...entries],
            };
        },
    };
}

function summarizeResult(result) {
    if (!result) return null;
    if (typeof result === 'string') return { type: 'text', length: result.length };
    if (Array.isArray(result)) return { type: 'array', length: result.length };
    return { type: 'object', keys: Object.keys(result).filter(k => !k.startsWith('_')) };
}

// ─── Scoped Context Pool ─────────────────────────────────────────────

export function createScopedPool(pool, access, agent = {}, config = {}) {
    const strictMode = config?.strictMode === true;
    const agentId = agent.id || 'unknown';
    const usedAccess = new Set();

    const proxy = new Proxy(pool, {
        get(_target, key) {
            usedAccess.add(key);
            if (!access.includes(key)) {
                const msg = `[AgentAccessViolation] ${agentId} tried to access "${key}" — not in contextAccess. ` +
                    `Declared: [${access.join(', ')}]`;
                if (strictMode) throw new Error(msg);
                console.log(msg);
                return undefined;
            }
            const val = _target[key];
            return typeof val === 'function' ? val.bind(_target) : val;
        },
        set(_target, key) {
            const msg = `[AgentAccessViolation] ${agentId} tried to set "${key}" — writes are not allowed`;
            console.log(msg);
            return true; // prevent write, suppress error in non-strict mode
        },
    });

    return {
        proxy,
        used: usedAccess,
        report(verbose = false) {
            const unused = access.filter(k => !usedAccess.has(k));
            const undeclared = [...usedAccess].filter(k => !access.includes(k));
            let msg = `[Agent] ${agentId} context access: ${usedAccess.size} keys used`;
            if (undeclared.length) {
                msg += ` | UNDECLARED: [${undeclared.join(', ')}]`;
            }
            if (verbose && unused.length) {
                msg += ` | unused: [${unused.join(', ')}]`;
            }
            return msg;
        },
    };
}

// ─── Managed Call (retry + timeout) ──────────────────────────────────

export async function managedCall(caller, prompt, callConfig = {}) {
    const retries = callConfig.retries ?? 2;
    const timeoutMs = callConfig.timeout ?? 30000;
    const onRetry = callConfig.onRetry;
    const signal = callConfig.signal;
    let lastError;
    let attemptCount = 0;

    // Check abort before starting
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    for (let attempt = 0; attempt <= retries; attempt++) {
        // Check abort before each attempt
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        try {
            const text = await withTimeout(caller.generate(prompt), timeoutMs, signal);
            return { text, retries: attempt };
        } catch (e) {
            lastError = e;
            if (e.name === 'AbortError') throw e;
            if (attempt < retries && signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            if (attempt < retries) {
                attemptCount = attempt + 1;
                console.warn(`[Agent] call attempt ${attemptCount}/${retries + 1} failed: ${e.message}. Retrying...`);
                if (onRetry) {
                    try { onRetry({ attempt: attemptCount, maxRetries: retries, error: e.message }); } catch (_) {}
                }
                await abortableSleep(2000, signal);
            }
        }
    }
    throw lastError;
}

async function withTimeout(promise, ms, signal) {
    let timer;
    let onAbort = null;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Request timed out after ${ms}ms`)), ms);
    });
    const abort = signal
        ? new Promise((_, reject) => {
            if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
            onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
            signal.addEventListener('abort', onAbort, { once: true });
        })
        : null;
    const contenders = abort ? [promise, timeout, abort] : [promise, timeout];
    try {
        return await Promise.race(contenders);
    } finally {
        clearTimeout(timer);
        if (onAbort) signal.removeEventListener('abort', onAbort);
    }
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function abortableSleep(ms, signal) {
    if (!signal) return sleep(ms);
    let onAbort = null;
    const promise = Promise.race([
        sleep(ms),
        new Promise((_, reject) => {
            if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
            onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
            signal.addEventListener('abort', onAbort, { once: true });
        }),
    ]);
    promise.finally(() => {
        if (onAbort) signal.removeEventListener('abort', onAbort);
    }).catch(() => {});
    return promise;
}

// ─── Execute Agent ───────────────────────────────────────────────────

/**
 * Execute an agent's declared pipeline.
 *
 * When config.enableTrace is true, execution is recorded in an append-only
 * trace object and pushed to the AgentTrace ring buffer. Trace never
 * participates in control flow — it is pure observation.
 *
 * Returns the agent's structured output (parsed ?? raw ?? prompt).
 */
export async function execute(agent, { pool, caller, config = {} }) {
    const { proxy: scoped, used, report } = createScopedPool(pool, agent.contextAccess, agent, config);
    const state = {};
    const trace = config.enableTrace ? createTrace(agent.id) : null;

    if (trace) {
        trace.push({
            stage: '_start',
            pipeline: agent.pipelineOrder.slice(),
            contextAccess: agent.contextAccess.slice(),
        });
    }

    const SEMANTIC = { context: 'ctx', prompt: 'prompt', call: 'raw', parse: 'parsed', validate: 'parsed' };

    for (const stage of agent.pipelineOrder) {
        const fn = agent.pipeline[stage];
        const t0 = performance.now();

        try {
            if (stage === 'call' && (fn === null || fn === undefined)) {
                const mcResult = await managedCall(caller, state.prompt, config.call);
                state.raw = mcResult.text;
                if (trace) trace.push({ stage, duration: performance.now() - t0, retries: mcResult.retries, promptLength: state.prompt?.length ?? 0 });
            } else if (stage === 'call') {
                state.raw = await fn(caller, state.prompt, state);
                if (trace) trace.push({ stage, duration: performance.now() - t0, customCall: true });
            } else if (fn) {
                const input = state.parsed ?? state.raw ?? state.prompt ?? state.ctx;
                state[stage] = await fn(input, state.ctx, scoped, config);
                if (SEMANTIC[stage]) state[SEMANTIC[stage]] = state[stage];
                if (trace) {
                    const out = state[stage];
                    trace.push({
                        stage,
                        duration: performance.now() - t0,
                        outputSummary: summarizeResult(out),
                    });
                }
            }
        } catch (e) {
            if (trace) trace.push({ stage, duration: performance.now() - t0, error: e.message });
            throw e;
        }
    }

    const result = state.parsed ?? state.raw ?? state.prompt;

    console.log(report(true));

    if (trace) {
        // Shallow copy of access set to freeze it
        const contextUsed = [...used];
        trace.push({ stage: '_done', result: summarizeResult(result), contextUsed });
        const snapshot = trace.snapshot();
        AgentTrace.push(snapshot);
        console.log('[AgentTrace]', agent.id, snapshot.stages.map(s => s.stage).join(' → '));
    }

    return result;
}
