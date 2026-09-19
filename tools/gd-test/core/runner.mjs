import path from 'node:path';
import { runStaticChecks } from '../lib/checks.mjs';
import { discoverTests, relativePath } from '../lib/files.mjs';
import { runNodeTests } from './test-runner.mjs';

export async function runProfile({ root, config, options }) {
    const profile = config.profiles[options.profile];
    if (!profile) throw new Error(`Unknown profile "${options.profile}". Use --help to list profiles.`);
    const startedAt = Date.now();
    let testEntries = await discoverTests(root, config, profile.suites);
    if (options.filter) {
        const filtered = testEntries.filter(entry => relativePath(root, entry.file).toLowerCase().includes(options.filter.toLowerCase()));
        if (filtered.length) testEntries = filtered;
    }
    if (options.list) return { profile, testEntries, report: null };

    const stages = [];
    if (profile.staticChecks) stages.push(await runStaticChecks(root, config));
    if (testEntries.length) {
        const requiredBugIds = profile.suites.includes('regression') && !options.filter
            ? (config.regression?.requiredBugIds || [])
            : [];
        stages.push(await runNodeTests({ root, config, testEntries, options, requiredBugIds }));
    } else if (profile.suites.length) {
        stages.push({ name: 'tests', ok: false, durationMs: 0, counts: {}, files: [], output: 'No tests matched the selected suites/filter.' });
    }
    const ok = stages.every(stage => stage.ok);
    return {
        profile,
        testEntries,
        report: {
            schemaVersion: 1,
            tool: 'gd-test-lab',
            profile: options.profile,
            ok,
            startedAt: new Date(startedAt).toISOString(),
            durationMs: Date.now() - startedAt,
            node: process.version,
            root,
            stRoot: options.stRoot ? path.resolve(options.stRoot) : null,
            filter: options.filter || null,
            coverage: options.coverage,
            seed: options.seed,
            stages,
        },
    };
}
