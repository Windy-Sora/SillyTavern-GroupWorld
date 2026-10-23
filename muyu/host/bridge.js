import { randomUUID } from '../runtime/crypto.js';
import { createHostModelConnection } from './model-connection.js';
/** Page-local identity only; no names or raw identity strings enter model requests. */
export function createHostBridge({ getContext, getSettings, extensionKey, providerPort, stDiagnostics, stPromptSnapshots, providerAssets, scriptExecutors, customAgents, memoryGeneration, profileGeneration, npcGeneration, generationBatch, skills, customPrompts, profileLibraries, npcLibraries, blueprintLibraries, blueprintLibraryChat, profileLibraryChat, npcLibraryChat, credentials, runConfig, permissionConfig, contextConfig, instructionConfig, displayConfig, history, agentMemory, webSearch, services, configWriter, variableDraftPort, variableEditor, memoryEditor, profileEditor, npcEditor, selectionEditor, ledgerEditor, characterCards, stPresetEditor, worldBookEditor, blueprintNodeEditor, variableWriter, bundleDraftPort, bundleWriter, profileWriter, memoryLimitPort, completionVariablePort, blueprintTogglePort, getGuards = () => ({}), pageId = randomUUID() }) {
    const userKey = 'page:' + pageId;
    const globalTarget = Object.freeze({ kind: 'global', userKey });
    function currentTarget() {
        const ctx = getContext(); const chatId = ctx.getCurrentChatId?.() ?? ctx.chatId;
        if (typeof chatId !== 'string' || !chatId) return null;
        let owner;
        if (ctx.groupId != null) owner = ['group', String(ctx.groupId)];
        else {
            const character = ctx.characters?.[ctx.characterId];
            if (typeof character?.avatar !== 'string' || !character.avatar) return null;
            owner = ['character', character.avatar];
        }
        return { kind: 'chat', userKey, chatKey: JSON.stringify([...owner, chatId]) };
    }
    return Object.freeze({
        currentTarget, globalTarget, providerPort, providerAssets, scriptExecutors, customAgents, memoryGeneration, profileGeneration, npcGeneration, generationBatch, skills, customPrompts, profileLibraries, npcLibraries, blueprintLibraries, blueprintLibraryChat, profileLibraryChat, npcLibraryChat, credentials, runConfig, permissionConfig, contextConfig, instructionConfig, displayConfig, history, agentMemory, webSearch, services, configWriter, variableDraftPort, variableEditor, memoryEditor, profileEditor, npcEditor, selectionEditor, ledgerEditor, characterCards, stPresetEditor, worldBookEditor, blueprintNodeEditor, variableWriter, bundleDraftPort, bundleWriter, profileWriter, memoryLimitPort, completionVariablePort, blueprintTogglePort,
        stDiagnostics,
        modelConnection: createHostModelConnection({ getContext, stDiagnostics }),
        configTarget: () => currentTarget() || globalTarget,
        getSettings,
        memoryPorts: Object.freeze({ extensionKey, getTarget: currentTarget, getSettings,
            getMetadata: () => getContext().chatMetadata,
            getGroup: () => { const ctx = getContext(); return ctx.groupId == null ? null : ctx.groups?.find(g => String(g.id) === String(ctx.groupId)) ?? null; },
            getMessageCount: () => getContext().chat?.length,
            getGuards,
        }),
        subscribe(listener) {
            const ctx = getContext(), source = ctx.eventSource, type = ctx.eventTypes?.CHAT_CHANGED;
            if (!type || typeof source?.on !== 'function' || typeof source?.removeListener !== 'function') throw new Error('HOST_EVENTS_UNAVAILABLE');
            source.on(type, listener); return () => source.removeListener(type, listener);
        },
    });
}
