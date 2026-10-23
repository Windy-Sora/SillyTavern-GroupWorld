// The Story Blueprint Provider performs literal dot-path replacement only.
// It does not run the generic Provider renderer or execute template code.
const stable = new Set([
    'blueprint', 'blueprint.title', 'blueprint.meta', 'blueprint.nodes',
    'progress', 'progress.current', 'progress.done', 'progress.total', 'progress.complete', 'progress.currentIndex',
    'current', 'current.id', 'current.depth', 'current.path', 'current.node', 'current.nodeJson', 'current.content',
    'completionVariable', 'doneSignals',
]);
const dynamicPrefix = ['blueprint.meta.', 'blueprint.nodes.', 'current.node.', 'current.content.'];

export function inspectStoryBlueprintProviderTemplate(text) {
    if (text === '') return { unknown: [], hasCurrentDetail: true, hasCompletionVariable: true };
    const paths = [...text.matchAll(/\{\{([^{}]+)\}\}/g)].map(match => match[1].trim());
    const unknown = [...new Set(paths.filter(path => !stable.has(path) && !dynamicPrefix.some(prefix => path.startsWith(prefix))))];
    return {
        unknown,
        hasCurrentDetail: paths.some(path => ['current.node', 'current.nodeJson', 'current.content'].includes(path)
            || path.startsWith('current.node.') || path.startsWith('current.content.')),
        hasCompletionVariable: paths.includes('completionVariable'),
    };
}
