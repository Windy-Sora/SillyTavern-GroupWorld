import assert from 'node:assert/strict';
import test from 'node:test';
import { createDirectorAgent } from '../../agents/director.js';
import { execute } from '../../systems/agent-runtime.js';

const characters = [
    { name: 'Alice', avatar: 'alice.png' },
    { name: 'Bob', avatar: 'bob.png' },
    { name: 'Carol', avatar: 'carol.png' },
];

function matchCharacterByName(name, enabledMembers) {
    return characters.find(character => character.name.toLowerCase() === String(name).toLowerCase()
        && enabledMembers.includes(character.avatar));
}

function createHarness(overrides = {}) {
    const calls = {
        render: [],
        schema: 0,
        profiles: 0,
        history: 0,
        logs: [],
    };
    const dependencies = {
        async renderPrompt(template, context, options) {
            calls.render.push({ template, context, options });
            return template;
        },
        getDefaultLlmPrompt: () => 'DEFAULT PROMPT',
        buildJsonSchema: () => { calls.schema++; return 'JSON SCHEMA'; },
        parseLlmResponse: raw => JSON.parse(raw),
        matchCharacterByName,
        buildCharacterProfilesText: () => { calls.profiles++; return 'PROFILE TEXT'; },
        getDirectorHistory: () => {
            calls.history++;
            return [{ speakers: ['Alice'], reason: 'previous' }];
        },
        log: message => calls.logs.push(message),
        ...overrides,
    };
    return { agent: createDirectorAgent(dependencies), calls };
}

function createPool(overrides = {}) {
    const messages = [
        { name: 'User', mes: 'first', is_user: true },
        { name: 'Alice', mes: 'second' },
        { name: 'User', mes: 'third', is_user: true },
    ];
    return {
        group: () => ({
            members: ['alice.png', 'bob.png', 'carol.png'],
            disabled_members: ['carol.png'],
        }),
        chat: () => messages,
        recentMessages: depth => messages.slice(-depth),
        worldInfoText: () => 'WORLD INFO',
        profilesText: () => 'POOL PROFILES',
        llmWorldInfoEnabled: () => true,
        llmHistoryEnabled: () => true,
        llmScriptContinuity: () => true,
        profileEnabled: () => true,
        ...overrides,
    };
}

function silenceRuntime(t) {
    const original = console.log;
    console.log = () => {};
    t.after(() => { console.log = original; });
}

test('Director Agent executes context, prompt injection, parsing, and validation as one pipeline', async t => {
    silenceRuntime(t);
    const controller = new AbortController();
    const { agent, calls } = createHarness();
    const result = await execute(agent, {
        pool: createPool(),
        caller: {
            supportsAbort: true,
            async generate(prompt, { signal }) {
                assert.equal(signal instanceof AbortSignal, true);
                assert.equal(signal.aborted, false);
                assert.notEqual(signal, controller.signal);
                assert.match(prompt, /POOL PROFILES/);
                assert.match(prompt, /"reason": "previous"/);
                assert.match(prompt, /WORLD INFO/);
                assert.match(prompt, /DEFAULT PROMPT/);
                assert.match(prompt, /JSON SCHEMA/);
                return JSON.stringify({
                    speakers: ['Bob', 'Unknown', 'Alice', 'Bob'],
                    reason: 'ordered',
                    scripts: { Bob: 'respond' },
                    ledger_update: { beat: 1 },
                });
            },
        },
        config: {
            llmContextDepth: 2,
            llmMaxSpeakers: 2,
            llmWorldInfoEnabled: true,
            llmHistoryEnabled: true,
            llmScriptContinuity: true,
            profileEnabled: true,
            call: { retries: 0, timeout: 100, signal: controller.signal },
        },
    });

    assert.deepEqual(result, {
        ledger_update: { beat: 1 },
        speakers: ['bob.png', 'alice.png'],
        names: ['Bob', 'Alice'],
        reason: 'ordered',
        scripts: { Bob: 'respond' },
        loreAssignments: null,
    });
    assert.equal(calls.render.length, 1);
    assert.deepEqual(calls.render[0].context.recentMessages.map(message => message.mes), ['second', 'third']);
    assert.deepEqual(calls.render[0].context.enabledMembers, ['alice.png', 'bob.png']);
    assert.equal(calls.render[0].context.maxSpeakers, 2);
    assert.equal(calls.render[0].options.signal, controller.signal);
    assert.equal(calls.schema, 1);
    assert.equal(calls.history, 1);
    assert.equal(calls.profiles, 0);
    assert.equal(calls.logs.some(message => message.includes('Unknown')), true);
});

test('Director Agent does not duplicate data represented by explicit prompt placeholders', async () => {
    const { agent, calls } = createHarness({
        renderPrompt: async (_template, context) => `rendered:${context.maxSpeakers}`,
    });
    const settings = {
        llmPrompt: '{{worldInfo}} {{previousPlan}} {{character_profiles}} {{llmJsonSchema}}',
        llmContextDepth: 1,
        llmMaxSpeakers: 1,
        llmWorldInfoEnabled: true,
        llmHistoryEnabled: true,
        llmScriptContinuity: true,
        profileEnabled: true,
    };
    const ctx = await agent.pipeline.context(undefined, undefined, createPool(), settings);
    const prompt = await agent.pipeline.prompt(ctx, undefined, createPool(), settings);

    assert.equal(prompt, 'rendered:1');
    assert.equal(calls.schema, 0);
    assert.equal(calls.history, 0);
    assert.equal(calls.profiles, 0);
});

test('Director Agent history mode applies its configured window and wrapper', async () => {
    const history = [
        { speakers: ['Alice'], turn: 1 },
        { speakers: ['Bob'], turn: 2 },
        { speakers: ['Alice'], turn: 3 },
    ];
    const { agent } = createHarness({ getDirectorHistory: () => history });
    const settings = {
        llmPrompt: 'BASE',
        llmScriptContinuity: true,
        llmScriptContinuityMode: 'history',
        llmScriptContinuityCount: 2,
        llmScriptContinuityHistoryWrapper: 'HISTORY={{previousPlans}}',
        llmHistoryEnabled: true,
        llmWorldInfoEnabled: false,
        profileEnabled: false,
    };
    const ctx = await agent.pipeline.context(undefined, undefined, createPool(), settings);
    const prompt = await agent.pipeline.prompt(ctx, undefined, createPool(), settings);

    assert.match(prompt, /HISTORY=/);
    assert.doesNotMatch(prompt, /"turn": 1/);
    assert.match(prompt, /"turn": 2/);
    assert.match(prompt, /"turn": 3/);
});

test('Director Agent rejects malformed, empty, and fully disabled plans', async () => {
    const { agent } = createHarness();
    const ctx = {
        enabledMembers: ['alice.png'],
        runtimeContext: { maxSpeakers: 3 },
    };

    assert.equal(agent.pipeline.parse('null', ctx), null);
    assert.equal(agent.pipeline.parse('{"speakers":[]}', ctx), null);
    const disabled = agent.pipeline.parse('{"speakers":["Carol"]}', ctx);
    assert.equal(agent.pipeline.validate(disabled, ctx), null);
});

test('Director Agent validates speaker and name arrays in lockstep', () => {
    const { agent } = createHarness();
    const ctx = { enabledMembers: ['alice.png'] };
    const parsed = {
        speakers: ['alice.png', 'bob.png'],
        names: ['Alice', 'Bob'],
        reason: 'probe',
    };
    assert.deepEqual(agent.pipeline.validate(parsed, ctx), {
        speakers: ['alice.png'],
        names: ['Alice'],
        reason: 'probe',
    });
});
