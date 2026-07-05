import { registerProvider } from '../../provider-registry.js';

/**
 * {{npcList}} — All NPCs in the current chat (from chat_metadata).
 *
 * Provides:
 *   content: formatted text listing all NPCs with name, description, personality, scenario
 *   data:    raw NPC array for path queries via {{?npcList:...}}
 *
 * Usage in Director Prompt:
 *   {{npcList}}                         → full formatted list
 *   {{?npcList:length}}                 → NPC count
 *   {{?npcList:[0].name}}              → first NPC's name
 *   {{?npcList:[name=张铁柱].description}} → find by name
 *   {{?npcList:[-1].scenario}}         → last NPC's scenario
 *
 * Usage in Script Wrapper:
 *   {{?npcList:all}} → JSON array of all NPCs (for $character filtering via block loop)
 *   {{#npcList:all}}{{?npcList:all[$it].name}}: {{?npcList:all[$it].scenario}}{{/npcList}}
 */
export function register(getNpcs) {
    registerProvider({
        id: 'npcList',
        placeholder: '{{npcList}}',
        render: () => {
            const npcs = getNpcs();
            if (!npcs.length) {
                return { content: '', data: { length: 0, all: [] } };
            }

            const content = npcs.map((n, i) =>
                `${i + 1}. ${n.name}${n.imported ? ' (已导入)' : ''}\n` +
                `   描述: ${n.description || '—'}\n` +
                `   性格: ${n.personality || '—'}\n` +
                `   场景: ${n.scenario || '—'}` +
                (n.first_mes ? `\n   开场白: ${n.first_mes}` : '')
            ).join('\n\n');

            return {
                content,
                data: {
                    length: npcs.length,
                    all: npcs,
                    // Array of names for quick reference
                    names: npcs.map(n => n.name),
                    // Index by name for path queries like [name=张铁柱]
                    byName: Object.fromEntries(npcs.map(n => [n.name, n])),
                },
            };
        },
    });
}
