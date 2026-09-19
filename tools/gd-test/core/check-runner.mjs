import { runCheckerWorker } from './check-worker-client.mjs';

function platformIssue(code, checker, message) {
    return {
        severity: 'error',
        code,
        file: `tools/gd-test/checks/${checker.file}`,
        line: null,
        message,
    };
}

async function runOne(checker, context) {
    const startedAt = Date.now();
    try {
        if (checker.discoveryError) throw Object.assign(new Error(checker.discoveryError.message), checker.discoveryError);
        const result = await runCheckerWorker({
            action: 'run',
            moduleUrl: checker.moduleUrl,
            file: checker.file,
            checkerId: checker.id,
            project: context.project,
        }, checker.timeoutMs);
        return {
            id: checker.id,
            title: checker.title,
            ok: true,
            durationMs: Date.now() - startedAt,
            ...result,
        };
    } catch (error) {
        const code = error.code === 'CHECK_TIMEOUT' ? 'CHECK_TIMEOUT' : 'CHECK_CRASH';
        return {
            id: checker.id,
            title: checker.title,
            ok: false,
            durationMs: Date.now() - startedAt,
            counts: {},
            issues: [platformIssue(code, checker, error.stack || error.message)],
        };
    }
}

export async function runCheckers(checkers, context) {
    if (!checkers.length) throw new Error('No checker plugins were discovered');
    const results = [];
    const counts = {};
    const issues = [];
    for (const checker of checkers) {
        const result = await runOne(checker, context);
        results.push(result);
        issues.push(...result.issues);
        for (const [key, value] of Object.entries(result.counts)) {
            if (Object.hasOwn(counts, key)) throw new Error(`Duplicate checker count key "${key}"`);
            counts[key] = value;
        }
    }
    return { counts, issues, checkers: results };
}
