const supported = new Set(['{{name}}', '{{summary}}', '{{tags}}', '{{motivation}}', '{{relationships}}']);

/** Rendering is literal replacement, not Provider expansion or a template language. */
export function inspectProfileRenderTemplate(text) {
    if (text === '') return { unknown: [] };
    const unknown = [...new Set(text.match(/\{\{[^{}]*\}\}/g) || [])].filter(token => !supported.has(token));
    return { unknown };
}
