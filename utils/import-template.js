/** Compensate only template fields still owned by this failed settings save. */
export async function saveImportedTemplate(settings, patch, saveSettings) {
    const previous = Object.fromEntries(Object.keys(patch).map(key => [key, { existed: Object.hasOwn(settings, key), value: settings[key] }]));
    Object.assign(settings, patch);
    try {
        await saveSettings();
    } catch (cause) {
        const details = [];
        if (!cause?.persistenceUnknown) {
            for (const [key, value] of Object.entries(patch)) {
                if (settings[key] !== value) { details.push('concurrent template edit preserved'); continue; }
                if (previous[key].existed) settings[key] = previous[key].value;
                else delete settings[key];
            }
            try { await saveSettings(); }
            catch { details.push('template compensation save failed'); }
        } else details.push('settings persistence outcome unknown; no automatic compensation');
        const error = new Error('Template settings save failed; previously saved chat data was not rolled back. ' + (cause?.message || 'Save failed') + (details.length ? '; ' + details.join('; ') : ''));
        error.templateSaveFailed = true;
        error.persistenceUnknown = !!cause?.persistenceUnknown;
        throw error;
    }
}
