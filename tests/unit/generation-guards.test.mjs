import assert from 'node:assert/strict';
import test from 'node:test';
import { createFreshRoundState, getForceSpeakAction } from '../../systems/generation-guards.js';

test('force-speak guard only activates before a normal group round and respects configured modes', () => {
    assert.equal(getForceSpeakAction({ hasGroup: true, mode: 'block' }), 'block');
    assert.equal(getForceSpeakAction({ hasGroup: true, mode: 'llm' }), 'llm');
    assert.equal(getForceSpeakAction({ hasGroup: true }), 'confirm_native');
    assert.equal(getForceSpeakAction({ hasGroup: true, lastMessageIsUser: true }), 'pass');
    assert.equal(getForceSpeakAction({ hasGroup: true, generationType: 'swipe' }), 'pass');
});

test('fresh round state clears all generation and takeover gates', () => {
    assert.deepEqual(createFreshRoundState(), { speakerCount: 0, initialized: false, generationStopped: false, takeoverPending: false, takeoverRemaining: 0, takeoverFailed: false, takeoverSwipeCount: 0 });
});
