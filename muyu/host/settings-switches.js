import { profileAutoFields, settingsSwitchFields } from '../config/settings-switch-rules.js';

// Business queues own registration, persistence and their existing narrow rollback policy.
// The freshness guard runs INSIDE the queue, immediately before any mutation.
export function createSettingsSwitchPort({ customPromptsSystem, profileLibrarySystem }) {
    return Object.freeze({
        async apply(patch, beforeApply) {
            const keys = Object.keys(patch);
            if (!keys.length || keys.some(key => !settingsSwitchFields.includes(key))) throw Error('WRITE_UNAVAILABLE');
            if (keys.includes('customPromptsEnabled')) {
                if (keys.length !== 1 || !customPromptsSystem?.setMasterEnabled) throw Error('WRITE_UNAVAILABLE');
                await customPromptsSystem.setMasterEnabled(patch.customPromptsEnabled, { beforeApply });
            } else {
                if (keys.some(key => !profileAutoFields.includes(key)) || !profileLibrarySystem?.updateAutoLoadSettings) throw Error('WRITE_UNAVAILABLE');
                await profileLibrarySystem.updateAutoLoadSettings(Object.fromEntries(keys.map(key => [key.split('.')[1], patch[key]])), {
                    beforeApply: owner => { if (profileLibrarySystem.isAutoLoading?.()) throw Error('WRITE_UNAVAILABLE'); beforeApply(owner); },
                });
            }
        },
    });
}
