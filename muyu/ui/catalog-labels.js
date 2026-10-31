import { permissionTitle } from '../permissions/contract.js';

// Display metadata only: never rewrites a Skill package, selector or permission ID.
const builtinEnglish = Object.freeze({
    'st-ejs-template-guide': ['EJS prompt templates', 'Explain and troubleshoot ST-Prompt-Template syntax, variable scopes and dynamic world-book injection without executing templates.'],
    'tavern-helper-guide': ['TavernHelper and interactive frontends', 'Understand script and message contexts, variables, MVU integration and frontend actions without granting API access.'],
    'st-card-stack-analysis': ['Character card and preset integration', 'Understand and troubleshoot macros, regex frontends, scripts and state pipelines without assuming a universal card format.'],
    'dsl-template-workbench': ['DSL and structured templates', 'Design and troubleshoot Provider data paths, filters, loops and nested template scopes.'],
    'config-review': ['Configuration review', 'Review connected GroupWorld settings and how modules work together, without modifying them.'],
    'currency-system': ['Currency systems', 'Design chat currency and counters, clarify scope, and preview only the requested changes.'],
    'provider-workbench': ['Provider workbench', 'Inspect, draft and test user Providers while respecting system locks and execution permissions.'],
    'director-diagnosis': ['Director diagnostics', 'Inspect speaker selection settings and runtime evidence without inferring past causes from current settings.'],
    'memory-maintenance': ['Character memory maintenance', 'Inspect and maintain GroupWorld character memories, extraction intervals and capacity; separate from Muyu notes.'],
    'blueprint-workflow': ['Story Blueprint workflow', 'Inspect and edit story nodes and progress through the available Blueprint tools.'],
    'configuration-orchestration': ['Multi-module configuration', 'Plan bounded changes across variables, settings and resources, with exact previews and separate approvals.'],
    'chat-context-analysis': ['Chat context analysis', 'Read authorized chat evidence and analyze story continuity, characters and rules without making edits.'],
    'variable-workbench': ['Variable workbench', 'Inspect and edit current-chat variable definitions and stored values using fresh selectors and baselines.'],
    'character-npc-workbench': ['Characters and NPCs', 'Inspect profiles and NPCs, draft edits and request generation without silently overwriting existing records.'],
    'resource-library-workflow': ['Resource libraries', 'Manage profile, NPC and Blueprint libraries and distinguish saved resources from current-chat data.'],
    'prompt-template-workbench': ['Prompts and templates', 'Inspect and draft custom Prompts, structured data, templates and schemas without treating them as permissions.'],
    'script-agent-workbench': ['Scripts and custom Agents', 'Draft and test script or Agent definitions; distinguish saving, enablement and real execution.'],
    'worldbook-workflow': ['World books', 'Inspect and manage authorized world-book content, bindings and entries without claiming final injection.'],
    'automation-workflow': ['Automation and post-speech', 'Explain automation timing and post-speech settings, additional calls and execution boundaries.'],
    'muyu-troubleshooting': ['Muyu troubleshooting', 'Diagnose connection, permission, context and tool failures from available evidence without requesting secrets.'],
    'skill-workbench': ['Skill management', 'Discover, inspect and manage Skills; imported documents never grant extra permissions.'],
    'muyu-interface-guide': ['Muyu interface guide', 'Find actual GUI controls for connections, history, permissions, Skills and memory without reading private settings.'],
    'muyu-settings-guide': ['Muyu settings and tuning', 'Explain Muyu budgets, permissions and storage; compare instruction drafts, inspect tool availability read-only and suggest targeted GUI adjustments.'],
});

export function skillDisplay(row, lang = 'zh') {
    const original = { displayName: row?.displayName || row?.name || '', description: row?.description || '' };
    if (lang !== 'en' || row?.source !== 'builtin' || !row.id?.startsWith('builtin:')) return original;
    const name = row.id.slice('builtin:'.length);
    if (row.name && row.name !== name || !Object.hasOwn(builtinEnglish, name)) return original;
    const [displayName, description] = builtinEnglish[name];
    return { displayName, description };
}

/** Canonical bilingual titles remain unchanged for transcripts and model protocols. */
export function permissionDisplayTitle(id, lang = 'zh') {
    const title = permissionTitle(id), at = title.indexOf(' / ');
    return at < 0 ? title : lang === 'en' ? title.slice(at + 3) : title.slice(0, at);
}
