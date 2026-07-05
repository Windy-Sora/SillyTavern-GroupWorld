import { registerProvider } from '../../provider-registry.js';

/**
 * {{charCritique}} — current character's critique as readable text.
 *
 * Only resolves when a character context is available (e.g. inside
 * character script wrapper). In the Director prompt (no context),
 * returns empty string — use {{characterCritique}} + DSL there.
 *
 * Fully dynamic: works with any user-defined JSON schema.
 * Convention: each character critique entry is an object where
 *   - string values → [key] value
 *   - array values  → [key] + bullet list
 *
 * Usage:
 *   {{charCritique}}
 */
export function register(getActiveCharacterCritiqueData) {
    registerProvider({
        id: 'charCritique',
        placeholder: '{{charCritique}}',
        render: (context) => {
            const data = getActiveCharacterCritiqueData();
            if (!data) return '';

            const charName = context?.character;
            if (!charName || !data[charName]) return '';

            const cc = data[charName];
            const lines = [];

            for (const [k, v] of Object.entries(cc)) {
                if (Array.isArray(v)) {
                    if (v.length) {
                        lines.push('[' + k + ']');
                        v.forEach(item => lines.push('  - ' + String(item)));
                    }
                } else if (v !== null && v !== undefined && v !== '') {
                    lines.push('[' + k + '] ' + (typeof v === 'object' ? JSON.stringify(v) : String(v)));
                }
            }

            return lines.join('\n');
        },
    });
}
