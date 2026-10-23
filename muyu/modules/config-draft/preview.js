import { copyJson, validateJson } from '../../core/json-contract.js';
import { memoryFields, memoryFieldSchemas } from './contracts.js';

export const changesSchema = Object.freeze({ type: 'object', properties: memoryFieldSchemas, additionalProperties: false });

/** Capture only four settings, without default filling, coercion or unrelated property access. */
export function readConfigBaseline(settings) {
    const result = {};
    for (const field of memoryFields) if (settings?.[field] !== undefined) {
        const value = settings[field];
        if (field === 'autoMemoryInterval' ? !Number.isSafeInteger(value) : typeof value !== 'boolean') throw new Error('UNSUPPORTED_BASELINE');
        result[field] = value;
    }
    return copyJson(result);
}

/** Pure candidate validation: allowedFields belongs to the trusted task owner, not the model. */
export function previewMemoryConfig({ baseline, changes, allowedFields, previousChanges = {}, allowEmpty = false }) {
    if (!Array.isArray(allowedFields) || !allowedFields.length || new Set(allowedFields).size !== allowedFields.length || allowedFields.some(k => !memoryFields.includes(k))) throw new Error('INVALID_EDIT_SCOPE');
    const patch = validateJson(changesSchema, changes);
    if (!Object.keys(patch).length && !allowEmpty) throw new Error('EMPTY_CHANGES');
    if (Object.keys(patch).some(k => !allowedFields.includes(k))) throw new Error('OUT_OF_SCOPE');
    const previous = validateJson(changesSchema, previousChanges), initial = readConfigBaseline(baseline);
    const proposed = { ...previous, ...patch };
    const diff = Object.entries(proposed).filter(([field, value]) => initial[field] !== value).map(([field, value]) => ({ field, before: Object.hasOwn(initial, field) ? JSON.stringify(initial[field]) : '(missing)', after: JSON.stringify(value) }));
    const effective = { ...initial, ...proposed }, warnings = [];
    if (effective.memoryEnabled !== true) warnings.push('MEMORY_NOT_ENABLED');
    if (effective.autoMemoryEnabled !== true) warnings.push('AUTO_NOT_ENABLED');
    if (!diff.length) warnings.push('NO_EFFECTIVE_CHANGE');
    const minimal = Object.fromEntries(diff.map(({ field }) => [field, proposed[field]]));
    return copyJson({ contractVersion: 1, scope: 'global', structural: 'passed', range: 'passed', semantic: warnings.length ? 'warnings' : 'passed', intent: 'requires_user_review', warnings, diff,
        manifest: { type: 'config-profile', version: 1, drawers: { profilesAndData: true }, settings: minimal },
        notice: '仅草稿，未应用。影响所有聊天；未指定字段保持原值。' });
}
