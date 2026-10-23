import { createToolRegistry } from '../tools/registry.js';

/** Finalize model-visible definitions and executable handlers together. */
export function createToolPlan(modules, { capabilityFor, labels }) {
    const registry = createToolRegistry(), handlers = Object.create(null), owners = new Map(), moduleIds = new Set();
    if (!Array.isArray(modules) || typeof capabilityFor !== 'function' || !labels) throw new TypeError('INVALID_TOOL_PLAN');
    for (const entry of modules) {
        if (!entry || typeof entry.id !== 'string' || !entry.id || moduleIds.has(entry.id) || !entry.module?.registry || !entry.module?.handlers) throw Error('INVALID_TOOL_MODULE');
        moduleIds.add(entry.id);
        const definitions = entry.module.registry.list(), ids = new Set(definitions.map(d => d.id));
        if (Object.keys(entry.module.handlers).length !== ids.size || Object.keys(entry.module.handlers).some(id => !ids.has(id))) throw Error('TOOL_HANDLER_MISMATCH');
        for (const definition of definitions) {
            if (typeof entry.module.handlers[definition.id] !== 'function') throw Error('TOOL_HANDLER_MISMATCH');
            const capability = capabilityFor(definition.id);
            if (!capability || capability.effect !== definition.effect || typeof capability.sources !== 'function') throw Error('TOOL_CAPABILITY_MISMATCH');
            const label = labels[definition.id];
            if (!Array.isArray(label) || label.length !== 2 || label.some(value => typeof value !== 'string' || !value.trim())) throw Error('TOOL_LABEL_MISSING');
            registry.register(definition);
            handlers[definition.id] = entry.module.handlers[definition.id];
            owners.set(definition.id, entry.id);
        }
    }
    if (Object.keys(labels).some(id => !owners.has(id))) throw Error('TOOL_LABEL_ORPHAN');
    registry.seal();
    return Object.freeze({ registry, handlers: Object.freeze(handlers), ownerOf: id => owners.get(id) || null });
}
