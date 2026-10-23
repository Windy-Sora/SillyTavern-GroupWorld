// The memory store only persists event and mood. Accept a deliberately bounded
// JSON Schema subset for that shape; do not claim arbitrary schema support.
const fail = () => { throw new TypeError('INVALID_MEMORY_JSON_SCHEMA'); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function keysWithin(value, allowed) {
    if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) fail();
}

function checkStringRule(rule) {
    keysWithin(rule, ['type', 'description', 'enum', 'minLength', 'maxLength']);
    if (rule.type !== 'string' || rule.description !== undefined && typeof rule.description !== 'string') fail();
    if (rule.enum !== undefined && (!Array.isArray(rule.enum) || !rule.enum.length || rule.enum.some(value => typeof value !== 'string') || new Set(rule.enum).size !== rule.enum.length)) fail();
    for (const key of ['minLength', 'maxLength']) if (rule[key] !== undefined && (!Number.isInteger(rule[key]) || rule[key] < 0 || rule[key] > 32768)) fail();
    if (rule.minLength !== undefined && rule.maxLength !== undefined && rule.minLength > rule.maxLength) fail();
}

function checkObjectRule(rule, requiredProperty, allowedProperties) {
    keysWithin(rule, ['type', 'description', 'properties', 'required', 'additionalProperties']);
    if (rule.type !== 'object' || rule.description !== undefined && typeof rule.description !== 'string' ||
        rule.additionalProperties !== undefined && typeof rule.additionalProperties !== 'boolean') fail();
    if (!object(rule.properties) || !Object.hasOwn(rule.properties, requiredProperty) ||
        Object.keys(rule.properties).some(key => !allowedProperties.includes(key))) fail();
    if (!Array.isArray(rule.required) || !rule.required.includes(requiredProperty) ||
        new Set(rule.required).size !== rule.required.length ||
        rule.required.some(key => !Object.hasOwn(rule.properties, key))) fail();
}

export function inspectMemorySchema(text) {
    if (text === '') return null;
    if (typeof text !== 'string' || text.length > 12000) fail();
    let root;
    try { root = JSON.parse(text); } catch { fail(); }
    checkObjectRule(root, 'memories', ['memories']);
    const list = root.properties.memories;
    keysWithin(list, ['type', 'description', 'items', 'minItems', 'maxItems']);
    if (list.type !== 'array' || list.description !== undefined && typeof list.description !== 'string') fail();
    for (const key of ['minItems', 'maxItems']) if (list[key] !== undefined && (!Number.isInteger(list[key]) || list[key] < 0 || list[key] > 1024)) fail();
    if (list.minItems !== undefined && list.maxItems !== undefined && list.minItems > list.maxItems) fail();
    const item = list.items;
    checkObjectRule(item, 'event', ['event', 'mood']);
    checkStringRule(item.properties.event);
    if (item.properties.mood !== undefined) checkStringRule(item.properties.mood);
    return root;
}

function matchesString(value, rule) {
    return typeof value === 'string' &&
        (rule.enum === undefined || rule.enum.includes(value)) &&
        (rule.minLength === undefined || value.length >= rule.minLength) &&
        (rule.maxLength === undefined || value.length <= rule.maxLength);
}

export function validateMemoryResponse(schema, value) {
    if (!schema) return;
    const list = value?.memories;
    const arrayRule = schema.properties.memories;
    const itemRule = arrayRule.items;
    const valid = object(value) && Array.isArray(list) &&
        (schema.additionalProperties !== false || Object.keys(value).every(key => key === 'memories')) &&
        (arrayRule.minItems === undefined || list.length >= arrayRule.minItems) &&
        (arrayRule.maxItems === undefined || list.length <= arrayRule.maxItems) &&
        list.every(item => object(item) &&
            itemRule.required.every(key => Object.hasOwn(item, key)) &&
            (itemRule.additionalProperties !== false || Object.keys(item).every(key => ['event', 'mood'].includes(key))) &&
            matchesString(item.event, itemRule.properties.event) &&
            (item.mood === undefined || itemRule.properties.mood !== undefined && matchesString(item.mood, itemRule.properties.mood) ||
                itemRule.properties.mood === undefined && itemRule.additionalProperties !== false && typeof item.mood === 'string'));
    if (!valid) throw new TypeError('MEMORY_SCHEMA_RESPONSE_MISMATCH');
}
