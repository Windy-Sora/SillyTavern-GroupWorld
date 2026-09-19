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

export function escapeTraceHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function renderTraceStageHtml(stage, labels = {}) {
    const name = stage.stage || stage.name || stage.id || '';
    const duration = stage.duration ?? stage.elapsed;
    const dur = duration != null ? `${Number(duration).toFixed(0)}ms` : '';
    let meta = '';
    if (stage.retries > 0) meta += ` ${labels.retries || 'retries'}: ${escapeTraceHtml(stage.retries)}`;
    if (stage.promptLength) meta += ` ${labels.prompt || 'prompt'}: ${escapeTraceHtml(stage.promptLength)}chars`;
    if (stage.error) meta += ` <span style="color:#ff5555;">${escapeTraceHtml(stage.error)}</span>`;
    if (stage.outputSummary) {
        const output = stage.outputSummary;
        const outputLabel = labels.output || 'out';
        if (output.type === 'text') meta += ` ${outputLabel}: ${escapeTraceHtml(output.length)}chars`;
        if (output.type === 'object') meta += ` ${outputLabel}: {${(output.keys || []).map(escapeTraceHtml).join(', ')}}`;
        if (output.type === 'array') meta += ` ${outputLabel}: [${escapeTraceHtml(output.length)}]`;
    }

    return `<div style="font-size:0.82em;padding:2px 0;display:flex;justify-content:space-between;">
            <span><b>${escapeTraceHtml(name)}</b></span>
            <span style="color:var(--grey70a);">${dur}${meta}</span>
        </div>`;
}
