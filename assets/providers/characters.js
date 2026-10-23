import { registerProvider } from '../../provider-registry.js';

export function register(settings, characters, buildCharacterProfilesText) {
    registerProvider({
        id: 'characters',
        placeholder: '{{characters}}',
        render: (ctx) => {
            const members = ctx.enabledMembers || [];
            // Build profiles text once and cache — this provider runs before
            // character_profiles in registry order, so cache for the next one
            if (ctx._profilesText === undefined) {
                ctx._profilesText = buildCharacterProfilesText();
            }
            const profilesActive = settings.profileEnabled && !!ctx._profilesText;
            const memberCharacters = members.map(a => characters.find(c => c.avatar === a)).filter(Boolean);
            const ambiguous = c => memberCharacters.filter(other => other.name.toLowerCase() === c.name.toLowerCase()).length > 1;
            return {
                content: members.map(a => {
                    const c = characters.find(c => c.avatar === a);
                    if (!c) return '';
                    const label = ambiguous(c) ? `${c.name} [speaker id: ${c.avatar}]` : c.name;
                    if (profilesActive) {
                        // Profiles are active — suppress bulky descriptions to save tokens
                        return `- ${label}`;
                    }
                    const desc = c.description || '';
                    const showDesc = settings.llmCharDescMode === 'full'
                        ? desc
                        : desc.slice(0, settings.llmCharDescLength);
                    const truncated = showDesc.length < desc.length ? `${showDesc}…` : showDesc;
                    return `- ${label}: ${truncated}`;
                }).filter(Boolean).join('\n') + (memberCharacters.some(ambiguous)
                    ? '\nSame-name cards: use their exact speaker id (avatar filename) in speakers, scripts and loreAssignments keys; never use the ambiguous name.' : ''),
            };
        },
    });
}
