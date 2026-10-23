/** Bounded JSON DTOs and a deliberately small, fail-closed schema dialect. */
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const types = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
const keywords = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'minimum', 'maximum', 'maxLength', 'maxItems', 'description', 'oneOf']);

/** Copy data without invoking accessors or accepting non-JSON values. */
export function copyJson(value) {
    const ancestors = new Set();
    let nodes = 0;
    function visit(input, depth) {
        if (++nodes > 4096 || depth > 16) throw new TypeError('JSON complexity limit');
        if (input === null || typeof input === 'boolean') return input;
        if (typeof input === 'string') {
            if (input.length > 32768) throw new TypeError('JSON string limit');
            return input;
        }
        if (typeof input === 'number' && Number.isFinite(input)) return input;
        if (typeof input !== 'object') throw new TypeError('Expected JSON value');
        if (ancestors.has(input)) throw new TypeError('Cyclic JSON');
        const array = Array.isArray(input);
        if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new TypeError('Expected plain JSON object');
        const own = Reflect.ownKeys(input);
        if (own.some(k => typeof k !== 'string')) throw new TypeError('Symbol keys are not JSON');
        if (array && (input.length > 1024 || own.length !== input.length + 1)) throw new TypeError('Expected bounded dense array');
        ancestors.add(input);
        const out = array ? [] : {};
        for (const key of own) {
            if (array && key === 'length') continue;
            if (forbidden.has(key)) throw new TypeError('Forbidden JSON key');
            if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= input.length)) throw new TypeError('Invalid array key');
            const descriptor = Object.getOwnPropertyDescriptor(input, key);
            if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Accessors/non-enumerable values are not JSON');
            out[key] = visit(descriptor.value, depth + 1);
        }
        ancestors.delete(input);
        return out;
    }
    const result = visit(value, 0);
    if (new TextEncoder().encode(JSON.stringify(result)).length > 32768) throw new TypeError('JSON byte limit');
    return result;
}

function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
    return value;
}

/** Stable identity for bounded DTOs, independent of object key insertion order. */
export function jsonKey(value) { return JSON.stringify(canonical(copyJson(value))); }

/** Validate schema definitions before registration; unsupported keywords fail. */
export function checkSchema(schema) {
    const root = copyJson(schema);
    function check(s) {
        if (!s || typeof s !== 'object' || Array.isArray(s) || !types.has(s.type)) throw new TypeError('Schema requires one supported type');
        for (const k of Object.keys(s)) if (!keywords.has(k)) throw new TypeError('Unsupported schema keyword: ' + k);
        if (s.oneOf !== undefined) {
            if (!Array.isArray(s.oneOf) || s.oneOf.length < 2 || s.oneOf.length > 8) throw new TypeError('Invalid schema alternatives');
            s.oneOf.forEach(check);
        }
        if (s.description !== undefined && typeof s.description !== 'string') throw new TypeError('Invalid description');
        if (s.enum !== undefined && (!Array.isArray(s.enum) || !s.enum.length)) throw new TypeError('Invalid enum');
        for (const k of ['minimum', 'maximum']) if (s[k] !== undefined && (!['number', 'integer'].includes(s.type) || typeof s[k] !== 'number')) throw new TypeError('Invalid numeric bound');
        if (s.minimum !== undefined && s.maximum !== undefined && s.minimum > s.maximum) throw new TypeError('Inverted bounds');
        for (const [k, type] of [['maxLength', 'string'], ['maxItems', 'array']]) if (s[k] !== undefined && (s.type !== type || !Number.isInteger(s[k]) || s[k] < 0)) throw new TypeError('Invalid size bound');
        if (s.type === 'object') {
            if (s.additionalProperties !== false || !s.properties || typeof s.properties !== 'object' || Array.isArray(s.properties)) throw new TypeError('Objects require closed properties');
            if (s.required !== undefined && (!Array.isArray(s.required) || s.required.some(k => typeof k !== 'string' || !Object.hasOwn(s.properties, k)))) throw new TypeError('Invalid required fields');
            for (const child of Object.values(s.properties)) check(child);
        } else if (['properties', 'required', 'additionalProperties'].some(k => Object.hasOwn(s, k))) throw new TypeError('Object keyword on other type');
        if (s.type === 'array') check(s.items);
        else if (Object.hasOwn(s, 'items')) throw new TypeError('Array keyword on other type');
    }
    check(root);
    return root;
}

/** Validate and return an isolated JSON value; throws before consumers see it. */
export function validateJson(schema, value) {
    const s = checkSchema(schema), data = copyJson(value);
    function check(rule, v) {
        const actual = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
        if (rule.type === 'integer' ? !Number.isInteger(v) : actual !== rule.type) throw new TypeError('JSON type mismatch');
        if (rule.enum && !rule.enum.some(x => jsonKey(x) === jsonKey(v))) throw new TypeError('JSON enum mismatch');
        if (typeof v === 'number' && ((rule.minimum !== undefined && v < rule.minimum) || (rule.maximum !== undefined && v > rule.maximum))) throw new TypeError('JSON number out of bounds');
        if (typeof v === 'string' && rule.maxLength !== undefined && v.length > rule.maxLength) throw new TypeError('JSON string too long');
        if (rule.type === 'array') {
            if (rule.maxItems !== undefined && v.length > rule.maxItems) throw new TypeError('JSON array too long');
            v.forEach(item => check(rule.items, item));
        }
        if (rule.type === 'object') {
            if ((rule.required || []).some(k => !Object.hasOwn(v, k))) throw new TypeError('Missing JSON field');
            for (const [k, item] of Object.entries(v)) {
                if (!Object.hasOwn(rule.properties, k)) throw new TypeError('Unknown JSON field');
                check(rule.properties[k], item);
            }
        }
        if (rule.oneOf) {
            let matched = 0;
            for (const alternative of rule.oneOf) { try { check(alternative, v); matched++; } catch { /* A non-matching alternative is expected. */ } }
            if (matched !== 1) throw new TypeError('JSON alternative mismatch');
        }
    }
    check(s, data);
    return data;
}
