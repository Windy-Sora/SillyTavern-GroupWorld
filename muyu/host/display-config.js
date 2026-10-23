import { DISPLAY_DEFAULTS, validateDisplayConfig } from '../preferences/contract.js';
import { createBudgetConfigStore } from './budget-config.js';
export function createDisplayConfigStore({ getSettings, saveSettings }) {
    return createBudgetConfigStore({ getSettings, saveSettings, key: 'muyuDisplayConfig', versionKey: 'muyuDisplayConfigVersion', defaults: DISPLAY_DEFAULTS,
        validate: validateDisplayConfig, legacy: () => false, errorCode: 'DISPLAY_CONFIG_SAVE_FAILED' });
}
