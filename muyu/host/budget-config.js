/** Upgrade only recognizable old defaults; explicitly saved budgets remain user-owned. */
export function createBudgetConfigStore({ getSettings, saveSettings, key, versionKey, defaults, validate, legacy, errorCode }) {
    return {
        read() {
            const settings = getSettings();
            try {
                const value = validate(settings[key]);
                return settings[versionKey] !== 1 && legacy(value) ? { ...defaults } : value;
            } catch { return { ...defaults }; }
        },
        async save(value) {
            const next = validate(value), settings = getSettings(), previous = settings[key], previousVersion = settings[versionKey];
            settings[key] = next; settings[versionKey] = 1;
            try { await saveSettings(); }
            catch {
                if (settings[key] === next) {
                    if (previous === undefined) delete settings[key]; else settings[key] = previous;
                    if (previousVersion === undefined) delete settings[versionKey]; else settings[versionKey] = previousVersion;
                }
                throw Error(errorCode);
            }
            return { ...next };
        },
    };
}
