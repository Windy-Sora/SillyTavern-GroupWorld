/** Approved profile application: chat persistence precedes optional global templates.
 * Unknown effects are reported, never blindly rolled back or retried. */
export async function applyApprovedLibraryChat({ settings, extensionKey, saveSettings, metadata, changes, template,
    validate, isCurrent, saveChatConfirmed }) {
    if (typeof saveChatConfirmed !== 'function') throw Error('WRITE_UNAVAILABLE');
    validate();
    const root = metadata[extensionKey] || (metadata[extensionKey] = {});
    const profiles = root.characterProfiles || (root.characterProfiles = {});
    const applied = {};
    for (const change of changes) {
        const next = { ...change.after, updatedAt: Date.now() };
        profiles[change.avatar] = next; applied[change.avatar] = JSON.parse(JSON.stringify(next));
    }
    let chatSave = 'unknown', settingsSave = 'not_started';
    const result = status => ({ status, chatSave, settingsSave, count: changes.length });
    try { await saveChatConfirmed(metadata); chatSave = 'confirmed'; } catch { return result('outcome_unknown'); }
    const current = checkTemplates => {
        try { return metadata[extensionKey] === root && root.characterProfiles === profiles && isCurrent(applied, checkTemplates); }
        catch { return false; }
    };
    if (!current(true)) return result('partial');
    if (!template) return result('applied_confirmed');
    const fields = { profileGeneratorPrompt: template.generatorPrompt, profileJsonSchema: template.jsonSchema, profileRenderTemplate: template.renderTemplate };
    Object.assign(settings, fields);
    try { await saveSettings(); settingsSave = 'unconfirmed'; }
    catch { settingsSave = 'unknown'; return result('partial'); }
    if (!current(false) || Object.entries(fields).some(([key,value])=>settings[key] !== value)) return result('partial');
    return result('applied_unconfirmed');
}
