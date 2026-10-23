import { PERMISSION_DEFAULTS, validatePermissionConfig } from '../permissions/read-policy.js';
export function createPermissionConfigStore({ getSettings, saveSettings }) {
    return {
        read() { try { return validatePermissionConfig(getSettings().muyuPermissionConfig); } catch { return { ...PERMISSION_DEFAULTS }; } },
        async save(value) {
            const next = validatePermissionConfig(value), settings = getSettings(), previous = settings.muyuPermissionConfig, expected = JSON.stringify(next);
            settings.muyuPermissionConfig = next;
            try { await saveSettings(); if (getSettings() !== settings || settings.muyuPermissionConfig !== next || JSON.stringify(next) !== expected) throw Error('SETTINGS_CHANGED'); }
            catch { if (getSettings() === settings && settings.muyuPermissionConfig === next && JSON.stringify(next) === expected) { if (previous === undefined) delete settings.muyuPermissionConfig; else settings.muyuPermissionConfig = previous; } throw Error('PERMISSION_CONFIG_SAVE_FAILED'); }
            return { ...next };
        },
    };
}
