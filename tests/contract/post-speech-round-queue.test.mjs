import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createPostSpeechSystem } from '../../systems/post-speech-system.js';

const source = await readFile(new URL('../../index.js', import.meta.url), 'utf8');
const queueSource = source.slice(
    source.indexOf('function invalidatePostSpeechRoundQueue()'),
    source.indexOf('// Custom extension prompt key'),
);

function fixture(jobs, executor) {
    let metadata = {};
    let saves = 0;
    const postSpeechSystem = createPostSpeechSystem({
        settings: {}, EXT_KEY: 'test', getChatMetadata: () => metadata,
        getChat: () => [], saveChatConditional: async () => { saves++; }, log: () => {},
    });
    const sandbox = {
        postSpeechRoundQueue: jobs,
        postSpeechRoundQueueEpoch: 0,
        postSpeechSystem,
        postSpeechExecutor: executor,
        CapabilityRegistry: { listExecutableForMode: () => [] },
        log: () => {},
    };
    const { drainPostSpeechRoundQueue, invalidatePostSpeechRoundQueue } = vm.runInNewContext(
        `${queueSource}\n({ drainPostSpeechRoundQueue, invalidatePostSpeechRoundQueue })`, sandbox,
    );
    return {
        postSpeechSystem, drain: drainPostSpeechRoundQueue,
        switchChat() {
            metadata = {};
            postSpeechSystem.resetPending();
            invalidatePostSpeechRoundQueue();
        },
        get saves() { return saves; },
    };
}

test('round queue claims before deferred execution and remaps selected intent indexes', async () => {
    const contexts = [
        { messageIndex: 5, messageName: 'A', intent: { type: 'busy', params: {} } },
        { messageIndex: 5, messageName: 'A', intent: { type: 'free', params: {} } },
    ];
    const plans = contexts.map((_, intentIndex) => ({ action: { intentIndex } }));
    const executed = [];
    const subject = fixture([{ contexts, deferred: plans, allowPending: false }], {
        async executeDeferred(selectedPlans) {
            executed.push(...selectedPlans.map(plan => plan.action.intentIndex));
            return { blocking: true, results: selectedPlans.map(plan => ({
                intentIndex: plan.action.intentIndex, success: true,
            })) };
        },
    });
    const held = subject.postSpeechSystem.reserveExecution([contexts[0]]);
    await subject.drain();
    assert.deepEqual(executed, [0]);
    assert.equal(subject.postSpeechSystem.wasExecuted(5, 'busy'), false);
    assert.equal(subject.postSpeechSystem.wasExecuted(5, 'free'), true);
    assert.equal(subject.postSpeechSystem.isPending(5, 'busy'), true);
    assert.equal(subject.postSpeechSystem.isPending(5, 'free'), false);
    assert.equal(subject.saves, 1);
    held.release();
});

test('round queue releases a pre-execution claim when capability execution throws', async () => {
    const context = { messageIndex: 6, messageName: 'A', intent: { type: 'image', params: {} } };
    const subject = fixture([{ contexts: [context], deferred: [{ action: { intentIndex: 0 } }] }], {
        async executeDeferred() { throw new Error('executor failed'); },
    });
    await assert.rejects(subject.drain(), /executor failed/);
    assert.equal(subject.postSpeechSystem.isPending(6, 'image'), false);
    assert.equal(subject.postSpeechSystem.wasExecuted(6, 'image'), false);
    assert.equal(subject.saves, 0);
});

test('round queue stops old-chat jobs after a chat switch during execution', async () => {
    let releaseFirst;
    const firstRunning = new Promise(resolve => { releaseFirst = resolve; });
    let startedFirst;
    const firstStarted = new Promise(resolve => { startedFirst = resolve; });
    const starts = [];
    const contexts = [0, 1].map(messageIndex => ({
        messageIndex, messageName: 'A', intent: { type: 'image', params: {} },
    }));
    const subject = fixture(contexts.map(context => ({ contexts: [context], deferred: [] })), {
        async run() {
            starts.push(starts.length);
            if (starts.length === 1) {
                startedFirst();
                await firstRunning;
            }
            return { blocking: true, results: [{ intentIndex: 0, success: true }], deferred: [] };
        },
    });
    const draining = subject.drain();
    await firstStarted;
    subject.switchChat();
    releaseFirst();
    await draining;
    assert.deepEqual(starts, [0]);
    assert.equal(subject.postSpeechSystem.wasExecuted(0, 'image'), false);
    assert.equal(subject.postSpeechSystem.wasExecuted(1, 'image'), false);
    assert.equal(subject.saves, 0);
});
