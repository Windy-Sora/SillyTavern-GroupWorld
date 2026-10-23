/** Canonical draft order, shared by observation and preview. Source identities stay private. */
export function taskBundleLayout(content) {
    if (content?.module !== 'task-bundle' || ![1, 2].includes(content.version) || !Array.isArray(content.variables) ||
        content.variables.length > 6 || !Array.isArray(content.scripts || []) || (content.scripts || []).length > 3) return null;
    const steps = [...content.variables.map(row => ({ kind: 'variable', sourceId: row?.preview?.id })),
        ...(content.settings ? [{ kind: 'settings', sourceId: 'global-settings' }] : []),
        ...(content.scripts || []).map(row => ({ kind: 'script', sourceId: row.id || row.next?.name }))];
    return !steps.length || steps.some(row => typeof row.sourceId !== 'string' || !row.sourceId) ? null : steps;
}
