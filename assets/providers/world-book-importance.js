import { registerProvider } from '../../provider-registry.js';

/**
 * {{worldBookImportance}} — per-entry importance scores (0.000–1.000).
 *
 * Content: ranked list with score and factors
 * Data:    sorted array for path queries
 *
 * Path query examples:
 *   {{?worldBookImportance:0.comment}}       → top entry name
 *   {{?worldBookImportance:0.importance}}     → top entry score
 *   {{?worldBookImportance:0.book}}           → top entry's world book
 */
export function register(scanner, getMaxEntries) {
    registerProvider({
        id: 'worldBookImportance',
        placeholder: '{{worldBookImportance}}',
        render: async () => {
            const books = await scanner.scanAll();
            if (!books.length) return { content: '', data: [] };

            const max = getMaxEntries ? getMaxEntries() : 20;
            const scored = scanner.calculateImportance(books);

            const content = scored.slice(0, Math.max(1, max)).map((s, i) =>
                `${i + 1}. [${s.comment}] _${s.book}_ importance=${s.importance.toFixed(3)} (${s.factors})`
            ).join('\n');

            // Summary of always-on entries
            const alwaysOn = scored.filter(s => s.constant && s.importance > 0);
            if (alwaysOn.length > 0) {
                const aoList = alwaysOn.map(s => `- [${s.comment}] _${s.book}_ importance=${s.importance.toFixed(3)}`).join('\n');
                return { content: `${content}\n\n## Always-On (${alwaysOn.length})\n${aoList}`, data: scored };
            }

            return { content, data: scored };
        },
    });
}
