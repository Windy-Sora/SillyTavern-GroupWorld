// This setting is a prompt example, not a JSON Schema or a runtime response validator.
// Keep inspection advisory: users may provide prose or their own output convention.
export function inspectDirectorOutputFormat(text) {
    if (text === '') return { empty: true };
    const placeholders = [...text.matchAll(/\{\{([^{}]+)\}\}/g)].map(match => match[1].trim());
    return {
        empty: false,
        hasSpeakers: /["']speakers["']|\bspeakers\b/i.test(text),
        hasScriptField: placeholders.includes('scriptField') || /["']scripts["']/i.test(text),
        hasStoryDoneField: placeholders.includes('storyBlueprintDoneField'),
        hasSelfReference: placeholders.includes('llmJsonSchema'),
        hasOtherPlaceholders: placeholders.some(path => !['scriptField', 'storyBlueprintDoneField', 'llmJsonSchema'].includes(path)),
    };
}
