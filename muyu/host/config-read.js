import { memoryFields } from '../modules/config-draft/contracts.js';
import { readConfigBaseline } from '../modules/config-draft/preview.js';
import { jsonKey } from '../core/json-contract.js';

/** Fixed first-party adapter. No registry render, defaults, initialization or saving. */
export function readMemoryConfig(getSettings) {
    const project = settings => ({ version: 1, scope: 'global', origin: 'current-memory', persistence: 'unknown', fields: memoryFields.map(field => {
        const raw = settings?.[field];
        if (raw === undefined) return { field, state: 'missing', value: '' };
        try { const value = readConfigBaseline({ [field]: raw })[field]; return { field, state: 'value', value: JSON.stringify(value) }; }
        catch { return { field, state: 'unsupported', value: '' }; }
    }) });
    const settings = getSettings(), data = project(settings);
    if (settings !== getSettings() || jsonKey(data) !== jsonKey(project(settings)) || settings !== getSettings()) throw Error('STALE_SOURCE');
    return data;
}
