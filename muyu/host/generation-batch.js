import { randomUUID } from '../runtime/crypto.js';
import { copyJson, jsonKey } from '../core/json-contract.js';

const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fail = code => { throw Error(code); };
const wire = value => {
    const text = JSON.stringify(value);
    if (typeof text !== 'string' || new TextEncoder().encode(text).length > 16 * 1024 * 1024) fail('GENERATION_BATCH_CONTEXT_TOO_LARGE');
    return text;
};
const businessSettings = settings => Object.fromEntries(Object.entries(settings).filter(([key]) => !key.startsWith('muyu')));
const resource = { memory: 'charMemories', profile: 'characterProfiles', npc: 'npcs' };
const completedStatuses = new Set(['trial_completed', 'no_result', 'applied_confirmed']);

/** Private orchestration only. A separate exact batch permission must gate this port. */
export function createGenerationBatchPort({ getTarget, getContext, getSettings, getCharacters, getProviders,
    getAgents, extensionKey, memoryGeneration, profileGeneration, npcGeneration,
    isBusy = () => false, timeoutMs = 290000 }) {
    if (typeof extensionKey !== 'string' || !extensionKey || [getTarget, getContext, getSettings, getCharacters, getProviders, getAgents].some(fn => typeof fn !== 'function') ||
        !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 290000) fail('INVALID_GENERATION_BATCH');
    const ports = { memory: memoryGeneration, profile: profileGeneration, npc: npcGeneration }, batches = new Map();
    const targetMatches = target => {
        if (target?.kind !== 'chat' || jsonKey(target) !== jsonKey(getTarget())) fail('TARGET_UNAVAILABLE');
    };
    function capture() {
        const ctx = getContext(), settings = getSettings(), characters = getCharacters(), providers = getProviders(), agents = getAgents();
        if (!plain(ctx.chatMetadata) || !Array.isArray(ctx.chat) || !Array.isArray(characters) || characters.length > 512 ||
            !Array.isArray(providers) || !Array.isArray(agents) || ctx.chatMetadata[extensionKey] !== undefined && !plain(ctx.chatMetadata[extensionKey])) fail('GENERATION_BATCH_UNAVAILABLE');
        return { metadata: ctx.chatMetadata, chat: ctx.chat, mainApi: ctx.mainApi, settings, root: ctx.chatMetadata[extensionKey],
            stores: Object.fromEntries(Object.entries(resource).map(([kind, key]) => [kind, ctx.chatMetadata[extensionKey]?.[key]])),
            entryRefs: Object.fromEntries(['memory', 'profile'].map(kind => [kind, Object.fromEntries(Object.entries(ctx.chatMetadata[extensionKey]?.[resource[kind]] || {}))])),
            metadataText: wire(ctx.chatMetadata), contextText: wire({ chat: ctx.chat, mainApi: ctx.mainApi, group: ctx.groupId,
                groups: ctx.groups, characters, settings: businessSettings(settings) }),
            characters: [...characters], providers: [...providers], renders: providers.map(p => p.render),
            agents: [...agents], stageOrders: agents.map(a => a?.pipelineOrder?.join('\0')),
            functions: agents.map(a => a?.pipelineOrder?.map(stage => a.pipeline[stage]) || []) };
    }
    function sameContext(before, now) {
        return now.metadata === before.metadata && now.chat === before.chat && now.mainApi === before.mainApi && now.settings === before.settings &&
            now.contextText === before.contextText && now.characters.length === before.characters.length && now.characters.every((c, i) => c === before.characters[i]) &&
            now.providers.length === before.providers.length && now.providers.every((p, i) => p === before.providers[i] && now.renders[i] === before.renders[i]) &&
            now.agents.length === before.agents.length && now.agents.every((a, i) => a === before.agents[i] && now.stageOrders[i] === before.stageOrders[i] &&
                now.functions[i].length === before.functions[i].length && now.functions[i].every((fn, j) => fn === before.functions[i][j]));
    }
    function current(t, target) {
        targetMatches(target);
        if (!t || t.retired || jsonKey(t.target) !== jsonKey(target)) fail('STALE_GENERATION_BATCH');
        if (isBusy()) fail('GENERATION_BATCH_BUSY');
        const now = capture(), before = t.expected;
        if (!sameContext(before, now) || now.metadataText !== before.metadataText || now.root !== before.root ||
            Object.keys(resource).some(kind => now.stores[kind] !== before.stores[kind]) || !sameOtherEntries(before, now)) fail('STALE_GENERATION_BATCH');
        return now;
    }
    function sameOtherEntries(before, now, changedKind, avatar) {
        return ['memory', 'profile'].every(kind => {
            const keys = new Set([...Object.keys(before.entryRefs[kind]), ...Object.keys(now.entryRefs[kind])]);
            return [...keys].every(key => kind === changedKind && key === avatar || before.entryRefs[kind][key] === now.entryRefs[kind][key]);
        });
    }
    function requestInput(step) {
        return { revision: step.revision, mode: step.mode, ...(step.kind === 'npc' ? step.count === undefined ? {} : { count: step.count } : { character: step.character }) };
    }
    function refreshStep(step, target) {
        const port = ports[step.kind];
        if (step.kind === 'npc') return { ...step, revision: port.readState(target).revision };
        const index = Number(step.character.split(':')[1]), offset = Math.floor(index / 16) * 16;
        const row = port.listTargets(target, offset).items.find(row => row.character === step.character);
        if (!row) fail('STALE_GENERATION_BATCH');
        return { ...step, revision: row.revision };
    }
    const publicStep = (step, descriptor) => ({ kind: step.kind, mode: step.mode,
        ...(step.kind === 'npc' ? { requested: descriptor.requested, effectiveCount: descriptor.effectiveCount } : { character: step.character, name: descriptor.name }),
        destination: descriptor.destination, notice: descriptor.notice });
    const describe = t => ({ executionId: t.executionId, steps: t.steps.map((step, i) => publicStep(step, t.descriptors[i])),
        maximumModelCalls: t.steps.length, oneShot: true, atomic: false,
        notice: 'Exact ordered business-generation list only. Real Prompt/Provider execution is not a sandbox; each step may incur model costs. Trial does not save; memory save may prune; profile save creates missing records only; NPC save appends records, never imports character cards. Confirmed earlier steps stay saved if a later step fails. Unknown/partial results stop the remainder, never retry or roll back. No Blueprint, settings changes, enablement, libraries or code-asset edits.' });
    const release = t => { for (let i = 0; i < t.childTasks.length; i++) ports[t.steps[i].kind]?.forgetExecutions?.(t.childTasks[i]); };

    // Only the current step's controlled write may change the next step's baseline.
    // A confirmed child result is required; all other metadata and context stay exact.
    function advance(t, step, result) {
        const now = capture(), before = t.expected;
        if (!sameContext(before, now)) fail('STALE_GENERATION_BATCH');
        const unchanged = result.status !== 'applied_confirmed';
        if (unchanged) {
            if (now.metadataText !== before.metadataText || now.root !== before.root || Object.keys(resource).some(kind => now.stores[kind] !== before.stores[kind]) || !sameOtherEntries(before, now)) fail('STALE_GENERATION_BATCH');
        } else {
            if (step.mode !== 'save') fail('INVALID_GENERATION_BATCH_RESULT');
            const oldMasked = JSON.parse(before.metadataText), newMasked = JSON.parse(now.metadataText), key = resource[step.kind];
            const mask = metadata => {
                const root = metadata[extensionKey]; if (!root) return;
                if (step.kind === 'npc') delete root[key];
                else if (root[key] !== undefined) {
                    if (!plain(root[key])) fail('STALE_GENERATION_BATCH');
                    const avatar = before.characters[Number(step.character.split(':')[1])]?.avatar;
                    if (typeof avatar !== 'string' || !avatar) fail('STALE_GENERATION_BATCH');
                    delete root[key][avatar];
                    if (!Object.keys(root[key]).length) delete root[key];
                }
                if (!Object.keys(root).length) delete metadata[extensionKey];
            };
            mask(oldMasked); mask(newMasked);
            const avatar = step.kind === 'npc' ? undefined : before.characters[Number(step.character.split(':')[1])]?.avatar;
            if (wire(oldMasked) !== wire(newMasked) || before.root !== undefined && now.root !== before.root ||
                Object.keys(resource).some(kind => kind !== step.kind && now.stores[kind] !== before.stores[kind]) ||
                !sameOtherEntries(before, now, step.kind, avatar)) fail('STALE_GENERATION_BATCH');
            if (step.kind === 'npc' && before.stores.npc !== undefined && now.stores.npc !== before.stores.npc) fail('STALE_GENERATION_BATCH');
        }
        t.expected = now;
    }
    return {
        prepareExecution({ steps }, { target, taskId }) {
            targetMatches(target);
            if (typeof taskId !== 'string' || !taskId || taskId.length > 128 || !Array.isArray(steps) || !steps.length || steps.length > 8) fail('INVALID_GENERATION_BATCH');
            const requests = copyJson(steps), unique = new Set();
            for (const step of requests) {
                if (!plain(step) || Object.keys(step).some(key => !['kind', 'mode', 'character', 'revision', 'count'].includes(key)) ||
                    !ports[step.kind] || !['trial', 'save'].includes(step.mode) || typeof step.revision !== 'string' || !step.revision || step.revision.length > 80 ||
                    step.kind === 'npc' && (step.character !== undefined || step.count !== undefined && (!Number.isSafeInteger(step.count) || step.count < 1 || step.count > 200)) ||
                    step.kind !== 'npc' && (step.count !== undefined || typeof step.character !== 'string' || !new RegExp(`^${step.kind}-character:(0|[1-9]\\d*)$`).test(step.character))) fail('INVALID_GENERATION_BATCH');
                const key = step.kind + ':' + (step.character || 'batch'); if (unique.has(key)) fail('DUPLICATE_GENERATION_BATCH_STEP'); unique.add(key);
            }
            const prior = [...batches.values()].find(t => t.taskId === taskId && !t.retired);
            if (prior) { if (jsonKey(prior.steps) !== jsonKey(requests)) fail('GENERATION_BATCH_ALREADY_PREPARED'); current(prior, target); return copyJson(describe(prior)); }
            if (batches.size >= 64) fail('EXECUTION_CAPACITY_EXCEEDED');
            const t = { executionId: randomUUID(), taskId, target: copyJson(target), steps: requests, expected: capture(), descriptors: [], childTasks: [], tickets: [] };
            current(t, target);
            const profileSaves = requests.filter(step => step.kind === 'profile' && step.mode === 'save').length;
            if (Object.keys(t.expected.stores.profile || {}).length + profileSaves > 512) fail('PROFILE_CAPACITY_EXCEEDED');
            try {
                for (let i = 0; i < requests.length; i++) {
                    t.childTasks.push(`generation-batch:${t.executionId}:${i}`);
                    const descriptor = ports[requests[i].kind].prepareExecution(requestInput(requests[i]), { target, taskId: t.childTasks[i] });
                    t.descriptors.push(descriptor); t.tickets.push(descriptor.executionId);
                }
                // All preparation is pure. Any unexpected effects invalidate the whole proposal.
                current(t, target); const descriptor = copyJson(describe(t)); batches.set(t.executionId, t); return descriptor;
            } catch (error) { release(t); throw error; }
        },
        describeExecution(id, target) { try { const t = batches.get(id); current(t, target); return copyJson(describe(t)); } catch { return null; } },
        async execute(id, { target, taskId, signal }) {
            targetMatches(target); const t = batches.get(id);
            if (!t || t.retired || t.taskId !== taskId || jsonKey(t.target) !== jsonKey(target)) fail('STALE_GENERATION_BATCH');
            if (t.result) return copyJson(t.result);
            if (t.work) return copyJson(await t.work);
            current(t, target);
            if (signal?.aborted) return { status: 'not_started', code: 'CANCELLED', steps: [], historicalExecutionOnly: true };
            const controller = new AbortController(); t.controller = controller;
            const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
            let timedOut = false;
            const timer = setTimeout(() => { timedOut = true; abort(); }, timeoutMs);
            t.work = Promise.resolve().then(async () => {
                const rows = t.steps.map((step, index) => ({ index, kind: step.kind, mode: step.mode, status: 'not_started' }));
                let completed = 0;
                try {
                    for (let i = 0; i < t.steps.length; i++) {
                        if (controller.signal.aborted || t.retired) { rows[i].code = timedOut ? 'TIMEOUT' : 'CANCELLED'; break; }
                        const step = t.steps[i], port = ports[step.kind];
                        try {
                            current(t, target);
                            if (i > 0) {
                                port.forgetExecutions(t.childTasks[i]);
                                const fresh = refreshStep(step, target);
                                current(t, target);
                                const descriptor = port.prepareExecution(requestInput(fresh), { target, taskId: t.childTasks[i] });
                                // The approved meaning cannot change when earlier controlled saves changed revisions.
                                if (jsonKey(publicStep(step, descriptor)) !== jsonKey(publicStep(step, t.descriptors[i]))) fail('STALE_GENERATION_BATCH');
                                t.tickets[i] = descriptor.executionId;
                            }
                            rows[i].status = 'running';
                            const result = await port.execute(t.tickets[i], { target, taskId: t.childTasks[i], signal: controller.signal });
                            rows[i].status = result?.status || 'outcome_unknown';
                            rows[i].chatSave = result?.chatSave || 'unknown';
                            rows[i].result = copyJson(result);
                            if (controller.signal.aborted || t.retired) rows[i].code = timedOut ? 'TIMEOUT' : 'CANCELLED';
                            if (!completedStatuses.has(rows[i].status)) break;
                            completed++;
                            if (controller.signal.aborted || t.retired) { rows[i].code = timedOut ? 'TIMEOUT' : 'CANCELLED'; break; }
                            advance(t, step, result);
                        } catch {
                            rows[i].code = timedOut ? 'TIMEOUT' : controller.signal.aborted || t.retired ? 'CANCELLED' : 'STEP_STALE_OR_FAILED';
                            if (rows[i].status === 'running') rows[i].status = 'outcome_unknown';
                            break;
                        }
                    }
                    const status = completed === rows.length && rows.every(row => !row.code) ? 'completed' : completed ? 'partial' : rows.some(row => row.status !== 'not_started') ? 'outcome_unknown' : 'not_started';
                    // Bound aggregate DTOs without discarding per-step outcomes or changing stored data.
                    for (const row of [...rows].reverse()) {
                        if (new TextEncoder().encode(JSON.stringify(rows)).length <= 22000) break;
                        if (row.result) { delete row.result; row.outputOmitted = true; }
                    }
                    return { executionId: t.executionId, status, completed, steps: rows, code: timedOut ? 'TIMEOUT' : controller.signal.aborted ? 'CANCELLED' : status === 'completed' ? 'COMPLETED' : 'STOPPED', atomic: false, historicalExecutionOnly: true,
                        notice: 'Historical per-step outcomes only. Confirmed earlier writes are retained. Unstarted steps were not executed; unknown steps are not retried. Long generated bodies may be omitted from the aggregate, not deleted from saved data.' };
                } finally { release(t); }
            });
            try { t.result = await t.work; return copyJson(t.result); }
            finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
        },
        forgetExecutions(taskId) { for (const [id, t] of batches) if (t.taskId === taskId) { t.retired = true; t.controller?.abort(); release(t); batches.delete(id); } },
        clearExecutions() { for (const t of batches.values()) { t.retired = true; t.controller?.abort(); release(t); } batches.clear(); },
    };
}
