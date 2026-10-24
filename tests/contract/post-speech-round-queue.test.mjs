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

test('both timing cannot replay an intent already completed at message time, including duplicate jobs', async () => {
    const context = { messageIndex: 2, messageName: 'A', intent: { type: 'image', params: {} } }; let starts = 0;
    const subject = fixture(Array.from({ length: 2 }, () => ({ contexts: [context], deferred: [], allowPending: true })), {
        async run() { starts++; throw Error('must not execute'); },
    });
    await subject.postSpeechSystem.record(2, 'A', 'image', {}, {});
    await subject.drain(); assert.equal(starts, 0); assert.equal(subject.saves, 1);
    assert.equal(subject.postSpeechSystem.isPending(2, 'image'), false);
});

test('both timing cannot overlap a non-blocking message execution', async () => {
    const context = { messageIndex: 3, messageName: 'A', intent: { type: 'image', params: {} } }; let starts = 0, complete;
    const completion = new Promise(resolve => { complete = resolve; });
    const subject = fixture([{ contexts: [context], deferred: [], allowPending: true }], {
        async run() { starts++; throw Error('must not execute'); },
    });
    const held = subject.postSpeechSystem.reserveExecution([context]);
    await subject.postSpeechSystem.trackExecution({ blocking: false, completion }, [context], held);
    await subject.drain(); assert.equal(starts, 0); assert.equal(subject.postSpeechSystem.isPending(3, 'image'), true);
    complete([{ intentIndex: 0, success: true }]); await completion; await new Promise(resolve => setImmediate(resolve));
    assert.equal(subject.postSpeechSystem.wasExecuted(3, 'image'), true); assert.equal(subject.postSpeechSystem.isPending(3, 'image'), false);
    assert.equal(subject.saves, 1);
});

for (const results of [[], [{ intentIndex: 0, success: false }]]) test('failed or unresolved message intents remain eligible at round end: ' + JSON.stringify(results), async () => {
    const context = { messageIndex: 4, messageName: 'A', intent: { type: 'image', params: {} } }; let starts = 0;
    const subject = fixture([{ contexts: [context], deferred: [], allowPending: true }], {
        async run() { starts++; return { blocking: true, deferred: [], results: [{ intentIndex: 0, success: true }] }; },
    });
    const held = subject.postSpeechSystem.reserveExecution([context]);
    await subject.postSpeechSystem.trackExecution({ blocking: true, results }, [context], held);
    assert.equal(subject.postSpeechSystem.wasExecuted(4, 'image'), false);
    await subject.drain(); assert.equal(starts, 1); assert.equal(subject.postSpeechSystem.wasExecuted(4, 'image'), true);
    assert.equal(subject.saves, 1);
});

test('completed and pending filtering preserves original deferred-plan indexes', async () => {
    const contexts = ['done', 'busy', 'fresh'].map(type => ({ messageIndex: 8, messageName: 'A', intent: { type, params: {} } }));
    const plans = contexts.map((context, intentIndex) => ({ action: { intentIndex, capabilityId: context.intent.type } })), executed = [];
    const subject = fixture([{ contexts, deferred: plans, allowPending: true }], {
        async executeDeferred(selected) {
            executed.push(...selected.map(plan => ({ capabilityId: plan.action.capabilityId, intentIndex: plan.action.intentIndex })));
            return { blocking: true, results: selected.map(plan => ({ intentIndex: plan.action.intentIndex, success: true })) };
        },
    });
    await subject.postSpeechSystem.record(8, 'A', 'done', {}, {});
    const held = subject.postSpeechSystem.reserveExecution([contexts[1]]);
    await subject.drain(); assert.deepEqual(executed, [{ capabilityId: 'fresh', intentIndex: 0 }]);
    assert.equal(subject.postSpeechSystem.wasExecuted(8, 'fresh'), true); assert.equal(subject.postSpeechSystem.wasExecuted(8, 'busy'), false);
    assert.equal(subject.postSpeechSystem.isPending(8, 'busy'), true); held.release();
    assert.equal(subject.saves, 2);
});

test('round filtering does not globally forbid an explicit new reservation of an existing key', async () => {
    const subject = fixture([], {}), context = { messageIndex: 9, intent: { type: 'image', params: {} } };
    await subject.postSpeechSystem.record(9, 'A', 'image', {}, {});
    const reservation = subject.postSpeechSystem.reserveExecution([context]);
    assert.equal(reservation.contexts.length, 1); assert.equal(subject.postSpeechSystem.isPending(9, 'image'), true);
    reservation.release(); assert.equal(subject.postSpeechSystem.isPending(9, 'image'), false);
});
