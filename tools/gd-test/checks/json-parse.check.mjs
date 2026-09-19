export default {
    id: 'json-parse',
    title: 'JSON parsing',
    version: 1,
    order: 20,
    run({ project }) {
        const issues = [];
        for (const [file, result] of project.jsonResults) {
            if (!result.ok) issues.push({ severity: 'error', code: 'JSON_PARSE', file, message: result.error });
        }
        return { counts: { jsonFiles: project.jsonFiles.length }, issues };
    },
};
