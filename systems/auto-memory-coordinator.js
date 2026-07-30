/**
 * Run automatic memory extraction with per-character progress.
 *
 * A successful character is checkpointed immediately, while failed characters
 * remain retryable. This prevents one failure from causing every successful
 * character in the batch to be generated again on the next pass.
 */
export async function runAutoMemoryTargets({
    targets,
    currentLen,
    interval,
    defaultCovered = 0,
    coveredByTarget = {},
    generateForTarget,
    onCovered = async () => {},
    log = () => {},
}) {
    const attempted = [];
    const skipped = [];
    const covered = [];
    const failures = [];

    for (const target of targets || []) {
        const previous = Number(coveredByTarget[target] ?? defaultCovered) || 0;
        if (currentLen - previous < interval) {
            skipped.push(target);
            continue;
        }

        attempted.push(target);
        try {
            await generateForTarget(target);
            await onCovered(target, currentLen);
            covered.push(target);
        } catch (error) {
            if (error?.code === 'NO_NEW_MEMORIES') {
                try {
                    await onCovered(target, currentLen);
                    covered.push(target);
                } catch (persistError) {
                    failures.push({ target, error: persistError });
                    log('Auto-memory checkpoint fail:', target, persistError?.message || String(persistError));
                }
                continue;
            }
            failures.push({ target, error });
            log('Auto-memory fail:', target, error?.message || String(error));
        }
    }

    return {
        attempted,
        skipped,
        covered,
        failures,
        complete: failures.length === 0,
    };
}
