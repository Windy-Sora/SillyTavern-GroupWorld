import { createConfigActions } from './config-apply.js';
import { createSelectionActions } from './selection-edit.js';
import { createWorkspaceActions } from './workspace.js';
import { createLedgerEditActions } from './ledger-edit.js';
import { createCharacterCardActions } from './character-card.js';
import { createStPresetActions } from './st-preset.js';
import { createWorldBookEditActions } from './worldbook-edit.js';
import { createBlueprintNodeEditActions } from './blueprint-node-edit.js';
import { createNpcEditActions } from './npc-edit.js';
import { createProfileEditActions } from './profile-edit.js';
import { createMemoryEditActions } from './memory-edit.js';
import { createVariableActions } from './variable-apply.js';
import { createTaskBundleActions } from './task-bundle-apply.js';
import { createProfileActions } from './profile-save.js';
import { createProviderInstallActions } from './provider-install.js';
import { createCustomAgentActions } from './custom-agent-save.js';
import { createCustomPromptActions } from './custom-prompt-save.js';
import { createProfileLibraryActions } from './profile-library-save.js';
import { createNpcLibraryActions } from './npc-library-save.js';
import { createBlueprintLibraryActions } from './blueprint-library-save.js';
import { createProfileLibraryChatActions } from './profile-library-chat.js';
import { createBlueprintLibraryChatActions } from './blueprint-library-chat.js';
import { createNpcLibraryChatActions } from './npc-library-chat.js';
import { createScriptActions } from './script-save.js';
import { createSkillActions } from './skill-save.js';
import { createActionAssembly } from './assembly.js';
import { validateReceiptOwners } from './receipt-protocol.js';

// Explicit legacy owners: scopes, artifact kinds and writer ports are not inferred.
const definitions = Object.freeze([
    { id:'workspaceActions',artifactKinds:['workspace-draft'],scope:'global',writer:'services',create:createWorkspaceActions },
    { id: 'actions', artifactKinds: ["config-draft"], scope: 'global', writer: 'configWriter', create: createConfigActions },
    { id: 'selectionActions', artifactKinds: ["selection-draft"], scope: 'global', writer: 'selectionEditor', create: createSelectionActions },
    { id: 'ledgerEditActions', artifactKinds: ["ledger-edit-draft"], scope: 'chat', writer: 'ledgerEditor', create: createLedgerEditActions },
    { id: 'worldBookEditActions', artifactKinds: ["worldbook-edit-draft"], scope: 'global', writer: 'worldBookEditor', create: createWorldBookEditActions },
    { id: 'characterCardActions', artifactKinds: ["character-card-draft"], scope: 'global', writer: 'characterCards', create: createCharacterCardActions },
    { id: 'stPresetActions', artifactKinds: ["st-preset-draft"], scope: 'global', writer: 'stPresetEditor', create: createStPresetActions },
    { id: 'blueprintNodeEditActions', artifactKinds: ["blueprint-node-edit-draft"], scope: 'chat', writer: 'blueprintNodeEditor', create: createBlueprintNodeEditActions },
    { id: 'npcEditActions', artifactKinds: ["npc-edit-draft"], scope: 'chat', writer: 'npcEditor', create: createNpcEditActions },
    { id: 'profileEditActions', artifactKinds: ["profile-edit-draft"], scope: 'chat', writer: 'profileEditor', create: createProfileEditActions },
    { id: 'memoryEditActions', artifactKinds: ["memory-edit-draft"], scope: 'chat', writer: 'memoryEditor', create: createMemoryEditActions },
    { id: 'variableActions', artifactKinds: ["variable-draft","variable-editor-draft"], scope: 'chat', writer: 'variableWriter', create: createVariableActions },
    { id: 'bundleActions', artifactKinds: ["task-bundle"], scope: 'chat', writer: 'bundleWriter', create: createTaskBundleActions },
    { id: 'profileActions', artifactKinds: ["profile-draft"], scope: 'global', writer: 'profileWriter', create: createProfileActions },
    { id: 'providerActions', artifactKinds: ["provider-draft"], scope: 'global', writer: 'providerAssets', create: createProviderInstallActions },
    { id: 'scriptActions', artifactKinds: ["script-draft"], scope: 'global', writer: 'scriptExecutors', create: createScriptActions },
    { id: 'customAgentActions', artifactKinds: ["custom-agent-draft"], scope: 'global', writer: 'customAgents', create: createCustomAgentActions },
    { id: 'customPromptActions', artifactKinds: ["custom-prompt-draft"], scope: 'global', writer: 'customPrompts', create: createCustomPromptActions },
    { id: 'skillActions', artifactKinds: ["skill-draft"], scope: 'global', writer: 'skills', create: createSkillActions },
    { id: 'profileLibraryActions', artifactKinds: ["profile-library-draft"], scope: 'global', writer: 'profileLibraries', create: createProfileLibraryActions },
    { id: 'npcLibraryActions', artifactKinds: ["npc-library-draft"], scope: 'global', writer: 'npcLibraries', create: createNpcLibraryActions },
    { id: 'blueprintLibraryActions', artifactKinds: ["blueprint-library-draft"], scope: 'global', writer: 'blueprintLibraries', create: createBlueprintLibraryActions },
    { id: 'profileLibraryChatActions', artifactKinds: ["profile-library-chat-draft"], scope: 'chat', writer: 'profileLibraryChat', create: createProfileLibraryChatActions },
    { id: 'npcLibraryChatActions', artifactKinds: ["npc-library-chat-draft"], scope: 'chat', writer: 'npcLibraryChat', create: createNpcLibraryChatActions },
    { id: 'blueprintLibraryChatActions', artifactKinds: ["blueprint-library-chat-draft"], scope: 'chat', writer: 'blueprintLibraryChat', create: createBlueprintLibraryChatActions },
].map(row => Object.freeze({ ...row, artifactKinds: Object.freeze(row.artifactKinds) })));

/** Instance-owned coordinators survive GUI unmount; existing contracts still authorize writes. */
export function builtinActionDescriptors() {
    return definitions.map(({ id, scope, artifactKinds }) => ({ id, scope, artifactKinds: [...artifactKinds] }));
}

export function createBuiltinActions({ host, getArtifact, validate, changed, checkpoint }) {
    validateReceiptOwners(builtinActionDescriptors());
    return createActionAssembly(definitions.map(row => ({ ...row, coordinator: row.create({
        getArtifact, validate, changed, writer: host[row.writer],
        ...(['actions', 'bundleActions'].includes(row.id) ? { checkpoint } : {}),
        getTarget: row.scope === 'global' ? () => host.globalTarget : () => host.currentTarget(),
    }) })));
}
