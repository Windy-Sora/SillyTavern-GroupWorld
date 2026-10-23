const tool = (id, group) => ({ id, group });

// Explicit trusted wiring, not an inferred grant or a prefix-based capability.
const definitions = [
    { id: 'selection-editor', port: 'selectionEditor', prefix: 'muyu.selection.', names: ['read', 'preview'], group: ['selection', '世界书与自动加载选择 / Worldbooks and auto-load selection'], kind: 'selection-draft', actionOwner: 'selectionActions', producers: ['preview'] },
    { id: 'ledger-editor', port: 'ledgerEditor', prefix: 'muyu.ledger_editor.', names: ['list', 'read', 'preview'], group: ['ledger-editor', '导演账本编辑 / Director ledger editing'], kind: 'ledger-edit-draft', actionOwner: 'ledgerEditActions', producers: ['preview'] },
    { id: 'blueprint-node-editor', port: 'blueprintNodeEditor', prefix: 'muyu.blueprint_node_editor.', names: ['initialize_read', 'initialize_preview', 'structure_read', 'structure_preview', 'list', 'read', 'preview'], group: ['blueprint-editor', '蓝图节点编辑 / Blueprint editing'], kind: 'blueprint-node-edit-draft', actionOwner: 'blueprintNodeEditActions', producers: ['preview', 'structure_preview', 'initialize_preview'] },
    { id: 'st-preset-editor', port: 'stPresetEditor', prefix: 'muyu.st_preset.', names: ['list', 'read', 'preview'], group: ['st-preset-editor', '聊天补全预设管理 / Chat-completion preset management'], kind: 'st-preset-draft', actionOwner: 'stPresetActions', producers: ['preview'] },
    { id: 'character-card', port: 'characterCards', prefix: 'muyu.character_card.', names: ['list', 'read', 'preview'], group: ['character-card', '酒馆角色卡 / ST character cards'], kind: 'character-card-draft', actionOwner: 'characterCardActions', producers: ['preview'] },
    { id: 'worldbook-editor', port: 'worldBookEditor', prefix: 'muyu.worldbook_editor.', names: ['list', 'bindings', 'read', 'preview'], group: ['worldbook-editor', '世界书条目编辑 / World-book entry editing'], kind: 'worldbook-edit-draft', actionOwner: 'worldBookEditActions', producers: ['preview'] },
    { id: 'variable-editor', port: 'variableEditor', prefix: 'muyu.variable_editor.', names: ['list', 'read', 'preview'], group: ['variable-editor', '变量编辑 / Variable editing'], kind: 'variable-editor-draft', actionOwner: 'variableActions', producers: ['preview'] },
    { id: 'memory-editor', port: 'memoryEditor', prefix: 'muyu.memory_editor.', names: ['list', 'create_targets', 'create_preview', 'read', 'preview'], group: ['memory-editor', '角色记忆编辑 / Character memory editing'], kind: 'memory-edit-draft', actionOwner: 'memoryEditActions', producers: ['preview', 'create_preview'] },
    { id: 'profile-editor', port: 'profileEditor', prefix: 'muyu.profile_editor.', names: ['create_targets', 'create_preview', 'list', 'read', 'preview'], group: ['profile-editor', '角色档案编辑 / Profile editing'], kind: 'profile-edit-draft', actionOwner: 'profileEditActions', producers: ['preview', 'create_preview'] },
    { id: 'npc-editor', port: 'npcEditor', prefix: 'muyu.npc_editor.', names: ['create_read', 'create_preview', 'list', 'read', 'preview'], group: ['npc-editor', 'NPC编辑 / NPC editing'], kind: 'npc-edit-draft', actionOwner: 'npcEditActions', producers: ['preview', 'create_preview'] },
    { id: 'provider-assets', port: 'providerAssets', prefix: 'muyu.provider.', names: ['assets', 'source', 'preview', 'test', 'update_preview', 'remove_preview'], group: ['provider-assets', 'Provider资产 / Provider assets'], moduleId: 'provider-asset', kind: 'provider-draft', actionOwner: 'providerActions', producers: ['preview', 'update_preview', 'remove_preview'] },
];

/** Absent host ports retain legacy disabled-module cleanup, never publish tools. */
export function editorDescriptors(host, modules) {
    return definitions.filter(row => host[row.port]).map(row => {
        const module = modules[row.port], group = { id: row.group[0], title: row.group[1] };
        return { id: row.id, module, bindAssistant: identity => module.bindRun(identity),
            tools: row.names.map(name => tool(row.prefix + name, group)),
            artifacts: [{ moduleId: row.moduleId || row.id, kind: row.kind, actionOwner: row.actionOwner, tools: row.producers.map(name => row.prefix + name) }] };
    });
}
