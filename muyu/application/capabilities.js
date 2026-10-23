import { generationBatchExecutionSource, parseGenerationBatchExecutionSource, npcExecutionSource, profileExecutionSource, parseNpcExecutionSource, parseProfileExecutionSource, memoryExecutionSource, parseMemoryExecutionSource, agentExecutionSource, parseAgentExecutionSource, executionSource, parseExecutionSource, permissionSource, sourceKey, scriptExecutionSource, parseScriptExecutionSource, requestSource } from '../permissions/contract.js';
import { fieldDefinition } from '../config/registry.js';

function settingsSources(fields) {
    try { return [...new Set(fields.map(id => fieldDefinition(id).domain === 'memory' ? 'source:memoryConfig' : 'source:configSettings'))]; }
    catch { return null; }
}

// One application contract for tool effects, required grants and history dependencies.
// Tool definitions own wire schemas; handlers own business validation.
const capabilities = Object.freeze({
    'muyu.service.fetch_page': { effect: 'external', sources: () => [] },
    'muyu.service.write_file': {effect:'read',sources:()=>['source:serviceDocuments']},
    'muyu.service.validate_json': {effect:'read',sources:()=>[]},
    ...Object.fromEntries(['list_roots', 'list_files', 'search_documents', 'read_document'].map(name => ['muyu.service.' + name, { effect: 'read', sources: () => ['source:serviceDocuments'] }])),
    ...Object.fromEntries(['muyu.worldbook_editor.list','muyu.worldbook_editor.read'].map(id=>[id,{effect:'read',sources:()=>['source:stWorldBookEntries']}])),
    'muyu.st_preset.list': {effect:'read',sources:()=>['source:stPresets']},
    'muyu.st_preset.read': {effect:'read',sources:()=>['source:stPresetContent']},
    'muyu.st_preset.preview': {effect:'read',sources:()=>['source:stPresetContent']},
    'muyu.character_card.list': {effect:'read',sources:()=>['source:stCharacters']},
    'muyu.character_card.read': {effect:'read',sources:()=>['source:stCharacterCardState']},
    'muyu.character_card.preview': {effect:'read',sources:args=>args.operation==='delete'?['source:stCharacterCardState','source:stCharacterCardReferences']:['source:stCharacterCardState']},
    'muyu.worldbook_editor.bindings':{effect:'read',sources:()=>['source:stWorldBooks']},
    'muyu.worldbook_editor.preview':{effect:'read',sources:args=>['set_global_binding','set_chat_binding'].includes(args.operation)?['source:stWorldBooks']:args.operation==='delete_book'?['source:stWorldBookEntries','source:stWorldBooks']:['source:stWorldBookEntries']},
    ...Object.fromEntries(['muyu.selection.read','muyu.selection.preview'].map(id=>[id,{effect:'read',sources:()=>['source:selectionState']}])),
    ...Object.fromEntries(['muyu.ledger_editor.list','muyu.ledger_editor.read','muyu.ledger_editor.preview'].map(id=>[id,{effect:'read',sources:()=>['source:ledgerEditState']}])),
    ...Object.fromEntries(['muyu.blueprint_node_editor.initialize_read','muyu.blueprint_node_editor.initialize_preview','muyu.blueprint_node_editor.structure_read','muyu.blueprint_node_editor.structure_preview'].map(id=>[id,{effect:'read',sources:()=>['source:blueprintStructureState']}])),
    ...Object.fromEntries(['muyu.blueprint_node_editor.list','muyu.blueprint_node_editor.read','muyu.blueprint_node_editor.preview'].map(id=>[id,{effect:'read',sources:()=>['source:blueprintNodeEditState']}])),
    ...Object.fromEntries(['muyu.npc_editor.list','muyu.npc_editor.read','muyu.npc_editor.preview'].map(id=>[id,{effect:'read',sources:()=>['source:npcEditState']}])),
    ...Object.fromEntries(['muyu.profile_editor.list','muyu.profile_editor.read','muyu.profile_editor.preview'].map(id=>[id,{effect:'read',sources:()=>['source:profileEditState']}])),
    ...Object.fromEntries(['muyu.profile_editor.create_targets','muyu.profile_editor.create_preview'].map(id=>[id,{effect:'read',sources:()=>['source:profileCreateState']}])),
    ...Object.fromEntries(['muyu.npc_editor.create_read','muyu.npc_editor.create_preview'].map(id=>[id,{effect:'read',sources:()=>['source:npcCreateState']}])),
    ...Object.fromEntries(['muyu.memory_editor.list','muyu.memory_editor.read','muyu.memory_editor.preview'].map(id=>[id,{effect:'read',sources:()=>['source:memoryEditState']}])),
    ...Object.fromEntries(['muyu.memory_editor.create_targets','muyu.memory_editor.create_preview'].map(id=>[id,{effect:'read',sources:()=>['source:memoryCreateState']}])),
    ...Object.fromEntries(['muyu.variable_editor.list','muyu.variable_editor.read','muyu.variable_editor.preview'].map(id=>[id,{effect:'read',sources:()=>['source:variableEditState']}])),
    ...Object.fromEntries(['muyu.blueprint_library_chat.capture_preview','muyu.blueprint_library_chat.apply_preview'].map(id => [id, { effect: 'read', sources: () => ['source:blueprintLibraryAssets','source:blueprintLibraryChat'] }])),
    ...Object.fromEntries(['muyu.npc_library_chat.capture_preview', 'muyu.npc_library_chat.apply_preview'].map(id => [id, { effect: 'read', sources: () => ['source:npcLibraryAssets', 'source:npcLibraryChat'] }])),
    ...Object.fromEntries(['muyu.library_chat.capture_preview', 'muyu.library_chat.apply_preview'].map(id => [id, { effect: 'read', sources: () => ['source:profileLibraryAssets', 'source:profileLibraryChat'] }])),
    ...Object.fromEntries(['muyu.blueprint_libraries.list','muyu.blueprint_libraries.read','muyu.blueprint_libraries.export','muyu.blueprint_libraries.preview'].map(id => [id, { effect: 'read', sources: () => ['source:blueprintLibraryAssets'] }])),
    ...Object.fromEntries(['muyu.npc_libraries.list','muyu.npc_libraries.read','muyu.npc_libraries.export','muyu.npc_libraries.preview'].map(id => [id, { effect: 'read', sources: () => ['source:npcLibraryAssets'] }])),
    ...Object.fromEntries(['muyu.libraries.list','muyu.libraries.read','muyu.libraries.export','muyu.libraries.preview'].map(id => [id, { effect: 'read', sources: () => ['source:profileLibraryAssets'] }])),
    ...Object.fromEntries(['muyu.prompts.list', 'muyu.prompts.read', 'muyu.prompts.preview', 'muyu.prompts.batch_preview', 'muyu.prompts.import_preview', 'muyu.prompts.export'].map(id => [id, { effect: 'read', sources: () => ['source:customPromptAssets'] }])),
    ...Object.fromEntries(['muyu.skills.list', 'muyu.skills.read', 'muyu.skills.preview'].map(id => [id, { effect: 'read', sources: () => ['source:skillAssets'] }])),
    ...Object.fromEntries(['muyu.skills.discover', 'muyu.skills.load'].map(id => [id, { effect: 'read', sources: () => [] }])),
    ...Object.fromEntries(['muyu.tools.list', 'muyu.tools.select'].map(id => [id, { effect: 'read', sources: () => [] }])),
    ...Object.fromEntries(['muyu.memory_generation.targets', 'muyu.memory_generation.prepare'].map(id => [id, { effect: 'read', sources: () => ['source:memoryGenerationTargets'] }])),
    ...Object.fromEntries(['muyu.profile_generation.targets', 'muyu.profile_generation.prepare'].map(id => [id, { effect: 'read', sources: () => ['source:profileGenerationTargets'] }])),
    ...Object.fromEntries(['muyu.npc_generation.state', 'muyu.npc_generation.prepare'].map(id => [id, { effect: 'read', sources: () => ['source:npcGenerationState'] }])),
    'muyu.generation_batch.prepare': { effect: 'read', sources: args => Array.isArray(args.steps) && args.steps.length && args.steps.every(step => ['memory', 'profile', 'npc'].includes(step.kind)) ? [...new Set(args.steps.map(step => ({ memory: 'source:memoryGenerationTargets', profile: 'source:profileGenerationTargets', npc: 'source:npcGenerationState' })[step.kind]))] : null },
    'muyu.generation_batch.execute': { effect: 'external', sources: args => [generationBatchExecutionSource(args.executionId)] },
    'muyu.npc_generation.execute': { effect: 'external', sources: args => [npcExecutionSource(args.executionId)] },
    'muyu.profile_generation.execute': { effect: 'external', sources: args => [profileExecutionSource(args.executionId)] },
    'muyu.memory_generation.execute': { effect: 'external', sources: args => [memoryExecutionSource(args.executionId)] },
    'muyu.agents.prepare_execution': { effect: 'read', sources: () => ['source:customAgentAssets'] },
    'muyu.agents.execute': { effect: 'external', sources: args => [agentExecutionSource(args.executionId)] },
    ...Object.fromEntries(['muyu.agents.list', 'muyu.agents.read', 'muyu.agents.preview', 'muyu.agents.batch_preview', 'muyu.agents.import_preview'].map(id => [id, { effect: 'read', sources: () => ['source:customAgentAssets'] }])),
    'muyu.scripts.prepare_execution': { effect: 'read', sources: () => ['source:scriptAssets'] },
    'muyu.scripts.execute': { effect: 'external', sources: args => [scriptExecutionSource(args.executionId)] },
    'muyu.scripts.test': { effect: 'external', sources: () => ['source:scriptTests'] },
    ...Object.fromEntries(['muyu.scripts.list', 'muyu.scripts.read', 'muyu.scripts.preview'].map(id => [id, { effect: 'read', sources: () => ['source:scriptAssets'] }])),
    'muyu.provider.assets': { effect: 'read', sources: () => ['source:providerAssets'] },
    'muyu.provider.source': { effect: 'read', sources: () => ['source:providerAssets'] },
    'muyu.provider.preview': { effect: 'read', sources: () => [] },
    'muyu.provider.update_preview': { effect: 'read', sources: () => ['source:providerAssets'] },
    'muyu.provider.remove_preview': { effect: 'read', sources: () => ['source:providerAssets'] },
    'muyu.provider.test': { effect: 'external', sources: () => ['source:providerTests'] },
    ...Object.fromEntries(['muyu.notes.list', 'muyu.notes.read'].map(id => [id, { effect: 'read', sources: () => [] }])),
    ...Object.fromEntries(['muyu.notes.remember', 'muyu.notes.forget'].map(id => [id, { effect: 'external', sources: () => [] }])),
    'muyu.web.search': { effect: 'external', sources: () => [] },
    ...Object.fromEntries(['muyu.provider.list', 'muyu.provider.discover', 'muyu.knowledge.list', 'muyu.knowledge.read', 'muyu.config.contract', 'muyu.context.list', 'muyu.context.read', 'muyu.history.list', 'muyu.history.read', 'muyu.history.search', 'muyu.interaction.ask', 'muyu.permission.request', 'muyu.settings.catalog', 'muyu.settings.contract', 'muyu.task.plan', 'muyu.task.bind_step', 'muyu.task.bind_read', 'muyu.profile.preview'].map(id => [id, { effect: 'read', sources: () => [] }])),
    'muyu.settings.read': { effect: 'read', sources: args => settingsSources(args.fields || []) },
    'muyu.settings.preview': { effect: 'read', sources: args => {
        const fields = Object.keys(args.changes || {}), sources = settingsSources(fields);
        if (!sources) return null;
        return [...sources, ...(fields.includes('memoryMaxEntries') ? ['source:memoryDiagnostics'] : []),
            ...(fields.some(field => ['storyBlueprintCompletionVariable', 'storyBlueprintEnabled'].includes(field)) ? ['source:variables'] : [])];
    } },
    'muyu.provider.read': { effect: 'read', sources: args => permissionSource(args.id) ? [sourceKey(args.id)] : null },
    ...Object.fromEntries(['muyu.provider.search', 'muyu.provider.match'].map(id => [id, { effect: 'read', sources: args => args.resultId
        ? [executionSource(args.id, args.revision)] : ['chatHistory', 'charMemory'].includes(args.id) ? [sourceKey(args.id)] : null }])),
    'muyu.variables.preview': { effect: 'read', sources: () => ['source:variables'] },
    'muyu.task.preview': { effect: 'read', sources: args => {
        let fields = [];
        try { if (args.settingsJson !== undefined) fields = Object.keys(JSON.parse(args.settingsJson)); } catch { return null; }
        const settings = fields.length ? settingsSources(fields) : [];
        if (!settings) return null;
        return [...new Set([...settings, ...((args.variables || []).length ? ['source:variables'] : []), ...((args.scripts || []).length ? ['source:scriptAssets'] : [])])];
    } },
    'muyu.provider.execute': { effect: 'external', sources: args => [executionSource(args.id, args.revision)] },
    'muyu.provider.result': { effect: 'read', sources: args => [executionSource(args.id, args.revision)] },
    'muyu.memory.inspect': { effect: 'read', sources: () => ['source:memoryConfig', 'source:memoryDiagnostics'] },
    'muyu.director.inspect': { effect: 'read', sources: () => ['source:directorDiagnostics'] },
    'muyu.config.preview': { effect: 'read', sources: () => ['source:memoryConfig'] },
});

/** Explicit policy registration; never infer grants from a tool definition. */
export function toolCapability(toolId) {
    return capabilities[toolId] || null;
}

export function requiredSources(toolId, args = {}) {
    return capabilities[toolId]?.sources(args) ?? null;
}
export function sourceTargetValid(source, target, providerPort, storedResult = false, scriptPort, agentPort, memoryPort, profilePort, npcPort, batchPort) {
    const execution = parseExecutionSource(source);
    if (execution) {
        if (target?.kind !== 'chat') return false;
        if (storedResult) return true;
        const descriptor = providerPort?.describe(execution.providerId, execution.providerRevision);
        return !!descriptor && descriptor.missingContext?.length === 0;
    }
    const batch = parseGenerationBatchExecutionSource(source);
    if (batch) return target?.kind === 'chat' && !!batchPort?.describeExecution(batch, target);
    const npc = parseNpcExecutionSource(source);
    if (npc) return target?.kind === 'chat' && !!npcPort?.describeExecution(npc, target);
    const profile = parseProfileExecutionSource(source);
    if (profile) return target?.kind === 'chat' && !!profilePort?.describeExecution(profile, target);
    const memory = parseMemoryExecutionSource(source);
    if (memory) return target?.kind === 'chat' && !!memoryPort?.describeExecution(memory, target);
    const agent = parseAgentExecutionSource(source);
    if (agent) return target?.kind === 'chat' && !!agentPort?.describeExecution(agent, target);
    const script = parseScriptExecutionSource(source);
    if (script) return target?.kind === 'chat' && !!scriptPort?.describeExecution(script, target);
    const spec = permissionSource(source.replace(/^source:/, ''));
    return !!spec && !!target && (spec.scope === 'global' || target.kind === 'chat');
}
function sourceDenied(source, target, taskId, permissions) {
    const execution = parseExecutionSource(source);
    return execution ? permissions.deniedExecution(target, taskId, execution.providerId, execution.providerRevision) : permissions.denied(source, target, taskId);
}
export function permissionRequestAllowed(args, target, taskId, permissions, providerPort, scriptPort, agentPort, memoryPort, profilePort, npcPort, batchPort) {
    const source = requestSource(args);
    return sourceTargetValid(source, target, providerPort, false, scriptPort, agentPort, memoryPort, profilePort, npcPort, batchPort) && !sourceDenied(source, target, taskId, permissions) && !permissions.allows(source, target, taskId);
}
export function permissionRequestAlreadyGranted(args, target, taskId, permissions, providerPort, scriptPort, agentPort, memoryPort, profilePort, npcPort, batchPort) {
    const source = requestSource(args);
    return sourceTargetValid(source, target, providerPort, false, scriptPort, agentPort, memoryPort, profilePort, npcPort, batchPort) && permissions.allows(source, target, taskId);
}
export function permissionApprovalCurrent(request, providerPort, scriptPort, agentPort, memoryPort, profilePort, npcPort, batchPort) {
    return sourceTargetValid(requestSource(request), request.target, providerPort, false, scriptPort, agentPort, memoryPort, profilePort, npcPort, batchPort);
}
export function toolAvailableInMode(toolId, mode) {
    return mode === 'assistant' || !toolId.startsWith('muyu.generation_batch.') && !toolId.startsWith('muyu.npc_generation.') && !toolId.startsWith('muyu.profile_generation.') && !toolId.startsWith('muyu.memory_generation.') && !toolId.startsWith('muyu.notes.') && !['muyu.provider.execute', 'muyu.provider.result', 'muyu.scripts.execute', 'muyu.scripts.prepare_execution', 'muyu.agents.execute', 'muyu.agents.prepare_execution'].includes(toolId);
}
export function assistantToolAccess(definition, args, target, taskId, permissions, providerPort, scriptPort, agentPort, memoryPort, profilePort, npcPort, batchPort) {
    const contract = capabilities[definition.id];
    if (!contract || contract.effect !== definition.effect) return { decision: 'policy_forbidden', required: [] };
    const required = requiredSources(definition.id, args);
    if (!required) return { decision: 'invalid_request', required: [] };
    const stored = definition.id === 'muyu.provider.result' || ['muyu.provider.search', 'muyu.provider.match'].includes(definition.id) && !!args.resultId;
    if (required.some(source => !sourceTargetValid(source, target, providerPort, stored, scriptPort, agentPort, memoryPort, profilePort, npcPort, batchPort))) return { decision: 'target_unavailable', required: [] };
    if (required.some(source => sourceDenied(source, target, taskId, permissions))) return { decision: 'user_denied', required: [] };
    const missingSources = required.filter(source => !permissions.allows(source, target, taskId));
    if (missingSources.length) return { decision: 'permission_required', required: [], missingSources };
    return { decision: true, required };
}
