/** Pure scheduling policy for automatic Custom Agent runs. */
export function planCustomAgentAutoRuns({
    instances,
    currentLength,
    counters,
    getLatestRangeEnd = () => 0,
    legacyLength,
}) {
    const actions = [];
    const sorted = [...instances]
        .filter(agent => agent.enabled && agent.autoEnabled)
        .sort((a, b) => (a.order || 0) - (b.order || 0));

    for (const instance of sorted) {
        const counterKey = `_autoCAG_${instance.id}`;
        const hasCounter = Object.prototype.hasOwnProperty.call(counters, counterKey);
        const covered = hasCounter ? counters[counterKey] : (getLatestRangeEnd(instance.id) ?? 0);
        const interval = instance.autoInterval || 10;

        if (covered === 0 && !hasCounter && legacyLength === undefined) {
            actions.push({
                type: currentLength >= interval ? 'execute' : 'checkpoint',
                instance,
                currentLength,
                newMessages: currentLength,
            });
        } else if (currentLength < covered) {
            actions.push({ type: 'reset', instance, currentLength, newMessages: 0 });
        } else if (currentLength - covered >= interval) {
            actions.push({
                type: 'execute',
                instance,
                currentLength,
                newMessages: currentLength - covered,
            });
        }
    }
    return actions;
}
