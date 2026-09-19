import path from 'node:path';
import { fileURLToPath } from 'node:url';

const checkDirectory = path.dirname(fileURLToPath(import.meta.url));

export default {
    id: 'module-smoke',
    title: 'Module import smoke',
    version: 1,
    order: 70,
    timeoutMs: 120_000,
    async run({ project, services }) {
        const importProbe = path.resolve(checkDirectory, '../lib/import-probe.mjs');
        const results = await services.mapLimit(
            project.smokeCandidates,
            project.config.staticChecks.moduleSmokeConcurrency || 4,
            file => services.runCommand(process.execPath, [importProbe, file], {
                cwd: project.root,
                timeoutMs: 15_000,
            }),
        );
        const issues = [];
        results.forEach((result, index) => {
            if (result.code !== 0) {
                issues.push({
                    severity: 'error',
                    code: 'MODULE_IMPORT',
                    file: services.relativePath(project.root, project.smokeCandidates[index]),
                    message: (result.stderr || result.stdout || 'Module import smoke test failed').trim(),
                });
            }
        });
        return {
            counts: {
                moduleSmokeChecked: project.smokeCandidates.length,
                moduleSmokeSkipped: project.smokeSkipped.length,
            },
            issues,
        };
    },
};
