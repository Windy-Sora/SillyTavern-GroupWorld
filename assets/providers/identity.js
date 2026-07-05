import { registerProvider } from '../../provider-registry.js';

export const DEFAULT_IDENTITY_PROMPT = `The following data defines each character's core identity. Use this as the definitive anchor for their personality, motivation, and behavior.

## Character Profiles (long-term stable identity kernel — highest priority)
Use DSL to query the current character's profile. In the Script Wrapper, $character is the speaker's name.

Full profile:        {{?character_profiles:$character}}
Summary only:        {{?character_profiles:$character.summary}}
Tags:                {{?character_profiles:$character.tags}}
Motivation:          {{?character_profiles:$character.motivation}}
Relationships:       {{?character_profiles:$character.relationships}}

## Character Memories (experiential context — informs but does not override profiles)
{{charMemory}}

## Imported World Summaries (cross-world background reference)
{{importedSummary}}

## Priority Rules
When information conflicts across sources:
1. Character Profile is the long-term stable identity kernel — it takes precedence over everything
2. Memories show what the character experienced, NOT who they are — they inform but do not redefine
3. Imported summaries provide world context only — they do not override character identity`;

/**
 * {{identity}} — User-defined identity anchoring prompt.
 */
export function register(settings) {
    registerProvider({
        id: 'identity',
        placeholder: '{{identity}}',
        render: () => {
            const raw = settings.identityPrompt || DEFAULT_IDENTITY_PROMPT;
            return { content: raw, data: null };
        },
    });
}
