import assert from 'node:assert/strict';
import test from 'node:test';
import { createPostSpeechSystem } from '../../systems/post-speech-system.js';

function createSystem() {
    const metadata = {};
    let saves = 0;
    const system = createPostSpeechSystem({
        settings: {},
        EXT_KEY: 'test',
        getChatMetadata: () => metadata,
        getChat: () => [],
        saveChatConditional: async () => { saves++; },
        log: () => {},
    });
    return { metadata, system, get saves() { return saves; } };
}

test('BUG-6: PostSpeech persists only successfully completed intents', async () => {
    const fixture = createSystem();
    const contexts = [
        { messageIndex: 5, messageName: 'A', intent: { type: 'ok', params: {} }, policy: {} },
        { messageIndex: 5, messageName: 'A', intent: { type: 'failed', params: {} }, policy: {} },
        { messageIndex: 5, messageName: 'A', intent: { type: 'unknown', params: {} }, policy: {} },
    ];

    await fixture.system.trackExecution({
        blocking: true,
        results: [
            { intentIndex: 0, capabilityId: 'ok', success: true },
            { intentIndex: 1, capabilityId: 'failed', success: false, error: 'boom' },
        ],
    }, contexts);

    assert.equal(fixture.system.wasExecuted(5, 'ok'), true);
    assert.equal(fixture.system.wasExecuted(5, 'failed'), false);
    assert.equal(fixture.system.wasExecuted(5, 'unknown'), false);
    assert.equal(fixture.saves, 1);
});

test('BUG-6: non-blocking intents stay pending until successful completion', async () => {
    const fixture = createSystem();
    let complete;
    const completion = new Promise(resolve => { complete = resolve; });
    const context = {
        messageIndex: 6,
        messageName: 'B',
        intent: { type: 'slow', params: {} },
        policy: {},
    };

    await fixture.system.trackExecution({
        blocking: false,
        results: [{ intentIndex: 0, capabilityId: 'slow', pending: true }],
        completion,
    }, [context]);
    assert.equal(fixture.system.isPending(6, 'slow'), true);
    assert.equal(fixture.system.wasExecuted(6, 'slow'), false);

    complete([{ intentIndex: 0, capabilityId: 'slow', success: true }]);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(fixture.system.isPending(6, 'slow'), false);
    assert.equal(fixture.system.wasExecuted(6, 'slow'), true);
});
