import { copyJson, validateJson } from '../core/json-contract.js';
import { configChangesSchema, dependencyFields, previewSettings, readSettingsFields } from './registry.js';
import { DEFAULT_SETTINGS } from '../../settings.js';
import { settingsSwitchFields } from './settings-switch-rules.js';

// A saved profile is a portable patch, not a snapshot of the user's current settings.
// These fields require dedicated chat-side effects or would overwrite sibling object keys
// when the existing profile applier merges an object with defaults.
const unsupported = new Set(['memoryMaxEntries', 'storyBlueprintCompletionVariable', 'storyBlueprintEnabled', 'lang', 'debugLogging', ...settingsSwitchFields]);
const metadataSchema = { type: 'object', properties: {
    name: { type: 'string', maxLength: 80 },
    description: { type: 'string', maxLength: 500 },
}, required: ['name', 'description'], additionalProperties: false };

export function prepareGeneratedProfile({ name, description = '', changes }) {
    const metadata = validateJson(metadataSchema, { name, description });
    metadata.name = metadata.name.trim();
    metadata.description = metadata.description.trim();
    if (!metadata.name) throw Error('PROFILE_NAME_REQUIRED');
    const patch = validateJson(configChangesSchema, changes);
    const keys = Object.keys(patch);
    if (!keys.length) throw Error('EMPTY_PROFILE');
    if (keys.some(key => unsupported.has(key) || key.startsWith('scoreWeights.'))) throw Error('PROFILE_FIELD_REQUIRES_SEPARATE_FLOW');
    const baseline = readSettingsFields(DEFAULT_SETTINGS, dependencyFields(keys));
    const review = previewSettings({ baseline, changes: patch, allowEmpty: true });
    const settings = {};
    for (const key of keys) settings[key] = copyJson(patch[key]);
    const content = copyJson({ module: 'generated-profile', name: metadata.name, description: metadata.description,
        settings, fields: keys, warnings: review.warnings, scope: 'global', saveOnly: true });
    if (new TextEncoder().encode(JSON.stringify(content)).length > 22000) throw Error('PROFILE_TOO_LARGE');
    return content;
}
