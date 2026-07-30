export function summarizeTrace(trace) {
    const stages = Array.isArray(trace?.stages) ? trace.stages : [];
    const realStages = stages.filter(stage => {
        const name = stage.stage || stage.name || stage.id;
        return name !== '_start' && name !== '_done';
    });
    return {
        realStages,
        hasError: stages.some(stage => !!stage.error),
        totalMs: realStages.reduce(
            (total, stage) => total + (stage.duration ?? stage.elapsed ?? 0),
            0,
        ),
        stageSummary: realStages.map(stage => stage.stage || stage.name || stage.id).join(' → '),
    };
}
