/** Mechanical facts about one settings read, never a task-wide or runtime verdict. */
export function settingReadEvidence(fields, values) {
    const missingFields = fields.filter(id => !Object.hasOwn(values, id));
    return {
        kind: 'current-memory-settings',
        requestedCount: fields.length,
        returnedCount: fields.length - missingFields.length,
        missingFields,
        coverage: 'this-read-only',
        runtime: 'not-observed',
        persistence: 'unknown',
        interpretation: 'Counts cover only this read. Combine successful field IDs across reads to assess the requested scope, not contract queries or attempted reads. Values show configuration, not execution, success or durable saving. Contracts describe conditional mechanisms, not observed events. Interpret empty text per field contract, never as a universal built-in default.',
    };
}
