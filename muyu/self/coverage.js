import { projectSelfConfig, SELF_SECTIONS } from './config.js';

// Derive valid field IDs from the same pure projection as the reader, never host state.
const fieldsBySection = new Map(SELF_SECTIONS.filter(id => id !== 'overview').map(id =>
    [id, new Set(projectSelfConfig(id, {}).sections[0].fields.map(row => row.key))]));
const states = ['known', 'unknown', 'not_applicable'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Coverage metadata only. Values, labels, notes and caller-supplied completion claims are not copied. */
export function selfConfigCoverage(body, requested) {
    if (!SELF_SECTIONS.includes(requested) || !object(body) || body.version !== 1 || body.readOnly !== true || body.section !== requested
        || !Array.isArray(body.sections) || !body.sections.length || body.sections.length > fieldsBySection.size) return null;
    const seen = new Set(), sections = [];
    for (const section of body.sections) {
        const allowed = fieldsBySection.get(section?.id);
        if (!allowed || seen.has(section.id) || requested !== 'overview' && section.id !== requested
            || !Array.isArray(section.fields) || !section.fields.length || section.fields.length > allowed.size) return null;
        seen.add(section.id);
        const row = { id: section.id, configured: { known: [], unknown: [], not_applicable: [] }, effective: { known: [], unknown: [], not_applicable: [] } };
        const fields = new Set();
        for (const field of section.fields) {
            if (!allowed.has(field?.key) || fields.has(field.key)) return null;
            fields.add(field.key);
            for (const column of ['configured', 'effective']) {
                const cell = field[column];
                if (!object(cell) || !states.includes(cell.state) || typeof cell.text !== 'string' || cell.text.length > 2000) return null;
                row[column][cell.state].push(field.key);
            }
        }
        sections.push(row);
    }
    return { kind: requested === 'overview' ? 'overview' : 'section', sections };
}
