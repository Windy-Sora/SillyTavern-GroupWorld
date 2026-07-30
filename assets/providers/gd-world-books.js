import { registerProvider } from '../../provider-registry.js';

export function register(scanner) {
    registerProvider({
        id: 'gdWorldBooksFull',
        placeholder: '{{gdWorldBooksFull}}',
        render: async () => {
            const snap = await scanner.buildSnapshot();
            return {
                content: snap.fullText,
                data: {
                    books: snap.books,
                    entries: snap.fullEntries,
                    names: snap.names,
                    stats: snap.stats,
                },
            };
        },
    });

    registerProvider({
        id: 'gdWorldBooksConstant',
        placeholder: '{{gdWorldBooksConstant}}',
        render: async () => {
            const snap = await scanner.buildSnapshot();
            return {
                content: snap.constantText,
                data: {
                    entries: snap.constantEntries,
                    names: snap.names,
                    stats: snap.stats,
                },
            };
        },
    });

    registerProvider({
        id: 'gdWorldBooksNames',
        placeholder: '{{gdWorldBooksNames}}',
        render: async () => {
            const snap = await scanner.buildSnapshot();
            return {
                content: snap.names.join(', '),
                data: snap.names,
            };
        },
    });
}
