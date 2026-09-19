import assert from 'node:assert/strict';
import test from 'node:test';
import { createCritiqueAgent } from '../../agents/critique.js';
import { execute } from '../../systems/agent-runtime.js';

test('Critique Agent reuses structured critique coverage under strict context access', async t => {
    const original = console.log;
    console.log = () => {};
    t.after(() => { console.log = original; });
    let prompt;
    const agent = createCritiqueAgent({ log: () => {} });
    const result = await execute(agent, {
        pool: {
            chat: () => [
                { name: 'Alice', mes: 'covered' },
                { name: 'Bob', mes: 'new scene' },
            ],
            critiqueLatest: () => ({ rangeEnd: 1, data: { directorCritique: { pacing: 'fast' } } }),
        },
        caller: { supportsAbort: true, async generate(value) { prompt = value; return '{"ok":true}'; } },
        config: { lang: 'en', critiqueReusePrevious: true, strictMode: true, call: { retries: 0, timeout: 100 } },
    });
    assert.equal(result, '{"ok":true}');
    assert.match(prompt, /\[Previous critique\]/);
    assert.match(prompt, /"pacing": "fast"/);
    assert.match(prompt, /Bob: new scene/);
    assert.doesNotMatch(prompt, /Alice: covered/);
});

test('Critique Agent supports custom full-chat prompts and rejects empty input', async () => {
    const agent = createCritiqueAgent({ log: () => {} });
    const prompt = await agent.pipeline.prompt(
        { chat: [{ is_user: true, mes: 'question' }, { mes: 'notice' }] },
        undefined,
        { critiqueLatest: () => null },
        { critiquePrompt: 'REVIEW', critiqueReusePrevious: false },
    );
    assert.equal(prompt, 'REVIEW\n\nUser: question\nSystem: notice');
    await assert.rejects(agent.pipeline.prompt({ chat: [] }, undefined, {}, {}), /No messages to critique/);
    await assert.rejects(agent.pipeline.prompt(
        { chat: [{ name: 'A', mes: 'done' }] },
        undefined,
        { critiqueLatest: () => ({ rangeEnd: 1, data: {} }) },
        { critiqueReusePrevious: true },
    ), /No new messages/);
});
