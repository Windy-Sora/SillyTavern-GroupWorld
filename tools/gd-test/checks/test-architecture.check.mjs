const LIMITS = [
    { pattern: /^tools\/gd-test\/cli\.mjs$/, max: 100 },
    { pattern: /^tools\/gd-test\/core\/[^/]+\.mjs$/, max: 250 },
    { pattern: /^tools\/gd-test\/checks\/[^/]+\.check\.mjs$/, max: 150 },
    { pattern: /^tests\/harness\/[^/]+\.mjs$/, max: 250 },
];

export default {
    id: 'test-architecture',
    title: 'Test architecture boundaries',
    version: 1,
    order: 80,
    run({ project, services }) {
        const issues = [];
        for (const record of project.importRecords) {
            if (!record.resolved) continue;
            const importer = record.importerRelative;
            const dependency = services.relativePath(project.root, record.resolved);
            if (/^tests\/.*\.test\.(?:js|mjs)$/i.test(importer) && /^tests\/.*\.test\.(?:js|mjs)$/i.test(dependency)) {
                issues.push({ severity: 'error', code: 'TEST_IMPORT_TEST', file: importer, line: record.line, message: `Test files must not import other test files: ${dependency}` });
            }
            if (importer.startsWith('tests/harness/') && !dependency.startsWith('tests/') && !dependency.startsWith('tools/')) {
                issues.push({ severity: 'error', code: 'HARNESS_PRODUCTION_DEP', file: importer, line: record.line, message: `Harness must not depend on production module: ${dependency}` });
            }
            if (importer.startsWith('tests/unit/') && dependency === 'tests/harness/fake-st-host.mjs') {
                issues.push({ severity: 'warning', code: 'UNIT_FAKE_HOST', file: importer, line: record.line, message: 'Unit tests should inject minimal dependencies instead of using the full Fake Host' });
            }
        }
        for (const [file, source] of project.sources) {
            const relative = services.relativePath(project.root, file);
            const limit = LIMITS.find(item => item.pattern.test(relative));
            if (!limit) continue;
            const lines = source.split(/\r?\n/).length;
            if (lines > limit.max) {
                issues.push({ severity: 'warning', code: 'TEST_MODULE_SIZE', file: relative, message: `Test platform module has ${lines} lines (review threshold: ${limit.max})` });
            }
        }
        return { counts: { testArchitectureFiles: project.sourceFiles.filter(file => services.relativePath(project.root, file).startsWith('tests/') || services.relativePath(project.root, file).startsWith('tools/gd-test/')).length }, issues };
    },
};
