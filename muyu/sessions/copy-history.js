import { HISTORY_LIMITS, validateRecord, validateSummary } from './contract.js';

const contentKey = record => JSON.stringify({ ...record, revision: 0 });
export const historyCopyError = error => ['HISTORY_CAPACITY', 'HISTORY_VERSION', 'HISTORY_INVALID', 'HISTORY_UNAVAILABLE', 'HISTORY_IDENTITY_UNAVAILABLE', 'HISTORY_SAVE_FAILED'].includes(error?.message) ? error.message : 'HISTORY_SAVE_FAILED';

/** Explicit copy only: never update/delete either an existing destination or the source. */
export async function copyHistory({ source, target, check = async () => {} }) {
    const report = { total: 0, copied: 0, identical: 0, conflicts: 0, remaining: 0, error: null };
    await check();
    const rows = await source.list();
    await check();
    if (!Array.isArray(rows) || rows.length > HISTORY_LIMITS.sessions) throw Error('HISTORY_INVALID');
    const summaries = rows.map(validateSummary);
    if (new Set(summaries.map(row => row.id)).size !== summaries.length) throw Error('HISTORY_INVALID');
    report.total = report.remaining = summaries.length;
    for (const summary of summaries) {
        try {
            await check();
            const record = validateRecord(await source.read(summary.id));
            await check();
            if (record.id !== summary.id || record.scope !== summary.scope || record.revision !== summary.revision) throw Error('HISTORY_CONFLICT');
            const existing = await target.read(record.id);
            await check();
            if (existing) {
                if (contentKey(validateRecord(existing)) === contentKey(record)) report.identical++;
                else report.conflicts++;
            } else {
                // A changing source must be re-examined on retry, not copied as a known stale snapshot.
                const current = validateRecord(await source.read(record.id));
                await check();
                if (JSON.stringify(current) !== JSON.stringify(record)) throw Error('HISTORY_CONFLICT');
                await target.create({ ...record, revision: 0 });
                await check();
                report.copied++;
            }
            report.remaining--;
        } catch (error) {
            if (['HISTORY_CONFLICT', 'HISTORY_DELETED'].includes(error.message)) {
                report.conflicts++; report.remaining--; continue;
            }
            // A failed acknowledgement may have saved this record. Retrying checks its full content.
            report.error = historyCopyError(error);
            break;
        }
    }
    return report;
}
