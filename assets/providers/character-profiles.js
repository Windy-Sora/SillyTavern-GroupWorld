import { registerProvider } from '../../provider-registry.js';

/**
 * {{character_profiles}} — Rendered character profiles.
 *
 * content: full text of all ready profiles (via buildCharacterProfilesText)
 * data:    per-character profile objects indexed by name for path queries
 *
 * Usage:
 *   {{character_profiles}}                          → all profiles text
 *   {{?character_profiles:$character}}              → current char's full profile text
 *   {{?character_profiles:$character.summary}}      → current char's summary
 *   {{?character_profiles:$character.motivation}}   → current char's motivation
 *   {{?character_profiles:Alice.tags}}              → Alice's tags (comma-separated)
 *
 * In Script Wrapper ($character = speaking character name):
 *   {{?character_profiles:$character.summary}}
 *   {{?character_profiles:$character.motivation}}
 */
export function register(buildCharacterProfilesText, getProfiles) {
    registerProvider({
        id: 'character_profiles',
        placeholder: '{{character_profiles}}',
        render: (ctx) => {
            // Reuse cached value set by characters provider (order: characters → character_profiles)
            if (ctx._profilesText === undefined) {
                ctx._profilesText = buildCharacterProfilesText();
            }

            // Build per-character data map keyed by name
            const profiles = getProfiles();
            const data = Object.create(null);
            for (const [avatar, prof] of Object.entries(profiles)) {
                if (prof.state !== 'ready' || !prof.name) continue;
                data[prof.name] = {
                    name: prof.name,
                    avatar,
                    summary: prof.profile?.summary || '',
                    tags: (prof.profile?.tags || []).join(', '),
                    motivation: prof.profile?.motivation || '',
                    relationships: prof.profile?.relationships || '',
                    // Raw fields for custom schemas
                    _raw: prof.profile || {},
                };
            }

            return { content: ctx._profilesText, data };
        },
    });
}
