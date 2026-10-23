/** Presentation preferences are never instructions, permissions or run budgets. */
export const DISPLAY_DEFAULTS = Object.freeze({ processDetail: 'compact' });
export const PROCESS_DETAILS = Object.freeze(['compact', 'standard', 'detailed', 'verbose']);
export const DISPLAY_THEMES = Object.freeze(['host', 'dusk', 'light']);
export function validateDisplayConfig(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['processDetail', 'theme'].includes(key)) || !PROCESS_DETAILS.includes(value.processDetail) || value.theme !== undefined && !DISPLAY_THEMES.includes(value.theme)) throw Error('DISPLAY_CONFIG_INVALID');
    return { processDetail: value.processDetail, ...(value.theme !== undefined ? { theme: value.theme } : {}) };
}
