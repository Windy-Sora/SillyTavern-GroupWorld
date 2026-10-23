import { validateJson } from '../core/json-contract.js';
import { requiredSources } from './capabilities.js';
import { permissionSource } from '../permissions/contract.js';

const note = 'Host observation only: not a permission grant, read-success proof or write approval.';
const schema = { type: 'object', properties: {
    type: { type: 'string', enum: ['read_authorization'] }, note: { type: 'string', enum: [note] },
    sources: { type: 'array', maxItems: 8, items: { type: 'object', properties: {
        source: { type: 'string', maxLength: 64 }, status: { type: 'string', enum: ['granted_now', 'reused', 'denied'] },
        grantScope: { type: 'string', enum: ['task', 'chat', 'connection', 'existing', 'none'] },
    }, required: ['source', 'status', 'grantScope'], additionalProperties: false } },
}, required: ['type', 'note', 'sources'], additionalProperties: false };

/** Connection-local observation after policy checks. Cannot grant or execute anything. */
export function createReadObservation({ permissions, target, taskId, decisions, registry }) {
    return {
        validate: value => validateJson(schema, value),
        observe(call) {
            if (registry.get(call.toolId)?.effect !== 'read') return null;
            const sources = [];
            for (const source of requiredSources(call.toolId, call.args) || []) {
                if ((source.startsWith('source:providerExecution') || source.startsWith('source:scriptExecution') || source.startsWith('source:agentExecution') || source.startsWith('source:generationBatchExecution') || source.startsWith('source:npcExecution') || source.startsWith('source:profileExecution') || source.startsWith('source:memoryExecution'))) continue;
                const id = source.slice(7), spec = permissionSource(id);
                if (!spec) continue;
                if (permissions.denied(source, target, taskId)) sources.push({ source: id, status: 'denied', grantScope: 'none' });
                else if (permissions.allows(source, target, taskId)) {
                    const decision = decisions.get(source);
                    sources.push({ source: id, status: decision ? 'granted_now' : 'reused',
                        grantScope: decision === 'task' ? 'task' : decision === 'chat' ? spec.scope === 'global' ? 'connection' : 'chat' : 'existing' });
                    decisions.delete(source);
                }
            }
            return sources.length ? { type: 'read_authorization', note, sources } : null;
        },
    };
}
