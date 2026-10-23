// Both the worldInfo Provider and the automatic Director/Force Speak prefix
// replace only the first occurrence. Do not render or read lorebook data here.
export function inspectDirectorWorldInfoTemplate(template) {
    if (!template) return { empty: true, placeholderCount: 0, otherPlaceholders: false };
    const placeholders = template.match(/{{[^{}]+}}/g) ?? [];
    return {
        empty: false,
        placeholderCount: placeholders.filter(token => token === '{{worldInfo}}').length,
        otherPlaceholders: placeholders.some(token => token !== '{{worldInfo}}'),
    };
}
