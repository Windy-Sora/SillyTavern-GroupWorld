/**
 * Memory Agent — extracts character memories from conversation context.
 *
 * Pipeline: context → prompt → call → parse → validate
 *
 * Memory record: { event, mood, round, timestamp }
 * Schema and render are user-customizable via settings.
 */
import { sanitizeJson } from '../utils/json-utils.js';

export const DEFAULT_MEMORY_PROMPT = `You are a character memory extractor. Based on the conversation below, extract key memories for the specified character.

━━━ Context ━━━
Character: {{charName}}
Character description: {{charDescription}}
Character personality: {{charPersonality}}

Recent conversation (this round):
{{newRecentMessages}}

Existing memories for this character (do NOT duplicate):
{{existingMemories}}
━━━━━━━━━━━━━

Guidelines:
- Extract 1-3 new memories that are personally significant to {{charName}}.
- Focus on events, emotions, relationships, and decisions that matter to THEM.
- Do NOT repeat anything already in "Existing memories".
- If nothing significant happened for this character in this round, output an empty array.
- Each memory should be a concise 1-2 sentence entry.

Reply with ONLY a JSON object, no prose, no code fences:
{
  "memories": [
    {
      "event": "What happened, from this character's perspective",
      "mood": "happy|sad|angry|fearful|excited|neutral|mixed"
    }
  ]
}`;

export const DEFAULT_MEMORY_SCHEMA = JSON.stringify({
    type: 'object',
    properties: {
        memories: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    event: { type: 'string', description: 'Memory event description' },
                    mood: { type: 'string', enum: ['happy','sad','angry','fearful','excited','neutral','mixed'] },
                },
                required: ['event', 'mood'],
            },
        },
    },
    required: ['memories'],
}, null, 2);

export const DEFAULT_MEMORY_RENDER = `{{#charMemory:all}}
  {{?charMemory:all[$it].event}} ({{?charMemory:all[$it].mood}})
{{/charMemory:all}}`;

export const DEFAULT_MEMORY_COMPRESS_PROMPT = `Given the following character memories, produce a concise one-paragraph summary that captures the key events, emotional arcs, and character development. Preserve important names, places, and turning points.

Character: {{charName}}
Description: {{charDescription}}
Personality: {{charPersonality}}

Memories to compress:
{{memories}}

Output ONLY the summary text. No JSON, no formatting, no preamble. Write in the same language as the input memories.`;

export function createMemoryAgent({ renderPrompt, extractJsonObject, log }) {
    return {
        id: 'memory',
        displayName: 'Memory Extractor',
        contextAccess: ['chat', 'recentMessages', 'characters', 'settings', 'group',
            'memoryCharacter', 'memoryExistingList', 'llmContextDepth'],
        pipelineOrder: ['context', 'prompt', 'call', 'parse', 'validate'],
        pipeline: {
            async context(_input, _ctx, pool, settings) {
                const char = pool.memoryCharacter?.() ?? null;
                const existingMemories = pool.memoryExistingList?.() ?? [];
                const llmDepth = Math.min(settings.llmContextDepth ?? 30, pool.chat()?.length ?? 0);
                const recentMessages = pool.recentMessages?.(llmDepth) ?? [];

                const existingText = existingMemories.length > 0
                    ? existingMemories.map((m, i) => `${i + 1}. ${m.event} [${m.mood}]`).join('\n')
                    : '(none yet)';

                return {
                    charName: char?.name || '',
                    charDescription: char?.description || '',
                    charPersonality: char?.personality || '',
                    recentMessages,
                    existingMemories,
                    existingText,
                    character: char,
                };
            },

            async prompt(ctx, _state, pool, settings) {
                const template = settings.memoryPrompt || DEFAULT_MEMORY_PROMPT;

                let filled = template
                    .replace(/\{\{charName\}\}/g, ctx.charName)
                    .replace(/\{\{charDescription\}\}/g, ctx.charDescription)
                    .replace(/\{\{charPersonality\}\}/g, ctx.charPersonality)
                    .replace(/\{\{existingMemories\}\}/g, ctx.existingText);

                return await renderPrompt(filled, { recentMessages: ctx.recentMessages });
            },

            parse(raw, ctx, pool) {
                let parsed;
                try {
                    parsed = JSON.parse(raw);
                } catch (e) {
                    const extracted = extractJsonObject(raw);
                    if (extracted) {
                        try { parsed = JSON.parse(sanitizeJson(extracted)); } catch (e2) {
                            log('Memory extract: invalid JSON after extraction:', e2.message);
                            return null;
                        }
                    } else { log('Memory extract: invalid JSON'); return null; }
                }

                const memories = parsed?.memories ?? (Array.isArray(parsed) ? parsed : []);
                if (!Array.isArray(memories)) return null;

                return memories
                    .filter(m => m.event && typeof m.event === 'string' && m.event.trim().length > 0)
                    .map(m => ({
                        event: m.event.trim(),
                        mood: m.mood || 'neutral',
                        round: pool.chat()?.length ?? 0,
                        timestamp: Date.now(),
                    }));
            },

            validate(parsed, ctx) {
                if (!parsed || !Array.isArray(parsed)) return null;
                // Dedup: skip memories whose event text already exists
                const existingEvents = new Set(
                    (ctx.existingMemories || []).map(m => m.event?.toLowerCase?.() || '')
                );
                return parsed.filter(m => !existingEvents.has((m.event || '').toLowerCase()));
            },
        },
    };
}
