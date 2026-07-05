import { registerProvider } from '../../provider-registry.js';

/**
 * {{importedSummary}} — Renders all enabled imported summaries.
 * Completely independent from the live {{chatSummary}} provider.
 *
 * Usage in Director Prompt:
 *   {{importedSummary}}                       → full text of all enabled summaries
 *   {{?importedSummary:count}}                → number of enabled summaries
 *   {{?importedSummary:names}}                → array of enabled summary names
 *   {{?importedSummary:[0].name}}             → first enabled summary name
 *   {{?importedSummary:[name=World].content}} → find by name
 *   {{#importedSummary:all}}{{?importedSummary:all[$it].name}}: {{?importedSummary:all[$it].content}}{{/importedSummary}}
 */
export function register(renderEnabledSummaries) {
    registerProvider({
        id: 'importedSummary',
        placeholder: '{{importedSummary}}',
        render: () => renderEnabledSummaries(),
    });
}
