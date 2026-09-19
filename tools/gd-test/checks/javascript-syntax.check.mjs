export default {
    id: 'javascript-syntax',
    title: 'JavaScript syntax',
    version: 1,
    order: 10,
    run({ project, services }) {
        const issues = [];
        for (const file of project.sourceFiles) {
            const probe = project.probeByFile.get(file);
            if (probe?.ok) continue;
            issues.push({
                severity: 'error',
                code: probe?.error?.startsWith('Invalid source-probe') ? 'SOURCE_PROBE' : 'JS_SYNTAX',
                file: services.relativePath(project.root, file),
                message: probe?.error || 'Syntax check failed',
            });
        }
        return { counts: { sourceFiles: project.sourceFiles.length }, issues };
    },
};
