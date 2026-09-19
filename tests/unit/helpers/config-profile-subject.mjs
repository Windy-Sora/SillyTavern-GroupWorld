import { createConfigProfileSystem } from '../../../systems/config-profile-system.js';

export function createConfigProfileSubject(initial = {}, variableResult = { ok: true }, options = {}) {
    const settings = structuredClone({
        lang: 'en',
        configProfiles: [],
        customPrompts: [],
        agentConfigs: { director: { apiKey: 'keep-me' } },
        ...initial,
    });
    const extensionSettings = {};
    const calls = { saves: 0, logs: [], variableImports: [] };
    const variableSystem = options.variableSystem || {
        getExportData: () => ({ defs: [], values: { global: {}, character: {} } }),
        applyImportData(data, options) {
            calls.variableImports.push({ data: structuredClone(data), options });
            return typeof variableResult === 'function' ? variableResult(data, options) : variableResult;
        },
    };
    const subject = createConfigProfileSystem({
        settings,
        EXT_KEY: 'gd',
        extension_settings: extensionSettings,
        saveSettingsDebounced: () => {
            calls.saves += 1;
            if (options.saveError) throw options.saveError;
        },
        variableSystem,
        customAgentSystem: options.customAgentSystem,
        log: message => calls.logs.push(message),
    });
    return { subject, settings, extensionSettings, calls };
}

export function jsonFile(value, name = 'profile.json') {
    return { name, text: async () => typeof value === 'string' ? value : JSON.stringify(value) };
}

export function manifest(overrides = {}) {
    return {
        version: 1,
        type: 'config-profile-manifest',
        name: 'Imported',
        drawers: {},
        settings: {},
        ...overrides,
    };
}
