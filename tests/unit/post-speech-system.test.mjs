import assert from 'node:assert/strict';
import test from 'node:test';
import { createPostSpeechSystem } from '../../systems/post-speech-system.js';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

function fixture(saveChatConditional = async () => {}, log = () => {}) {
    let metadata = {};
    const system = createPostSpeechSystem({
        settings: {}, EXT_KEY: 'test', getChatMetadata: () => metadata,
        getChat: () => [], saveChatConditional, log,
    });
    return { system, get metadata() { return metadata; }, switchTo(next) { metadata = next; } };
}

test('failed record remains retryable and preserves concurrent records', async () => {
    const save = deferred();
    let saves = 0;
    const { system, metadata } = fixture(() => { saves++; return save.promise; });
    const recording = system.record(1, 'A', 'image', {}, null);
    assert.equal(system.wasExecuted(1, 'image'), true);
    metadata.test.postSpeechDecisions.push({ messageIndex: 2, capabilityId: 'audio' });
    save.reject(new Error('save failed'));
    await assert.rejects(recording, /save failed/);
    assert.equal(system.wasExecuted(1, 'image'), false);
    assert.equal(system.wasExecuted(2, 'audio'), true);
    assert.equal(saves, 1);
});

test('failed bounded record restores evicted oldest entry', async () => {
    const save = deferred();
    const { system, metadata } = fixture(() => save.promise);
    const original = Array.from({ length: 500 }, (_, index) => ({ messageIndex: index, capabilityId: 'old' }));
    metadata.test = { postSpeechDecisions: original.slice() };
    const recording = system.record(500, 'A', 'new', {}, null);
    assert.equal(system.count(), 500);
    save.reject(new Error('save failed'));
    await assert.rejects(recording, /save failed/);
    assert.deepEqual(system.list(500), original);
});

test('failed bounded record does not consume an extra old entry after a later record succeeds', async () => {
    const firstSave = deferred();
    const secondSave = deferred();
    let saves = 0;
    const { system, metadata } = fixture(() => ++saves === 1 ? firstSave.promise : secondSave.promise);
    const original = Array.from({ length: 500 }, (_, messageIndex) => ({ messageIndex, capabilityId: 'old' }));
    metadata.test = { postSpeechDecisions: original.slice() };
    const first = system.record(500, 'A', 'failed', {}, null);
    const second = system.record(501, 'B', 'saved', {}, null);
    assert.equal(saves, 1);
    firstSave.reject(new Error('save failed'));
    await assert.rejects(first, /save failed/);
    await Promise.resolve();
    assert.equal(saves, 2);
    secondSave.resolve();
    await second;
    assert.deepEqual(system.list(500).map(r => r.messageIndex), [
        ...original.slice(1).map(r => r.messageIndex), 501,
    ]);
});

test('failed prune restores removed records without discarding concurrent additions', async () => {
    const save = deferred();
    const { system, metadata } = fixture(() => save.promise);
    metadata.test = { postSpeechDecisions: [
        { messageIndex: 1, capabilityId: 'old' },
        { messageIndex: 9, capabilityId: 'removed' },
    ] };
    const pruning = system.pruneAfter(2);
    metadata.test.postSpeechDecisions.push({ messageIndex: 2, capabilityId: 'concurrent' });
    save.reject(new Error('save failed'));
    await assert.rejects(pruning, /save failed/);
    assert.deepEqual(system.list().map(r => r.capabilityId), ['old', 'removed', 'concurrent']);
});

test('failed clear restores old records but keeps concurrent additions', async () => {
    const save = deferred();
    const { system, metadata } = fixture(() => save.promise);
    metadata.test = { postSpeechDecisions: [{ messageIndex: 1, capabilityId: 'old' }] };
    const clearing = system.clearAll();
    metadata.test.postSpeechDecisions.push({ messageIndex: 2, capabilityId: 'concurrent' });
    save.reject(new Error('save failed'));
    await assert.rejects(clearing, /save failed/);
    assert.deepEqual(system.list().map(r => r.capabilityId), ['old', 'concurrent']);
});

test('clear rollback honors the 500-record bound after a concurrent append', async () => {
    const save = deferred();
    const { system, metadata } = fixture(() => save.promise);
    metadata.test = { postSpeechDecisions: Array.from({ length: 500 }, (_, messageIndex) => ({
        messageIndex, capabilityId: 'old',
    })) };
    const clearing = system.clearAll();
    metadata.test.postSpeechDecisions.push({ messageIndex: 500, capabilityId: 'new' });
    save.reject(new Error('save failed'));
    await assert.rejects(clearing, /save failed/);
    assert.equal(system.count(), 500);
    assert.equal(system.list(500)[0].messageIndex, 1);
    assert.equal(system.list(1)[0].capabilityId, 'new');
});

test('resetting pending keeps the selected chat decisions and ignores late completion', async () => {
    const done = deferred();
    const f = fixture();
    await f.system.trackExecution({ blocking: false, completion: done.promise }, [
        { messageIndex: 3, messageName: 'A', intent: { type: 'image', params: {} } },
    ]);
    const selected = { test: { postSpeechDecisions: [{ messageIndex: 3, capabilityId: 'image' }] } };
    f.switchTo(selected);
    f.system.resetPending();
    done.resolve([{ intentIndex: 0, success: true }]);
    await done.promise;
    await Promise.resolve();
    assert.equal(f.system.isPending(3, 'image'), false);
    assert.equal(f.system.count(), 1);
});

test('non-blocking save rejection releases pending intent for retry', async () => {
    const save = deferred();
    const completion = deferred();
    const logged = deferred();
    let saves = 0;
    const { system } = fixture(() => { saves++; return save.promise; }, () => logged.resolve());
    await system.trackExecution({ blocking: false, completion: completion.promise }, [
        { messageIndex: 4, messageName: 'A', intent: { type: 'image', params: {} } },
    ]);
    completion.resolve([{ intentIndex: 0, success: true }]);
    await completion.promise;
    await Promise.resolve();
    assert.equal(system.isPending(4, 'image'), true);
    save.reject(new Error('save failed'));
    await logged.promise;
    assert.equal(system.isPending(4, 'image'), false);
    assert.equal(system.wasExecuted(4, 'image'), false);
    assert.equal(saves, 1);
});

test('chat switch during multi-intent persistence cannot record a later intent in new chat', async () => {
    const save = deferred();
    const f = fixture(() => save.promise);
    const tracking = f.system.trackExecution({ blocking: true, results: [
        { intentIndex: 0, success: true }, { intentIndex: 1, success: true },
    ] }, [
        { messageIndex: 1, messageName: 'A', intent: { type: 'image', params: {} } },
        { messageIndex: 1, messageName: 'A', intent: { type: 'audio', params: {} } },
    ]);
    const previous = f.metadata;
    f.switchTo({});
    f.system.resetPending();
    save.resolve();
    await tracking;
    assert.deepEqual(previous.test.postSpeechDecisions.map(r => r.capabilityId), ['image']);
    assert.equal(f.system.count(), 0);
});

test('a queued record cannot start after its chat is no longer selected', async () => {
    const save = deferred();
    let saves = 0;
    const f = fixture(() => { saves++; return save.promise; });
    const oldMetadata = f.metadata;
    const first = f.system.record(1, 'A', 'image', {}, null);
    const queued = f.system.record(2, 'A', 'audio', {}, null);
    f.switchTo({});
    f.system.resetPending();
    save.resolve();
    await first;
    await assert.rejects(queued, /chat changed/);
    assert.equal(saves, 1);
    assert.deepEqual(oldMetadata.test.postSpeechDecisions.map(r => r.capabilityId), ['image']);
    assert.equal(f.system.count(), 0);
});

test('a queued record cannot recreate a deleted message decision after prune', async () => {
    const save = deferred();
    let saves = 0;
    const { system } = fixture(() => ++saves === 1 ? save.promise : Promise.resolve());
    const result = { blocking: true, results: [{ intentIndex: 0, success: true }] };
    const context = messageIndex => ({
        messageIndex, messageName: 'A', intent: { type: 'image', params: {} },
    });
    const first = system.trackExecution(result, [context(0)]);
    const queued = system.trackExecution(result, [context(5)]);
    await system.pruneAfter(0);
    save.resolve();
    await Promise.all([first, queued]);
    assert.equal(system.wasExecuted(0, 'image'), true);
    assert.equal(system.wasExecuted(5, 'image'), false);
    assert.equal(saves, 1);
});

test('concurrent completion trackers retain pending until both have settled', async () => {
    const first = deferred();
    const second = deferred();
    const firstLogged = deferred();
    const secondLogged = deferred();
    let unresolved = 0;
    const { system } = fixture(async () => {}, () => {
        (++unresolved === 1 ? firstLogged : secondLogged).resolve();
    });
    const context = { messageIndex: 7, messageName: 'A', intent: { type: 'image', params: {} } };
    await system.trackExecution({ blocking: false, completion: first.promise }, [context]);
    await system.trackExecution({ blocking: false, completion: second.promise }, [context]);
    assert.equal(system.isPending(7, 'image'), true);

    first.resolve([]);
    await firstLogged.promise;
    assert.equal(system.isPending(7, 'image'), true);

    second.resolve([]);
    await secondLogged.promise;
    assert.equal(system.isPending(7, 'image'), false);
    assert.equal(system.wasExecuted(7, 'image'), false);
});

test('queued concurrent successes persist one decision for the same intent', async () => {
    const heldSave = deferred();
    let saves = 0;
    const { system } = fixture(() => ++saves === 1 ? heldSave.promise : Promise.resolve());
    const unrelated = system.record(1, 'A', 'audio', {}, null);
    const context = { messageIndex: 8, messageName: 'B', intent: { type: 'image', params: {} } };
    const execution = { blocking: true, results: [{ intentIndex: 0, success: true }] };
    const first = system.trackExecution(execution, [context]);
    const second = system.trackExecution(execution, [context]);
    assert.equal(system.isPending(8, 'image'), true);
    heldSave.resolve();
    await Promise.all([unrelated, first, second]);
    assert.equal(system.list().filter(r => r.messageIndex === 8 && r.capabilityId === 'image').length, 1);
    assert.equal(system.isPending(8, 'image'), false);
    assert.equal(saves, 2);
});

test('one rejected completion does not release another tracker for the same intent', async () => {
    const first = deferred();
    const second = deferred();
    const firstLogged = deferred();
    const secondLogged = deferred();
    let logs = 0;
    const { system } = fixture(async () => {}, () => {
        (++logs === 1 ? firstLogged : secondLogged).resolve();
    });
    const context = { messageIndex: 9, messageName: 'A', intent: { type: 'image', params: {} } };
    await system.trackExecution({ blocking: false, completion: first.promise }, [context]);
    await system.trackExecution({ blocking: false, completion: second.promise }, [context]);
    first.reject(new Error('completion failed'));
    await firstLogged.promise;
    assert.equal(system.isPending(9, 'image'), true);
    second.resolve([]);
    await secondLogged.promise;
    assert.equal(system.isPending(9, 'image'), false);
});

test('late old-chat completion cannot decrement a new tracker with the same key', async () => {
    const oldCompletion = deferred();
    const newCompletion = deferred();
    const newLogged = deferred();
    const f = fixture(async () => {}, () => newLogged.resolve());
    const context = { messageIndex: 2, messageName: 'A', intent: { type: 'image', params: {} } };
    await f.system.trackExecution({ blocking: false, completion: oldCompletion.promise }, [context]);
    f.switchTo({});
    f.system.resetPending();
    await f.system.trackExecution({ blocking: false, completion: newCompletion.promise }, [context]);
    oldCompletion.resolve([{ intentIndex: 0, success: true }]);
    await oldCompletion.promise;
    await Promise.resolve();
    assert.equal(f.system.isPending(2, 'image'), true);
    assert.equal(f.system.wasExecuted(2, 'image'), false);
    newCompletion.resolve([]);
    await newLogged.promise;
    assert.equal(f.system.isPending(2, 'image'), false);
});

test('reservation claims one intent before execution and releases after tracked completion', async () => {
    const f = fixture();
    const context = { messageIndex: 10, messageName: 'A', intent: { type: 'image', params: {} } };
    const first = f.system.reserveExecution([context, context]);
    assert.deepEqual(first.indexes, [0]);
    assert.equal(first.contexts.length, 1);
    assert.equal(f.system.isPending(10, 'image'), true);
    const duplicate = f.system.reserveExecution([context]);
    assert.equal(duplicate.contexts.length, 0);
    duplicate.release();

    await f.system.trackExecution({
        blocking: true,
        results: [{ intentIndex: 0, success: true }],
    }, first.contexts, first);
    assert.equal(f.system.isPending(10, 'image'), false);
    assert.equal(f.system.wasExecuted(10, 'image'), true);
    assert.equal(f.system.count(), 1);
});

test('reservation stays pending through non-blocking completion and releases on error', async () => {
    const f = fixture();
    const context = { messageIndex: 11, messageName: 'A', intent: { type: 'image', params: {} } };
    const reservation = f.system.reserveExecution([context]);
    let settle;
    const completion = { then(onFulfilled) { settle = onFulfilled; return Promise.resolve(); } };
    await f.system.trackExecution({ blocking: false, completion }, reservation.contexts, reservation);
    assert.equal(f.system.isPending(11, 'image'), true);
    await settle([]);
    assert.equal(f.system.isPending(11, 'image'), false);
    assert.equal(f.system.wasExecuted(11, 'image'), false);
    reservation.release();
    assert.equal(f.system.isPending(11, 'image'), false);
});

test('round reservation can intentionally overlap a message reservation', () => {
    const f = fixture();
    const context = { messageIndex: 12, messageName: 'A', intent: { type: 'image', params: {} } };
    const message = f.system.reserveExecution([context]);
    const round = f.system.reserveExecution([context], { allowPending: true });
    assert.equal(round.contexts.length, 1);
    message.release();
    assert.equal(f.system.isPending(12, 'image'), true);
    round.release();
    assert.equal(f.system.isPending(12, 'image'), false);
});

test('old reservation release cannot clear a new chat reservation', () => {
    const f = fixture();
    const context = { messageIndex: 13, messageName: 'A', intent: { type: 'image', params: {} } };
    const old = f.system.reserveExecution([context]);
    f.switchTo({});
    f.system.resetPending();
    const current = f.system.reserveExecution([context]);
    old.release();
    assert.equal(f.system.isPending(13, 'image'), true);
    current.release();
    assert.equal(f.system.isPending(13, 'image'), false);
});
