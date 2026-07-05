/**
 * Profile Agent — generates structured character profiles.
 *
 * Extracted from profile-system.js generateSingleProfile().
 * Pipeline: context → prompt → call → parse → validate
 */
import { sanitizeJson } from '../utils/json-utils.js';

export function createProfileAgent({
    renderPrompt,
    extractJsonObject,
    log,
}) {
    return {
        id: 'profile',
        displayName: 'Profile Generator',
        contextAccess: ['character', 'settings'],
        pipelineOrder: ['context', 'prompt', 'call', 'parse', 'validate'],
        pipeline: {
            async context(_input, _ctx, pool, settings) {
                const char = pool.character?.();
                if (!char) throw new Error('No character in context');
                return {
                    name: char.name,
                    description: char.description || '',
                    personality: char.personality || '',
                    scenario: char.scenario || '',
                };
            },

            async prompt(ctx, _state, pool, settings) {
                const generatorPrompt = settings.profileGeneratorPrompt ||
                    pool.profileGeneratorDefault?.() || '';
                const schemaText = settings.profileJsonSchema ||
                    pool.profileSchemaDefault?.() || '';

                let filled = generatorPrompt
                    .replace(/\{\{charName\}\}/g, ctx.name)
                    .replace(/\{\{charDescription\}\}/g, ctx.description)
                    .replace(/\{\{charPersonality\}\}/g, ctx.personality)
                    .replace(/\{\{charScenario\}\}/g, ctx.scenario);

                // Run through renderPrompt so registered providers resolve
                filled = await renderPrompt(filled, {});

                return filled;
            },

            async parse(raw, ctx, pool, settings) {
                let parsed;
                try {
                    parsed = JSON.parse(raw);
                } catch (e) {
                    const extracted = extractJsonObject(raw);
                    if (extracted) {
                        try { parsed = JSON.parse(sanitizeJson(extracted)); } catch (e2) {
                            throw new Error(`Profile generation: invalid JSON after extraction: ${e2.message}`);
                        }
                    } else throw new Error('Profile generation: invalid JSON response');
                }
                return parsed;
            },

            async validate(parsed, ctx, pool, settings) {
                // Schema validation — ensure it has at least summary field
                if (!parsed || typeof parsed !== 'object') return null;
                if (!parsed.summary && !parsed.tags && !parsed.motivation && !parsed.relationships) {
                    // Flatten: if the response has a single key that's an object, use that
                    const keys = Object.keys(parsed);
                    if (keys.length === 1 && typeof parsed[keys[0]] === 'object') {
                        return parsed[keys[0]];
                    }
                }
                return parsed;
            },
        },
    };
}
