/** A failed question can be copied back into the composer, never replayed as a task. */
export function recoverableQuestion({ record, messages = record?.messages, runs = [], readOnly = false, busy = false }) {
    if (!record || readOnly || busy || record.archived || record.imported || !Array.isArray(messages)) return null;
    const last = messages.at(-1), before = messages.at(-2);
    if (last?.role !== 'user' || typeof last.content !== 'string' || !last.content.trim() || last.origin === 'continuation') return null;
    const latest = runs.at(-1);
    if (latest && latest.id !== last.runId) return null;
    if (latest?.taskId && runs.find(run => run.taskId === latest.taskId)?.id !== latest.id) return null;
    if (last.origin !== 'question' && before && !latest) return null;
    const status = latest?.status || record.status;
    if (!['failed', 'cancelled', 'interrupted'].includes(status)) return null;
    const rows = latest?.process?.rows;
    return { runId: last.runId, status, possibleEffects: !Array.isArray(rows) || !!latest.process.dropped || rows.some(row => row.type?.startsWith('tool.')) };
}
