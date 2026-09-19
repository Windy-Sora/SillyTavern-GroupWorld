function findLine(source, offset) {
    return source.slice(0, offset).split(/\r?\n/).length;
}

export default {
    id: 'source-hygiene',
    title: 'Source hygiene',
    version: 1,
    order: 40,
    run({ project, services }) {
        const issues = [];
        for (const file of project.sourceFiles) {
            const source = project.sources.get(file);
            const relative = services.relativePath(project.root, file);
            if (project.config.staticChecks.checkMergeMarkers) {
                const marker = /^(?:<<<<<<<|=======|>>>>>>>)(?:\s|$)/m.exec(source);
                if (marker) issues.push({ severity: 'error', code: 'MERGE_MARKER', file: relative, line: findLine(source, marker.index), message: 'Unresolved merge-conflict marker' });
            }
            if (project.config.staticChecks.checkReplacementCharacters) {
                const replacement = source.indexOf('\uFFFD');
                if (replacement >= 0) issues.push({ severity: 'warning', code: 'ENCODING_REPLACEMENT', file: relative, line: findLine(source, replacement), message: 'Contains Unicode replacement character U+FFFD' });
            }
        }
        return { issues };
    },
};
