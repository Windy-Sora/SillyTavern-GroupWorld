import { randomUUID } from '../runtime/crypto.js';
import { copyJson, jsonKey } from '../core/json-contract.js';
import { profileGenerationSettings } from '../../systems/profile-generation.js';

/** Private, one-shot profile business-model tickets; no permission grants or history restoration here. */
export function createProfileGenerationPort({ getTarget, getSettings, getContext, getCharacters, getProviders,
    system, saveChatConfirmed, changed, isBusy = () => false, timeoutMs = 290000 }) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 290000) throw Error('INVALID_GENERATION_TIMEOUT');
    const tickets = new Map(), targets = new Map();
    const descriptor = t => ({ executionId: t.executionId, character: t.selector, name: t.name, mode: t.mode,
        oneShot: true, existing: t.exists, schema: 'standard_fields',
        destination: t.custom ? 'Configured profile business-model connection (not necessarily Muyu)' : 'SillyTavern current native connection; destination managed by ST',
        notice: 'Real Prompt/Provider rendering is not a sandbox and may read data, execute code or use the network. One additional business-model attempt, no automatic retries. Attempts/output are not billing receipts. No business attempt does not mean no Muyu assistant calls. Trial does not save. Save only creates a missing current-chat profile, never overwrites an existing record or changes shared schema/archive metadata. Results sent to Muyu are untrusted historical output, not proven facts.' });
    function targetMatches(target) {
        if (target?.kind !== 'chat' || jsonKey(getTarget()) !== jsonKey(target)) throw Error('TARGET_UNAVAILABLE');
    }
    function current(t, target) {
        targetMatches(target);
        if (!t || t.retired || jsonKey(t.target) !== jsonKey(target)) throw Error('STALE_PROFILE_GENERATION');
        if (isBusy()) throw Error('PROFILE_BUSY');
        const ctx = getContext(), settings = getSettings(), providers = getProviders(), live = system.inspectGeneration(t.avatar);
        if (settings !== t.settings || JSON.stringify(profileGenerationSettings(settings)) !== t.settingsKey ||
            ctx.chat !== t.chat || ctx.chatMetadata !== t.metadata || live.chat !== t.chat || live.metadata !== t.metadata || ctx.mainApi !== t.mainApi ||
            getCharacters()[t.index] !== t.character || live.character !== t.character || live.character.name !== t.name ||
            providers.length !== t.providers.length || providers.some((p, i) => p !== t.providers[i] || p.render !== t.renders[i]) ||
            !t.writeStarted && (live.fingerprint !== t.baseline || live.root !== t.root || live.store !== t.store || live.archive !== t.archive || live.entry !== t.entry)) throw Error('STALE_PROFILE_GENERATION');
        return live;
    }
    return {
        listTargets(target, offset = 0) {
            targetMatches(target);
            if (!Number.isInteger(offset) || offset < 0 || offset > 512) throw Error('INVALID_PROFILE_SELECTOR');
            const characters = getCharacters();
            if (!Array.isArray(characters) || characters.length > 512) throw Error('PROFILE_CHARACTER_UNAVAILABLE');
            const items = characters.slice(offset, offset + 16).map((character, i) => {
                const selector = 'profile-character:' + (offset + i), live = system.inspectGeneration(character.avatar, { fingerprint: false });
                const key = jsonKey({ target, selector }), shape = JSON.stringify({ name: character.name, exists: live.exists, schemaHash: live.schemaHash,
                    enabled: getSettings().profileEnabled }), old = targets.get(key);
                if (!old || old.character !== character || old.root !== live.root || old.store !== live.store || old.entry !== live.entry || old.shape !== shape) {
                    targets.set(key, { character, root: live.root, store: live.store, entry: live.entry, shape, revision: randomUUID() });
                    if (targets.size > 512) targets.delete(targets.keys().next().value);
                }
                return { character: selector, name: character.name, existing: live.exists, saveAvailable: !live.exists && live.count < 512 && !!getSettings().profileEnabled,
                    revision: targets.get(key).revision };
            });
            return { items, nextOffset: offset + items.length < characters.length ? offset + items.length : null };
        },
        prepareExecution({ character: selector, revision, mode }, { target, taskId }) {
            targetMatches(target);
            if (typeof taskId !== 'string' || !taskId || taskId.length > 128 || typeof selector !== 'string' || !/^profile-character:(0|[1-9]\d*)$/.test(selector) || !['trial', 'save'].includes(mode)) throw Error('INVALID_PROFILE_GENERATION');
            if (system.isGenerating() || isBusy()) throw Error('PROFILE_BUSY');
            const known = targets.get(jsonKey({ target, selector }));
            if (!known || known.revision !== revision) throw Error('STALE_PROFILE_GENERATION');
            const index = Number(selector.slice(18)), chosen = getCharacters()[index];
            if (!chosen || chosen !== known.character) throw Error('STALE_PROFILE_GENERATION');
            const live = system.inspectGeneration(chosen.avatar), ctx = getContext(), settings = getSettings(), providers = getProviders();
            if (live.root !== known.root || live.store !== known.store || live.entry !== known.entry ||
                known.shape !== JSON.stringify({ name: chosen.name, exists: live.exists, schemaHash: live.schemaHash, enabled: settings.profileEnabled })) throw Error('STALE_PROFILE_GENERATION');
            if (!settings.profileEnabled) throw Error('PROFILE_DISABLED');
            if (mode === 'save' && live.exists) throw Error('PROFILE_ALREADY_EXISTS');
            if (mode === 'save' && (live.count >= 512 || typeof saveChatConfirmed !== 'function')) throw Error(live.count >= 512 ? 'PROFILE_CAPACITY_EXCEEDED' : 'WRITE_UNAVAILABLE');
            const prior = [...tickets.values()].find(t => t.taskId === taskId && t.avatar === chosen.avatar && !t.retired);
            if (prior) {
                if (prior.mode !== mode) throw Error('PROFILE_CALL_ALREADY_PREPARED');
                current(prior, target); return descriptor(prior);
            }
            if (tickets.size >= 128) throw Error('EXECUTION_CAPACITY_EXCEEDED');
            const t = { executionId: randomUUID(), selector, index, avatar: chosen.avatar, name: chosen.name, character: chosen,
                mode, exists: live.exists, custom: !!settings.agentConfigs?.profile?.useCustom, taskId, target: copyJson(target),
                settings, settingsKey: JSON.stringify(profileGenerationSettings(settings)), metadata: ctx.chatMetadata, chat: ctx.chat, mainApi: ctx.mainApi,
                root: live.root, store: live.store, archive: live.archive, entry: live.entry, baseline: live.fingerprint,
                providers: [...providers], renders: providers.map(p => p.render) };
            current(t, target); tickets.set(t.executionId, t); return descriptor(t);
        },
        describeExecution(id, target) { try { const t = tickets.get(id); current(t, target); return descriptor(t); } catch { return null; } },
        async execute(id, { target, taskId, signal }) {
            const t = tickets.get(id); targetMatches(target);
            if (!t || t.retired || t.taskId !== taskId || jsonKey(t.target) !== jsonKey(target)) throw Error('STALE_PROFILE_GENERATION');
            if (t.result) return copyJson(t.result);
            if (t.started) return { ...descriptor(t), status: 'outcome_unknown', code: 'ALREADY_STARTED', chatSave: 'unknown' };
            current(t, target);
            let phase = 'not_started', timer, abort;
            const controller = new AbortController(); t.controller = controller;
            const report = (status, code) => ({ ...descriptor(t), status, code, chatSave: phase === 'save' ? 'unknown' : 'not_started',
                historicalExecutionOnly: true, modelCallAttempted: ['generate', 'save'].includes(phase), resultWriteStarted: phase === 'save',
                notice: descriptor(t).notice + ' Cancellation cannot guarantee stopping Provider side effects, native billing or an in-flight save. Unknown results are never retried.' });
            if (signal?.aborted) return report('not_started', 'CANCELLED');
            t.started = true;
            try {
                const stopped = new Promise(resolve => {
                    abort = () => { controller.abort(); resolve(report(phase === 'not_started' ? 'not_started' : 'outcome_unknown', 'CANCELLED')); };
                    signal?.addEventListener('abort', abort, { once: true });
                    timer = setTimeout(() => { controller.abort(); resolve(report(phase === 'not_started' ? 'not_started' : 'outcome_unknown', 'TIMEOUT')); }, timeoutMs);
                });
                const work = Promise.resolve().then(() => system.generateApproved(t.avatar, { mode: t.mode, signal: controller.signal,
                    validate: () => current(t, target), saveChatConfirmed,
                    changed: () => { if (jsonKey(getTarget()) === jsonKey(t.target) && getContext().chatMetadata === t.metadata) changed?.(); },
                    onPhase: value => { phase = value; if (value === 'save') t.writeStarted = true; } })).then(value => {
                    const output = { ...report(value.status, 'COMPLETED'), ...value, outputUntrusted: true };
                    if (new TextEncoder().encode(JSON.stringify(value.profile)).length > 6000) { delete output.profile; output.outputOmitted = true; }
                    return output;
                }, error => {
                    const code = error?.code ?? error?.message;
                    return report(phase === 'not_started' ? 'not_started' : 'outcome_unknown',
                        ['CANCELLED', 'PROFILE_BUSY', 'PROFILE_DISABLED', 'STALE_PROFILE_GENERATION', 'INVALID_PROFILE_OUTPUT', 'PROFILE_CAPACITY_EXCEEDED', 'PROFILE_SCHEMA_STALE', 'UNSUPPORTED_PROFILE_SCHEMA'].includes(code) ? code : 'EXECUTION_ERROR');
                });
                t.result = await Promise.race([work, stopped]); return copyJson(t.result);
            } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
        },
        forgetExecutions(taskId) { for (const [id, t] of tickets) if (t.taskId === taskId) { t.retired = true; t.controller?.abort(); tickets.delete(id); } },
        clearExecutions() { for (const t of tickets.values()) { t.retired = true; t.controller?.abort(); } tickets.clear(); targets.clear(); },
    };
}
