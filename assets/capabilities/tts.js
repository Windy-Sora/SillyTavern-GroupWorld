import { CapabilityRegistry } from '../../systems/capability-registry.js';

export function register({ log }) {
    CapabilityRegistry.register({
        id: 'tts',
        displayName: 'TTS Voice',
        description: 'Adjust voice emotion, speed, and pitch to match the character\'s tone.',
        promptHint: 'Activate when the character\'s emotional tone is clear and should be reflected in their voice. Skip for short/functional lines like "Yes." or "OK."',
        schema: {
            intents: ['tts', 'voice', 'speech', 'tone'],
            params: {
                emotion: { type: 'string', values: ['neutral','happy','sad','angry','fearful','excited','whisper','shout'], default: 'neutral', description: 'Voice emotion matching character tone' },
                speed:   { type: 'number', min: 0.5, max: 2.0, default: 1.0, description: 'Speaking speed multiplier' },
                pitch:   { type: 'number', min: 0.5, max: 2.0, default: 1.0, description: 'Voice pitch multiplier' },
            },
        },
        constraints: { maxPerMessage: 1, cooldown: 1000 },
        executor: async (params) => {
            log(`[TTS] emotion=${params.emotion} speed=${params.speed} pitch=${params.pitch} — (placeholder: not connected to ST TTS extension)`);
        },
    });
}
