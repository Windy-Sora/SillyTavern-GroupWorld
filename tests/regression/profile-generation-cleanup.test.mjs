import assert from 'node:assert/strict';
import test from 'node:test';
import { createProfileSystem } from '../../systems/profile-system.js';

test('BUG-10: failed profile generation always clears QUIET_PROMPT', async () => {
    const promptCalls = [];
    const system = createProfileSystem({
        settings: { profileEnabled: true, profileGeneratorPrompt: 'Profile {{charName}}', agentConfigs: { profile: {} } },
        EXT_KEY: 'gd',
        getChatMetadata: () => ({}),
        getChat: () => [],
        getCharacters: () => [{ avatar: 'alice.png', name: 'Alice' }],
        saveChatConditional: async () => {},
        getContext: () => ({ generateRaw: async () => '' }),
        setExtensionPrompt: (...args) => promptCalls.push(args),
        inject_ids: { QUIET_PROMPT: 'quiet' },
        extension_prompt_types: { IN_PROMPT: 0 },
        isRoundActive: () => false,
        renderPrompt: async prompt => prompt,
        createCaller: () => ({ generate: async () => { throw new Error('model failed'); } }),
    });
    await assert.rejects(system.generateSingleProfile('alice.png'), /model failed/);
    assert.deepEqual(promptCalls.at(-1), ['quiet', '', 0, 0, true]);
});
