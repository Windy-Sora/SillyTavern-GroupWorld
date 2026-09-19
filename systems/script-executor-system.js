import { withTimeout } from './agent-runtime.js';
import {
    SCRIPT_EXECUTOR_EXPORT_VERSION,
    generateScriptExecutorId,
    normalizeScriptExecutor,
    validateScriptExecutorExport,
} from './script-executor-validation.js';

export function createScriptExecutorSystem({ settings, saveSettings, renderPrompt, AgentTrace, log, decisionTimeoutMs = 10000, phaseTimeoutMs = 5000 }) {
    // Turn state belongs to this system instance. Keeping it at module scope made
    // tests and multiple extension contexts contaminate one another.
    let turnShared = {};
    let turnId = 0;
    let decisionSnapshot = null;
    let mutationQueue = Promise.resolve();

    function enqueueMutation(work) {
        const result = mutationQueue.then(work, work);
        mutationQueue = result.catch(() => {});
        return result;
    }

    function getList() {
        if (settings.scriptExecutors === undefined) settings.scriptExecutors = [];
        if (!Array.isArray(settings.scriptExecutors)) throw new Error('scriptExecutors must be an array');
        return settings.scriptExecutors;
    }

    function save() {
        return saveSettings();
    }

    function generateId() {
        return generateScriptExecutorId();
    }

    async function add(partial) {
        if (partial === undefined) partial = {};
        if (partial === null || typeof partial !== 'object' || Array.isArray(partial)) {
            throw new Error('executor must be an object');
        }
        const source = { ...partial, name: partial.name ?? 'Untitled' };
        const entry = normalizeScriptExecutor(source, {
            path: 'executor',
            id: generateId(),
        });
        const list = getList();
        list.push(entry);
        try {
            await save();
        } catch (error) {
            const index = list.indexOf(entry);
            if (index !== -1) list.splice(index, 1);
            throw error;
        }
        return entry;
    }

    async function update(id, updates) {
        const list = getList();
        const idx = list.findIndex(e => e.id === id);
        if (idx === -1) return undefined;
        if (updates === null || typeof updates !== 'object' || Array.isArray(updates)) {
            throw new Error('updates must be an object');
        }
        const allowed = ['name', 'triggerOn', 'priority', 'code', 'enabled', 'params', 'renderParams', 'returnMode'];
        const candidate = { ...list[idx] };
        for (const k of allowed) {
            if (Object.prototype.hasOwnProperty.call(updates, k)) candidate[k] = updates[k];
        }
        const entry = normalizeScriptExecutor(candidate, { path: 'executor', id });
        const previous = list[idx];
        list[idx] = entry;
        const appliedSnapshot = structuredClone(entry);
        try {
            await save();
        } catch (error) {
            const currentIndex = list.findIndex(e => e.id === id);
            if (currentIndex !== -1) {
                const current = list[currentIndex];
                if (current === entry && JSON.stringify(current) === JSON.stringify(appliedSnapshot)) {
                    list[currentIndex] = previous;
                } else {
                    for (const key of allowed) {
                        if (Object.prototype.hasOwnProperty.call(updates, key)
                            && JSON.stringify(appliedSnapshot[key]) !== JSON.stringify(previous[key])
                            && JSON.stringify(current[key]) === JSON.stringify(appliedSnapshot[key])) {
                            current[key] = previous[key];
                        }
                    }
                }
            }
            throw error;
        }
        return entry;
    }

    async function remove(id) {
        const list = getList();
        const idx = list.findIndex(e => e.id === id);
        if (idx === -1) return;
        const [removed] = list.splice(idx, 1);
        try {
            await save();
        } catch (error) {
            if (!list.some(e => e.id === id)) list.splice(Math.min(idx, list.length), 0, removed);
            throw error;
        }
    }

    async function toggle(id) {
        const list = getList();
        const entry = list.find(e => e.id === id);
        if (!entry) return;
        const previous = entry.enabled;
        entry.enabled = !entry.enabled;
        try {
            await save();
        } catch (error) {
            if (entry.enabled === !previous) entry.enabled = previous;
            throw error;
        }
        return entry;
    }

    function createExportData() {
        return {
            version: SCRIPT_EXECUTOR_EXPORT_VERSION,
            type: 'script-executor-export',
            exportedAt: new Date().toISOString(),
            executors: getList().map((entry, index) => normalizeScriptExecutor(entry, {
                path: `scriptExecutors[${index}]`,
            })),
            migrations: [],
        };
    }

    /**
     * Validate the complete payload and resolve every conflict before replacing
     * settings. The live list is never touched until the single commit below.
     */
    async function importExecutors(data, { resolveConflict } = {}) {
        const incoming = validateScriptExecutorExport(data);
        const candidate = [...getList()];
        let imported = 0;
        let skipped = 0;

        for (const executor of incoming) {
            const conflictIndex = candidate.findIndex(entry => entry.name === executor.name);
            if (conflictIndex !== -1) {
                const conflict = candidate[conflictIndex];
                const resolution = resolveConflict
                    ? await resolveConflict({ incoming: executor, existing: conflict })
                    : 'skip';
                if (resolution === 'cancel') return { imported: 0, skipped: 0, cancelled: true };
                if (resolution === 'skip') {
                    skipped++;
                    continue;
                }
                if (resolution !== 'overwrite') throw new Error('Invalid conflict resolution');
                candidate[conflictIndex] = { ...executor, id: conflict.id || generateId() };
            } else {
                candidate.push({ ...executor, id: generateId() });
            }
            imported++;
        }

        if (imported > 0) {
            const previous = settings.scriptExecutors;
            settings.scriptExecutors = candidate;
            try {
                await save();
            } catch (error) {
                settings.scriptExecutors = previous;
                throw error;
            }
        }
        return { imported, skipped, cancelled: false };
    }

    function resetTurnShared() {
        turnShared = {};
        turnId++;
        decisionSnapshot = null;
    }

    function getTurnShared() { return turnShared; }
    function getTurnId() { return turnId; }
    function getDecisionSnapshot() { return decisionSnapshot; }

    async function buildParams(entry) {
        const params = Object.create(null);
        for (const p of (entry.params || [])) {
            params[p.key] = p.default;
        }
        if (entry.renderParams) {
            for (const p of (entry.params || [])) {
                if (p.type === 'string' || typeof p.default === 'string') {
                    try {
                        params[p.key] = await renderPrompt(
                            String(p.default ?? ''),
                            {},
                            { recursive: false, maxPasses: 1 }
                        );
                    } catch (_) { /* keep original default */ }
                }
            }
        }
        return params;
    }

    function pushTrace(traceEntry) {
        if (AgentTrace && typeof AgentTrace.push === 'function') {
            try { AgentTrace.push(traceEntry); } catch (_) { /* best-effort */ }
        }
    }

    function safeClone(obj) {
        if (obj === null || obj === undefined) return obj;
        try {
            return structuredClone(obj);
        } catch (_) {
            console.warn('[GD] safeClone: structuredClone failed (object may contain functions), falling back', _.message);
            try {
                return JSON.parse(JSON.stringify(obj));
            } catch (_2) {
                // Last resort: shallow copy for objects with functions/DOM nodes.
                // Nested references are shared — warn if the copy would alias deeply.
                console.warn('[GD] safeClone: both structuredClone and JSON failed. Using shallow copy — nested objects will share references with the original.');
                if (Array.isArray(obj)) return [...obj];
                if (typeof obj === 'object') return { ...obj };
                return obj;
            }
        }
    }

    function deepFreeze(obj, seen = new WeakSet()) {
        if (!obj || typeof obj !== 'object' || seen.has(obj)) return obj;
        seen.add(obj);
        for (const value of Object.values(obj)) deepFreeze(value, seen);
        return Object.freeze(obj);
    }

    /**
     * Shared script results become immutable cross-phase snapshots. Limit that
     * boundary to JSON-style values whose immutability Object.freeze can
     * actually enforce. Map/Set keep mutable internal slots and non-empty typed
     * arrays can throw during Object.freeze in current JavaScript runtimes.
     */
    function assertSnapshotValue(value, path = 'result', seen = new WeakSet()) {
        if (value === null) return;
        const type = typeof value;
        if (type === 'string' || type === 'number' || type === 'boolean' || type === 'undefined') return;
        if (type !== 'object') {
            throw new TypeError(`Unsupported snapshot value at ${path}: ${type}`);
        }
        if (seen.has(value)) {
            throw new TypeError(`Unsupported snapshot value at ${path}: cyclic reference`);
        }
        seen.add(value);
        if (Array.isArray(value)) {
            value.forEach((item, index) => assertSnapshotValue(item, `${path}[${index}]`, seen));
            seen.delete(value);
            return;
        }
        const proto = Object.getPrototypeOf(value);
        if (proto !== Object.prototype && proto !== null) {
            const label = value?.constructor?.name || 'non-plain object';
            throw new TypeError(`Unsupported snapshot value at ${path}: ${label}`);
        }
        for (const [key, item] of Object.entries(value)) {
            assertSnapshotValue(item, `${path}.${key}`, seen);
        }
        seen.delete(value);
    }

    // ── Decision phase: blocking, await all, 10s timeout ──
    async function executeAllDecision(rawEvent) {
        const event = rawEvent ? { ...rawEvent } : {};
        const myTurnId = turnId; // guard against cross-turn async contamination

        const list = getList().filter(e =>
            e.enabled && (e.triggerOn === 'decision' || e.triggerOn === 'all')
        );
        if (!list.length) return null;

        const sorted = [...list].sort((a, b) => a.priority - b.priority);

        const traceEntry = {
            agentId: 'script-executor',
            startTime: new Date().toISOString(),
            stages: [],
        };

        // Clone decision so timed-out scripts can't keep mutating the live reference.
        // A fresh per-script clone is given inside the loop for the same reason.
        let workingDecision = safeClone(event.decision || null);

        for (const entry of sorted) {
            const stage = { id: entry.id, name: entry.name, trigger: 'decision', priority: entry.priority, startTime: Date.now() };
            try {
                const params = await buildParams(entry);
                if (turnId !== myTurnId) break;

                // Per-script clone prevents timed-out scripts from mutating workingDecision
                const decisionForScript = safeClone(workingDecision);

                const ctx = {
                    params,
                    shared: safeClone(turnShared),
                    decision: decisionForScript,             // per-script clone — mutation-safe
                    chat: event.chat || null,
                    characters: event.characters || null,
                    group: event.group || null,
                    settings: event.settings || null,
                    getContext: event.getContext || null,
                    // decision phase has no message / character
                };

                const fn = new Function('ctx', entry.code);
                const result = await withTimeout(Promise.resolve(fn(ctx)), decisionTimeoutMs).catch(e => {
                    if (e?.name === 'TimeoutError') { const x = new Error(`Script "${entry.name}" timed out after ${decisionTimeoutMs}ms`); x.name = 'TimeoutError'; throw x; }
                    throw e;
                });

                if (turnId === myTurnId && entry.returnMode === 'shared' && result !== undefined && result !== null && typeof result === 'object') {
                    if (Array.isArray(result)) {
                        log?.(`[GD] Script executor (decision) "${entry.name}" returned an array, which cannot be merged into shared state. Use an object instead.`);
                    } else {
                        assertSnapshotValue(result);
                        Object.assign(turnShared, safeClone(result));
                    }
                }

                // Apply mutations back to working copy (only if turn hasn't changed).
                // Detect if the script replaced ctx.decision entirely, losing old keys.
                if (turnId === myTurnId) {
                    assertSnapshotValue(ctx.decision, 'ctx.decision');
                    if (ctx.decision !== decisionForScript) {
                        const oldKeys = Object.keys(decisionForScript || {});
                        const newKeys = Object.keys(ctx.decision || {});
                        const lostKeys = oldKeys.filter(k => !newKeys.includes(k));
                        if (lostKeys.length > 0) {
                            log?.(`[GD] Script executor (decision) "${entry.name}" replaced ctx.decision; lost keys: ${lostKeys.join(', ')}`);
                        }
                    }
                    workingDecision = safeClone(ctx.decision);
                }

                stage.ok = true;
                stage.mutationsApplied = turnId === myTurnId;
            } catch (e) {
                stage.ok = false;
                stage.error = e.message || String(e);
                log?.(`[GD] Script executor (decision) "${entry.name}": ${stage.error}`);
                // Keep previous workingDecision, continue to next executor
            }
            stage.elapsed = Date.now() - stage.startTime;
            traceEntry.stages.push(stage);
            if (turnId !== myTurnId) break;
        }

        if (turnId !== myTurnId) {
            pushTrace(traceEntry);
            return null;
        }

        // Write back to live event for downstream consumers.
        // Clear-then-assign so delete operations in workingDecision propagate.
        if (event.decision && workingDecision) {
            for (const key of Object.keys(event.decision)) {
                delete event.decision[key];
            }
            Object.assign(event.decision, workingDecision);
        }

        // Snapshot decision state for message/round phases (frozen for read-only enforcement)
        decisionSnapshot = deepFreeze({
            decision: safeClone(workingDecision),
            shared: safeClone(turnShared),
        });

        pushTrace(traceEntry);
        return decisionSnapshot;
    }

    // ── Message / Round phase: fire-and-forget, 5s timeout ──
    async function executeAll(mode, rawEvent) {
        const event = rawEvent ? { ...rawEvent } : {};
        const myTurnId = turnId; // guard against cross-turn async contamination

        const list = getList().filter(e =>
            e.enabled && (e.triggerOn === mode || e.triggerOn === 'both' || e.triggerOn === 'all')
        );

        if (!list.length) return;

        const sorted = [...list].sort((a, b) => a.priority - b.priority);

        const traceEntry = {
            agentId: 'script-executor',
            startTime: new Date().toISOString(),
            stages: [],
        };

        for (const entry of sorted) {
            if (turnId !== myTurnId) break;
            const stage = { id: entry.id, name: entry.name, trigger: mode, priority: entry.priority, startTime: Date.now() };
            try {
                const params = await buildParams(entry);
                if (turnId !== myTurnId) break;

                const ctx = {
                    params,
                    shared: safeClone(turnShared),
                    decisionSnapshot: decisionSnapshot,    // read-only snapshot from decision phase
                    message: event.message || null,
                    character: event.character || null,
                    chat: event.chat || null,
                    characters: event.characters || null,
                    group: event.group || null,
                    settings: event.settings || null,
                    getContext: event.getContext || null,
                };

                const fn = new Function('ctx', entry.code);
                const result = await withTimeout(Promise.resolve(fn(ctx)), phaseTimeoutMs).catch(e => {
                    if (e?.name === 'TimeoutError') { const x = new Error(`Script "${entry.name}" timed out after ${phaseTimeoutMs}ms`); x.name = 'TimeoutError'; throw x; }
                    throw e;
                });

                if (turnId === myTurnId && entry.returnMode === 'shared' && result !== undefined && result !== null && typeof result === 'object') {
                    if (Array.isArray(result)) {
                        log?.(`[GD] Script executor "${entry.name}" returned an array, which cannot be merged into shared state. Use an object instead.`);
                    } else {
                        assertSnapshotValue(result);
                        Object.assign(turnShared, safeClone(result));
                    }
                }

                stage.ok = true;
                stage.mutationsApplied = turnId === myTurnId;
            } catch (e) {
                stage.ok = false;
                stage.error = e.message || String(e);
                log?.(`[GD] Script executor "${entry.name}": ${stage.error}`);
            }
            stage.elapsed = Date.now() - stage.startTime;
            traceEntry.stages.push(stage);
            if (turnId !== myTurnId) break;
        }

        pushTrace(traceEntry);
    }

    return {
        getList,
        add: (...args) => enqueueMutation(() => add(...args)),
        update: (...args) => enqueueMutation(() => update(...args)),
        remove: (...args) => enqueueMutation(() => remove(...args)),
        toggle: (...args) => enqueueMutation(() => toggle(...args)),
        createExportData,
        importExecutors: (...args) => enqueueMutation(() => importExecutors(...args)),
        executeAll, executeAllDecision,
        resetTurnShared, getTurnShared, getTurnId, getDecisionSnapshot,
        safeClone,
    };
}
