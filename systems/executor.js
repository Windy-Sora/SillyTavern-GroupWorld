/**
 * Executor — resolves policy intents into capability actions and executes them.
 *
 * Three responsibilities:
 *   1. resolve  — intents → matched capabilities (schema-aware)
 *   2. schedule — actions → ordered plan (immediate / deferred / round_end)
 *   3. execute  — plan → results (blocking or fire-and-forget)
 *
 * Pure. Does NOT access global state. All inputs injected via factory.
 */

/**
 * @param {Object} options
 * @param {boolean} [options.blocking=true]   True = await each, false = fire-and-forget
 * @param {Function} [options.getBlocking]     Read the current setting when a batch starts
 * @param {Function} [options.onExecuted]     Callback after each action: (capId, result)
 * @param {Function} [options.log]            Log function for debug output
 * @param {Function} [options.resolveCapability] Resolve a capability by id at
 *   execution time. When supplied, stale deferred plans are cancelled.
 * @returns {{
 *   run: (policy, capabilities) => Promise<Object>,
 *   executeDeferred: (plans) => Promise<Object>
 * }}
 */
export function createExecutor(options = {}) {
    const currentBlocking = () => (typeof options.getBlocking === 'function' ? options.getBlocking() : options.blocking) !== false;
    const onExecuted = options.onExecuted || (() => {});
    const log = options.log || (() => {});
    const resolveCapability = options.resolveCapability;
    const MAX_POLICY_INTENTS = 8;
    const MAX_POLICY_ACTIONS = 8;
    const MAX_DELAY_MS = 30000;
    const lastStarted = new Map();

    // ── resolve ──────────────────────────────────────────────────────

    function cloneParamValue(value, seen = new WeakMap()) {
        if (value === null || typeof value !== 'object') return value;
        if (seen.has(value)) return seen.get(value);

        const clone = Array.isArray(value) ? [] : {};
        seen.set(value, clone);
        for (const [key, nested] of Object.entries(value)) {
            Object.defineProperty(clone, key, {
                value: cloneParamValue(nested, seen),
                enumerable: true,
                configurable: true,
                writable: true,
            });
        }
        return clone;
    }

    function resolve(intents, capabilities) {
        if (!Array.isArray(intents)) return [];
        const enabled = capabilities.filter(c => c.enabled !== false);
        const actions = [];
        const counts = new Map();

        if (intents.length > MAX_POLICY_INTENTS) log(`[Executor] policy intents limited to ${MAX_POLICY_INTENTS}`);
        for (const [intentIndex, intent] of intents.slice(0, MAX_POLICY_INTENTS).entries()) {
            if (typeof intent?.type !== 'string') continue;
            const intentType = intent.type.toLowerCase().trim();
            if (!intentType) continue;

            // Exact match on capability.id first, then fallback to schema intents
            let matches = enabled.filter(c => c.id.toLowerCase() === intentType);
            if (!matches.length) {
                matches = enabled.filter(c =>
                    c.schema?.intents?.includes(intentType)
                );
            }
            // Fallback: substring match (less strict)
            if (!matches.length) {
                matches = enabled.filter(c =>
                    c.id.toLowerCase().includes(intentType)
                );
            }

            for (const cap of matches) {
                const maxPerMessage = Number.isSafeInteger(cap.constraints?.maxPerMessage) && cap.constraints.maxPerMessage >= 0
                    ? cap.constraints.maxPerMessage : 1;
                if ((counts.get(cap.id) ?? 0) >= maxPerMessage) continue;
                let params = cloneParamValue(intent.params || {});

                // Schema validation: required params
                if (cap.schema?.params) {
                    const valid = validateParams(params, cap.schema.params);
                    if (!valid.ok) {
                        log(`[Executor] ${cap.id}: param validation failed — ${valid.error}`);
                        continue;
                    }
                    params = valid.sanitized;
                }

                actions.push({
                    capabilityId: cap.id,
                    intentIndex,
                    intentType: intent.type,
                    params,
                    executor: cap.executor,
                    capabilityRevision: cap.revision,
                    constraints: cap.constraints,
                });
                counts.set(cap.id, (counts.get(cap.id) ?? 0) + 1);
                if (actions.length >= MAX_POLICY_ACTIONS) {
                    log(`[Executor] policy actions limited to ${MAX_POLICY_ACTIONS}`);
                    return actions;
                }
            }
        }
        return actions;
    }

    function validateParams(params, schema) {
        const sanitized = { ...params };
        for (const [key, def] of Object.entries(schema)) {
            if (def.required && (sanitized[key] === undefined || sanitized[key] === null)) {
                return { ok: false, error: `missing required param: ${key}` };
            }
            if (sanitized[key] === undefined && def.default !== undefined) {
                sanitized[key] = cloneParamValue(def.default);
            }
            if (def.type === 'number' && sanitized[key] !== undefined) {
                if (typeof sanitized[key] === 'string' && sanitized[key].trim() !== '') {
                    sanitized[key] = Number(sanitized[key]);
                }
                if (typeof sanitized[key] !== 'number' || !Number.isFinite(sanitized[key])) {
                    return { ok: false, error: `${key} must be a number` };
                }
            }
            if (def.min !== undefined && sanitized[key] < def.min) {
                log(`[Executor] param "${key}" value ${sanitized[key]} below min=${def.min}, clamped`);
                sanitized[key] = def.min;
            }
            if (def.max !== undefined && sanitized[key] > def.max) {
                log(`[Executor] param "${key}" value ${sanitized[key]} above max=${def.max}, clamped`);
                sanitized[key] = def.max;
            }
            if (def.values && !def.values.includes(sanitized[key])) {
                const fallback = cloneParamValue(def.default ?? def.values[0]);
                log(`[Executor] param "${key}" value "${sanitized[key]}" not in allowed [${def.values}], fallback to "${fallback}"`);
                sanitized[key] = fallback;
            }
        }
        return { ok: true, sanitized };
    }

    // ── schedule ─────────────────────────────────────────────────────

    function schedule(actions, timing = {}) {
        if (!actions.length) return [];

        const mode = timing.mode ?? 'immediate';
        const requestedDelay = Number(timing.delay);
        const delay = Number.isFinite(requestedDelay) ? Math.min(MAX_DELAY_MS, Math.max(0, requestedDelay)) : 0;

        if (mode === 'immediate') {
            // Array order = execution order — no delay between
            return actions.map((action, i) => ({ action, delay: i === 0 ? 0 : 0 }));
        }

        if (mode === 'deferred') {
            // Stagger by 200ms between each
            return actions.map((action, i) => ({ action, delay: Math.min(MAX_DELAY_MS, delay + (i * 200)) }));
        }

        if (mode === 'round_end') {
            // Caller queues these for batch execution later.
            return actions.map((action, i) => ({ action, delay: Math.min(MAX_DELAY_MS, delay + (i * 200)), roundEnd: true }));
        }

        log(`[Executor] Unknown timing mode "${mode}", falling back to immediate`);
        return actions.map(action => ({ action, delay: 0 }));
    }

    // ── execute ──────────────────────────────────────────────────────

    async function executeOne({ action, delay }) {
        await sleep(delay);
        try {
            let executor = action.executor;
            if (typeof resolveCapability === 'function') {
                const current = resolveCapability(action.capabilityId);
                const unavailable = !current
                    || current.enabled === false
                    || current.revision !== action.capabilityRevision;
                if (unavailable) {
                    return {
                        capabilityId: action.capabilityId,
                        intentIndex: action.intentIndex,
                        intentType: action.intentType,
                        success: false,
                        cancelled: true,
                        error: 'Capability unavailable or changed after scheduling',
                    };
                }
                executor = current.executor;
            }
            const cooldown = Number.isFinite(action.constraints?.cooldown) ? Math.max(0, action.constraints.cooldown) : 0;
            const previous = lastStarted.get(action.capabilityId);
            const now = Date.now();
            if (cooldown && previous?.revision === action.capabilityRevision && now - previous.at < cooldown) {
                return {
                    capabilityId: action.capabilityId,
                    intentIndex: action.intentIndex,
                    intentType: action.intentType,
                    success: false,
                    cancelled: true,
                    error: 'Capability cooldown active',
                };
            }
            if (cooldown) lastStarted.set(action.capabilityId, { revision: action.capabilityRevision, at: now });
            await executor(action.params);
            return {
                capabilityId: action.capabilityId,
                intentIndex: action.intentIndex,
                intentType: action.intentType,
                success: true,
            };
        } catch (e) {
            return {
                capabilityId: action.capabilityId,
                intentIndex: action.intentIndex,
                intentType: action.intentType,
                success: false,
                error: e.message,
            };
        }
    }

    function sleep(ms) {
        return new Promise(r => setTimeout(r, Math.max(0, ms)));
    }

    async function notifyExecuted(action, result) {
        try {
            await onExecuted(action.capabilityId, result);
        } catch (e) {
            log(`[Executor] onExecuted callback failed: ${e.message}`);
        }
    }

    async function executeAll(scheduled, blocking) {
        if (blocking) {
            const results = [];
            for (const s of scheduled) {
                const r = await executeOne(s);
                results.push(r);
                await notifyExecuted(s.action, r);
            }
            return { results, completion: Promise.resolve(results) };
        }

        // Non-blocking callers still receive a completion receipt for accurate
        // bookkeeping after the fire-and-forget work settles.
        const completion = Promise.all(scheduled.map(async s => {
            const r = await executeOne(s);
            await notifyExecuted(s.action, r);
            return r;
        }));
        const results = scheduled.map(s => ({
            capabilityId: s.action.capabilityId,
            intentIndex: s.action.intentIndex,
            intentType: s.action.intentType,
            pending: true,
        }));
        return { results, completion };
    }

    function buildResult({
        resolved,
        scheduled,
        executed,
        deferred,
        execution,
        blocking,
    }) {
        return {
            resolved,
            scheduled,
            executed,
            roundEndQueued: deferred.length,
            blocking,
            results: execution.results,
            completion: execution.completion,
            deferred,
        };
    }

    // ── public API ───────────────────────────────────────────────────

    return {
        async run(policy, capabilities) {
            const blocking = currentBlocking();
            const intents = policy?.intents || [];
            const timing = policy?.timing || {};

            // 1. resolve
            const actions = resolve(intents, capabilities);
            if (!actions.length) {
                return {
                    resolved: 0,
                    scheduled: 0,
                    executed: 0,
                    roundEndQueued: 0,
                    blocking,
                    results: [],
                    completion: Promise.resolve([]),
                    deferred: [],
                };
            }

            // 2. schedule
            const planned = schedule(actions, timing);
            const deferred = planned.filter(plan => plan.roundEnd);
            const executable = planned.filter(plan => !plan.roundEnd);

            // 3. execute only work due now. round_end plans are caller-owned
            // and must be passed back through executeDeferred at the boundary.
            const execution = await executeAll(executable, blocking);
            return buildResult({
                resolved: actions.length,
                scheduled: planned.length,
                executed: executable.length,
                deferred,
                execution,
                blocking,
            });
        },

        /** Execute a deferred plan batch returned by run(). */
        async executeDeferred(deferred = []) {
            if (!Array.isArray(deferred)) {
                throw new TypeError('Deferred execution plans must be an array');
            }

            const blocking = currentBlocking();
            const executable = deferred.slice(0, MAX_POLICY_ACTIONS).map(plan => ({ ...plan, roundEnd: false,
                delay: Number.isFinite(plan.delay) ? Math.min(MAX_DELAY_MS, Math.max(0, plan.delay)) : 0 }));
            const execution = await executeAll(executable, blocking);
            return buildResult({
                resolved: executable.length,
                scheduled: executable.length,
                executed: executable.length,
                deferred: [],
                execution,
                blocking,
            });
        },
    };
}
