import { DEFAULT_SETTINGS } from '../../settings.js';
import { configFields, fieldDefinition } from './registry.js';

// Explicit inventory, not a whitelist generated from defaults. New default keys
// must receive an owner and a deliberate support classification in tests.
const groups = {
    muyu: 'muyuFloatingBallVisible muyuPermissionConfig muyuInstructionConfig muyuContextConfig muyuRunConfig muyuDisplayConfig muyuHistoryEnabled muyuHistoryAccountStorage muyuHistoryStorage muyuHistoryReadSource muyuHistoryWriteTargets muyuHistoryVolumeMiB muyuHistoryData muyuAgentMemoryEnabled muyuAgentMemoryData muyuWebSearchConfig',
    director: 'mode topN llmContextDepth llmPrompt llmMaxSpeakers llmRespectOrder llmCharDescMode llmCharDescLength llmScriptEnabled llmScriptPrompt llmScriptWrapper llmJsonSchema llmJsonSchemaHint llmHistoryEnabled llmScriptContinuity llmScriptContinuityMode llmScriptContinuityCount llmScriptContinuityWrapper llmScriptContinuityHistoryWrapper llmWorldInfoEnabled llmWorldInfoWrapper templateMaxPasses templateRecursive templateDebugPlaceholders providerTimeoutMs forceSpeakMode forceSpeakPrompt llmScriptPosition',
    formula: 'scoreWeights recentMessageCount consecutivePenalty triggerEnabled triggerScore initiativeEnabled initiativeBaseScore',
    summary: 'knowledgeText summaryEnabled summaryReusePrevious summaryPrompt autoSummaryEnabled autoSummaryInterval',
    storyBlueprint: 'storyBlueprintEnabled storyBlueprintAutoContinue storyBlueprintProgressionMode storyBlueprintProgressionLevel storyBlueprintCompletionVariable storyBlueprintCompletionVariableGuard storyBlueprintMaxNodes storyBlueprintPrompt storyBlueprintContinuePrompt storyBlueprintJsonSchema storyBlueprintProviderTemplate storyBlueprintLibraries',
    critique: 'critiqueEnabled critiqueReusePrevious critiquePrompt critiqueSchema autoCritiqueEnabled autoCritiqueInterval',
    worldBook: 'worldBookSourceMode worldBookSelection worldBookMaxEntries',
    general: 'identityPrompt debugLogging lang',
    profiles: 'profileEnabled profileTokenBudget profileConcurrency profileGeneratorPrompt profileJsonSchema profileRenderTemplate profileSchemaVersion profileLibraries profileLibraryAutoLoad',
    npc: 'npcEnabled npcMaxCount npcBatchSize npcGenerateFirstMes npcPrompt npcLibraries',
    memory: 'memoryEnabled memoryTokenBudget autoMemoryEnabled autoMemoryInterval autoMemorySpeakers memoryPrompt memoryJsonSchema memoryRenderTemplate memoryKeepRecent memoryMaxEntries memoryCompressPrompt',
    postSpeech: 'traceMaxEntries postSpeechMessageEnabled postSpeechMessagePrompt postSpeechRoundEnabled postSpeechRoundPrompt postSpeechBlocking postSpeechDecisionLimit',
    assets: 'agentConfigs customPrompts customPromptsEnabled scriptExecutors providerReferenceList providerReferenceDeletedDefaultIds customAgents',
};
export const dynamicSettings = Object.freeze({
    configProfiles: 'systems/config-profile-system.js', userProviders: 'systems/user-provider-loader.js', userCapabilities: 'systems/user-provider-loader.js',
    uiState: 'ui/sections/dashboard.js',
});
const special = new Set('agentConfigs customPrompts scriptExecutors customAgents profileLibraries npcLibraries storyBlueprintLibraries providerReferenceList providerReferenceDeletedDefaultIds'.split(' '));
// Explicitly deferred by product decision; not an authorization problem.
const deferred = new Set();
export function configurationCoverage() {
    return Object.entries(groups).flatMap(([owner, list]) => list.split(' ').map(key => {
        const fields = configFields.filter(id => id === key || id.startsWith(key + '.'));
        const value = DEFAULT_SETTINGS[key];
        return { key, owner, type: Array.isArray(value) ? 'array' : typeof value, scope: 'global',
            ...(key === 'profileLibraryAutoLoad' ? { partial: true, pendingFields: ['matchNameOnly'], selectionWriter: 'muyu/host/selection-editor.js' } : {}),
            status: ['worldBookSelection', 'scriptExecutors', 'customAgents', 'customPrompts', 'profileLibraries', 'npcLibraries', 'storyBlueprintLibraries'].includes(key) ? 'special-editor-supported' : ['storyBlueprintCompletionVariableGuard', 'muyuWebSearchConfig', 'muyuFloatingBallVisible', 'muyuDisplayConfig', 'muyuPermissionConfig'].includes(key) ? 'internal' : deferred.has(key) ? 'deferred' : fields.length ? 'supported' : special.has(key) ? 'special-editor-pending' : 'pending', fields,
            secret: key === 'agentConfigs', executable: key === 'scriptExecutors',
            writer: key === 'worldBookSelection' ? 'muyu/host/selection-editor.js' : key === 'storyBlueprintLibraries' ? 'muyu/host/blueprint-libraries.js' : key === 'npcLibraries' ? 'muyu/host/npc-libraries.js' : key === 'profileLibraries' ? 'muyu/host/profile-libraries.js' : key === 'customPrompts' ? 'muyu/host/custom-prompts.js' : key === 'customAgents' ? 'muyu/host/custom-agents.js' : key === 'scriptExecutors' ? 'muyu/host/script-executors.js' : fields.length ? 'muyu/host/config-write.js' : null,
            contract: fields.map(fieldDefinition),
        };
    }));
}
export function assertConfigurationCoverage() {
    const keys = configurationCoverage().map(row => row.key);
    if (new Set(keys).size !== keys.length || keys.length !== Object.keys(DEFAULT_SETTINGS).length || Object.keys(DEFAULT_SETTINGS).some(key => !keys.includes(key))) throw Error('CONFIG_COVERAGE_DRIFT');
    if (Object.keys(DEFAULT_SETTINGS.scoreWeights).some(key => !configFields.includes('scoreWeights.' + key))) throw Error('CONFIG_COVERAGE_DRIFT');
    if ([...deferred].some(key => configFields.includes(key))) throw Error('CONFIG_DEFERRED_WRITE_DRIFT');
    return keys.length;
}
