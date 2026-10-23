import { randomUUID } from '../runtime/crypto.js';
import { copyJson, jsonKey } from '../core/json-contract.js';
import { npcGenerationSettings } from '../../systems/npc-generation.js';

/** Page-local exact generation tickets, never restored from conversations or card imports. */
export function createNpcGenerationPort({ getTarget, getSettings, getContext, getProviders, system,
    saveChatConfirmed, changed, isBusy = () => false, timeoutMs = 290000 }) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 290000) throw Error('INVALID_GENERATION_TIMEOUT');
    const tickets = new Map(), states = new Map();
    const describe = t => ({ executionId: t.executionId, mode: t.mode, requested: t.requested, effectiveCount: t.effectiveCount,
        existingCount: t.existingCount, limit: t.limit, firstMes: t.firstMes, oneShot: true,
        destination: t.custom ? 'Configured NPC business-model connection (not necessarily Muyu)' : 'SillyTavern current native connection; destination managed by ST',
        notice: 'Generate new NPC records in this chat only. Trial does not save; save appends accepted unique names within the approved count and remaining capacity. No existing edits, pruning, enablement, libraries or ST character-card creation/import. Real Prompt/Provider rendering may read data, execute code, use network or cause side effects; trial is not a sandbox. One potentially additional-cost model attempt, no retries. Attempts/output are not billing receipts. No business attempt does not mean no Muyu assistant calls. Generated output sent to Muyu is untrusted historical material, not verified story fact.' });
    function targetMatches(target) {
        if (target?.kind !== 'chat' || jsonKey(target) !== jsonKey(getTarget())) throw Error('TARGET_UNAVAILABLE');
    }
    function state(target) {
        targetMatches(target); const live = system.inspectGeneration({ fingerprint: false }), settings = getSettings();
        const shape = JSON.stringify({ count: live.entries.length, limit: live.limit, configured: live.requested, firstMes: live.firstMes, enabled: settings.npcEnabled });
        const key = jsonKey(target), old = states.get(key);
        if (!old || old.metadata !== live.metadata || old.root !== live.root || old.list !== live.list || old.shape !== shape) {
            states.set(key, { metadata: live.metadata, root: live.root, list: live.list, shape, revision: randomUUID() });
            if (states.size > 64) states.delete(states.keys().next().value);
        }
        return { live, settings, revision: states.get(key).revision };
    }
    function current(t, target) {
        targetMatches(target);
        if (!t || t.retired || jsonKey(t.target) !== jsonKey(target)) throw Error('STALE_NPC_GENERATION');
        if (isBusy()) throw Error('NPC_BUSY');
        const settings = getSettings(), ctx = getContext(), providers = getProviders(), live = system.inspectGeneration({ count: t.requested });
        if (settings !== t.settings || JSON.stringify(npcGenerationSettings(settings)) !== t.settingsKey ||
            ctx.chat !== t.chat || ctx.chatMetadata !== t.metadata || ctx.mainApi !== t.mainApi || live.chat !== t.chat || live.metadata !== t.metadata ||
            live.agent !== t.agent || live.agent.pipelineOrder.join('\0') !== t.stages.join('\0') || t.stages.some((stage, i) => live.agent.pipeline[stage] !== t.functions[i]) ||
            live.characters.length !== t.characters.length || live.characters.some((c, i) => c !== t.characters[i]) ||
            providers.length !== t.providers.length || providers.some((p, i) => p !== t.providers[i] || p.render !== t.renders[i]) ||
            !t.writeStarted && (live.fingerprint !== t.baseline || live.root !== t.root || live.list !== t.list)) throw Error('STALE_NPC_GENERATION');
        return live;
    }
    return {
        readState(target) {
            const { live, settings, revision } = state(target);
            return { revision, count: live.entries.length, limit: live.limit, configuredBatchSize: live.requested,
                effectiveCount: live.effectiveCount, firstMes: live.firstMes, enabled: settings.npcEnabled === true,
                canGenerate: settings.npcEnabled === true && live.effectiveCount > 0, persistence: 'unknown' };
        },
        prepareExecution({ revision, mode, count }, { target, taskId }) {
            if (typeof taskId !== 'string' || !taskId || taskId.length > 128 || !['trial', 'save'].includes(mode)) throw Error('INVALID_NPC_GENERATION');
            if (isBusy() || system.isGenerating()) throw Error('NPC_BUSY');
            const snapshot = state(target); if (snapshot.revision !== revision) throw Error('STALE_NPC_GENERATION');
            if (!snapshot.settings.npcEnabled) throw Error('NPC_DISABLED');
            const live = system.inspectGeneration({ count }), settings = snapshot.settings, ctx = getContext(), providers = getProviders();
            if (!live.effectiveCount) throw Error('NPC_CAPACITY_EXCEEDED');
            if (mode === 'save' && typeof saveChatConfirmed !== 'function') throw Error('WRITE_UNAVAILABLE');
            const prior = [...tickets.values()].find(t => t.taskId === taskId && !t.retired);
            if (prior) {
                if (prior.mode !== mode || prior.requested !== live.requested) throw Error('NPC_CALL_ALREADY_PREPARED');
                current(prior, target); return describe(prior);
            }
            if (tickets.size >= 128) throw Error('EXECUTION_CAPACITY_EXCEEDED');
            const t = { executionId: randomUUID(), mode, taskId, target: copyJson(target), requested: live.requested,
                effectiveCount: live.effectiveCount, existingCount: live.entries.length, limit: live.limit, firstMes: live.firstMes,
                custom: settings.agentConfigs?.npc?.useCustom === true, settings, settingsKey: JSON.stringify(npcGenerationSettings(settings)),
                metadata: ctx.chatMetadata, chat: ctx.chat, mainApi: ctx.mainApi, root: live.root, list: live.list, baseline: live.fingerprint,
                characters: [...live.characters], agent: live.agent, stages: [...live.agent.pipelineOrder], functions: live.agent.pipelineOrder.map(stage => live.agent.pipeline[stage]),
                providers: [...providers], renders: providers.map(p => p.render) };
            current(t, target); tickets.set(t.executionId, t); return describe(t);
        },
        describeExecution(id, target) { try { const t = tickets.get(id); current(t, target); return describe(t); } catch { return null; } },
        async execute(id, { target, taskId, signal }) {
            targetMatches(target); const t = tickets.get(id);
            if (!t || t.retired || t.taskId !== taskId || jsonKey(t.target) !== jsonKey(target)) throw Error('STALE_NPC_GENERATION');
            if (t.result) return copyJson(t.result);
            if (t.started) return { ...describe(t), status: 'outcome_unknown', code: 'ALREADY_STARTED', chatSave: 'unknown' };
            current(t, target);
            let phase = 'not_started', timer, abort;
            const controller = new AbortController(); t.controller = controller;
            const report = (status, code) => ({ ...describe(t), status, code, chatSave: phase === 'save' ? 'unknown' : 'not_started',
                modelCallAttempted: ['generate', 'save'].includes(phase), resultWriteStarted: phase === 'save', historicalExecutionOnly: true,
                notice: describe(t).notice + ' Cancellation/timeout cannot guarantee stopping Provider side effects, native billing or an in-flight save. Unknown results are never retried.' });
            if (signal?.aborted) return report('not_started', 'CANCELLED');
            t.started = true;
            try {
                const stopped = new Promise(resolve => {
                    abort = () => { controller.abort(); resolve(report(phase === 'not_started' ? 'not_started' : 'outcome_unknown', 'CANCELLED')); };
                    signal?.addEventListener('abort', abort, { once: true });
                    timer = setTimeout(() => { controller.abort(); resolve(report(phase === 'not_started' ? 'not_started' : 'outcome_unknown', 'TIMEOUT')); }, timeoutMs);
                });
                const work = Promise.resolve().then(() => system.generateApproved({ mode: t.mode, count: t.requested, signal: controller.signal,
                    validate: () => current(t, target), saveChatConfirmed,
                    changed: () => { if (jsonKey(getTarget()) === jsonKey(t.target) && getContext().chatMetadata === t.metadata) changed?.(); },
                    onPhase: value => { phase = value; if (value === 'save') t.writeStarted = true; } })).then(value => {
                    const output = { ...report(value.status, 'COMPLETED'), ...value, outputUntrusted: true, outputFormatChecked: true };
                    if (new TextEncoder().encode(JSON.stringify(value.npcs)).length > 6000) { output.npcs = []; output.outputOmitted = true; }
                    return output;
                }, error => {
                    // Runtime may wrap an abort error; retiring the private ticket is still cancellation.
                    const code = controller.signal.aborted ? 'CANCELLED' : error?.code ?? error?.message;
                    return report(phase === 'not_started' ? 'not_started' : 'outcome_unknown',
                        ['CANCELLED', 'NPC_BUSY', 'NPC_DISABLED', 'STALE_NPC_GENERATION', 'INVALID_NPC_OUTPUT', 'NPC_OUTPUT_TOO_LARGE', 'NPC_CAPACITY_EXCEEDED'].includes(code) ? code : 'EXECUTION_ERROR');
                });
                t.result = await Promise.race([work, stopped]); return copyJson(t.result);
            } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
        },
        forgetExecutions(taskId) { for (const [id, t] of tickets) if (t.taskId === taskId) { t.retired = true; t.controller?.abort(); tickets.delete(id); } },
        clearExecutions() { for (const t of tickets.values()) { t.retired = true; t.controller?.abort(); } tickets.clear(); states.clear(); },
    };
}
