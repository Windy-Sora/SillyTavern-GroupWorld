import assert from 'node:assert/strict';
import test from 'node:test';
import { createSummaryAgent } from '../../agents/summary.js';
import { execute } from '../../systems/agent-runtime.js';

function mute(t) {
    const original = console.log;
    console.log = () => {};
    t.after(() => { console.log = original; });
}

test('Summary Agent reuses prior coverage and sends only new messages', async t => {
    mute(t);
    let sent;
    const agent = createSummaryAgent({ log: () => {} });
    const result = await execute(agent, {
        pool: {
            chat: () => [
                { name: 'Alice', mes: 'old' },
                { is_user: true, mes: 'new question' },
                { name: 'Bob', mes: 'new answer' },
            ],
            summaryLatest: () => ({ rangeEnd: 1, content: 'Earlier events' }),
        },
        caller: { supportsAbort: true, async generate(prompt) { sent = prompt; return 'summary result'; } },
        config: { lang: 'en', summaryReusePrevious: true, strictMode: true, call: { retries: 0, timeout: 100 } },
    });
    assert.equal(result, 'summary result');
    assert.match(sent, /\[Previous summary\]\nEarlier events/);
    assert.match(sent, /User: new question/);
    assert.match(sent, /Bob: new answer/);
    assert.doesNotMatch(sent, /Alice: old/);
});

test('Summary Agent supports full custom prompts and rejects empty coverage', async () => {
    const agent = createSummaryAgent({ log: () => {} });
    const ctx = await agent.pipeline.context(undefined, undefined, { chat: () => [{ mes: 'system text' }] }, {});
    const prompt = await agent.pipeline.prompt(ctx, undefined, { summaryLatest: () => null }, {
        summaryPrompt: 'CUSTOM',
        summaryReusePrevious: false,
    });
    assert.equal(prompt, 'CUSTOM\n\nSystem: system text');
    await assert.rejects(agent.pipeline.prompt({ chat: [] }, undefined, {}, {}), /No messages to summarize/);
    await assert.rejects(agent.pipeline.prompt(
        { chat: [{ name: 'A', mes: 'done' }] },
        undefined,
        { summaryLatest: () => ({ rangeEnd: 1, content: 'complete' }) },
        { summaryReusePrevious: true },
    ), /No new messages/);
});
