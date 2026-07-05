/**
 * AssetLoader — dynamically imports and registers modules from asset folders.
 *
 * Each asset folder (providers, capabilities, etc.) has a manifest.js that
 * lists module names. AssetLoader constructs paths from a basePath, imports
 * each module, and calls its register() function with provided dependencies.
 *
 * Usage:
 *   AssetLoader.providers({ basePath: '../assets/providers', modules }, deps);
 */

export const AssetLoader = {
    async _loadAll({ basePath, modules }, deps = {}) {
        const loaded = [];
        const failed = [];
        for (const name of modules) {
            const path = `${basePath}/${name}.js`;
            try {
                const mod = await import(path);
                if (typeof mod.register === 'function') {
                    mod.register(deps);
                    loaded.push(name);
                } else {
                    console.warn(`[AssetLoader] ${name}: no register() export, skipped`);
                    failed.push(name);
                }
            } catch (e) {
                console.error(`[AssetLoader] ${name}: import failed —`, e.message);
                failed.push(name);
            }
        }
        return { loaded, failed };
    },

    async providers({ basePath, modules }, deps = {}) {
        const result = await this._loadAll({ basePath, modules }, deps);
        console.log(`[AssetLoader] providers: ${result.loaded.length} loaded` +
            (result.failed.length ? `, ${result.failed.length} failed` : ''));
        return result;
    },

    async capabilities({ basePath, modules }, deps = {}) {
        const result = await this._loadAll({ basePath, modules }, deps);
        console.log(`[AssetLoader] capabilities: ${result.loaded.length} loaded` +
            (result.failed.length ? `, ${result.failed.length} failed` : ''));
        return result;
    },
};
