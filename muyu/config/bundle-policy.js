import { settingsSwitchFields } from './settings-switch-rules.js';

const separateFields = new Set(['memoryMaxEntries', 'storyBlueprintCompletionVariable', 'storyBlueprintEnabled', ...settingsSwitchFields]);
// Shared by execution validation and public contracts; registered fields only.
export function bundleFieldPolicy(id) {
    const supported = !separateFields.has(id);
    return { supported, workflow: supported ? 'muyu.task.preview' : 'dedicated-settings-preview',
        reason: supported ? 'Registered setting may join variables/settings/scripts; all baseline and dependency checks still apply.' : 'Dedicated side effects require a separate settings workflow; not forbidden or unlocked by extra permission.' };
}
export const BUNDLE_LIMITS = Object.freeze({ numericVariables: 6, scripts: 3, draftBytes: 18000 });
export const BUNDLE_VARIABLE_SCOPE = 'global'; // One value shared by the current chat, not per character.
