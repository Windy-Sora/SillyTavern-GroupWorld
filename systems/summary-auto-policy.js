/** Decide whether a completed group round should generate or checkpoint a summary. */
export function planSummaryAutoRun({ currentLength, covered, hasCounter, hasLegacyCounter, interval }) {
    const firstEnable = covered === 0 && !hasCounter && !hasLegacyCounter;
    if (firstEnable && currentLength < interval) return { type: 'checkpoint', firstEnable, newMessages: currentLength };
    if (firstEnable) return { type: 'execute', firstEnable, newMessages: currentLength };
    if (currentLength < covered) return { type: 'reset', firstEnable: false, newMessages: 0 };
    const newMessages = currentLength - covered;
    return { type: newMessages >= interval ? 'execute' : 'none', firstEnable: false, newMessages };
}

/** Advance coverage only after the planned generation has completed. */
export async function runSummaryAutoPlan(action, { currentLength, generateSummary, saveLength }) {
    if (action.type === 'execute') await generateSummary();
    if (action.type !== 'none') await saveLength(currentLength);
    return action;
}
