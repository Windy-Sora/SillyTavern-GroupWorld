// Prompt text transformation only. This does not submit a native JSON Schema
// to the model or validate the eventual response against this example.
export function migrateLegacyDirectorOutputFormat(text) {
    if (typeof text !== 'string'
        || text.includes('{{storyBlueprintDoneField}}')
        || !/"global"\s*:\s*\{\s*\}/.test(text)) return text;
    return text.replace(/"global"\s*:\s*\{\s*\}/, '"global": { {{storyBlueprintDoneField}} }');
}

export function renderDirectorOutputFormat({ text, scriptEnabled, storyBlueprintEnabled, completionVariable = '' }) {
    const scriptField = scriptEnabled
        ? ',\n  "scripts": {\n    "NameOfFirstSpeaker": "short imperative stage direction",\n    "NameOfSecondSpeaker": "short imperative stage direction"\n  }'
        : '';
    const storyBlueprintDoneField = storyBlueprintEnabled
        ? `\n      "${completionVariable}": false\n    `
        : '';
    return text
        .replace(/\{\{scriptField\}\}/g, scriptField)
        .replace(/\{\{storyBlueprintDoneField\}\}/g, storyBlueprintDoneField)
        .replace(/\{\{llmJsonSchema\}\}/g, '');
}
