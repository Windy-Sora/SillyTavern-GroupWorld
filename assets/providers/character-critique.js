import { registerProvider } from '../../provider-registry.js';

/**
 * {{characterCritique}} — Full character critique data as JSON.
 *
 * Usage:
 *   {{characterCritique}}                       → JSON text of all critiques
 *   {{?characterCritique:Alice.consistency}}    → Alice's consistency critique
 *   {{?characterCritique:Bob.suggestions[0]}}   → Bob's first suggestion
 *   {{#characterCritique:all}}                  → iterate all
 *     {{?characterCritique:all[$it].name}}
 *   {{/characterCritique}}
 *
 * In character script templates, $character resolves to the current character:
 *   {{?characterCritique:$character.consistency}}
 */
export function register(getActiveCharacterCritiqueData) {
    registerProvider({
        id: 'characterCritique',
        placeholder: '{{characterCritique}}',
        render: () => {
            const data = getActiveCharacterCritiqueData();
            if (!data) return { content: '', data: null };
            return {
                content: JSON.stringify(data, null, 2),
                data,
            };
        },
    });
}
