// Pure memory-data template renderer. It must not invoke renderPrompt(): doing
// that from charMemory would execute charMemory again and recurse.
const loop = /\{\{#charMemory:(all|groups)\}\}([\s\S]*?)\{\{\/charMemory:\1\}\}/g;
const query = /\{\{\?charMemory:(all|groups)\[\$it\]\.(event|mood|character|name|content)\}\}/g;
const marker = /\{\{[^{}]*\}\}/;

export function renderMemoryTemplate(template, all) {
    if (typeof template !== 'string' || template.length > 12000) throw new TypeError('INVALID_MEMORY_RENDER_TEMPLATE');
    const groups = Object.entries(all).filter(([, memories]) => Array.isArray(memories) && memories.length).map(([name, memories]) => ({
        name,
        content: `=== ${name} ===\n${memories.map(memory => `- ${memory.event} [${memory.mood}]`).join('\n')}\n\n`,
    }));
    const entries = Object.entries(all).flatMap(([character, memories]) => Array.isArray(memories)
        ? memories.map(memory => ({ ...memory, character })) : []);
    const collections = { all: entries, groups };
    if (marker.test(template.replace(loop, ''))) throw new TypeError('INVALID_MEMORY_RENDER_TEMPLATE');
    const rendered = template.replace(loop, (_block, collection, inner) => {
        if (marker.test(inner.replace(query, ''))) throw new TypeError('INVALID_MEMORY_RENDER_TEMPLATE');
        return collections[collection].map(item => inner.replace(query, (_token, target, key) => target === collection
            ? String(item[key] ?? '') : '')).join('');
    });
    return rendered.trim();
}

export function inspectMemoryRenderTemplate(template) {
    if (template === '') return { custom: false, containsMemoryLoop: false };
    renderMemoryTemplate(template, { Example: [{ event: 'An event', mood: 'neutral' }] });
    return { custom: true, containsMemoryLoop: /\{\{#charMemory:(all|groups)\}\}/.test(template) };
}
