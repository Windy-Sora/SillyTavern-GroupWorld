import { CapabilityRegistry } from '../../systems/capability-registry.js';

export function register({ log }) {
    CapabilityRegistry.register({
        id: 'emotion',
        displayName: 'Emotion Detection',
        description: 'Detects emotional cues in character messages and logs them.',
        promptHint: 'Activate when the character line has clear emotional tone (angry, sad, excited, etc.). Skip for neutral/factual lines.',
        schema: {
            intents: ['emotion', 'emotional', 'mood', 'tone'],
            params: {
                mood: { type: 'string', values: ['neutral','happy','sad','angry','fearful','excited','whisper'], default: 'neutral', description: 'Dominant emotion in this line' },
            },
        },
        executor: async (params) => {
            log(`[Emotion] ${params.mood || params.emotion || 'neutral'} — ${params.reason || ''}`);
        },
    });
}
