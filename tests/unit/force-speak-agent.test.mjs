import assert from 'node:assert/strict';
import test from 'node:test';
import { createForceSpeakAgent } from '../../agents/force-speak.js';
import { execute } from '../../systems/agent-runtime.js';

const chars = [
    { name: 'Alice', avatar: 'alice.png' },
    { name: 'Bob', avatar: 'bob.png' },
];

function createHarness() {
    const renders = [];
    const agent = createForceSpeakAgent({
        renderPrompt: async (template, context, options) => {
            renders.push({ template, context, options });
            return template;
        },
        getDefaultLlmPrompt: () => 'DIRECTOR',
        buildJsonSchema: () => 'SCHEMA',
        parseLlmResponse: raw => JSON.parse(raw),
        matchCharacterByName: (name, members) => chars.find(c => c.name === name && members.includes(c.avatar)),
        buildCharacterProfilesText: () => 'FALLBACK PROFILES',
        log: () => {},
    });
    return { agent, renders };
}

function pool() {
    const chat = [{ mes: 'one' }, { mes: 'two' }];
    return {
        group: () => ({ members: ['alice.png', 'bob.png'], disabled_members: ['bob.png'] }),
        chat: () => chat,
        recentMessages: depth => chat.slice(-depth),
        forceSpeakCharacter: () => chars[0],
        forceSpeakPrompt: () => 'ONLY {charName}',
        worldInfoText: () => 'WORLD',
        profileEnabled: () => true,
        profilesText: () => 'PROFILES',
    };
}

test('ForceSpeak Agent injects context and selects only the requested enabled character', async t => {
    const original = console.log;
    console.log = () => {};
    t.after(() => { console.log = original; });
    const { agent, renders } = createHarness();
    let sent;
    const result = await execute(agent, {
        pool: pool(),
        caller: { supportsAbort: true, async generate(prompt) { sent = prompt; return '{"speakers":["Alice"],"reason":"forced"}'; } },
        config: {
            lang: 'en', llmContextDepth: 1, llmWorldInfoEnabled: true,
            profileEnabled: true, strictMode: true, call: { retries: 0, timeout: 100 },
        },
    });
    assert.deepEqual(result.speakers, ['alice.png']);
    assert.deepEqual(result.names, ['Alice']);
    assert.match(sent, /PROFILES/);
    assert.match(sent, /WORLD/);
    assert.match(sent, /SCHEMA/);
    assert.match(sent, /ONLY Alice/);
    assert.deepEqual(renders[0].context.enabledMembers, ['alice.png']);
    assert.deepEqual(renders[0].context.recentMessages, [{ mes: 'two' }]);
});

test('ForceSpeak Agent preserves unknown names and rejects malformed speaker lists', async () => {
    const { agent } = createHarness();
    const ctx = { enabledMembers: ['alice.png'] };
    assert.deepEqual(await agent.pipeline.parse('{"speakers":["Guest"]}', ctx), {
        speakers: ['Guest'],
        names: ['Guest'],
    });
    assert.equal(await agent.pipeline.parse('{"speakers":[]}', ctx), null);
    assert.equal(await agent.pipeline.parse('null', ctx), null);
});
