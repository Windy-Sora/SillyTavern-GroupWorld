/**
 * NPC Agent — generates NPCs from context and existing character lists.
 *
 * Pipeline: context → prompt → call → parse
 * Dedup: parse stage strips results with names that match existing NPCs or group members.
 */
import { sanitizeJson } from '../utils/json-utils.js';

export const DEFAULT_NPC_PROMPT = `You are an NPC generator for a roleplay scenario. Create new NPCs that fit naturally into the current story and setting based on the context below.

━━━ Context ━━━
Recent messages:
{{newRecentMessages}}

World info (activated entries):
{{worldInfo}}

World books (all selected entries):
{{worldBookImportance}}

Available characters:
{{existingCharacters}}

NPCs already in the scene:
{{npcList}}
━━━━━━━━━━━━━

Existing NPCs (DO NOT duplicate these names):
{{existingNpcs}}

Guidelines:
- Generate {{batchSize}} NPC(s) that feel organic to the current scene and world.
- Each NPC should have a distinct role and personality — no two should serve the same function.
- Names must be unique and NOT appear in the lists above.
- If the story already has enough NPCs for the current scene, you may generate fewer than requested.

Reply with ONLY a JSON object, no prose, no code fences:
{
  "npcs": [
    {
      "name": "NPC name",
      "description": "Physical appearance, background, role in the world",
      "personality": "Traits, speech style, temperament",
      "scenario": "Where and how the characters might encounter this NPC"{{firstMesLine}}
    }
  ]
}`;

const FIRST_MES_LINE = ',\n      "first_mes": "Opening line when meeting the characters"';

export function createNpcAgent({ renderPrompt, extractJsonObject, log }) {
    const DEFAULT_PROMPT = DEFAULT_NPC_PROMPT;

    return {
        id: 'npc',
        displayName: 'NPC Generator',
        contextAccess: ['chat', 'recentMessages', 'characters', 'group', 'settings', 'worldInfoText',
            'profilesText', 'npcExistingList', 'npcBatchSize', 'npcGenerateFirstMes'],
        pipelineOrder: ['context', 'prompt', 'call', 'parse'],
        pipeline: {
            async context(_input, _ctx, pool, settings) {
                const recentMessages = pool.recentMessages?.(settings.llmContextDepth ?? 20) ?? [];
                const existingNpcs = pool.npcExistingList?.() ?? [];
                const group = pool.group?.();
                const members = group?.members?.filter(a => !group.disabled_members?.includes(a)) ?? [];
                // Build character list with descriptions for the prompt
                const groupChars = members.map(av => {
                    const c = pool.characters?.()?.find(ch => ch.avatar === av);
                    if (!c) return null;
                    const desc = c.description || '';
                    return `- ${c.name}${desc ? ': ' + desc : ''}`;
                }).filter(Boolean);

                // Build existing NPC text for prompt
                const npcText = existingNpcs.length > 0
                    ? existingNpcs.map((n, i) => `${i + 1}. ${n.name} | ${n.scenario || 'no scenario'} | ${n.imported ? 'already imported as character card' : 'not imported'}`).join('\n')
                    : '(none yet)';

                const batchSize = pool.npcBatchSize?.() ?? settings.npcBatchSize ?? 3;
                const generateFirstMes = pool.npcGenerateFirstMes?.() ?? settings.npcGenerateFirstMes ?? false;

                const groupCharNames = members.map(av => {
                    const c = pool.characters?.()?.find(ch => ch.avatar === av);
                    return c?.name ?? '';
                }).filter(Boolean);

                return {
                    recentMessages,
                    existingNpcs,
                    existingNpcText: npcText,
                    groupChars,
                    groupCharNames,           // plain names for dedup
                    enabledMembers: members,     // avatar list — used by {{characters}} Provider
                    batchSize: Math.max(0, Math.min(batchSize, (settings.npcMaxCount ?? 10) - existingNpcs.length)),
                    generateFirstMes,
                };
            },

            async prompt(ctx, _state, pool, settings) {
                const promptTemplate = settings.npcPrompt || DEFAULT_PROMPT;
                const fmLine = ctx.generateFirstMes ? FIRST_MES_LINE : '';
                const charText = ctx.groupChars.length > 0 ? ctx.groupChars.join('\n') : '(none)';

                // Resolve all placeholders in one pass — Providers via global
                // registry, agent data via locals (injected into renderPrompt cache).
                return await renderPrompt(promptTemplate, {}, {
                    locals: {
                        firstMesLine: fmLine,
                        existingNpcs: ctx.existingNpcText,
                        batchSize: String(ctx.batchSize),
                        existingCharacters: charText,
                    },
                    maxPasses: 1,          // single pass — recursive would re-parse char
                    recursive: false,        // descriptions containing {{User}} etc.
                    debugPlaceholders: false,
                });
            },

            parse(raw, ctx) {
                let parsed;
                try {
                    parsed = JSON.parse(raw);
                } catch (e) {
                    const extracted = extractJsonObject(raw);
                    if (extracted) {
                        try { parsed = JSON.parse(sanitizeJson(extracted)); } catch (e2) {
                            log('NPC generation: invalid JSON after extraction:', e2.message);
                            return null;
                        }
                    } else {
                        log('NPC generation: invalid JSON response');
                        return null;
                    }
                }

                let npcs = parsed?.npcs ?? (Array.isArray(parsed) ? parsed : []);
                if (!Array.isArray(npcs) || npcs.length === 0) {
                    log('NPC generation: no npcs array in response');
                    return null;
                }

                // Dedup: strip NPCs with names matching existing NPCs or group characters
                const existingNames = new Set([
                    ...ctx.existingNpcs.map(n => n.name.toLowerCase()),
                    ...(ctx.groupCharNames || []).map(n => n.toLowerCase()),
                ]);

                const filtered = npcs.filter(npc => {
                    if (!npc.name || typeof npc.name !== 'string') return false;
                    if (npc.name.trim().length < 1) return false;
                    if (existingNames.has(npc.name.trim().toLowerCase())) {
                        log(`NPC dedup: skipped "${npc.name}" (already exists)`);
                        return false;
                    }
                    return true;
                });

                // Normalize
                return filtered.map(n => ({
                    name: n.name.trim(),
                    description: (n.description || '').trim(),
                    personality: (n.personality || '').trim(),
                    scenario: (n.scenario || '').trim(),
                    first_mes: ctx.generateFirstMes ? (n.first_mes || '').trim() : undefined,
                    imported: false,
                    importedAvatar: null,
                    createdAt: Date.now(),
                }));
            },
        },
    };
}
