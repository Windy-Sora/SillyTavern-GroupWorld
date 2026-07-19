export const providers = new Map();

export function registerProvider(provider) {
    if (!provider || !provider.id || !provider.placeholder) {
        console.warn('[GroupDirector] registerProvider: invalid provider, missing id or placeholder');
        return;
    }
    providers.set(provider.id, provider);
}

export function unregisterProvider(id) {
    providers.delete(id);
}

export function getProviders() {
    return [...providers.values()];
}

export function getAvailablePlaceholders() {
    return [...providers.values()].map(p => p.placeholder);
}
