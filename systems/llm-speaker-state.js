/** Pure decision state for LLM mode when SillyTavern drives generation order. */
export function decideLlmSpeakerTurn({ plannedAvatars = [], spokenAvatars = [], cursor = 0, avatar, generationType = 'normal', respectOrder = false }) {
    const reroll = generationType === 'swipe' || generationType === 'regenerate';
    const planned = new Set(plannedAvatars);
    if (reroll) {
        return { action: 'allow', reason: 'reroll', spokenAvatars: [...spokenAvatars], cursor };
    }
    if (!planned.has(avatar)) {
        return { action: 'block', reason: 'not_planned', spokenAvatars: [...spokenAvatars], cursor };
    }

    const spoken = new Set(spokenAvatars);
    let nextCursor = cursor;
    if (respectOrder) {
        while (nextCursor < plannedAvatars.length && spoken.has(plannedAvatars[nextCursor])) nextCursor += 1;
        const expected = plannedAvatars[nextCursor];
        if (expected === avatar) nextCursor += 1;
        else {
            nextCursor = plannedAvatars.findIndex(candidate => !spoken.has(candidate));
            if (nextCursor === -1) nextCursor = plannedAvatars.length;
        }
    }
    spoken.add(avatar);
    return { action: 'allow', reason: 'planned', spokenAvatars: [...spoken], cursor: nextCursor };
}
