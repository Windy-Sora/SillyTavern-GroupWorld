import { RUN_DEFAULTS, validateRunConfig } from '../core/budget.js';
import { createBudgetConfigStore } from './budget-config.js';
export function createRunConfigStore({ getSettings, saveSettings }) {
    return createBudgetConfigStore({ getSettings, saveSettings, key: 'muyuRunConfig', versionKey: 'muyuRunBudgetVersion',
        defaults: RUN_DEFAULTS, validate: validateRunConfig, errorCode: 'RUN_CONFIG_SAVE_FAILED',
        legacy: value => value.timeMs === 120000 && (value.modelCalls === 6 && value.toolCalls === 16 && value.maxTokens === 8192 && [24000, 1000000].includes(value.providerBytes) || value.modelCalls === 12 && value.toolCalls === 48 && value.maxTokens === 32768 && value.providerBytes === 2 * 1024 * 1024) });
}
