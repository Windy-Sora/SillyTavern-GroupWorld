import { registerProvider } from '../../provider-registry.js';

/**
 * {{importedCritique}} — Renders all enabled imported critiques.
 * Completely independent from the live {{directorCritique}} / {{characterCritique}} providers.
 *
 * Usage in Director Prompt:
 *   {{importedCritique}}                       → full text of all enabled critiques
 *   {{?importedCritique:count}}                → number of enabled critiques
 *   {{?importedCritique:names}}                → array of enabled critique names
 *   {{?importedCritique:[0].name}}             → first enabled critique name
 *   {{?importedCritique:[0].directorCritique.pacing}}  → first critique director pacing
 *   {{#importedCritique:all}}{{?importedCritique:all[$it].name}}: {{?importedCritique:all[$it].directorCritique.pacing}}{{/importedCritique}}
 */
export function register(renderEnabledCritiques) {
    registerProvider({
        id: 'importedCritique',
        placeholder: '{{importedCritique}}',
        render: () => renderEnabledCritiques(),
    });
}
