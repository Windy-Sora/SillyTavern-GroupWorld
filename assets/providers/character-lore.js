import { registerProvider } from '../../provider-registry.js';

/**
 * {{characterLore}} — injects the director's loreAssignments as keywords
 * into the character prompt. ST's world info system detects these keywords
 * and automatically activates the corresponding lorebook entries.
 *
 * No content lookup needed — ST handles that natively via checkWorldInfo.
 */
export function register(getDirectorHistory) {
    registerProvider({
        id: 'characterLore',
        placeholder: '{{characterLore}}',
        render: (ctx) => {
            const charName = ctx?.character;
            if (!charName) return { content: '' };

            const history = getDirectorHistory();
            if (!history.length) return { content: '' };

            const latest = history[history.length - 1];
            const assignments = latest?.loreAssignments;
            if (!assignments || typeof assignments !== 'object') return { content: '' };

            const names = assignments[charName];
            if (!Array.isArray(names) || names.length === 0) return { content: '' };

            // Deduplicate and format as keyword triggers for ST's world info scanner
            const unique = [...new Set(names.filter(Boolean))];
            if (unique.length === 0) return { content: '' };

            return { content: `[World lore: ${unique.join(', ')}]` };
        },
    });
}
