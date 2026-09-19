import assert from 'node:assert/strict';
import test from 'node:test';
import { decideTakeoverTurn } from '../../systems/round-state.js';
import { transitionWrapperStarted } from '../../systems/round-state.js';
import { buildTakeoverSchedule } from '../../systems/takeover-scheduler.js';
import { canFinalizeRound } from '../../systems/round-finalization.js';
import { decideLlmSpeakerTurn } from '../../systems/llm-speaker-state.js';
import { FakeSillyTavernHost } from '../harness/fake-st-host.mjs';

test('takeover execution generates the remaining ordered speakers and only then permits round finalization', async t => {
    const host = new FakeSillyTavernHost();
    t.after(() => host.dispose());
    host.queueResponse('bob reply').queueResponse('eve reply');
    const schedule = buildTakeoverSchedule(['alice', 'bob', 'eve'], {
        completed: new Set(['alice']),
        knownAvatars: new Set(['alice', 'bob', 'eve']),
    });
    let remaining = schedule.remaining;
    assert.equal(canFinalizeRound({ takeoverRemaining: remaining, manualGenerationInProgress: true }), false);

    for (const step of schedule.queue) {
        const turn = decideTakeoverTurn({ remaining, avatar: step.avatar, plannedAvatars: ['alice', 'bob', 'eve'] });
        assert.equal(turn.action, 'allow');
        remaining = turn.remaining;
        await host.generateRaw({ prompt: `generate:${step.avatar}` });
    }

    assert.deepEqual(host.requests.map(request => request.prompt), ['generate:bob', 'generate:eve']);
    assert.equal(remaining, 0);
    assert.equal(canFinalizeRound({ takeoverRemaining: remaining, manualGenerationInProgress: false }), true);
});

test('takeover failure leaves the unfinished plan unavailable for finalization until retry state is restored', async t => {
    const host = new FakeSillyTavernHost();
    t.after(() => host.dispose());
    host.queueResponse({ type: 'reject', message: 'network failed' });
    const turn = decideTakeoverTurn({ remaining: 2, avatar: 'alice', plannedAvatars: ['alice', 'bob'] });
    await assert.rejects(host.generateRaw({ prompt: 'generate:alice' }), /network failed/);

    assert.equal(turn.remaining, 1);
    assert.equal(canFinalizeRound({ takeoverRemaining: turn.remaining, manualGenerationInProgress: true }), false);
});

test('nested wrappers preserve an active takeover and rerolls do not consume remaining planned generations', () => {
    assert.deepEqual(transitionWrapperStarted({ manualRemaining: 2, generationType: 'normal' }), { kind: 'preserve_nested' });
    const reroll = decideTakeoverTurn({ remaining: 2, swipeCount: 0, generationType: 'swipe', avatar: 'alice', plannedAvatars: ['alice', 'bob'] });
    assert.equal(reroll.action, 'allow');
    assert.equal(reroll.remaining, 2);

    const speakerReroll = decideLlmSpeakerTurn({ plannedAvatars: ['alice'], spokenAvatars: ['alice'], cursor: 1, avatar: 'eve', generationType: 'regenerate', respectOrder: true });
    assert.deepEqual(speakerReroll, { action: 'allow', reason: 'reroll', spokenAvatars: ['alice'], cursor: 1 });
});

test('user stop prevents round finalization even after a pending request settles', async t => {
    const host = new FakeSillyTavernHost();
    t.after(() => host.dispose());
    host.queueResponse({ type: 'pending' });
    const request = host.generateRaw({ prompt: 'generate:alice' });
    host.stopGeneration();
    await assert.rejects(request, error => error.name === 'AbortError');
    assert.equal(canFinalizeRound({ generationStopped: true }), false);
});
