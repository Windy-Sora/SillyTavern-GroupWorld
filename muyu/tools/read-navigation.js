import { SELF_SECTIONS } from '../self/config.js';
// First-party navigation only: no discovery of host data, grants or side effects.
const paths = Object.freeze({
    'character-card': { list: 'muyu.character_card.list', read: 'muyu.character_card.read', source: 'stCharacterCardState', skill: 'character-npc-workbench', object: 'saved basic card text only; regex/scripts/embedded books use the separate stCharacterComponents Provider source, not this text whitelist' },
    libraries: { list: 'muyu.libraries.list', read: 'muyu.libraries.read', source: 'profileLibraryAssets', skill: 'resource-library-workflow', object: 'saved profile packages, not current-chat profiles or configuration profiles' },
    'npc-libraries': { list: 'muyu.npc_libraries.list', read: 'muyu.npc_libraries.read', source: 'npcLibraryAssets', skill: 'resource-library-workflow', object: 'saved NPC packages, not current-chat NPC records or ST character cards' },
    'blueprint-libraries': { list: 'muyu.blueprint_libraries.list', read: 'muyu.blueprint_libraries.read', source: 'blueprintLibraryAssets', skill: 'resource-library-workflow', object: 'saved blueprint packages, not current-chat blueprint progress' },
    prompts: { list: 'muyu.prompts.list', read: 'muyu.prompts.read', source: 'customPromptAssets', skill: 'prompt-template-workbench', object: 'saved custom Prompt definitions, not ST presets, Muyu system instructions or Provider code' },
});
export const sourceReadNavigationSchema = { type: 'object', properties: {
    tool: { type: 'string', enum: ['muyu.provider.read'] },
    args: { type: 'object', properties: { id: { type: 'string', enum: ['stCharacterComponents', 'stPersonaContent'] } }, required: ['id'], additionalProperties: false },
    purpose: { type: 'string', maxLength: 240 }, skill: { type: 'string', maxLength: 80 }, boundary: { type: 'string', maxLength: 400 },
}, required: ['tool', 'args', 'purpose', 'skill', 'boundary'], additionalProperties: false };
const sourcePaths = Object.freeze({
    stCharacterComponents: { purpose: 'Read saved card regex, Tavern Helper scripts and embedded-book entries. Start with this source directory, then follow its card and component selectors.', skill: 'st-card-stack-analysis' },
    stPersonaContent: { purpose: 'Read current-memory or stored Persona descriptions. Start with this source directory; check currentReadAvailable and storedReadAvailable separately.', skill: 'worldbook-workflow' },
});
export function sourceReadNavigation(id) {
    const route = sourcePaths[id];
    return route ? { tool: 'muyu.provider.read', args: { id }, ...route,
        boundary: 'Entry support only, not data availability or permission. Separate source authorization is required. Use this source\'s own directory/revision; never reuse the old reader\'s revision. Read only when relevant and allowed; never bypass denial. Skill name is a relevance hint, not proof it is enabled.' } : null;
}
export function readNavigation(group, toolIds, availableTools = toolIds) {
    if (group === 'muyu-self' && toolIds.includes('muyu.self.read')) return { inspectionPath: {
        tool: 'muyu.self.read', sections: [...SELF_SECTIONS], permission: 'muyuSelfConfig',
        procedure: 'Select this listed group if grouped, then pass the relevant section. Use tools for document/web/JSON/Skill/memory switches and retained admission; storage for history routing/work status; run/context for budgets; connection for connection flags.',
        boundary: 'Passive settings observation, not an active document/web call, probe or archive opening. Reading feature switches does not require that feature execution tool to be admitted. Navigation grants no permission or data availability; honor no-read and denial. Overview is a multi-section snapshot, not a catalog. Unknown is not unread; do not use unrelated sections as fallback.',
    } };
    const path = paths[group];
    if (!path || !toolIds.includes(path.list) || !toolIds.includes(path.read)) return {};
    return { readPath: { ...path, scope: 'global',
        procedure: 'Select this listed group if grouped; list metadata, then read the returned exact id/revision at offset=0. Follow read.nextOffset with that same resource version. Relist on stale data; do not guess IDs or splice versions.',
        boundary: 'Navigation grants no permission. Use read for inspection; export requires explicit export intent and is not a substitute for read. Reading does not apply, import, activate, render, generate or confirm persistence. Saved resources may remain when runtime use is disabled. Current-chat data needs its own source/tool; denial must not be bypassed. If the group is absent, do not claim it is available or use Provider execution as a substitute.' },
        ...(group === 'character-card' && availableTools.includes('muyu.provider.list') ? { relatedDirectory: { tool: 'muyu.provider.list',
            purpose: 'This lists optional tool GROUPS, not every Provider data source. For card regex/scripts/embedded books, check stCharacterComponents in the Provider SOURCE catalog before claiming unsupported. A catalog entry does not prove host data availability or authorize reading.' } } : {}) };
}
