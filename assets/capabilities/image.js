import { CapabilityRegistry } from '../../systems/capability-registry.js';

export function register({ log }) {
    CapabilityRegistry.register({
        id: 'image',
        displayName: 'Image Generation',
        description: 'Generate a scene image based on the current visual description.',
        promptHint: 'Activate when the scene contains striking visual elements (landscape, action, character appearance changes, group gathering). Do NOT activate for ordinary dialogue or internal monologue.',
        schema: {
            intents: ['image', 'scene', 'visual', 'picture', 'photo'],
            params: {
                prompt: { type: 'string', required: true, description: 'Image generation prompt describing the scene' },
                style:  { type: 'string', values: ['realistic','anime','sketch','painting','cinematic'], default: 'cinematic', description: 'Visual style of the generated image' },
                composition: { type: 'string', values: ['portrait','landscape','square'], default: 'landscape', description: 'Image aspect ratio' },
            },
        },
        constraints: { maxPerMessage: 1, cooldown: 5000 },
        executor: async (params) => {
            log(`[Image] style=${params.style} composition=${params.composition} prompt="${(params.prompt || '').substring(0, 80)}..." — (placeholder: not connected to ComfyUI/ST image extension)`);
        },
    });
}
