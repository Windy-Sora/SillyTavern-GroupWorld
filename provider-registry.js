export const providers = new Map();

function hasSameOwner(current, replacement) {
    return Boolean(
        current?._gdOwner
        && current._gdOwner === replacement?._gdOwner
        && current._gdOwnerId === replacement?._gdOwnerId
    );
}

export function registerProvider(provider) {
    if (!provider || !provider.id || !provider.placeholder) {
        console.warn('[GroupDirector] registerProvider: invalid provider, missing id or placeholder');
        return;
    }
    const current = providers.get(provider.id);
    if (current && !hasSameOwner(current, provider)) {
        throw new Error(`Provider "${provider.id}" is already registered`);
    }
    providers.set(provider.id, provider);
    return provider;
}

export function unregisterProvider(id, owner = null) {
    const current = providers.get(id);
    if (!current) return false;
    if (owner && (
        current._gdOwner !== owner.owner
        || current._gdOwnerId !== owner.ownerId
    )) return false;
    return providers.delete(id);
}

export function getProviders() {
    return [...providers.values()];
}

export function getAvailablePlaceholders() {
    return [...providers.values()].map(p => p.placeholder);
}
