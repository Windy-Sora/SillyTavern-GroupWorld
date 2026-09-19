import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryAgent } from '../../agents/memory.js';
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
