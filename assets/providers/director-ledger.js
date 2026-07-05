import { registerProvider } from '../../provider-registry.js';

/**
 * Provider that exposes the latest director decision as structured data.
 *
 * {{directorLedger}}          → latest plan JSON string
 * {{?directorLedger:reason}}  → latest plan reason
 * {{?directorLedger:scripts.$character|}} → per-character script from latest plan
 */
export function register(settings, getDirectorHistory) {
    registerProvider({
        id: 'directorLedger',
        placeholder: '{{directorLedger}}',
        render: () => {
            const history = getDirectorHistory();
            if (!history.length) return { content: '', data: null };
            const latest = history[history.length - 1];
            return { content: JSON.stringify(latest, null, 2), data: latest };
        },
    });

    /**
     * Provider that exposes the ENTIRE director history as an array.
     *
     * {{directorHistory}}                 → full history JSON array
     * {{?directorHistory:[-1].reason}}     → latest round's reason
     * {{?directorHistory:[-2].speakers}}   → previous round's speakers
     * {{?directorHistory:0.reason}}        → first round's reason
     */
    registerProvider({
        id: 'directorHistory',
        placeholder: '{{directorHistory}}',
        render: () => {
            const history = getDirectorHistory();
            if (!history.length) return { content: '[]', data: [] };
            return { content: JSON.stringify(history, null, 2), data: history };
        },
    });
}
