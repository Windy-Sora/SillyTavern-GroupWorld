import assert from 'node:assert/strict';
import test from 'node:test';
import { createNpcAgent } from '../../agents/npc.js';
import { execute } from '../../systems/agent-runtime.js';

function harness() {
    const renders = [];
    const logs = [];
    return {
        renders,
        logs,
        agent: createNpcAgent({
            renderPrompt: async (template, context, options) => { renders.push({ template, context, options }); return template; },
            extractJsonObject: raw => raw.match(/\{[\s\S]*\}/)?.[0] || null,
            log: message => logs.push(message),
        }),
    };
}

test('NPC Agent renders local context, caps batches, and removes duplicate names', async t => {
    const original = console.log;
    console.log = () => {};
    t.after(() => { console.log = original; });
    const { agent, renders, logs } = harness();
    const chars = [
        { name: 'Alice', avatar: 'alice.png', description: 'Mage' },
        { name: 'Disabled', avatar: 'off.png' },
    ];
    const result = await execute(agent, {
        pool: {
            recentMessages: () => [{ mes: 'scene' }],
            npcExistingList: () => [{ name: 'Guard', scenario: 'Gate', imported: true }],
            group: () => ({ members: ['alice.png', 'off.png'], disabled_members: ['off.png'] }),
            characters: () => chars,
            npcBatchSize: () => 5,
            npcGenerateFirstMes: () => true,
        },
        caller: {
            supportsAbort: true,
            async generate() {
                return '{"npcs":[{"name":" Guard "},{"name":"Alice"},{"name":"Mira","description":" Scout ","first_mes":" Hi "}]}';
            },
        },
        config: { npcMaxCount: 3, strictMode: true, call: { retries: 0, timeout: 100 } },
    });
    assert.equal(renders[0].options.locals.batchSize, '2');
    assert.match(renders[0].options.locals.existingCharacters, /Alice: Mage/);
    assert.match(renders[0].options.locals.firstMesLine, /first_mes/);
    assert.equal(result.length, 1);
    assert.deepEqual({ ...result[0], createdAt: 0 }, {
        name: 'Mira', description: 'Scout', personality: '', scenario: '', first_mes: 'Hi',
        imported: false, importedAvatar: null, createdAt: 0,
    });
    assert.equal(logs.filter(line => line.includes('dedup')).length, 2);
});

test('NPC Agent handles no group, disabled first messages, arrays, and malformed output', async () => {
    const { agent, logs } = harness();
    const ctx = await agent.pipeline.context(undefined, undefined, {
        recentMessages: () => [],
        npcExistingList: () => [],
        group: () => null,
        characters: () => [],
        npcBatchSize: () => 1,
        npcGenerateFirstMes: () => false,
    }, { npcMaxCount: 10 });
    assert.equal(ctx.existingNpcText, '(none yet)');
    assert.deepEqual(ctx.groupChars, []);
    const parsed = agent.pipeline.parse('[{"name":"Guest","first_mes":"ignored"}]', ctx);
    assert.equal(parsed[0].first_mes, undefined);
    assert.equal(agent.pipeline.parse('{"npcs":[]}', ctx), null);
    assert.equal(agent.pipeline.parse('broken', ctx), null);
    assert.equal(logs.some(line => line.includes('invalid JSON')), true);
});
