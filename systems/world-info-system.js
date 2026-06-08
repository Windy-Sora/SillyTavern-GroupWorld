export function createWorldInfoSystem({ settings, getChat, getCharacters, checkWorldInfo, world_info_include_names, getContext, power_user, log }) {

    async function buildDirectorWorldInfo(enabledMembers) {
        if (!settings.llmWorldInfoEnabled) {
            return { text: '', entries: [] };
        }

        try {
            const chat = getChat();
            const characters = getCharacters();
            const coreChat = chat.filter(x => !x.is_system);
            const chatForWI = coreChat.map(x => world_info_include_names ? `${x.name}: ${x.mes}` : x.mes).reverse();
            const maxCtx = Number(getContext().maxContext) || 100000;

            const personaText = power_user.persona_description || '';
            const allDesc = enabledMembers
                .map(a => characters.find(c => c.avatar === a))
                .filter(Boolean)
                .map(c => [c.description, c.personality, c.scenario].filter(Boolean).join(' '))
                .join(' ');
            const firstMember = characters.find(c => enabledMembers.includes(c.avatar));

            const activated = await checkWorldInfo(chatForWI, maxCtx, false, {
                trigger: 'normal',
                personaDescription: personaText,
                characterDescription: allDesc,
                characterPersonality: firstMember?.personality || '',
                characterDepthPrompt: '',
                scenario: firstMember?.scenario || '',
                creatorNotes: '',
            });

            const entries = Array.from(activated?.allActivatedEntries || []);
            const text = entries.length > 0
                ? entries.map(e => {
                    const label = e.comment || e.uid || 'entry';
                    const content = e.content || '';
                    return `[${label}]\n${content}`;
                }).join('\n')
                : ((activated?.worldInfoBefore || '') + (activated?.worldInfoAfter || ''));

            log(`World Info: ${entries.length} entries activated`, entries.map(e => e.comment || e.uid));

            return { text, entries };
        } catch (e) {
            console.warn('[GroupDirector] World Info fetch failed:', e.message);
            return { text: '', entries: [] };
        }
    }

    return { buildDirectorWorldInfo };
}
