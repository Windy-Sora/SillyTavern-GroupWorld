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
 * @param {Function} [options.onExecuted]     Callback after each action: (capId, result)
 * @param {Function} [options.log]            Log function for debug output
 * @returns {{ run: (policy, capabilities) => Promise<Object> }}
 */
export function createExecutor(options = {}) {
    const blocking = options.blocking !== false;
    const onExecuted = options.onExecuted || (() => {});
    const log = options.log || (() => {});

    // ── resolve ──────────────────────────────────────────────────────

    function resolve(intents, capabilities) {
        if (!Array.isArray(intents)) return [];
        const enabled = capabilities.filter(c => c.enabled !== false);
        const actions = [];

        for (const intent of intents) {
            const intentType = (intent.type || '').toLowerCase().trim();
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
                // Schema validation: required params
                if (cap.schema?.params) {
                    const valid = validateParams(intent.params || {}, cap.schema.params);
                    if (!valid.ok) {
                        log(`[Executor] ${cap.id}: param validation failed — ${valid.error}`);
                        continue;
                    }
                    intent.params = valid.sanitized;
                }

                actions.push({
                    capabilityId: cap.id,
                    params: intent.params || {},
                    executor: cap.executor,
                });
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
                sanitized[key] = def.default;
            }
            if (def.type === 'number' && typeof sanitized[key] === 'string') {
                sanitized[key] = Number(sanitized[key]);
                if (isNaN(sanitized[key])) return { ok: false, error: `${key} must be a number` };
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
                const fallback = def.default ?? def.values[0];
                log(`[Executor] param "${key}" value "${sanitized[key]}" not in allowed [${def.values}], fallback to "${fallback}"`);
                sanitized[key] = fallback;
            }
        }
        return { ok: true, sanitized };
    }

    // ── schedule ─────────────────────────────────────────────────────

    function schedule(actions, timing = {}) {
        if (!actions.length) return [];

        const mode = timing.mode || 'immediate';
        const delay = timing.delay || 0;

        if (mode === 'immediate') {
            // Array order = execution order — no delay between
            return actions.map((action, i) => ({ action, delay: i === 0 ? 0 : 0 }));
        }

        if (mode === 'deferred') {
            // Stagger by 200ms between each
            return actions.map((action, i) => ({ action, delay: delay + (i * 200) }));
        }

        // round_end — caller queues these for batch execution later
        return actions.map((action, i) => ({ action, delay: delay + (i * 200), roundEnd: true }));
    }

    // ── execute ──────────────────────────────────────────────────────

    async function executeOne({ action, delay }) {
        await sleep(delay);
        try {
            await action.executor(action.params);
            return { capabilityId: action.capabilityId, success: true };
        } catch (e) {
            return { capabilityId: action.capabilityId, success: false, error: e.message };
        }
    }

    function sleep(ms) {
        return new Promise(r => setTimeout(r, Math.max(0, ms)));
    }

    async function executeAll(scheduled) {
        if (blocking) {
            const results = [];
            for (const s of scheduled) {
                const r = await executeOne(s);
                results.push(r);
            }
            return results;
        }
        // Fire-and-forget: callbacks fire as each completes, return minimal
        Promise.allSettled(scheduled.map(async s => {
            const r = await executeOne(s);
            onExecuted(s.action.capabilityId, r);
            return r;
        })).catch(() => {});
        return scheduled.map(s => ({ capabilityId: s.action.capabilityId, pending: true }));
    }

    // ── public API ───────────────────────────────────────────────────

    return {
        async run(policy, capabilities) {
            const intents = policy?.intents || [];
            const timing = policy?.timing || {};

            // 1. resolve
            const actions = resolve(intents, capabilities);
            if (!actions.length) {
                return { resolved: 0, scheduled: 0, executed: 0, results: [] };
            }

            // 2. schedule
            const planned = schedule(actions, timing);

            // 3. execute
            const results = await executeAll(planned);

            return {
                resolved: actions.length,
                scheduled: planned.length,
                executed: planned.filter(p => !p.roundEnd).length,
                roundEndQueued: planned.filter(p => p.roundEnd).length,
                blocking,
                results,
            };
        }
    };
}
