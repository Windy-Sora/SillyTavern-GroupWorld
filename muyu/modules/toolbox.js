import { createToolRegistry } from '../tools/registry.js';
export function createToolboxModule() {
    const registry = createToolRegistry();
    for (const name of ['list', 'select']) registry.register({ id: 'muyu.tools.' + name, version: 1,
        description: name === 'list' ? 'List all available on-demand tool groups, IDs and exact tools. Tools absent from the current request may be unselected, not unsupported. BEFORE denying a capability or claiming GUI-only management, check this directory. Includes Skill create/update/copy/enable previews when the skills group is listed; skills.discover/load are task guidance, NOT the whole management API. When grouped=true, choose needed groups with tools.select before calling their tools. This is not permission; do not ask the user to classify their task.' : 'Select up to 8 needed optional tool groups by listed IDs for subsequent model requests. REPLACES prior optional selection; keep all still-needed groups. Must be the only tool call in this response. No permission granted, no host data read or code execution. On capacity error choose fewer groups, not fewer safeguards. Core tools remain available.',
        inputSchema: { type: 'object', properties: name === 'list' ? {} : { groups: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 80 } } }, required: name === 'list' ? [] : ['groups'], additionalProperties: false },
        outputSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 24000 } }, required: ['text'], additionalProperties: false },
        scope: 'global', effect: 'read', dataClasses: ['public-knowledge'], confirmation: 'policy', resourceKeys: [], timeoutMs: 1000, retryPolicy: { kind: 'none', maxAttempts: 1 } });
    registry.seal();
    return { registry, handlers: { 'muyu.tools.list': () => { throw Error('TOOLBOX_NOT_BOUND'); }, 'muyu.tools.select': () => { throw Error('TOOLBOX_NOT_BOUND'); } }, transferRun() {}, retainArtifacts() {}, forgetRun() {}, dispose() {} };
}
