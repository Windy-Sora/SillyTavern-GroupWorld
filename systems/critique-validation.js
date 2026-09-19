const EMPTY_CRITIQUE_DATA = Object.freeze({
    directorCritique: Object.freeze({}),
    characterCritiques: Object.freeze({}),
});

export function createEmptyCritiqueData() {
    return {
        directorCritique: {},
        characterCritiques: {},
    };
}

export function isPlainObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function assertJsonValue(value, path, seen) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (Array.isArray(value)) {
        if (seen.has(value)) throw new TypeError(`${path} must not contain circular references`);
        seen.add(value);
        value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`, seen));
        seen.delete(value);
        return;
    }
    if (isPlainObject(value)) {
        if (seen.has(value)) throw new TypeError(`${path} must not contain circular references`);
        seen.add(value);
        for (const [key, item] of Object.entries(value)) {
            assertJsonValue(item, `${path}.${key}`, seen);
        }
        seen.delete(value);
        return;
    }
    throw new TypeError(`${path} must contain JSON-compatible values`);
}

export function normalizeCritiqueData(value, { path = 'critique.data' } = {}) {
    if (!isPlainObject(value)) throw new TypeError(`${path} must be an object`);
    const director = value.directorCritique ?? EMPTY_CRITIQUE_DATA.directorCritique;
    const characters = value.characterCritiques ?? EMPTY_CRITIQUE_DATA.characterCritiques;
    if (!isPlainObject(director)) throw new TypeError(`${path}.directorCritique must be an object`);
    if (!isPlainObject(characters)) throw new TypeError(`${path}.characterCritiques must be an object`);
    for (const [name, critique] of Object.entries(characters)) {
        if (!isPlainObject(critique)) {
            throw new TypeError(`${path}.characterCritiques.${name} must be an object`);
        }
    }
    assertJsonValue(value, path, new Set());
    return structuredClone({
        ...value,
        directorCritique: director,
        characterCritiques: characters,
    });
}

export function validateCritiqueExport(value) {
    if (!isPlainObject(value)) return { ok: false, error: 'Not a valid JSON object' };
    if (value.type !== 'critique-export') {
        return { ok: false, error: 'Not a critique export file (missing "type":"critique-export")' };
    }
    if (!Number.isInteger(value.version) || value.version < 1) {
        return { ok: false, error: `Unsupported version: ${value.version}` };
    }
    if (!isPlainObject(value.critique)) return { ok: false, error: 'Missing or invalid "critique" object' };
    if (typeof value.critique.content !== 'string') return { ok: false, error: 'Missing or invalid "critique.content"' };
    try {
        normalizeCritiqueData(value.critique.data);
    } catch (error) {
        return { ok: false, error: error.message };
    }
    return { ok: true };
}
