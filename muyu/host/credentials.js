const ID = 'muyu-assistant';
const SOURCE_ID = 'muyu-connection-source';
const options = c => ({ profile: c.profile || 'deepseek', thinking: (c.profile || 'deepseek') === 'deepseek' && c.thinking !== false, reasoningEffort: c.reasoningEffort || 'high' });
/** Opt-in extension setting; existing agentConfigs export paths strip apiKey. Not encryption. */
export function createCredentialStore({ getSettings, saveSettings }) {
    const stored = () => getSettings().agentConfigs?.[ID];
    return Object.freeze({
        sourcePreference() { return getSettings().agentConfigs?.[SOURCE_ID] || (stored() ? { source: 'independent', autoConnect: false } : { source: 'st', autoConnect: true }); },
        async saveSourcePreference(source, autoConnect = true) {
            if (!['st', 'independent'].includes(source)) throw Error('INVALID_CONNECTION_SOURCE');
            const settings = getSettings(); settings.agentConfigs ||= {};
            const previous = settings.agentConfigs[SOURCE_ID], next = { source, autoConnect: autoConnect === true };
            settings.agentConfigs[SOURCE_ID] = next;
            try { await saveSettings(); } catch { if (settings.agentConfigs[SOURCE_ID] === next) { if (previous) settings.agentConfigs[SOURCE_ID] = previous; else delete settings.agentConfigs[SOURCE_ID]; } throw Error('CREDENTIAL_SAVE_FAILED'); }
        },
        describe() {
            const c = stored();
            return c?.apiKey ? { endpoint: c.endpoint, model: c.model, ...options(c), remembered: true, autoConnect: c.autoConnect === true } : null;
        },
        restoreAutoConnection() {
            const c = stored();
            return c?.apiKey && c.autoConnect === true ? { endpoint: c.endpoint, model: c.model, ...options(c), apiKey: c.apiKey, supportsTools: true } : null;
        },
        resolve(config) {
            const saved = stored();
            if (config.apiKey) return config.apiKey;
            if (saved?.apiKey && saved.endpoint === config.endpoint) return saved.apiKey;
            return '';
        },
        async save(config, sourcePreference = null) {
            const settings = getSettings(), previous = settings.agentConfigs?.[ID];
            settings.agentConfigs ||= {};
            const previousSource = settings.agentConfigs[SOURCE_ID];
            const nextSource = sourcePreference ? { source: sourcePreference.source, autoConnect: sourcePreference.autoConnect === true } : null;
            if (nextSource && !['st', 'independent'].includes(nextSource.source)) throw Error('INVALID_CONNECTION_SOURCE');
            const next = config ? { endpoint: config.endpoint, model: config.model, ...options(config), apiKey: config.apiKey, autoConnect: config.autoConnect === true } : undefined;
            if (next) settings.agentConfigs[ID] = next; else delete settings.agentConfigs[ID];
            if (nextSource) settings.agentConfigs[SOURCE_ID] = nextSource;
            try { await saveSettings(); }
            catch {
                if (settings.agentConfigs[ID] === next) { if (previous) settings.agentConfigs[ID] = previous; else delete settings.agentConfigs[ID]; }
                if (nextSource && settings.agentConfigs[SOURCE_ID] === nextSource) { if (previousSource) settings.agentConfigs[SOURCE_ID] = previousSource; else delete settings.agentConfigs[SOURCE_ID]; }
                throw Error('CREDENTIAL_SAVE_FAILED');
            }
        },
        async setAutoConnect(value) {
            const c = stored();
            if (!c?.apiKey || c.autoConnect !== true && value !== true) return;
            await this.save({ ...c, autoConnect: value === true });
        },
    });
}
