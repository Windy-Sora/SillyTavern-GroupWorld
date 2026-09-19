/** Decide whether round-end work may run after a group wrapper finishes. */
export function canFinalizeRound({ takeoverRemaining = 0, manualGenerationInProgress = false, generationStopped = false }) {
    return takeoverRemaining === 0 && !manualGenerationInProgress && !generationStopped;
}

export function decideRoundFinalization(state) {
    const ready = canFinalizeRound(state);
    return {
        ready,
        runPostSpeech: ready && !!state.postSpeechEnabled && !state.postSpeechRan,
        drainDeferred: ready && !state.postSpeechAborted && (state.deferredCount || 0) > 0,
        runRoundScripts: ready && !state.roundScriptsRan,
    };
}
