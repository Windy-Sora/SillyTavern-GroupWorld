import { scenario } from '../harness/scenario.mjs';

scenario('scenario API provides an isolated SillyTavern context', async ({ host, context, assert }) => {
    host.queueResponse({ type: 'resolve', value: 'model output' });
    const result = await context.generateRaw({ prompt: 'probe' });

    assert.equal(result, 'model output');
    assert.equal(host.requests.length, 1);
    assert.equal(host.requests[0].prompt, 'probe');
    assert.equal(host.activeRequestCount, 0);

    await context.saveChatConditional();
    assert.equal(host.saveCalls, 1);
});
