import { CONTEXT_DEFAULTS, validateContextConfig } from '../context/policy.js';
import { createBudgetConfigStore } from './budget-config.js';
export function createContextConfigStore({ getSettings, saveSettings }) {
    return createBudgetConfigStore({ getSettings, saveSettings, key: 'muyuContextConfig', versionKey: 'muyuContextBudgetVersion',
        defaults: CONTEXT_DEFAULTS, validate: validateContextConfig, errorCode: 'CONTEXT_CONFIG_SAVE_FAILED',
        legacy: value => [32000, 500000].includes(value.inputTokens) && value.recentTurns === 12 && !value.autoSummary && value.historyAuthorization === 'auto' &&
            (value.summaryTokens === 8192 || !Object.hasOwn(getSettings().muyuContextConfig || {}, 'summaryTokens')) && value.summaryTimeMs === CONTEXT_DEFAULTS.summaryTimeMs });
}
