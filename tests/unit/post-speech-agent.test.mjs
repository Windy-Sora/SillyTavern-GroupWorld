import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createPostSpeechAgent,
    DEFAULT_PROMPT_MESSAGE,
    DEFAULT_PROMPT_ROUND,
} from '../../agents/post-speech.js';
import { execute } from '../../systems/agent-runtime.js';
import { CapabilityRegistry } from '../../systems/capability-registry.js';

function register(t, id, scope) {
    CapabilityRegistry.register({ id, scope, executor: async () => {} });
    t.after(() => CapabilityRegistry.unregister(id));
}

test('PostSpeech Agent selects message capabilities and passes rendering controls', async t => {
    register(t, 'test.post.message', 'message');
    register(t, 'test.post.round', 'round');
    const renders = [];
    const controller = new AbortController();
    const agent = createPostSpeechAgent({
        renderPrompt: async (template, context, options) => { renders.push({ template, context, options }); return 'MESSAGE POLICY'; },
        log: () => {},
    });
    const original = console.log;
    console.log = () => {};
    t.after(() => { console.log = original; });
    const result = await execute(agent, {
        pool: {
            speakerMessage: () => 'Hello',
            speakerName: () => 'Alice',
            speakerDescription: () => 'Mage',
            postSpeechMode: () => 'message',
        },
        caller: { supportsAbort: true, async generate(prompt) { assert.equal(prompt, 'MESSAGE POLICY'); return '{"intents":[]}'; } },
        config: { strictMode: true, call: { retries: 0, timeout: 100, signal: controller.signal } },
    });
    assert.equal(result, '{"intents":[]}');
    assert.equal(renders[0].template, DEFAULT_PROMPT_MESSAGE);
    assert.equal(renders[0].options.signal, controller.signal);
    assert.equal(renders[0].options.passthrough.includes('User'), true);
});

test('PostSpeech Agent chooses round prompts and skips model calls without matching capabilities', async t => {
    register(t, 'test.post.round-only', 'round');
    const agent = createPostSpeechAgent({ renderPrompt: async template => template, log: () => {} });
    const roundCtx = await agent.pipeline.context(undefined, undefined, {
        speakerMessage: () => '', speakerName: () => '', speakerDescription: () => '', postSpeechMode: () => 'round',
    }, {});
    assert.equal(roundCtx.hasCapabilities, true);
    assert.equal(await agent.pipeline.prompt(roundCtx, undefined, {}, {}), DEFAULT_PROMPT_ROUND);

    const messageCtx = await agent.pipeline.context(undefined, undefined, {
        speakerMessage: () => '', speakerName: () => '', speakerDescription: () => '', postSpeechMode: () => 'message',
    }, {});
    assert.equal(messageCtx.hasCapabilities, false);
    let calls = 0;
    const original = console.log;
    console.log = () => {};
    t.after(() => { console.log = original; });
    const result = await execute(agent, {
        pool: {
            speakerMessage: () => '', speakerName: () => '', speakerDescription: () => '', postSpeechMode: () => 'message',
        },
        caller: { async generate() { calls++; return 'unexpected'; } },
        config: { strictMode: true },
    });
    assert.equal(result, null);
    assert.equal(calls, 0);
});

test('PostSpeech Agent parses clean, fenced, trailing-comma, and invalid responses', () => {
    const agent = createPostSpeechAgent({ renderPrompt: async value => value, log: () => {} });
    assert.deepEqual(agent.parseResponse('{"intents":[],"timing":{"mode":"immediate"}}'), {
        intents: [], timing: { mode: 'immediate' },
    });
    assert.deepEqual(agent.parseResponse('```json\n{"intents":[{"type":"tts",}],}\n```'), {
        intents: [{ type: 'tts' }],
    });
    assert.equal(agent.parseResponse('broken'), null);
    assert.equal(agent.parseResponse(''), null);
});
