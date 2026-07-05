/**
 * Provider manifest — module names (without path or .js extension).
 * AssetLoader resolves them against the basePath at load time.
 *
 * NEW providers MUST export: export function register(deps)
 *   — deps is an object passed by AssetLoader.providers({ ... }, deps).
 *
 * Existing 19 providers (below) use legacy signatures for stability.
 * Do NOT modify them — they work. New ones follow the standard.
 */
export const providerModules = [
    'recent-messages',
    'new-recent-messages',
    'characters',
    'character-profiles',
    'world-info',
    'history',
    'director-ledger',
    'test-provider',
    'world-books',
    'world-book-importance',
    'character-lore',
    'system-time',
    'random-dice',
    'dice',
    'moon-phase',
    'time-of-day',
    'knowledge',
    'chat-summary',
    'npc-list',
];
