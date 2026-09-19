import assert from 'node:assert/strict';
import test from 'node:test';
import { decideFormulaTurn, decideTakeoverTurn, resetFormulaRoundState, transitionWrapperStarted } from '../../systems/round-state.js';

test('formula round allows only Top-N candidates and advances count only for allowed speakers', () => {
    const scores = { alice: 50, bob: 30, eve: 10 };
    const first = decideFormulaTurn({ scores, topN: 2, avatar: 'alice', speakerCount: 0 });
    const blocked = decideFormulaTurn({ scores, topN: 2, avatar: 'eve', speakerCount: first.nextSpeakerCount });

    assert.deepEqual(first, {
        allowed: true,
        score: 50,
        allowedAvatars: ['alice', 'bob'],
        nextSpeakerCount: 1,
    });
    assert.deepEqual(blocked, {
        allowed: false,
        score: 10,
        allowedAvatars: ['alice', 'bob'],
        nextSpeakerCount: 1,
    });
});

test('formula round blocks unknown candidates and handles an empty candidate pool', () => {
    assert.deepEqual(decideFormulaTurn({ scores: {}, topN: 1, avatar: 'alice', speakerCount: 3 }), {
        allowed: false,
        score: -Infinity,
        allowedAvatars: [],
        nextSpeakerCount: 3,
    });
    assert.deepEqual(resetFormulaRoundState(), { scores: {}, speakerCount: 0, initialized: false });
});

test('takeover consumes only normal generations and allows rerolls without consuming the plan', () => {
    assert.deepEqual(decideTakeoverTurn({ remaining: 2, avatar: 'alice', plannedAvatars: ['alice', 'bob'] }), {
        action: 'allow', reason: 'manual_takeover', remaining: 1, swipeCount: 0, failed: false, reroll: false,
    });
    assert.deepEqual(decideTakeoverTurn({ remaining: 2, swipeCount: 2, generationType: 'swipe', avatar: 'alice', plannedAvatars: ['alice'] }), {
        action: 'allow', reason: 'manual_takeover', remaining: 2, swipeCount: 3, failed: false, reroll: true,
    });
});

test('takeover blocks pending ST order, plan mismatches, and excessive rerolls', () => {
    assert.equal(decideTakeoverTurn({ remaining: 0, pending: true, avatar: 'alice' }).reason, 'takeover_pending');
    assert.deepEqual(decideTakeoverTurn({ remaining: 1, avatar: 'eve', plannedAvatars: ['alice'] }), {
        action: 'block', reason: 'plan_mismatch', remaining: 1, swipeCount: 0, failed: false, reroll: false,
    });
    assert.deepEqual(decideTakeoverTurn({ remaining: 1, swipeCount: 5, generationType: 'regenerate', avatar: 'alice' }), {
        action: 'block', reason: 'swipe_limit', remaining: 0, swipeCount: 6, failed: true, reroll: true,
    });
});

test('wrapper start preserves nested takeover, retries failed plans, reuses swipes, and resets normal rounds', () => {
    assert.deepEqual(transitionWrapperStarted({ manualRemaining: 2, takeoverFailed: true, generationType: 'swipe' }), { kind: 'preserve_nested' });
    assert.deepEqual(transitionWrapperStarted({ takeoverFailed: true }), { kind: 'retry_failed' });
    assert.deepEqual(transitionWrapperStarted({ generationType: 'regenerate' }), { kind: 'reuse_or_restore_plan', generationType: 'regenerate' });
    assert.deepEqual(transitionWrapperStarted({ generationType: 'normal' }), { kind: 'reset_new_round', generationType: 'normal' });
});
