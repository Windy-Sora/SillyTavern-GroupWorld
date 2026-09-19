import assert from 'node:assert/strict';
import test from 'node:test';
import { canFinalizeRound, decideRoundFinalization } from '../../systems/round-finalization.js';

test('round finalization waits for takeover completion and never runs after user stop', () => {
    assert.equal(canFinalizeRound({ takeoverRemaining: 1 }), false);
    assert.equal(canFinalizeRound({ manualGenerationInProgress: true }), false);
    assert.equal(canFinalizeRound({ generationStopped: true }), false);
    assert.equal(canFinalizeRound({}), true);
});

test('round finalization gates PostSpeech, deferred jobs, and scripts independently', () => {
    assert.deepEqual(decideRoundFinalization({ postSpeechEnabled: true, deferredCount: 2 }), {
        ready: true, runPostSpeech: true, drainDeferred: true, runRoundScripts: true,
    });
    assert.deepEqual(decideRoundFinalization({ generationStopped: true, postSpeechEnabled: true, deferredCount: 2 }), {
        ready: false, runPostSpeech: false, drainDeferred: false, runRoundScripts: false,
    });
});
