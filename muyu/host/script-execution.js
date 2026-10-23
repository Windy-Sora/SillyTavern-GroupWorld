import { randomUUID } from '../runtime/crypto.js';
import { copyJson, jsonKey } from '../core/json-contract.js';

/** Host-owned execution tickets. Never persisted or reconstructed from history. */
export function createScriptExecutionPort({ getTarget, getContext, getSettings, system, existing }) {
    const tickets = new Map();
    function current(ticket, target) {
        if (!ticket || target?.kind !== 'chat' || jsonKey(target) !== jsonKey(ticket.target) || jsonKey(getTarget?.()) !== jsonKey(target)) throw Error('STALE_SCRIPT_EXECUTION');
        const context = getContext();
        if (getSettings() !== ticket.settings || context.chat !== ticket.chat ||
            ticket.messageIndex !== undefined && (context.chat[ticket.messageIndex] !== ticket.message || JSON.stringify(ticket.message) !== ticket.messageJson)) throw Error('STALE_SCRIPT_EXECUTION');
        existing(ticket.id, ticket.revision);
        return context;
    }
    const describe = ticket => ({ executionId: ticket.executionId, id: ticket.id, revision: ticket.revision, name: ticket.definition.name,
        stage: ticket.stage, ...(ticket.messageIndex === undefined ? {} : { messageIndex: ticket.messageIndex }), enabled: ticket.definition.enabled,
        renderParams: ticket.definition.renderParams, scope: 'real_st_page', automaticPipelineMergePerformed: false, oneShot: true });
    return {
        prepareExecution(args, { target, taskId }) {
            if (!taskId || target?.kind !== 'chat' || jsonKey(target) !== jsonKey(getTarget?.()) || !system?.executeOne) throw Error('TARGET_UNAVAILABLE');
            const row = existing(args.id, args.revision), context = getContext();
            if (!['message', 'round', 'decision'].includes(args.stage) || !Array.isArray(context.chat) ||
                !(row.triggerOn === args.stage || row.triggerOn === 'all' || row.triggerOn === 'both' && args.stage !== 'decision')) throw Error('INVALID_EXECUTION_STAGE');
            if (args.stage === 'message' ? !Number.isSafeInteger(args.messageIndex) || args.messageIndex < 0 || !context.chat[args.messageIndex] : args.messageIndex !== undefined) throw Error('INVALID_EXECUTION_MESSAGE');
            // A task cannot mint a second ticket to replay the same invocation.
            for (const ticket of tickets.values()) if (ticket.taskId === taskId && ticket.id === args.id && ticket.revision === args.revision && ticket.stage === args.stage && ticket.messageIndex === args.messageIndex) {
                current(ticket, target); return describe(ticket);
            }
            if (tickets.size >= 256) throw Error('SCRIPT_EXECUTION_CAPACITY');
            const definition = copyJson(row);
            if (JSON.stringify(definition).length > 32000) throw Error('SCRIPT_ASSET_UNSUPPORTED');
            const ticket = { ...args, executionId: randomUUID(), definition, target: copyJson(target), taskId,
                settings: getSettings(), chat: context.chat, message: args.stage === 'message' ? context.chat[args.messageIndex] : null };
            ticket.messageJson = JSON.stringify(ticket.message);
            tickets.set(ticket.executionId, ticket); return describe(ticket);
        },
        describeExecution(id, target) {
            try { const ticket = tickets.get(id); current(ticket, target); return { ...describe(ticket), definition: copyJson(ticket.definition) }; } catch { return null; }
        },
        async execute(id, { target, taskId, signal }) {
            const ticket = tickets.get(id); current(ticket, target);
            if (ticket.taskId !== taskId) throw Error('STALE_SCRIPT_EXECUTION');
            if (ticket.result) return copyJson(ticket.result);
            if (ticket.pending) return { ...describe(ticket), status: 'outcome_unknown', code: 'ALREADY_STARTED', persistence: 'unknown' };
            if (signal?.aborted) return { ...describe(ticket), status: 'not_started', code: 'CANCELLED', persistence: 'unknown' };
            const context = current(ticket, target);
            ticket.pending = true;
            try {
                const result = await system.executeOne({ definition: ticket.definition, stage: ticket.stage, signal,
                    validate: () => current(ticket, target), event: { chat: context.chat, characters: context.characters,
                        group: context.groups?.find(row => String(row.id) === String(context.groupId)) || null,
                        settings: ticket.settings, getContext,
                        ...(ticket.stage === 'message' ? { message: ticket.message, character: context.characters?.find(row => row.name === ticket.message.name) || null } : {}) } });
                ticket.result = { ...describe(ticket), ...result };
            } catch { ticket.result = { ...describe(ticket), status: 'outcome_unknown', code: 'EXECUTION_ERROR', persistence: 'unknown' }; }
            return copyJson(ticket.result);
        },
        forgetExecutions(taskId) { for (const [id, ticket] of tickets) if (ticket.taskId === taskId) tickets.delete(id); },
        clearExecutions() { tickets.clear(); },
    };
}
