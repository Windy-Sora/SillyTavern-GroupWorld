import { withTimeout } from './agent-runtime.js';

let turnShared = {};
let turnId = 0;    // incremented per turn to guard against cross-turn async contamination
let decisionSnapshot = null; // snapshot after decision hook completes, read-only for message/round

export function createScriptExecutorSystem({ settings, saveSettings, renderPrompt, AgentTrace, log }) {
    function getList() {
        return settings.scriptExecutors || [];
    }

    function save() {
        saveSettings();
    }

    function generateId() {
        return 'se_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    }

    function add(partial) {
        const entry = {
            id: generateId(),
            name: partial.name || 'Untitled',
            triggerOn: partial.triggerOn || 'both',
            priority: typeof partial.priority === 'number' ? partial.priority : 0,
            code: partial.code || '',
            enabled: partial.enabled !== false,
            params: Array.isArray(partial.params) ? partial.params : [],
            renderParams: !!partial.renderParams,
            returnMode: partial.returnMode === 'shared' ? 'shared' : 'ignore',
        };
        const list = getList();
        list.push(entry);
        save();
        return entry;
    }

    function update(id, updates) {
        const list = getList();
        const idx = list.findIndex(e => e.id === id);
        if (idx === -1) return;
        const allowed = ['name', 'triggerOn', 'priority', 'code', 'enabled', 'params', 'renderParams', 'returnMode'];
        for (const k of allowed) {
            if (updates.hasOwnProperty(k)) list[idx][k] = updates[k];
        }
        save();
    }

    function remove(id) {
        const list = getList();
        const idx = list.findIndex(e => e.id === id);
        if (idx === -1) return;
        list.splice(idx, 1);
        save();
    }

    function toggle(id) {
        const list = getList();
        const entry = list.find(e => e.id === id);
        if (!entry) return;
        entry.enabled = !entry.enabled;
        save();
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
        const params = {};
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

                // Per-script clone prevents timed-out scripts from mutating workingDecision
                const decisionForScript = safeClone(workingDecision);

                const ctx = {
                    params,
                    shared: { ...turnShared },
                    decision: decisionForScript,             // per-script clone — mutation-safe
                    chat: event.chat || null,
                    characters: event.characters || null,
                    group: event.group || null,
                    settings: event.settings || null,
                    getContext: event.getContext || null,
                    // decision phase has no message / character
                };

                const fn = new Function('ctx', entry.code);
                const result = await withTimeout(Promise.resolve(fn(ctx)), 10000).catch(e => {
                    if (e?.name === 'TimeoutError') { const x = new Error(`Script "${entry.name}" timed out after 10s`); x.name = 'TimeoutError'; throw x; }
                    throw e;
                });

                if (turnId === myTurnId && entry.returnMode === 'shared' && result !== undefined && result !== null && typeof result === 'object') {
                    if (Array.isArray(result)) {
                        log?.(`[GD] Script executor (decision) "${entry.name}" returned an array, which cannot be merged into shared state. Use an object instead.`);
                    } else {
                        Object.assign(turnShared, result);
                    }
                }

                // Apply mutations back to working copy (only if turn hasn't changed).
                // Detect if the script replaced ctx.decision entirely, losing old keys.
                if (turnId === myTurnId) {
                    if (ctx.decision !== decisionForScript) {
                        const oldKeys = Object.keys(decisionForScript || {});
                        const newKeys = Object.keys(ctx.decision || {});
                        const lostKeys = oldKeys.filter(k => !newKeys.includes(k));
                        if (lostKeys.length > 0) {
                            log?.(`[GD] Script executor (decision) "${entry.name}" replaced ctx.decision; lost keys: ${lostKeys.join(', ')}`);
                        }
                    }
                    workingDecision = ctx.decision;
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
        decisionSnapshot = Object.freeze({
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
            const stage = { id: entry.id, name: entry.name, trigger: mode, priority: entry.priority, startTime: Date.now() };
            try {
                const params = await buildParams(entry);

                const ctx = {
                    params,
                    shared: { ...turnShared },
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
                const result = await withTimeout(Promise.resolve(fn(ctx)), 5000).catch(e => {
                    if (e?.name === 'TimeoutError') { const x = new Error(`Script "${entry.name}" timed out after 5s`); x.name = 'TimeoutError'; throw x; }
                    throw e;
                });

                if (turnId === myTurnId && entry.returnMode === 'shared' && result !== undefined && result !== null && typeof result === 'object') {
                    if (Array.isArray(result)) {
                        log?.(`[GD] Script executor "${entry.name}" returned an array, which cannot be merged into shared state. Use an object instead.`);
                    } else {
                        Object.assign(turnShared, result);
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
        }

        pushTrace(traceEntry);
    }

    return {
        getList, add, update, remove, toggle,
        executeAll, executeAllDecision,
        resetTurnShared, getTurnShared, getTurnId, getDecisionSnapshot,
        safeClone,
    };
}
