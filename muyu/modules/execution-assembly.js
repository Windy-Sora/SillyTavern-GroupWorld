const definitions = [
    { id: 'script-executors', port: 'scriptExecutors', prefix: 'muyu.scripts.', names: ['list', 'read', 'prepare_execution', 'execute', 'test', 'preview'], group: ['scripts', '脚本执行器 / Script Executors'], moduleId: 'script-executor', kind: 'script-draft', actionOwner: 'scriptActions', producers: ['preview'] },
    { id: 'custom-agents', port: 'customAgents', prefix: 'muyu.agents.', names: ['prepare_execution', 'execute', 'list', 'read', 'preview', 'batch_preview', 'import_preview'], group: ['agents', '自定义Agent / Custom Agents'], moduleId: 'custom-agent', kind: 'custom-agent-draft', actionOwner: 'customAgentActions', producers: ['preview', 'batch_preview', 'import_preview'] },
    { id: 'generation-batch', port: 'generationBatch', prefix: 'muyu.generation_batch.', names: ['prepare', 'execute'], group: ['generation-batch', '整单生成 / Generation batch'] },
    { id: 'memory-generation', port: 'memoryGeneration', prefix: 'muyu.memory_generation.', names: ['targets', 'prepare', 'execute'], group: ['memory-generation', '记忆生成 / Memory generation'] },
    { id: 'profile-generation', port: 'profileGeneration', prefix: 'muyu.profile_generation.', names: ['targets', 'prepare', 'execute'], group: ['profile-generation', '档案生成 / Profile generation'] },
    { id: 'npc-generation', port: 'npcGeneration', prefix: 'muyu.npc_generation.', names: ['state', 'prepare', 'execute'], group: ['npc-generation', 'NPC生成 / NPC generation'] },
];

export function executionDescriptors(host, modules) {
    return definitions.filter(row => host[row.port]).map(row => {
        const module = modules[row.port], group = { id: row.group[0], title: row.group[1] };
        return { id: row.id, module, bindAssistant: identity => module.bindRun(identity), taskLifecycle: true,
            tools: row.names.map(name => ({ id: row.prefix + name, group })),
            artifacts: row.producers ? [{ moduleId: row.moduleId, kind: row.kind, actionOwner: row.actionOwner, tools: row.producers.map(name => row.prefix + name) }] : [] };
    });
}
