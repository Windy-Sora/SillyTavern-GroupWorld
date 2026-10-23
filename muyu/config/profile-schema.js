import { copyJson } from '../core/json-contract.js';

// This is the bounded subset offered by Muyu, not a claim that every ST backend
// accepts every JSON Schema feature. The classic editor keeps its existing path.
const types = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
const keywords = new Set(['type', 'properties', 'required', 'items', 'description', 'additionalProperties',
    'enum', 'minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems']);

export function inspectProfileSchema(text) {
    if (text === '') return { custom: false };
    let root;
    try { root = copyJson(JSON.parse(text)); }
    catch { throw new TypeError('INVALID_PROFILE_JSON_SCHEMA'); }
    const fail = () => { throw new TypeError('INVALID_PROFILE_JSON_SCHEMA'); };
    const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    function inspect(node) {
        if (!object(node) || !types.has(node.type) || Object.keys(node).some(key => !keywords.has(key))) fail();
        if (node.description !== undefined && typeof node.description !== 'string') fail();
        if (node.enum !== undefined && (!Array.isArray(node.enum) || !node.enum.length)) fail();
        for (const [min, max, type] of [['minimum', 'maximum', 'number'], ['minLength', 'maxLength', 'string'], ['minItems', 'maxItems', 'array']]) {
            const hasBound = node[min] !== undefined || node[max] !== undefined;
            if (!hasBound) continue;
            if (type === 'number' ? !['number', 'integer'].includes(node.type) : node.type !== type) fail();
            for (const key of [min, max]) if (node[key] !== undefined && (typeof node[key] !== 'number' || !Number.isFinite(node[key]) || (type !== 'number' && (!Number.isInteger(node[key]) || node[key] < 0)))) fail();
            if (node[min] !== undefined && node[max] !== undefined && node[min] > node[max]) fail();
        }
        if (node.type === 'object') {
            if (node.properties !== undefined && !object(node.properties)) fail();
            if (node.additionalProperties !== undefined && typeof node.additionalProperties !== 'boolean') fail();
            if (node.required !== undefined && (!Array.isArray(node.required) || new Set(node.required).size !== node.required.length
                || node.required.some(key => typeof key !== 'string' || !Object.hasOwn(node.properties || {}, key)))) fail();
            for (const child of Object.values(node.properties || {})) inspect(child);
        } else if (['properties', 'required', 'additionalProperties'].some(key => Object.hasOwn(node, key))) fail();
        if (node.type === 'array') {
            if (!Object.hasOwn(node, 'items')) fail();
            inspect(node.items);
        } else if (Object.hasOwn(node, 'items')) fail();
    }
    inspect(root);
    if (root.type !== 'object') fail();
    return { custom: true };
}
