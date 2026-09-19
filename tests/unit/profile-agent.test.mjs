import assert from 'node:assert/strict';
import test from 'node:test';
import { createProfileAgent } from '../../agents/profile.js';
import { execute } from '../../systems/agent-runtime.js';

function agent(rendered = []) {
    return createProfileAgent({
        renderPrompt: async prompt => { rendered.push(prompt); return `rendered:${prompt}`; },
        extractJsonObject: raw => raw.match(/\{[\s\S]*\}/)?.[0] || null,
        log: () => {},
    });
}

test('Profile Agent renders character fields and parses extracted JSON under strict access', async t => {
    const original = console.log;
    console.log = () => {};
    t.after(() => { console.log = original; });
    const rendered = [];
    const result = await execute(agent(rendered), {
        pool: {
            character: () => ({ name: 'Alice', description: 'Mage', personality: 'Calm', scenario: 'Tower' }),
            profileGeneratorDefault: () => '{{charName}}|{{charDescription}}|{{charPersonality}}|{{charScenario}}',
            profileSchemaDefault: () => '{"type":"object"}',
        },
        caller: {
            supportsAbort: true,
            async generate() { return 'prefix {"profile":{"summary":"A calm mage",},} suffix'; },
        },
        config: { strictMode: true, call: { retries: 0, timeout: 100 } },
    });
    assert.deepEqual(result, { summary: 'A calm mage' });
    assert.deepEqual(rendered, ['Alice|Mage|Calm|Tower']);
});

test('Profile Agent rejects missing characters and invalid JSON while preserving valid shapes', async () => {
    const subject = agent();
    await assert.rejects(subject.pipeline.context(undefined, undefined, { character: () => null }, {}), /No character/);
    await assert.rejects(subject.pipeline.parse('not json'), /invalid JSON response/);
    await assert.rejects(subject.pipeline.parse('text {broken}'), /invalid JSON after extraction/);
    assert.equal(await subject.pipeline.validate(null), null);
    assert.deepEqual(await subject.pipeline.validate({ summary: 'ready' }), { summary: 'ready' });
    assert.deepEqual(await subject.pipeline.validate({ wrapper: { tags: ['x'] } }), { tags: ['x'] });
});
