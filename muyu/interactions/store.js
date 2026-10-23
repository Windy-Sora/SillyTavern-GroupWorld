import { randomUUID } from '../runtime/crypto.js';
import { validateQuestion, validateAnswer } from './contract.js';
import { validatePermission, permissionFields } from '../permissions/contract.js';

/** In-memory requests only; imported history can never restore executable interactions. */
export function createInteractionStore() {
    const requests = new Map();
    const pending = id => { const r = requests.get(id); if (!r || r.status !== 'pending') throw Error('INTERACTION_STALE'); return r; };
    return {
        create(identity, question) {
            if ([...requests.values()].some(r => r.sessionId === identity.sessionId && r.status === 'pending')) throw Error('INTERACTION_PENDING');
            const permission = question?.kind === 'permission';
            const q = permission ? validatePermission(permissionFields(question)) : validateQuestion(question), id = 'request:' + randomUUID();
            const r = { ...structuredClone(identity), id, kind: permission ? 'permission' : 'clarification', ...q,
                ...(permission ? { hostManaged: question.hostManaged === true } : {}), status: 'pending', draft: '', createdAt: Date.now() };
            requests.set(id, r); return structuredClone(r);
        },
        get: id => structuredClone(pending(id)),
        list: () => structuredClone([...requests.values()]),
        draft(id, value) { const r = pending(id); if (r.kind !== 'clarification') throw Error('INTERACTION_STALE'); r.draft = validateAnswer(value, true); },
        resolve(id, status) { const r = pending(id); r.status = status; r.draft = ''; },
        invalidate(predicate) { for (const r of requests.values()) if (r.status === 'pending' && predicate(r)) { r.status = 'expired'; r.draft = ''; } },
        forget(sessionId) { for (const [id, r] of requests) if (r.sessionId === sessionId) requests.delete(id); },
        clear() { requests.clear(); },
    };
}
