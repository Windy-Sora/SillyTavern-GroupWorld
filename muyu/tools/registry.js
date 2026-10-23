import { copyJson, checkSchema } from '../core/json-contract.js';

function freeze(value) {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
}

/** Built-in tool definitions only. This registry is NOT an execution or permission API. */
export function createToolRegistry() {
    const entries = new Map();
    let sealed = false;
    return Object.freeze({
        register(definition) {
            if (sealed) throw new Error('Registry sealed');
            const d = copyJson(definition);
            const fields = ['id', 'version', 'description', 'inputSchema', 'outputSchema', 'scope', 'effect', 'dataClasses', 'confirmation', 'timeoutMs', 'retryPolicy', 'resourceKeys'];
            if (Object.keys(d).some(k => !fields.includes(k)) || fields.some(k => !Object.hasOwn(d, k))) throw new TypeError('Invalid tool definition fields');
            if (typeof d.id !== 'string' || !/^muyu\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(d.id) || !Number.isInteger(d.version) || d.version < 1) throw new TypeError('Invalid tool identity');
            if (typeof d.description !== 'string' || !d.description.trim()) throw new TypeError('Missing description');
            if (!['global', 'chat'].includes(d.scope) || !['read', 'workspace', 'navigate', 'write', 'external'].includes(d.effect)) throw new TypeError('Invalid scope/effect');
            if (d.confirmation !== 'policy') throw new TypeError('Policy must own confirmation');
            if (!Number.isInteger(d.timeoutMs) || d.timeoutMs < 1 || d.timeoutMs > (['muyu.agents.execute', 'muyu.memory_generation.execute', 'muyu.profile_generation.execute', 'muyu.npc_generation.execute', 'muyu.generation_batch.execute'].includes(d.id) && d.effect === 'external' ? 300000 : 15000)) throw new TypeError('Invalid tool timeout');
            for (const key of ['dataClasses', 'resourceKeys']) if (!Array.isArray(d[key]) || d[key].some(v => typeof v !== 'string' || !v.trim()) || new Set(d[key]).size !== d[key].length) throw new TypeError('Invalid tool tags');
            if (!d.retryPolicy || Object.keys(d.retryPolicy).sort().join(',') !== 'kind,maxAttempts' || !['none', 'read'].includes(d.retryPolicy.kind) || !Number.isInteger(d.retryPolicy.maxAttempts) || d.retryPolicy.maxAttempts < 1 || d.retryPolicy.maxAttempts > 2) throw new TypeError('Invalid retry policy');
            if ((d.retryPolicy.kind === 'read' && d.effect !== 'read') || (d.retryPolicy.kind === 'none' && d.retryPolicy.maxAttempts !== 1)) throw new TypeError('Unsafe retry policy');
            checkSchema(d.inputSchema); checkSchema(d.outputSchema);
            if (d.inputSchema.type !== 'object') throw new TypeError('Tool inputs must be objects');
            if (entries.has(d.id)) throw new Error('Duplicate tool ID');
            entries.set(d.id, freeze(d));
        },
        seal() { sealed = true; },
        get(id) { return entries.get(id) || null; },
        list() { return [...entries.values()]; },
    });
}
