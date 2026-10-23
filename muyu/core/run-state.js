import { copyJson, jsonKey } from './json-contract.js';

const terminal = new Set(['succeeded', 'failed', 'cancelled', 'interrupted', 'yielded']);
const transitions = {
    queued: ['running', 'cancelled', 'interrupted'],
    running: ['awaiting_input', 'awaiting_approval', 'yielded', 'succeeded', 'failed', 'cancelling', 'interrupted'],
    awaiting_input: ['running', 'cancelling', 'interrupted'],
    awaiting_approval: ['running', 'cancelling', 'interrupted'],
    cancelling: ['cancelled', 'failed', 'interrupted'],
};

/** Create an isolated queued run. IDs and target come from the application, never the model. */
export function createRunState({ id, sessionId, taskId, target }) {
    for (const value of [id, sessionId, taskId]) if (typeof value !== 'string' || !value.trim()) throw new TypeError('Missing run identity');
    const t = copyJson(target);
    if (!t || !['global', 'chat'].includes(t.kind) || typeof t.userKey !== 'string' || !t.userKey || Object.keys(t).some(k => !['kind', 'userKey', 'chatKey'].includes(k))) throw new TypeError('Invalid target');
    if (t.kind === 'chat' ? typeof t.chatKey !== 'string' || !t.chatKey : Object.hasOwn(t, 'chatKey')) throw new TypeError('Invalid chat target');
    return { schemaVersion: 1, id, sessionId, taskId, target: t, status: 'queued', seq: 0, lastEvent: null };
}

/** Pure control reducer. Trusted application commands only; not a model-event consumer. */
export function transitionRun(state, event) {
    const e = copyJson(event);
    if (!e || typeof e.eventId !== 'string' || !e.eventId || e.runId !== state.id || !Number.isInteger(e.seq) || !transitions[state.status] && !terminal.has(state.status)) throw new TypeError('Invalid control event');
    if (Object.keys(e).some(k => !['eventId', 'runId', 'seq', 'status'].includes(k))) throw new TypeError('Unknown control field');
    // Duplicate delivery is harmless only when the exact most recent event matches.
    if (e.seq === state.seq && state.lastEvent && jsonKey(e) === jsonKey(state.lastEvent)) return copyJson(state);
    if (terminal.has(state.status)) throw new Error('Run is terminal');
    if (e.seq !== state.seq + 1) throw new Error('Out-of-order control event');
    if (state.lastEvent?.eventId === e.eventId) throw new Error('Reused control event ID');
    if (!transitions[state.status].includes(e.status)) throw new Error('Invalid run transition');
    return { ...copyJson(state), status: e.status, seq: e.seq, lastEvent: e };
}

/** Future stores may use this projection, but never resume execution or approval automatically. */
export function interruptRestoredRun(snapshot) {
    const stored = copyJson(snapshot);
    if (stored.schemaVersion !== 1 || ![...Object.keys(transitions), ...terminal].includes(stored.status) || !Number.isInteger(stored.seq) || stored.seq < 0) throw new TypeError('Unsupported run snapshot');
    createRunState(stored); // Validate target and identities without trusting the stored object.
    return { ...stored, status: terminal.has(stored.status) ? stored.status : 'interrupted', lastEvent: null };
}
