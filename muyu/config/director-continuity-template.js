// Both consumers use String.replace, which replaces only the first matching
// history placeholder. Other Provider tokens are not portable between the
// explicit Provider path and Director's post-render auto-injection path.
export function inspectDirectorContinuityTemplate(text, placeholder) {
    if (text === '') return { placeholderCount: 1, otherPlaceholders: false };
    const paths = [...text.matchAll(/\{\{([^{}]+)\}\}/g)].map(match => match[1].trim());
    return {
        placeholderCount: paths.filter(path => path === placeholder).length,
        otherPlaceholders: paths.some(path => path !== placeholder),
    };
}
