import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryAgent, DEFAULT_MEMORY_SCHEMA } from '../../agents/memory.js';
import { inspectMemorySchema } from '../../agents/memory-schema.js';
import { execute } from '../../systems/agent-runtime.js';

function harness() {
    const logs = [];
    const renders = [];
    return {
        logs,
        renders,
        agent: createMemoryAgent({
            renderPrompt: async (prompt, context) => { renders.push({ prompt, context }); return prompt; },
            extractJsonObject: raw => raw.match(/\{[\s\S]*\}/)?.[0] || null,
            log: (...args) => logs.push(args.join(' ')),
        }),
    };
}

test('Memory Agent builds context, normalizes memories, and removes existing events', async t => {
    const originalLog = console.log;
    console.log = () => {};
    t.after(() => { console.log = originalLog; });
    const { agent, renders } = harness();
    const chat = [{ mes: 'old' }, { mes: 'new' }];
    const result = await execute(agent, {
        pool: {
            memoryCharacter: () => ({ name: 'Alice', description: 'Mage', personality: 'Calm' }),
            memoryExistingList: () => [{ event: 'Found a key', mood: 'excited' }],
            chat: () => chat,
            recentMessages: depth => chat.slice(-depth),
        },
        caller: {
            supportsAbort: true,
            async generate() {
                return '```json\n{"memories":[{"event":" Found a key ","mood":"happy"},{"event":"Met Bob"},{"event":"   "}],}\n```';
            },
        },
        config: { llmContextDepth: 1, strictMode: true, call: { retries: 0, timeout: 100 } },
    });
    assert.equal(result.length, 1);
    assert.equal(result[0].event, 'Met Bob');
    assert.equal(result[0].mood, 'neutral');
    assert.equal(result[0].round, 2);
    assert.equal(Number.isFinite(result[0].timestamp), true);
    assert.match(renders[0].prompt, /Alice/);
    assert.match(renders[0].prompt, /Found a key \[excited\]/);
    assert.deepEqual(renders[0].context.recentMessages, [{ mes: 'new' }]);
});

test('Memory Agent handles array responses, empty context, and malformed JSON', async () => {
    const { agent, logs } = harness();
    const ctx = await agent.pipeline.context(undefined, undefined, {
        memoryCharacter: () => null,
        memoryExistingList: () => [],
        chat: () => [],
        recentMessages: () => [],
    }, {});
    assert.equal(ctx.charName, '');
    assert.equal(ctx.existingText, '(none yet)');
    const parsed = agent.pipeline.parse('[{"event":"A","mood":"sad"}]', ctx, { chat: () => [] });
    assert.equal(parsed[0].event, 'A');
    assert.equal(agent.pipeline.parse('{"memories":"bad"}', ctx, { chat: () => [] }), null);
    assert.equal(agent.pipeline.parse('broken', ctx, { chat: () => [] }), null);
    assert.equal(logs.some(line => line.includes('invalid JSON')), true);
    assert.equal(agent.pipeline.validate(null, ctx), null);
});

test('Custom memory Schema reaches the model and rejects nonconforming output before normalization', async () => {
    const { agent, renders } = harness();
    const schema = JSON.stringify({
        type: 'object', properties: { memories: { type: 'array', items: {
            type: 'object', properties: { event: { type: 'string', minLength: 2 }, mood: { type: 'string', enum: ['happy'] } },
            required: ['event', 'mood'], additionalProperties: false,
        } } }, required: ['memories'], additionalProperties: false,
    });
    const context = await agent.pipeline.context(null, null, {
        memoryCharacter: () => ({ name: 'Alice' }), memoryExistingList: () => [], chat: () => [], recentMessages: () => [],
    }, {});
    await agent.pipeline.prompt(context, null, null, { memoryJsonSchema: schema });
    assert.match(renders[0].prompt, /Output must follow this JSON Schema/);
    assert.match(renders[0].prompt, /"minLength":2/);
    assert.equal(agent.pipeline.parse('{"memories":[{"event":"OK","mood":"happy"}]}', context, { chat: () => [] }, { memoryJsonSchema: schema })[0].event, 'OK');
    assert.throws(() => agent.pipeline.parse('{"memories":[{"event":"X","mood":"happy"}]}', context, { chat: () => [] }, { memoryJsonSchema: schema }), /MEMORY_SCHEMA_RESPONSE_MISMATCH/);
    assert.throws(() => agent.pipeline.parse('[{"event":"OK","mood":"happy"}]', context, { chat: () => [] }, { memoryJsonSchema: schema }), /MEMORY_SCHEMA_RESPONSE_MISMATCH/);
    assert.throws(() => agent.pipeline.parse('{"memories":[{"event":"OK","mood":"sad"}]}', context, { chat: () => [] }, { memoryJsonSchema: schema }), /MEMORY_SCHEMA_RESPONSE_MISMATCH/);
});

test('Memory Schema accepts its displayed default and rejects unsupported storage shapes', () => {
    assert.equal(inspectMemorySchema(DEFAULT_MEMORY_SCHEMA).properties.memories.type, 'array');
    assert.equal(inspectMemorySchema(''), null);
    for (const schema of ['not JSON', '{}', '{"type":"array"}', JSON.stringify({
        type: 'object', properties: { memories: { type: 'array', items: {
            type: 'object', properties: { event: { type: 'string' }, location: { type: 'string' } }, required: ['event'],
        } } }, required: ['memories'],
    })]) assert.throws(() => inspectMemorySchema(schema), /INVALID_MEMORY_JSON_SCHEMA/);
});
