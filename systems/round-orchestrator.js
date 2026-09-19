import { canFinalizeRound } from './round-finalization.js';
import { decideTakeoverTurn, transitionWrapperStarted } from './round-state.js';
import { buildTakeoverSchedule } from './takeover-scheduler.js';

function createInitialState(initial = {}) {
    return {
        generationType: initial.generationType || 'normal',
        takeoverPending: !!initial.takeoverPending,
        takeoverRemaining: Math.max(0, Number(initial.takeoverRemaining) || 0),
        takeoverFailed: !!initial.takeoverFailed,
        takeoverCompleted: new Set(initial.takeoverCompleted || []),
        takeoverSwipeCount: Math.max(0, Number(initial.takeoverSwipeCount) || 0),
    };
}

/** Stateful coordination for the takeover slice of a Group World round. */
export function createRoundOrchestrator(initial = {}) {
    let state = createInitialState(initial);

    function getSnapshot() {
        return {
            generationType: state.generationType,
            takeoverPending: state.takeoverPending,
            takeoverRemaining: state.takeoverRemaining,
            takeoverFailed: state.takeoverFailed,
            takeoverCompleted: [...state.takeoverCompleted],
            takeoverSwipeCount: state.takeoverSwipeCount,
        };
    }

    function reset(next = {}) {
        state = createInitialState(next);
        return getSnapshot();
    }

    function startWrapper({ generationType = 'normal' } = {}) {
        state.generationType = generationType;
        return transitionWrapperStarted({
            generationType,
            manualRemaining: state.takeoverRemaining,
            takeoverFailed: state.takeoverFailed,
        });
    }

    function retryFailed({ pending = false } = {}) {
        state.takeoverFailed = false;
        state.takeoverPending = !!pending;
        state.takeoverRemaining = 0;
        state.takeoverSwipeCount = 0;
        return getSnapshot();
    }

    function clearTakeover() {
        state.takeoverPending = false;
        state.takeoverRemaining = 0;
        state.takeoverFailed = false;
        state.takeoverSwipeCount = 0;
        return getSnapshot();
    }

    function setPending(pending) {
        state.takeoverPending = !!pending;
        return state.takeoverPending;
    }

    function beginTakeover(plannedAvatars, { knownAvatars = new Set() } = {}) {
        const schedule = buildTakeoverSchedule(plannedAvatars || [], {
            completed: state.takeoverCompleted,
            knownAvatars,
        });
        state.takeoverPending = false;
        state.takeoverRemaining = schedule.remaining;
        state.takeoverSwipeCount = 0;
        return schedule;
    }

    function decideTurn({ avatar, plannedAvatars = null, generationType = state.generationType, maxSwipes = 5 }) {
        const decision = decideTakeoverTurn({
            remaining: state.takeoverRemaining,
            swipeCount: state.takeoverSwipeCount,
            generationType,
            avatar,
            plannedAvatars,
            pending: state.takeoverPending,
            maxSwipes,
        });
        state.generationType = generationType;
        state.takeoverRemaining = decision.remaining;
        state.takeoverSwipeCount = decision.swipeCount;
        state.takeoverFailed = decision.failed;
        return { ...decision, state: getSnapshot() };
    }

    function skipTurn() {
        state.takeoverRemaining = Math.max(0, state.takeoverRemaining - 1);
        state.takeoverSwipeCount = 0;
        return state.takeoverRemaining;
    }

    function markCompleted(avatar) {
        if (avatar) state.takeoverCompleted.add(avatar);
        return getSnapshot();
    }

    function markFailed() {
        state.takeoverRemaining = 0;
        state.takeoverFailed = true;
        return getSnapshot();
    }

    function finishTakeover() {
        state.takeoverPending = false;
        state.takeoverRemaining = 0;
        state.takeoverSwipeCount = 0;
        return getSnapshot();
    }

    function canFinalize({ manualGenerationInProgress = false, generationStopped = false } = {}) {
        if (state.takeoverPending || state.takeoverFailed) return false;
        return canFinalizeRound({
            takeoverRemaining: state.takeoverRemaining,
            manualGenerationInProgress,
            generationStopped,
        });
    }

    return {
        beginTakeover,
        canFinalize,
        clearTakeover,
        decideTakeoverTurn: decideTurn,
        finishTakeover,
        getSnapshot,
        markCompleted,
        markFailed,
        reset,
        retryFailed,
        setPending,
        skipTurn,
        startWrapper,
    };
}
