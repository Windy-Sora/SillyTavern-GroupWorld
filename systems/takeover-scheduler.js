/** Build the remaining manual-generation queue without touching SillyTavern. */
export function buildTakeoverSchedule(orderedAvatars, { completed = new Set(), knownAvatars = new Set() } = {}) {
    const queue = [];
    const skipped = [];
    for (let originalIndex = 0; originalIndex < orderedAvatars.length; originalIndex += 1) {
        const avatar = orderedAvatars[originalIndex];
        if (completed.has(avatar)) {
            skipped.push({ avatar, originalIndex, reason: 'completed' });
        } else if (!knownAvatars.has(avatar)) {
            skipped.push({ avatar, originalIndex, reason: 'unknown' });
        } else {
            queue.push({ avatar, originalIndex });
        }
    }
    return { queue, skipped, remaining: queue.length };
}
