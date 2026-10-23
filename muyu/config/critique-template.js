import { copyJson } from '../core/json-contract.js';

/** The setting is a JSON output example, not a JSON Schema document. */
export function inspectCritiqueTemplate(text) {
    if (text === '') return { nonstandard: false };
    let value;
    try { value = copyJson(JSON.parse(text)); }
    catch { throw new TypeError('INVALID_CRITIQUE_OUTPUT_EXAMPLE'); }
    const object = item => item !== null && typeof item === 'object' && !Array.isArray(item);
    if (!object(value) || !Object.hasOwn(value, 'directorCritique') || !object(value.directorCritique)
        || !Object.hasOwn(value, 'characterCritiques') || !object(value.characterCritiques)
        || Object.values(value.characterCritiques).some(item => !object(item))) {
        throw new TypeError('INVALID_CRITIQUE_OUTPUT_EXAMPLE');
    }
    const director = value.directorCritique;
    const directorFields = ['pacing', 'spotlight', 'suggestions'];
    const characterFields = ['consistency', 'interaction', 'suggestions'];
    const hasStandardFields = (item, fields) => fields.every(field => Object.hasOwn(item, field)
        && (field === 'suggestions' ? Array.isArray(item[field]) : typeof item[field] === 'string'));
    return { nonstandard: !hasStandardFields(director, directorFields)
        || Object.values(value.characterCritiques).some(item => !hasStandardFields(item, characterFields)) };
}
