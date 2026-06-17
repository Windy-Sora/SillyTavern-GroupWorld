import { registerProvider } from '../provider-registry.js';

export function register(getActiveSummaryText) {
    registerProvider({
        id: 'chatSummary',
        placeholder: '{{chatSummary}}',
        render: () => ({
            content: getActiveSummaryText(),
        }),
    });
}
