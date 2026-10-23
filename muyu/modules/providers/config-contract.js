import { memoryFields } from '../config-draft/contracts.js';
import { validateJson } from '../../core/json-contract.js';
import { readPresentationSchema } from '../../config/read-presentation.js';
const str = maxLength => ({ type: 'string', maxLength });
const obj = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export const configDataSchema = obj({
    version: { type: 'integer', enum: [1] }, scope: { type: 'string', enum: ['global'] },
    origin: { type: 'string', enum: ['current-memory'] }, persistence: { type: 'string', enum: ['unknown'] },
    fields: { type: 'array', maxItems: 4, items: obj({ field: { type: 'string', enum: memoryFields }, state: { type: 'string', enum: ['value', 'missing', 'unsupported'] }, value: str(40) }) },
});
// Display metadata is added only after the host's raw contract is validated.
export const configReadDataSchema = { ...configDataSchema, properties: { ...configDataSchema.properties, presentation: readPresentationSchema } };
export function validateConfigData(value) {
    const data = validateJson(configDataSchema, value);
    if (data.fields.length !== 4 || new Set(data.fields.map(f => f.field)).size !== 4) throw Error('INVALID_CONFIG_DATA');
    for (const field of data.fields) {
        if (field.state !== 'value') { if (field.value !== '') throw Error('INVALID_CONFIG_DATA'); continue; }
        const v = JSON.parse(field.value);
        if (field.field === 'autoMemoryInterval' ? !Number.isSafeInteger(v) : typeof v !== 'boolean') throw Error('INVALID_CONFIG_DATA');
        if (JSON.stringify(v) !== field.value) throw Error('INVALID_CONFIG_DATA');
    }
    return data;
}
