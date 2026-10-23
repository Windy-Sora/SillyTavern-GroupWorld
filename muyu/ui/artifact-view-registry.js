/** Presentation ownership is trusted wiring, never write authority. Unknown kinds fail closed. */
export function createArtifactViews(entries, actions) {
    if (!Array.isArray(entries) || !entries.length || !Array.isArray(actions)) throw Error('INVALID_ARTIFACT_VIEWS');
    const rows = new Map();
    for (const entry of entries) {
        const action = actions.find(a => a.id === entry?.actionOwner);
        if (typeof entry?.kind !== 'string' || !entry.kind || rows.has(entry.kind) || typeof entry.render !== 'function' ||
            !Array.isArray(entry.title) || entry.title.length !== 2 || entry.title.some(t => typeof t !== 'string' || !t.trim()) ||
            !['inline', 'anchored-details'].includes(entry.layout) ||
            !(entry.role === 'action' && action?.artifactKinds.includes(entry.kind) && entry.layout === 'inline' ||
                entry.role === 'report' && entry.kind === 'report' && entry.actionOwner === null && entry.layout === 'anchored-details' ||
                entry.role === 'read-review' && entry.kind === 'task-plan' && entry.actionOwner === null && entry.layout === 'anchored-details')) throw Error('INVALID_ARTIFACT_VIEW');
        rows.set(entry.kind, Object.freeze({ ...entry, title: Object.freeze([...entry.title]) }));
    }
    if (actions.some(action => action.artifactKinds.some(kind => rows.get(kind)?.actionOwner !== action.id))) throw Error('ARTIFACT_VIEW_MISSING');
    return Object.freeze({
        describe: () => [...rows.values()].map(({ render, ...row }) => ({ ...row, title: [...row.title] })),
        title(kind, lang = 'zh') { return rows.get(kind)?.title[lang === 'en' ? 1 : 0] || (lang === 'en' ? 'Unsupported artifact' : '暂不支持的产物'); },
        layout: kind => rows.get(kind)?.layout || 'inline',
        render(kind, context) { const row = rows.get(kind); if (!row) return false; row.render(context); return true; },
    });
}
