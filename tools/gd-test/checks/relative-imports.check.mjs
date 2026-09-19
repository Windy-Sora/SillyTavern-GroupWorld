export default {
    id: 'relative-imports',
    title: 'Relative imports',
    version: 1,
    order: 50,
    run({ project }) {
        const issues = [];
        if (project.config.staticChecks.checkRelativeImports) {
            for (const record of project.importRecords) {
                if (record.resolved) continue;
                const active = project.reachable.has(record.importer);
                issues.push({
                    severity: active ? 'error' : 'warning',
                    code: active ? 'IMPORT_MISSING' : 'IMPORT_MISSING_ORPHAN',
                    file: record.importerRelative,
                    line: record.line,
                    message: `Relative import cannot be resolved: ${record.specifier}`,
                });
            }
        }
        return { counts: project.importCounts, issues };
    },
};
