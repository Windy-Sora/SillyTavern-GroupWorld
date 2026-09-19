export function getForceSpeakAction({ roundInitialized = false, generationType = 'normal', lastMessageIsUser = false, hasGroup = false, mode = 'native' }) {
    const forced = !roundInitialized && generationType !== 'swipe' && generationType !== 'regenerate' && !lastMessageIsUser && hasGroup;
    if (!forced) return 'pass';
    if (mode === 'block') return 'block';
    if (mode === 'llm') return 'llm';
    return 'confirm_native';
}

export function createFreshRoundState() {
    return { speakerCount: 0, initialized: false, generationStopped: false, takeoverPending: false, takeoverRemaining: 0, takeoverFailed: false, takeoverSwipeCount: 0 };
}
