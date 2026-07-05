/**
 * PostSpeech Agent — generates multimodal policy after each character message.
 *
 * Pipeline: context → prompt → call
 *
 * Output (JSON): { intents: [...], timing: { mode: 'immediate'|'deferred', delay: number } }
 *
 * Does NOT know ST internals, does NOT know capability implementations.
 * Only outputs abstract intents for the Execution Engine to resolve.
 */
import { CapabilityRegistry } from '../systems/capability-registry.js';
import { extractJsonObject, sanitizeJson } from '../utils/json-utils.js';

// ST-native Handlebars template placeholders — preserved as-is during
// renderPrompt so ST can substitute them later in its own pipeline.
const ST_NATIVE_PLACEHOLDERS = [
    'User', 'user', 'char', 'original',
    'anchorBefore', 'anchorAfter', 'system', 'persona',
    'wiBefore', 'loreBefore', 'wiAfter', 'loreAfter',
    'mesExamples', 'mesExamplesRaw', 'trim',
    'description', 'personality', 'scenario',
];

/** Default prompt for per-message PostSpeech. Uses {{capabilityListMessage}}. */
export const DEFAULT_PROMPT_MESSAGE = `You are a multimodal policy generator. Based on the character's message and the conversation context, decide which sensory capabilities should be activated for the user.

━━━ Available Capabilities ━━━
Each capability lists its params and when to use it. Only activate those whose "When" condition matches the current message.

{{capabilityListMessage}}

━━━ Context ━━━
Recent messages:
{{newRecentMessages}}

Character who just spoke:
Name: {{speakerName}}
Description: {{speakerDescription}}
They said: "{{speakerMessage}}"

Current scene:
{{worldInfo}}

━━━ ━━━━━━━━━━━━━━

Guidelines:
- Only activate capabilities that are LISTED above and make sense for this message.
- "tts" → adjust voice emotion/tone based on what the character is feeling
- "image" → request an image if the scene describes striking visual elements
- "emotion" → if the message contains strong emotional cues, describe the character's emotional expression
- Output 0-2 intents per message. Do NOT activate anything if nothing fits.
- If the message is short or purely functional (e.g. "Yes.", "OK."), skip.

Reply with ONLY a JSON object, no prose, no code fences:
{
  "intents": [
    {
      "type": "capability-id",
      "params": { "key": "value" }
    }
  ],
  "timing": { "mode": "immediate" }
}`;

/** Default prompt for per-round PostSpeech. Uses {{capabilityListRound}}. */
export const DEFAULT_PROMPT_ROUND = `You are a multimodal policy generator. Based on the complete conversation round, decide which sensory capabilities should be activated.

━━━ Available Capabilities ━━━
Each capability lists its params and when to use it. Only activate those whose "When" condition matches the current scene.

{{capabilityListRound}}

━━━ Context ━━━
Round summary — recent messages from this round:
{{newRecentMessages}}

World info (activated entries):
{{worldInfo}}

World books (all selected entries):
{{worldBookImportance}}
━━━━━━━━━━━━━

Guidelines:
- Analyze the ENTIRE round, not just a single message.
- "image" → generate a scene image for striking visual elements that emerged during this round.
- "emotion" → summarize the dominant emotional tone of the round.
- Output 0-2 intents per round. Do NOT activate anything if nothing fits.

Reply with ONLY a JSON object, no prose, no code fences:
{
  "intents": [
    {
      "type": "capability-id",
      "params": { "key": "value" }
    }
  ],
  "timing": { "mode": "immediate" }
}`;

export function createPostSpeechAgent({ renderPrompt, log }) {
    return {
        id: 'post-speech',
        displayName: 'PostSpeech Policy',
        contextAccess: ['chat', 'recentMessages', 'characters', 'group', 'settings', 'worldInfoText',
            'speakerMessage', 'speakerName', 'speakerDescription'],
        pipelineOrder: ['context', 'prompt', 'call'],
        pipeline: {
            async context(_input, _ctx, pool, settings) {
                const msg = pool.speakerMessage?.() ?? '';
                const speakerName = pool.speakerName?.() ?? '';
                const speakerDesc = pool.speakerDescription?.() ?? '';
                const mode = pool.postSpeechMode?.() ?? settings.postSpeechMode ?? 'message';
                const capabilities = CapabilityRegistry.listForMode(mode);

                return {
                    speakerMessage: msg,
                    speakerName,
                    speakerDescription: speakerDesc,
                    postSpeechMode: mode,
                    hasCapabilities: capabilities.length > 0,
                };
            },

            async prompt(ctx, _state, pool, settings) {
                if (!ctx.hasCapabilities) return null;

                const mode = ctx.postSpeechMode ?? 'message';
                const defaultPrompt = mode === 'round' ? DEFAULT_PROMPT_ROUND : DEFAULT_PROMPT_MESSAGE;
                const template = settings.postSpeechPrompt || defaultPrompt;

                // Resolve all {{...}} via renderPrompt. Capability lists are registered
                // Providers ({{capabilityListMessage}}, {{capabilityListRound}}, {{capabilityList}}).
                return await renderPrompt(template, {}, {
                    passthrough: ST_NATIVE_PLACEHOLDERS,
                });
            },
        },

        /**
         * Quick parse of LLM response — returns policy object or null.
         * Called by the orchestrator, not part of the pipeline.
         */
        parseResponse(raw) {
            if (!raw) return null;
            try {
                return JSON.parse(raw);
            } catch (e) {
                const extracted = extractJsonObject(raw);
                if (extracted) {
                    try { return JSON.parse(sanitizeJson(extracted)); } catch (_) {}
                }
                return null;
            }
        },
    };
}
