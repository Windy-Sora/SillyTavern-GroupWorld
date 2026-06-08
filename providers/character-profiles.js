import { registerProvider } from '../provider-registry.js';

export function register(buildCharacterProfilesText) {
    registerProvider({
        id: 'character_profiles',
        placeholder: '{{character_profiles}}',
        render: (ctx) => {
            // Reuse cached value set by characters provider (order: characters → character_profiles)
            if (ctx._profilesText === undefined) {
                ctx._profilesText = buildCharacterProfilesText();
            }
            return { content: ctx._profilesText };
        },
    });
}
