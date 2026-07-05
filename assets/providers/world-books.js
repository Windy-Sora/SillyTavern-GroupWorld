import { registerProvider } from '../../provider-registry.js';

/**
 * {{worldBooks}} — full inventory of all world books and their entries.
 *
 * Content: human-readable summary grouped by world book name
 * Data:    structured array for path queries
 *
 * Path query examples:
 *   {{?worldBooks:0.name}}              → first book name
 *   {{?worldBooks:0.entries[0].comment}} → first entry comment
 */
export function register(scanner) {
    registerProvider({
        id: 'worldBooks',
        placeholder: '{{worldBooks}}',
        render: async () => {
            const books = await scanner.scanAll();

            const content = books.map(book => {
                const alwaysOn = book.entries.filter(e => e.constant && !e.disable).length;
                const keyword = book.entries.filter(e => !e.constant && e.keyCount > 0 && !e.disable).length;
                const disabled = book.entries.filter(e => e.disable).length;
                const parts = [`## ${book.name} (${book.entryCount} entries`];
                if (alwaysOn) parts.push(`, ${alwaysOn} always-on`);
                if (keyword) parts.push(`, ${keyword} keyword`);
                if (disabled) parts.push(`, ${disabled} disabled`);
                parts.push(')');
                for (const e of book.entries) {
                    const flags = [];
                    if (e.disable) flags.push('DISABLED');
                    if (e.constant) flags.push('always-on');
                    else if (e.keyCount > 0) flags.push(`keys: ${e.key.slice(0, 5).join(', ')}`);
                    else flags.push('no-trigger');
                    flags.push(`depth=${e.depth}`);
                    parts.push(`- [${e.comment || '(unnamed)'}] ${flags.join(', ')}`);
                }
                return parts.join('\n');
            }).join('\n\n');

            // Build a flat all-entries array so block-loops can query
            // {{?worldBooks:allEntries[comment=$it].content}} without
            // needing to know which world book an entry belongs to.
            const allEntries = [];
            for (const book of books) {
                for (const entry of book.entries) {
                    allEntries.push({ ...entry, book: book.name });
                }
            }

            return { content, data: { books, allEntries } };
        },
    });
}
