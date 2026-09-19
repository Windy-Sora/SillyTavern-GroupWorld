import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverCheckers } from '../core/check-discovery.mjs';
import { runCheckers } from '../core/check-runner.mjs';
import { buildProjectIndex, projectServices } from '../core/project-index.mjs';
import { relativePath } from './files.mjs';

const checkDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../checks');

/** Compatibility entry point used by the CLI and existing platform tests. */
export async function runStaticChecks(root, config) {
    const startedAt = Date.now();
    const project = await buildProjectIndex(root, config);
    const checkers = await discoverCheckers(checkDirectory);
    const result = await runCheckers(checkers, Object.freeze({
        root,
        config,
        project,
        services: projectServices,
    }));
    const errors = result.issues.filter(item => item.severity === 'error').length;
    const warnings = result.issues.length - errors;
    const productionModules = project.productionFiles.map(file => relativePath(root, file));
    const testReachableModules = project.productionFiles
        .filter(file => project.testReachable.has(file))
        .map(file => relativePath(root, file));
    const testReachableSet = new Set(testReachableModules);
    const testUnreachableModules = productionModules.filter(file => !testReachableSet.has(file));
    return {
        name: 'static',
        ok: errors === 0,
        durationMs: Date.now() - startedAt,
        counts: { ...result.counts, errors, warnings },
        issues: result.issues,
        checkers: result.checkers,
        moduleReachability: {
            productionModules,
            testReachableModules,
            testUnreachableModules,
        },
    };
}
