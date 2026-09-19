import assert from 'node:assert/strict';
import test from 'node:test';
import { createRoundOrchestrator } from '../../systems/round-orchestrator.js';
import { FakeSillyTavernHost } from '../harness/fake-st-host.mjs';

const known = new Set(['alice', 'bob', 'eve']);

test('round orchestrator owns takeover progression and finalization readiness', async t => {
    const host = new FakeSillyTavernHost();
    t.after(() => host.dispose());
    host.queueResponse('alice reply').queueResponse('bob reply');
    const round = createRoundOrchestrator();
    const schedule = round.beginTakeover(['alice', 'bob'], { knownAvatars: known });

    assert.deepEqual(schedule.queue.map(step => step.avatar), ['alice', 'bob']);
    assert.equal(round.canFinalize(), false);

    const alice = round.decideTakeoverTurn({ avatar: 'alice', plannedAvatars: ['alice', 'bob'] });
    assert.equal(alice.action, 'allow');
    assert.equal(alice.state.takeoverRemaining, 1);
    await host.generateRaw({ prompt: 'generate:alice' });
    round.markCompleted('alice');

    const bob = round.decideTakeoverTurn({ avatar: 'bob', plannedAvatars: ['alice', 'bob'] });
    assert.equal(bob.action, 'allow');
    assert.equal(bob.state.takeoverRemaining, 0);
    await host.generateRaw({ prompt: 'generate:bob' });
    round.markCompleted('bob');
    assert.deepEqual(host.requests.map(request => request.prompt), ['generate:alice', 'generate:bob']);
    assert.equal(round.canFinalize(), true);
});

test('blocked mismatches do not consume takeover state or permit finalization', () => {
    const round = createRoundOrchestrator();
    round.beginTakeover(['alice'], { knownAvatars: known });

    const mismatch = round.decideTakeoverTurn({ avatar: 'eve', plannedAvatars: ['alice'] });
    assert.equal(mismatch.action, 'block');
    assert.equal(mismatch.reason, 'plan_mismatch');
    assert.equal(mismatch.state.takeoverRemaining, 1);
    assert.equal(mismatch.state.takeoverFailed, false);
    assert.equal(round.canFinalize(), false);
});

test('rerolls preserve remaining speakers and trip the configured safety limit', () => {
    const round = createRoundOrchestrator();
    round.beginTakeover(['alice'], { knownAvatars: known });

    for (let count = 1; count <= 5; count += 1) {
        const reroll = round.decideTakeoverTurn({ avatar: 'alice', plannedAvatars: ['alice'], generationType: 'swipe' });
        assert.equal(reroll.action, 'allow');
        assert.equal(reroll.state.takeoverRemaining, 1);
        assert.equal(reroll.state.takeoverSwipeCount, count);
    }

    const limited = round.decideTakeoverTurn({ avatar: 'alice', plannedAvatars: ['alice'], generationType: 'regenerate' });
    assert.equal(limited.action, 'block');
    assert.equal(limited.reason, 'swipe_limit');
    assert.equal(limited.state.takeoverRemaining, 0);
    assert.equal(limited.state.takeoverFailed, true);
});

test('wrapper transitions preserve active takeover and restore failed plans for retry', () => {
    const round = createRoundOrchestrator({
        takeoverRemaining: 2,
        takeoverFailed: true,
        takeoverCompleted: ['alice'],
    });

    assert.deepEqual(round.startWrapper({ generationType: 'normal' }), { kind: 'preserve_nested' });
    round.finishTakeover();
    assert.deepEqual(round.startWrapper({ generationType: 'normal' }), { kind: 'retry_failed' });

    const retry = round.retryFailed({ pending: true });
    assert.equal(retry.takeoverPending, true);
    assert.equal(retry.takeoverRemaining, 0);
    assert.equal(retry.takeoverFailed, false);
    assert.deepEqual(retry.takeoverCompleted, ['alice']);
});

test('completed and unavailable speakers are excluded when a takeover resumes', () => {
    const round = createRoundOrchestrator({ takeoverCompleted: ['alice'] });
    const schedule = round.beginTakeover(['alice', 'ghost', 'bob'], { knownAvatars: known });

    assert.deepEqual(schedule.queue, [{ avatar: 'bob', originalIndex: 2 }]);
    assert.deepEqual(schedule.skipped, [
        { avatar: 'alice', originalIndex: 0, reason: 'completed' },
        { avatar: 'ghost', originalIndex: 1, reason: 'unknown' },
    ]);
    assert.equal(round.getSnapshot().takeoverRemaining, 1);
});

test('user stop and manual generation independently block round finalization', () => {
    const round = createRoundOrchestrator();
    assert.equal(round.canFinalize({ generationStopped: true }), false);
    assert.equal(round.canFinalize({ manualGenerationInProgress: true }), false);
    assert.equal(round.canFinalize(), true);

    round.setPending(true);
    assert.equal(round.canFinalize(), false);
    round.setPending(false);
    round.markFailed();
    assert.equal(round.canFinalize(), false);
});

test('reset, clear, and preflight skips update only takeover-owned state', () => {
    const round = createRoundOrchestrator({
        generationType: 'swipe',
        takeoverPending: true,
        takeoverRemaining: 2,
        takeoverFailed: true,
        takeoverCompleted: ['alice'],
        takeoverSwipeCount: 3,
    });

    assert.equal(round.skipTurn(), 1);
    assert.equal(round.getSnapshot().takeoverSwipeCount, 0);
    assert.deepEqual(round.clearTakeover(), {
        generationType: 'swipe',
        takeoverPending: false,
        takeoverRemaining: 0,
        takeoverFailed: false,
        takeoverCompleted: ['alice'],
        takeoverSwipeCount: 0,
    });
    assert.deepEqual(round.reset(), {
        generationType: 'normal',
        takeoverPending: false,
        takeoverRemaining: 0,
        takeoverFailed: false,
        takeoverCompleted: [],
        takeoverSwipeCount: 0,
    });
});
