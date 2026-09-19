import { selectTopCandidates } from './speaker-selection.js';

/**
 * Pure state transitions for formula-mode rounds.
 * Side effects (logging, aborting SillyTavern generation) stay in index.js.
 */
export function decideFormulaTurn({ scores, topN, avatar, speakerCount = 0 }) {
    const allowedAvatars = selectTopCandidates(scores, topN);
    const allowed = allowedAvatars.includes(avatar);
    return {
        allowed,
        score: scores[avatar] ?? -Infinity,
        allowedAvatars,
        nextSpeakerCount: allowed ? speakerCount + 1 : speakerCount,
    };
}

export function resetFormulaRoundState() {
    return { scores: {}, speakerCount: 0, initialized: false };
}

/**
 * Decide the interceptor outcome while Director is manually generating an
 * ordered LLM plan. The returned state is intentionally serializable.
 */
export function decideTakeoverTurn({
    remaining,
    swipeCount = 0,
    generationType = 'normal',
    avatar,
    plannedAvatars = null,
    pending = false,
    maxSwipes = 5,
}) {
    if (remaining > 0) {
        const reroll = generationType === 'swipe' || generationType === 'regenerate';
        const nextRemaining = reroll ? remaining : remaining - 1;
        const nextSwipeCount = reroll ? swipeCount + 1 : 0;
        if (nextSwipeCount > maxSwipes) {
            return { action: 'block', reason: 'swipe_limit', remaining: 0, swipeCount: nextSwipeCount, failed: true, reroll };
        }
        if (plannedAvatars && !plannedAvatars.includes(avatar)) {
            return { action: 'block', reason: 'plan_mismatch', remaining, swipeCount: nextSwipeCount, failed: false, reroll };
        }
        return { action: 'allow', reason: 'manual_takeover', remaining: nextRemaining, swipeCount: nextSwipeCount, failed: false, reroll };
    }
    if (pending) return { action: 'block', reason: 'takeover_pending', remaining, swipeCount, failed: false, reroll: false };
    return { action: 'pass', reason: 'not_takeover', remaining, swipeCount, failed: false, reroll: false };
}

/** Select the lifecycle branch for GROUP_WRAPPER_STARTED without side effects. */
export function transitionWrapperStarted({ generationType = 'normal', manualRemaining = 0, takeoverFailed = false }) {
    if (manualRemaining > 0) return { kind: 'preserve_nested' };
    if (takeoverFailed) return { kind: 'retry_failed' };
    if (generationType === 'swipe' || generationType === 'regenerate') {
        return { kind: 'reuse_or_restore_plan', generationType };
    }
    return { kind: 'reset_new_round', generationType };
}
