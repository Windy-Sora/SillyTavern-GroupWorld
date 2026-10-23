// Trusted declarations keep legacy candidate aliases and do not grant access.
const definitions = [
    { id: 'custom-prompts', port: 'customPrompts', prefix: 'muyu.prompts.', names: ['batch_preview', 'import_preview', 'export', 'list', 'read', 'preview'], group: ['prompts', '自定义Prompt / Custom Prompts'], moduleId: 'custom-prompt', kind: 'custom-prompt-draft', actionOwner: 'customPromptActions', producers: ['batch_preview', 'import_preview', 'preview'] },
    { id: 'skills', port: 'skills', prefix: 'muyu.skills.', names: ['list', 'read', 'preview'], group: ['skills', 'Skill管理 / Skill management'], moduleId: 'skill', kind: 'skill-draft', actionOwner: 'skillActions', producers: ['preview'] },
    { id: 'profile-libraries', port: 'profileLibraries', prefix: 'muyu.libraries.', names: ['list', 'read', 'preview', 'export'], group: ['libraries', '档案库 / Profile libraries'], moduleId: 'profile-library', kind: 'profile-library-draft', actionOwner: 'profileLibraryActions', producers: ['preview'] },
    { id: 'npc-libraries', port: 'npcLibraries', prefix: 'muyu.npc_libraries.', names: ['list', 'read', 'preview', 'export'], group: ['npc-libraries', 'NPC库 / NPC libraries'], moduleId: 'npc-library', kind: 'npc-library-draft', actionOwner: 'npcLibraryActions', producers: ['preview'] },
    { id: 'blueprint-libraries', port: 'blueprintLibraries', prefix: 'muyu.blueprint_libraries.', names: ['list', 'read', 'preview', 'export'], group: ['blueprint-libraries', '蓝图库 / Blueprint libraries'], moduleId: 'blueprint-library', kind: 'blueprint-library-draft', actionOwner: 'blueprintLibraryActions', producers: ['preview'] },
    { id: 'profile-library-chat', port: 'profileLibraryChat', prefix: 'muyu.library_chat.', names: ['capture_preview', 'apply_preview'], group: ['library-chat', '聊天与档案库 / Chat and profile library'], moduleId: 'profile-library-chat', kind: 'profile-library-chat-draft', actionOwner: 'profileLibraryChatActions', producers: ['capture_preview', 'apply_preview'] },
    { id: 'npc-library-chat', port: 'npcLibraryChat', prefix: 'muyu.npc_library_chat.', names: ['capture_preview', 'apply_preview'], group: ['npc-library-chat', '聊天与NPC库 / Chat and NPC library'], moduleId: 'npc-library-chat', kind: 'npc-library-chat-draft', actionOwner: 'npcLibraryChatActions', producers: ['capture_preview', 'apply_preview'] },
    { id: 'blueprint-library-chat', port: 'blueprintLibraryChat', prefix: 'muyu.blueprint_library_chat.', names: ['capture_preview', 'apply_preview'], group: ['blueprint-library-chat', '聊天与蓝图库 / Chat and blueprint library'], moduleId: 'blueprint-library-chat', kind: 'blueprint-library-chat-draft', actionOwner: 'blueprintLibraryChatActions', producers: ['capture_preview', 'apply_preview'] },
];

export function assetDescriptors(host, modules) {
    return definitions.filter(row => host[row.port]).map(row => {
        const module = modules[row.port], group = { id: row.group[0], title: row.group[1] };
        return { id: row.id, module, bindAssistant: identity => module.bindRun(identity),
            tools: row.names.map(name => ({ id: row.prefix + name, group })),
            artifacts: [{ moduleId: row.moduleId, kind: row.kind, actionOwner: row.actionOwner, tools: row.producers.map(name => row.prefix + name) }] };
    });
}
