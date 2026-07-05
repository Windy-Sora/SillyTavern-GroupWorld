import { registerProvider } from '../../provider-registry.js';

/**
 * {{charMemory}} — All characters' memories (for Director Prompt).
 * {{charMemoryCurrent}} — Current character's memories (for Script Wrapper).
 */
export function register({ getMemoriesForAll, getMemoriesForChar, log }) {

    registerProvider({
        id: 'charMemory',
        placeholder: '{{charMemory}}',
        render: () => {
            const all = getMemoriesForAll();
            if (!Object.keys(all).length) return { content: '', data: { all: [] } };

            let content = '';
            const flatAll = [];
            for (const [avatar, mems] of Object.entries(all)) {
                if (!mems.length) continue;
                content += `=== ${avatar} ===\n`;
                content += mems.map(m => `- ${m.event} [${m.mood}]`).join('\n') + '\n\n';
                flatAll.push(...mems);
            }

            return {
                content: content.trim(),
                data: { all: flatAll, byChar: all },
            };
        },
    });

    registerProvider({
        id: 'charMemoryCurrent',
        placeholder: '{{charMemoryCurrent}}',
        render: (ctx) => {
            const charName = typeof ctx === 'object' ? (ctx.$character || ctx.character || '') : (typeof ctx === 'string' ? ctx : '');
            const mems = getMemoriesForChar(charName);
            log(`[charMemoryCurrent] charName="${charName}", mems=${mems.length}, mems[0]=${mems[0]?.event?.substring(0, 30) || 'none'}`);
            if (!mems.length) return { content: '', data: { all: [] } };

            return {
                content: mems.map(m => `- ${m.event} [${m.mood}]`).join('\n'),
                data: { length: mems.length, all: mems },
            };
        },
    });
}
