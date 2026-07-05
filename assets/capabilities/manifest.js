/**
 * Capability manifest — add new capabilities by appending their module name.
 * Each module must export register({ log, ... }) matching AssetLoader deps.
 */
export const capabilityModules = [
    'emotion',
    'tts',
    'image',
];
