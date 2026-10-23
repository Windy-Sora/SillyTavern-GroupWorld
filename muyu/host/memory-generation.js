import { randomUUID } from '../runtime/crypto.js';
import { copyJson, jsonKey } from '../core/json-contract.js';
import { memoryGenerationSettings } from '../../systems/memory-generation.js';

/** Page-local, one-shot business-model tickets. No history restoration of execution rights. */
export function createMemoryGenerationPort({ getTarget, getSettings, getContext, getCharacters, getProviders,
    system, saveChatConfirmed, changed, isBusy = () => false, timeoutMs = 290000 }) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 290000) throw Error('INVALID_GENERATION_TIMEOUT');
    const tickets = new Map(), targets = new Map();
    const targetState = character => {
        const state = system.inspectGeneration(character.avatar, { fingerprint: false });
        return { ...state, fingerprint: JSON.stringify({ name: character.name, count: state.entries.length, limit: state.limit }) };
    };
    const describe = t => ({ executionId: t.executionId, character: t.selector, name: t.name, mode: t.mode,
        oneShot: true, destination: t.custom ? 'Configured memory business-model connection (not necessarily Muyu)' : 'SillyTavern current native connection; destination managed by ST',
        usesRealContext: true, limit: t.limit, existingCount: t.count,
        notice: 'Real Prompt/Provider rendering may read secrets, execute page code, mutate data or use the network. One business-model attempt with no automatic retries; potential additional cost and output sent to Muyu. Attempts/output are not billing receipts. No business attempt does not mean no Muyu assistant calls. Save appends to this character and may prune oldest memories to its limit. Trial does not write memories, but is not a sandbox. No automatic enablement.' });
    function current(t, target) {
        if (!t || t.retired || target?.kind !== 'chat' || jsonKey(t.target) !== jsonKey(target) || jsonKey(getTarget()) !== jsonKey(target)) throw Error('STALE_MEMORY_GENERATION');
        if (isBusy()) throw Error('MEMORY_BUSY');
        const ctx = getContext(), settings = getSettings(), providers = getProviders(), agent = system.inspectGeneration(t.avatar);
        if (settings !== t.settings || JSON.stringify(memoryGenerationSettings(settings)) !== t.settingsKey || ctx.chat !== t.chat || ctx.chatMetadata !== t.metadata || ctx.mainApi !== t.mainApi ||
            providers.length !== t.providers.length || providers.some((p, i) => p !== t.providers[i] || p.render !== t.renders[i]) ||
            agent.agent !== t.agent || agent.agent.pipelineOrder.join('\0') !== t.stages.join('\0') || t.stages.some((stage, i) => agent.agent.pipeline[stage] !== t.functions[i]) ||
            agent.character !== t.character || getCharacters()[Number(t.selector.slice(17))] !== t.character || agent.character.name !== t.name ||
            !t.writeStarted && (agent.fingerprint !== t.baseline || agent.root !== t.root || agent.store !== t.store || agent.hasEntries !== t.hasEntries || t.hasEntries && agent.entries !== t.entries)) throw Error('STALE_MEMORY_GENERATION');
        return agent;
    }
    return {
        listTargets(target, offset = 0) {
            if (target?.kind !== 'chat' || jsonKey(getTarget()) !== jsonKey(target) || !Number.isInteger(offset) || offset < 0 || offset > 512) throw Error('TARGET_UNAVAILABLE');
            const characters = getCharacters();
            if (!Array.isArray(characters) || characters.length > 512) throw Error('MEMORY_CHARACTERS_UNAVAILABLE');
            const items = characters.slice(offset, offset + 16).map((character, index) => {
                if (typeof character.name !== 'string' || character.name.length > 200) throw Error('MEMORY_CHARACTER_UNAVAILABLE');
                const selector = 'memory-character:' + (offset + index), state = targetState(character);
                const key = jsonKey({ target, selector }), old = targets.get(key);
                if (!old || old.character !== character || old.fingerprint !== state.fingerprint || old.root !== state.root || old.store !== state.store || old.hasEntries !== state.hasEntries || state.hasEntries && old.entries !== state.entries) {
                    targets.set(key, { character, ...state, revision: randomUUID() });
                    if (targets.size > 512) targets.delete(targets.keys().next().value);
                }
                return { character: selector, name: character.name, revision: targets.get(key).revision, count: state.entries.length, limit: state.limit };
            });
            return { items, nextOffset: offset + 16 < characters.length ? offset + 16 : -1 };
        },
        prepareExecution({ character: selector, revision, mode }, { target, taskId }) {
            if (!taskId || !['trial', 'save'].includes(mode) || !/^memory-character:(0|[1-9]\d*)$/.test(selector) || target?.kind !== 'chat' || jsonKey(getTarget()) !== jsonKey(target)) throw Error('INVALID_MEMORY_GENERATION');
            if (!system?.generateApproved || typeof getProviders !== 'function' || mode === 'save' && typeof saveChatConfirmed !== 'function') throw Error('GENERATION_UNAVAILABLE');
            if (isBusy() || system.isGenerating?.() || system.isPruning?.()) throw Error('MEMORY_BUSY');
            const character = getCharacters()[Number(selector.slice(17))];
            if (!character || typeof character.name !== 'string' || character.name.length > 200) throw Error('MEMORY_CHARACTER_UNAVAILABLE');
            if (revision !== undefined) {
                const old = targets.get(jsonKey({ target, selector }));
                if (!old || old.revision !== revision || old.character !== character) throw Error('STALE_MEMORY_GENERATION');
                const state = targetState(character);
                if (state.fingerprint !== old.fingerprint || state.root !== old.root || state.store !== old.store || state.hasEntries !== old.hasEntries || state.hasEntries && state.entries !== old.entries) throw Error('STALE_MEMORY_GENERATION');
            }
            for (const t of tickets.values()) if (t.taskId === taskId && t.avatar === character.avatar) {
                if (t.mode !== mode) throw Error('MEMORY_EXECUTION_ALREADY_PREPARED');
                current(t, target); return describe(t);
            }
            if (tickets.size >= 128) throw Error('MEMORY_EXECUTION_CAPACITY');
            const baseline = system.inspectGeneration(character.avatar), settings = getSettings(), ctx = getContext(), providers = getProviders();
            const t = { executionId: randomUUID(), taskId, target: copyJson(target), selector, avatar: character.avatar,
                name: character.name, mode, settings, settingsKey: JSON.stringify(memoryGenerationSettings(settings)), custom: settings.agentConfigs?.memory?.useCustom === true,
                chat: ctx.chat, metadata: ctx.chatMetadata, mainApi: ctx.mainApi, baseline: baseline.fingerprint,
                root: baseline.root, store: baseline.store, entries: baseline.entries, hasEntries: !!baseline.store && Object.hasOwn(baseline.store, character.avatar),
                character: baseline.character, agent: baseline.agent, stages: [...baseline.agent.pipelineOrder], functions: baseline.agent.pipelineOrder.map(stage => baseline.agent.pipeline[stage]),
                providers: [...providers], renders: providers.map(p => p.render), limit: baseline.limit, count: baseline.entries.length };
            tickets.set(t.executionId, t); current(t, target); return describe(t);
        },
        describeExecution(id, target) { try { const t = tickets.get(id); current(t, target); return describe(t); } catch { return null; } },
        async execute(id, { target, taskId, signal }) {
            const t = tickets.get(id);
            if (!t || t.retired || t.taskId !== taskId || jsonKey(t.target) !== jsonKey(target) || jsonKey(getTarget()) !== jsonKey(target)) throw Error('STALE_MEMORY_GENERATION');
            if (t.result) return copyJson(t.result);
            if (t.started) return { ...describe(t), status: 'outcome_unknown', code: 'ALREADY_STARTED', chatSave: 'unknown' };
            current(t, target);
            let phase = 'not_started', timer, abort;
            const controller = new AbortController(); t.controller = controller;
            const report = (status, code) => ({ ...describe(t), status, code, chatSave: phase === 'save' ? 'unknown' : 'not_started',
                historicalExecutionOnly: true, modelCallAttempted: ['generate', 'save'].includes(phase), resultWriteStarted: phase === 'save',
                notice: describe(t).notice + ' Cancellation/timeout cannot guarantee stopping Provider side effects, native billing or an in-flight save. Unknown results are never retried.' });
            if (signal?.aborted) return report('not_started', 'CANCELLED');
            t.started = true;
            try {
                const stopped = new Promise(resolve => {
                    abort = () => { controller.abort(); resolve(report(phase === 'not_started' ? 'not_started' : 'outcome_unknown', 'CANCELLED')); };
                    signal?.addEventListener('abort', abort, { once: true });
                    timer = setTimeout(() => { controller.abort(); resolve(report(phase === 'not_started' ? 'not_started' : 'outcome_unknown', 'TIMEOUT')); }, timeoutMs);
                });
                const work = Promise.resolve().then(() => system.generateApproved(t.avatar, { mode: t.mode, signal: controller.signal,
                    validate: () => current(t, target), saveChatConfirmed, changed: () => {
                        if (jsonKey(getTarget()) === jsonKey(t.target) && getContext().chatMetadata === t.metadata) changed?.();
                    }, onPhase: value => { phase = value; if (value === 'save') t.writeStarted = true; } })).then(value => {
                    const output = { ...report(value.status, 'COMPLETED'), ...value, outputUntrusted: true, outputFormatChecked: true };
                    if (new TextEncoder().encode(JSON.stringify(value.entries)).length > 6000) { output.entries = []; output.outputOmitted = true; }
                    return output;
                }, error => report(phase === 'not_started' ? 'not_started' : 'outcome_unknown',
                    ['CANCELLED', 'MEMORY_BUSY', 'STALE_MEMORY_GENERATION', 'INVALID_MEMORY_OUTPUT', 'MEMORY_OUTPUT_TOO_LARGE'].includes(error.code) ? error.code : 'EXECUTION_ERROR'));
                t.result = await Promise.race([work, stopped]);
                return copyJson(t.result);
            } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
        },
        forgetExecutions(taskId) { for (const [id, t] of tickets) if (t.taskId === taskId) { t.retired = true; t.controller?.abort(); tickets.delete(id); } },
        clearExecutions() { for (const t of tickets.values()) { t.retired = true; t.controller?.abort(); } tickets.clear(); targets.clear(); },
    };
}
