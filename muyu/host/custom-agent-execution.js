import { randomUUID } from '../runtime/crypto.js';
import { copyJson, jsonKey } from '../core/json-contract.js';
import { agentExecutionEvidence } from '../agents/execution-evidence.js';

/** Exact, page-local generation tickets; never restored from saved conversations. */
export function createCustomAgentExecutionPort({ getTarget, getContext, getSettings, getProviders, system, existing, changed = () => {}, timeoutMs = 290000 }) {
    const tickets = new Map();
    const config = () => JSON.stringify(getSettings()?.agentConfigs?.['custom-agent'] || {});
    const chatKey = chat => {
        const key = JSON.stringify(chat);
        if (typeof key !== 'string' || key.length > 16 * 1024 * 1024) throw Error('AGENT_CONTEXT_TOO_LARGE');
        return key;
    };
    function current(ticket, target) {
        if (!ticket || ticket.retired || target?.kind !== 'chat' || jsonKey(target) !== jsonKey(ticket.target) || jsonKey(getTarget?.()) !== jsonKey(target)) throw Error('STALE_AGENT_EXECUTION');
        const ctx = getContext();
        if (getSettings() !== ticket.settings || config() !== ticket.config || ctx.chat !== ticket.chat || ctx.chatMetadata !== ticket.metadata || ctx.mainApi !== ticket.mainApi || chatKey(ctx.chat) !== ticket.chatKey) throw Error('STALE_AGENT_EXECUTION');
        const providers = getProviders();
        if (providers.length !== ticket.providers.length || providers.some((row, index) => row !== ticket.providers[index] || row.render !== ticket.renders[index])) throw Error('STALE_AGENT_EXECUTION');
        existing(ticket.id, ticket.revision);
        if (!ticket.writeStarted && system.executionBaseline?.(ticket.id) !== ticket.resultBaseline) throw Error('STALE_AGENT_EXECUTION');
        return ctx;
    }
    const describe = t => ({ executionId: t.executionId, id: t.id, revision: t.revision, name: t.definition.name, mode: t.mode,
        enabled: t.definition.enabled, oneShot: true, destination: t.destination, usesRealContext: true,
        notice: 'Prompt rendering may run Providers, read real data and cause side effects. One extra business-model request; output is sent to Muyu. Trial does not write the Agent result but is not a sandbox.' });
    return {
        prepareExecution({ id, revision, mode }, { target, taskId }) {
            if (!taskId || !['trial', 'save'].includes(mode) || target?.kind !== 'chat' || jsonKey(getTarget?.()) !== jsonKey(target) || !system?.executeApproved) throw Error('TARGET_UNAVAILABLE');
            const row = existing(id, revision), ctx = getContext();
            if (!row.prompt?.trim() || !Array.isArray(ctx.chat) || !ctx.chatMetadata) throw Error('INVALID_AGENT_EXECUTION');
            for (const t of tickets.values()) if (t.taskId === taskId && t.id === id && t.revision === revision) {
                // Changing trial/save must not mint a second paid request in the same task.
                if (t.mode !== mode) throw Error('AGENT_EXECUTION_ALREADY_PREPARED');
                current(t, target); return describe(t);
            }
            if (tickets.size >= 128) throw Error('AGENT_EXECUTION_CAPACITY');
            if (row.name.length > 80 || row.prompt.length > 12000 || row.schema.length > 8000) throw Error('AGENT_ASSET_UNSUPPORTED');
            const definition = copyJson(Object.fromEntries(['id', 'name', 'providerName', 'prompt', 'schema', 'enabled', 'autoEnabled', 'autoInterval', 'order'].map(key => [key, row[key]]))), providers = getProviders();
            const custom = getSettings()?.agentConfigs?.['custom-agent']?.useCustom === true;
            const t = { id, revision, mode, taskId, definition, executionId: randomUUID(), target: copyJson(target),
                settings: getSettings(), config: config(), chat: ctx.chat, metadata: ctx.chatMetadata, mainApi: ctx.mainApi, chatKey: chatKey(ctx.chat),
                resultBaseline: system.executionBaseline?.(id),
                providers: [...providers], renders: providers.map(p => p.render),
                destination: custom ? 'Configured Custom Agent model connection (not necessarily the Muyu model)' : 'SillyTavern current native model connection; concrete destination is managed by ST' };
            tickets.set(t.executionId, t); return describe(t);
        },
        describeExecution(id, target) { try { const t = tickets.get(id); current(t, target); return { ...describe(t), definition: copyJson(t.definition) }; } catch { return null; } },
        async execute(id, { target, taskId, signal }) {
            const t = tickets.get(id);
            if (!t || t.retired || t.taskId !== taskId || jsonKey(t.target) !== jsonKey(target) || jsonKey(getTarget?.()) !== jsonKey(target)) throw Error('STALE_AGENT_EXECUTION');
            if (t.result) return copyJson(t.result);
            if (t.pending) return agentExecutionEvidence({ ...describe(t), status: 'outcome_unknown', code: 'ALREADY_STARTED', persistence: 'unknown', text: '' });
            current(t, target);
            const control = new AbortController(); t.control = control;
            let timer, abort, phase = 'not_started';
            const result = (status, code, text = '') => agentExecutionEvidence({ ...describe(t), status, code, text, outputUntrusted: true, schemaValidated: false, historicalExecutionOnly: true,
                modelCallAttempted: ['generate', 'save'].includes(phase), resultWriteStarted: phase === 'save',
                persistence: phase === 'save' ? status === 'saved_unconfirmed' ? 'unconfirmed' : 'unknown' : 'not_started' });
            if (signal?.aborted) return result('not_started', 'CANCELLED');
            t.pending = true;
            try {
                const stopped = new Promise(resolve => {
                    abort = () => { control.abort(); resolve(result(phase === 'not_started' ? 'not_started' : 'outcome_unknown', 'CANCELLED')); };
                    signal?.addEventListener('abort', abort, { once: true });
                    timer = setTimeout(() => { control.abort(); resolve(result(phase === 'not_started' ? 'not_started' : 'outcome_unknown', 'TIMEOUT')); }, timeoutMs);
                });
                const work = Promise.resolve().then(() => system.executeApproved(t.definition, { trial: t.mode === 'trial', signal: control.signal,
                    validate: () => current(t, target), onPhase: value => { phase = value; if (value === 'save') t.writeStarted = true; } })).then(value => {
                    if (control.signal.aborted) return result('outcome_unknown', 'CANCELLED');
                    if (!value) return result('no_result', 'EMPTY_RESPONSE');
                    let text = typeof value.content === 'string' ? value.content : '';
                    const omitted = new TextEncoder().encode(text).length > 6000;
                    if (omitted) text = '';
                    return { ...result(t.mode === 'trial' ? 'trial_completed' : 'saved_unconfirmed', 'COMPLETED', text), outputOmitted: omitted };
                }, () => result(phase === 'not_started' ? 'not_started' : 'outcome_unknown', 'EXECUTION_ERROR'));
                t.result = await Promise.race([work, stopped]);
                try { changed(); } catch { /* Observer cannot change execution result. */ }
                return copyJson(t.result);
            } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
        },
        forgetExecutions(taskId) { for (const [id, t] of tickets) if (t.taskId === taskId) { t.retired = true; t.control?.abort(); tickets.delete(id); } },
        clearExecutions() { for (const t of tickets.values()) { t.retired = true; t.control?.abort(); } tickets.clear(); },
    };
}
