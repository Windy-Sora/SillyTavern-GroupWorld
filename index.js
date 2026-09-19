import { eventSource, event_types } from '../../../events.js';
import { extension_settings, getContext } from '../../../extensions.js';
import { saveSettings as saveSettingsHost, saveSettingsDebounced, chat_metadata, saveChatConditional, getCurrentChatId, getRequestHeaders, characters, chat, setCharacterId, setCharacterName, setExtensionPrompt, extension_prompt_types, substituteParams } from '../../../../script.js';
import { callGenericPopup, POPUP_TYPE } from '../../../popup.js';
import { inject_ids } from '../../../constants.js';
import { groups, selected_group } from '../../../group-chats.js';
import { checkWorldInfo, world_info_include_names, world_names, loadWorldInfo, selected_world_info, world_info } from '../../../world-info.js';
import { power_user } from '../../../power-user.js';
import { EXT_KEY, MODE_OFF, MODE_FORMULA, MODE_LLM, DEFAULT_SETTINGS } from './settings.js';
import { registerProvider, unregisterProvider, getProviders, getAvailablePlaceholders } from './provider-registry.js';
import { renderPrompt, setProviderTimeoutDefault } from './prompt-renderer.js';
import { parseLlmResponse, extractJsonObject, sanitizeJson } from './utils/json-utils.js';
import { djb2Hash, hashChar } from './utils/string-utils.js';
import { roundCounterReset, roundCounterGet, roundCounterSet } from './utils/counter.js';
import { scoreFormulaCharacter } from './systems/speaker-selection.js';
import { decideFormulaTurn } from './systems/round-state.js';
import { recoverDirectorPlan } from './systems/director-plan.js';
import { createRoundOrchestrator } from './systems/round-orchestrator.js';
import { decideLlmSpeakerTurn } from './systems/llm-speaker-state.js';
import { getForceSpeakAction } from './systems/generation-guards.js';
import { matchesTrigger, rollInitiative as rollInitiativeValue } from './systems/trigger-initiative.js';
// ─── Providers (assets/providers/) ──────────────────────────────────
import { register as registerRecentMessages } from './assets/providers/recent-messages.js';
import { register as registerCharacters } from './assets/providers/characters.js';
import { register as registerCharacterProfiles } from './assets/providers/character-profiles.js';
import { register as registerWorldInfoProvider } from './assets/providers/world-info.js';
import { register as registerHistoryProviders } from './assets/providers/history.js';
import { register as registerDirectorLedger } from './assets/providers/director-ledger.js';
import { register as registerTestProvider } from './assets/providers/test-provider.js';
import { register as registerWorldBooks } from './assets/providers/world-books.js';
import { register as registerWorldBookImportance } from './assets/providers/world-book-importance.js';
import { register as registerGdWorldBooks } from './assets/providers/gd-world-books.js';
import { register as registerCharacterLore } from './assets/providers/character-lore.js';
import { register as registerSystemTime } from './assets/providers/system-time.js';
import { register as registerRandomDice } from './assets/providers/random-dice.js';
import { register as registerDice } from './assets/providers/dice.js';
import { register as registerMoonPhase } from './assets/providers/moon-phase.js';
import { register as registerTimeOfDay } from './assets/providers/time-of-day.js';
import { register as registerKnowledge } from './assets/providers/knowledge.js';
import { register as registerChatSummary } from './assets/providers/chat-summary.js';
import { register as registerImportedSummary } from './assets/providers/imported-summary.js';
import { register as registerImportedCritique } from './assets/providers/imported-critique.js';
import { register as registerDirectorCritique } from './assets/providers/director-critique.js';
import { register as registerCharacterCritique } from './assets/providers/character-critique.js';
import { register as registerCharCritique } from './assets/providers/char-critique.js';
import { register as registerIdentity } from './assets/providers/identity.js';
import { register as registerNpcList } from './assets/providers/npc-list.js';
import { register as registerNewRecentMessages } from './assets/providers/new-recent-messages.js';
import { register as registerCharMemory } from './assets/providers/char-memory.js';
import { createHistorySystem } from './systems/history-system.js';
import { createWorldInfoSystem } from './systems/world-info-system.js';
import { createProfileSystem } from './systems/profile-system.js';
import { createWorldBookScanner } from './systems/world-book-scanner.js';
import { createChatSummarySystem } from './systems/chat-summary-system.js';
import { createConfirmedChatMetadataSave } from './systems/chat-metadata-save-confirmation.js';
import { createCritiqueSystem } from './systems/critique-system.js';
import { createCritiqueAutoCoordinator } from './systems/critique-auto-coordinator.js';
import { createCustomAgentSystem } from './systems/custom-agent-system.js';
import { planCustomAgentAutoRuns } from './systems/custom-agent-auto-coordinator.js';
import { createExportImportSystem } from './systems/export-import-system.js';
import { createProfileExportSystem } from './systems/profile-export-system.js';
import { createProfileLibrarySystem } from './systems/profile-library-system.js';
import { createNpcExportSystem } from './systems/npc-export-system.js';
import { createNpcLibrarySystem } from './systems/npc-library-system.js';
import { createSummaryExportSystem } from './systems/summary-export-system.js';
import { createCritiqueExportSystem } from './systems/critique-export-system.js';
import { createMemoryExportSystem } from './systems/memory-export-system.js';
import { createConfigProfileSystem } from './systems/config-profile-system.js';
import { createCustomPromptsSystem } from './systems/custom-prompts-system.js';
import { createScriptExecutorSystem } from './systems/script-executor-system.js';
import { createVariableSystem } from './systems/variable-system.js';
import { createStoryBlueprintSystem } from './systems/story-blueprint-system.js';
import { createStoryBlueprintLibrarySystem } from './systems/story-blueprint-library-system.js';
import { loadSettingsUI, reloadSettingsUI } from './ui/settings-init.js';
import { AssetLoader } from './systems/asset-loader.js';
import { providerModules } from './assets/providers/manifest.js';
import { register as registerVariables } from './assets/providers/variables.js';
import { register as registerStoryBlueprint } from './assets/providers/story-blueprint.js';

// ─── Agent Runtime ──────────────────────────────────────────────────
import { AgentRegistry, execute, createScopedPool, AgentTrace } from './systems/agent-runtime.js';
import { createCaller } from './utils/custom-api.js';
import { createDirectorAgent } from './agents/director.js';
import { createForceSpeakAgent } from './agents/force-speak.js';
import { createProfileAgent } from './agents/profile.js';
import { createSummaryAgent } from './agents/summary.js';
import { createCritiqueAgent } from './agents/critique.js';
import { createNpcAgent, DEFAULT_NPC_PROMPT } from './agents/npc.js';
import { createNpcSystem } from './systems/npc-system.js';
import { createConfirmedNpcChatSave } from './systems/npc-save-confirmation.js';
import { createMemoryAgent, DEFAULT_MEMORY_PROMPT, DEFAULT_MEMORY_SCHEMA, DEFAULT_MEMORY_RENDER, DEFAULT_MEMORY_COMPRESS_PROMPT } from './agents/memory.js';
import { createMemorySystem } from './systems/memory-system.js';
import { createPostSpeechAgent } from './agents/post-speech.js';
import { createExecutor } from './systems/executor.js';
import { CapabilityRegistry, registerCapabilityProviders } from './systems/capability-registry.js';
import { createUserProviderLoader } from './systems/user-provider-loader.js';
import { createPostSpeechSystem } from './systems/post-speech-system.js';
import { createConfirmedPostSpeechChatSave } from './systems/post-speech-save-confirmation.js';
import { runAutoMemoryTargets } from './systems/auto-memory-coordinator.js';

// Migrate legacy settings (v0.3 → v0.4)
let loaded = extension_settings[EXT_KEY] || {};
if (loaded.enabled === false) loaded.mode = MODE_OFF;
else if (loaded.directorLlmEnabled === true) loaded.mode = MODE_LLM;
else if (loaded.mode === 'top_n' || (loaded.mode === undefined && loaded.enabled !== false)) loaded.mode = MODE_FORMULA;
delete loaded.enabled;
delete loaded.directorLlmEnabled;
delete loaded.directorLlmModel;
if (loaded.directorLlmPrompt && !loaded.llmPrompt) loaded.llmPrompt = loaded.directorLlmPrompt;
delete loaded.directorLlmPrompt;
if (typeof loaded.llmJsonSchema === 'string'
    && !loaded.llmJsonSchema.includes('{{storyBlueprintDoneField}}')
    && /"global"\s*:\s*\{\s*\}/.test(loaded.llmJsonSchema)) {
    loaded.llmJsonSchema = loaded.llmJsonSchema.replace(
        /"global"\s*:\s*\{\s*\}/,
        '"global": { {{storyBlueprintDoneField}} }',
    );
}

let settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
settings.scoreWeights = Object.assign({}, DEFAULT_SETTINGS.scoreWeights, loaded.scoreWeights || {});
extension_settings[EXT_KEY] = settings;
// Wire the live provider timeout default into the renderer (kept in sync in saveSettings).
setProviderTimeoutDefault(settings.providerTimeoutMs);

// ─── Runtime State ────────────────────────────────────────────────────
let roundScores = {};               // { avatar: score }
let roundSpeakerCount = 0;
let roundTriggeredAvatars = new Set();
let roundInitiative = {};
let llmPickedAvatars = null;        // ordered Array<avatar> from LLM, null if not used
let llmPickedSet = null;            // Set<avatar> for O(1) membership
let llmSpokenSet = new Set();
let llmCursor = 0;
let roundInitialized = false;
let initPromise = null;              // guards concurrent interceptor calls
let isGroupChat = false;
const roundOrchestrator = createRoundOrchestrator();
let directorScripts = {};           // { characterName: scriptText } from LLM
let directorLastReason = '';         // reason from last director decision, exposed to script executors
let roundGenerateType = 'normal';    // captured from GROUP_WRAPPER_STARTED, read by interceptor
const wiState = { text: '', entries: [] };  // WI cache for WorldInfoProvider
const scriptCounterSnapshots = new Map();   // charName → counter value at first render
let generationStopped = false;               // set by GENERATION_STOPPED, checked in retry loop
let postSpeechRoundQueue = [];                  // caller-owned jobs deferred to group wrapper finished
let postSpeechRoundQueueEpoch = 0;
let postSpeechRoundRan = false;                 // dedup flag for GROUP_WRAPPER_FINISHED
let scriptExecutorRoundRan = false;              // dedup flag for script executor round trigger
let postSpeechLastMsgIndex = -1;                // dedup for per-message renders
let postSpeechAbortController = null;           // AbortController for PostSpeech round LLM call
let postSpeechMessageAbortController = null;    // AbortController for PostSpeech per-message LLM call
let directorAbortController = null;             // AbortController for Director + ForceSpeak LLM calls

function isPostSpeechIntentQueued(messageIndex, capabilityId) {
    return postSpeechRoundQueue.some(job =>
        job.contexts.some(context =>
            context.messageIndex === messageIndex &&
            context.intent?.type === capabilityId
        )
    );
}

function enqueuePostSpeechRoundJob(contexts, deferred = [], allowPending = false) {
    if (!contexts.length) return;
    postSpeechRoundQueue.push({
        contexts: [...contexts],
        deferred: [...deferred],
        allowPending,
    });
}

function countQueuedPostSpeechIntents() {
    return postSpeechRoundQueue.reduce((total, job) => total + job.contexts.length, 0);
}

function invalidatePostSpeechRoundQueue() {
    postSpeechRoundQueueEpoch++;
    postSpeechRoundQueue = [];
}

async function drainPostSpeechRoundQueue() {
    const queueEpoch = postSpeechRoundQueueEpoch;
    const pendingJobs = postSpeechRoundQueue.splice(0);
    const pendingCount = pendingJobs.reduce(
        (total, job) => total + job.contexts.length,
        0
    );
    log(`PostSpeech: executing ${pendingCount} deferred per-message intents`);

    for (const job of pendingJobs) {
        if (queueEpoch !== postSpeechRoundQueueEpoch) break;
        const reservation = postSpeechSystem.reserveExecution(job.contexts, { allowPending: job.allowPending });
        if (!reservation.contexts.length) continue;
        let trackingStarted = false;
        try {
            let execResult;
            if (job.deferred.length) {
                const selected = new Map(reservation.indexes.map((index, selectedIndex) => [index, selectedIndex]));
                const plans = job.deferred
                    .filter(plan => selected.has(plan.action.intentIndex))
                    .map(plan => ({
                        ...plan,
                        action: { ...plan.action, intentIndex: selected.get(plan.action.intentIndex) },
                    }));
                execResult = await postSpeechExecutor.executeDeferred(plans);
            } else {
                execResult = await postSpeechExecutor.run(
                    { intents: reservation.contexts.map(context => context.intent) },
                    CapabilityRegistry.listExecutableForMode('message')
                );
                if (execResult.deferred.length) {
                    execResult = await postSpeechExecutor.executeDeferred(execResult.deferred);
                }
            }
            trackingStarted = true;
            await postSpeechSystem.trackExecution(execResult, reservation.contexts, reservation);
        } catch (error) {
            if (!trackingStarted) reservation.release();
            throw error;
        }
    }
}

// Custom extension prompt key for director script (not QUIET_PROMPT to avoid leakage)
const DIRECTOR_SCRIPT_KEY = 'group_director_script';

/** Get current script injection position from settings. */
function getScriptPosition() {
    return settings.llmScriptPosition === 1
        ? extension_prompt_types.IN_CHAT
        : extension_prompt_types.IN_PROMPT;
}

async function getScriptForChar(charName, extraContext) {
    const script = directorScripts[charName] || '';
    // On swipe/regenerate, restore the counter to what it was when this
    // character's script was first rendered this round. On first render,
    // snapshot the current counter for future restores.
    const isReroll = roundGenerateType === 'swipe' || roundGenerateType === 'regenerate';
    if (isReroll && scriptCounterSnapshots.has(charName)) {
        roundCounterSet(scriptCounterSnapshots.get(charName));
    } else if (!isReroll) {
        scriptCounterSnapshots.set(charName, roundCounterGet());
        // Persist to chat_metadata for crash/tab-close recovery
        const cm = chat_metadata[EXT_KEY];
        if (cm) {
            cm._counterSnapshots = Object.fromEntries(scriptCounterSnapshots);
        }
    }
    const wrapper = settings.llmScriptWrapper || '{{script}}';
    // Inject the script text BEFORE rendering so any nested {{...}}
    // references inside the script go through the full provider pipeline.
    // (Previously it was injected after renderPrompt via a sentinel,
    // which left nested {{?directorLedger:xxx}} unresolved.)
    const combined = wrapper.split('{{script}}').join(script);
    const char = characters.find(c => c.name === charName);
    const ctx = { character: charName, avatar: char?.avatar, ...extraContext };
    return await renderPrompt(combined, ctx, {
        maxPasses: settings.templateMaxPasses,
        recursive: settings.templateRecursive,
        debugPlaceholders: settings.templateDebugPlaceholders,
    });
}

function saveSettings() {
    extension_settings[EXT_KEY] = settings;
    // Keep the renderer's provider timeout default in sync with GUI changes.
    setProviderTimeoutDefault(settings.providerTimeoutMs);
    saveSettingsDebounced();
}

async function saveSettingsConfirmed() {
    extension_settings[EXT_KEY] = settings;
    setProviderTimeoutDefault(settings.providerTimeoutMs);
    let confirmed = false;
    const onSaved = () => { confirmed = true; };
    eventSource.on(event_types.SETTINGS_UPDATED, onSaved);
    try {
        await saveSettingsHost();
        if (!confirmed) throw new Error('Settings persistence was not confirmed');
    } finally {
        eventSource.removeListener(event_types.SETTINGS_UPDATED, onSaved);
    }
}

// ─── Systems ──────────────────────────────────────────────────────────
// chat_metadata, chat, and characters are export let in ST — they get
// replaced on chat load. Pass as getters so modules always read current values.
const getChatMetadata = () => chat_metadata;
const getChat = () => chat;
const getCharacters = () => characters;
const saveNpcChatConfirmed = createConfirmedNpcChatSave({
    saveChatConditional, getCurrentChatId, getCurrentGroup: () => selected_group && groups.find(group => group.id === selected_group),
    getContext, getChatMetadata, getRequestHeaders, EXT_KEY,
});
const confirmedChatSaveDependencies = {
    saveChatConditional,
    getCurrentChatId,
    getCurrentGroup: () => selected_group && groups.find(group => group.id === selected_group),
    getContext,
    getChatMetadata,
    getRequestHeaders,
};
const saveSummaryChatConfirmed = createConfirmedChatMetadataSave({
    ...confirmedChatSaveDependencies,
    selectValue: metadata => metadata[EXT_KEY]?.summaries ?? [],
    label: 'Chat Summary',
});
const saveStoryBlueprintChatConfirmed = createConfirmedChatMetadataSave({
    ...confirmedChatSaveDependencies,
    selectValue: metadata => metadata[EXT_KEY]?.storyBlueprint ?? null,
    label: 'Story Blueprint',
});

const variableSystem = createVariableSystem({
    getChatMetadata,
    EXT_KEY,
    saveChatConditional,
    getCharacters,
    getCurrentGroup,
    getChat,
    getLang: () => settings.lang || 'zh',
    log,
});

const storyBlueprintSystem = createStoryBlueprintSystem({
    settings,
    getChatMetadata,
    getChat,
    EXT_KEY,
    saveChatConditional,
    saveChatConfirmed: saveStoryBlueprintChatConfirmed,
    renderPrompt,
    generateRaw: (opts) => getContext().generateRaw(opts),
    createCaller,
    parseJson: (raw) => {
        const extracted = extractJsonObject(raw || '');
        if (!extracted) return null;
        try { return JSON.parse(sanitizeJson(extracted)); }
        catch (e) { log('Story Blueprint JSON parse failed:', e.message); return null; }
    },
    variableSystem,
    getCurrentGroup,
    getLang: () => settings.lang || 'zh',
    log,
});
storyBlueprintSystem.ensureCompletionVariable();

const storyBlueprintLibrarySystem = createStoryBlueprintLibrarySystem({
    settings,
    extension_settings,
    EXT_KEY,
    saveSettings: saveSettingsConfirmed,
    saveChatConditional,
    getCurrentGroup,
    storyBlueprintSystem,
    log,
});

const { getDirectorHistory, addToDirectorHistory, pruneDirectorHistory, updateEntry, clearEntry } =
    createHistorySystem({ getChatMetadata, getChat, EXT_KEY, saveChatConditional, settings, log });

const { buildDirectorWorldInfo } =
    createWorldInfoSystem({ settings, getChat, getCharacters, checkWorldInfo, world_info_include_names, getContext, power_user, log });

const chatSummarySystem = createChatSummarySystem({
    settings, getChatMetadata, getChat, EXT_KEY, saveChatConditional: saveSummaryChatConfirmed,
    renderPrompt, generateRaw: (opts) => getContext().generateRaw(opts),
    inject_ids, extension_prompt_types, setExtensionPrompt, log,
    createCaller,
});

const critiqueSystem = createCritiqueSystem({
    settings, getChatMetadata, getChat, EXT_KEY, saveChatConditional,
    renderPrompt, generateRaw: (opts) => getContext().generateRaw(opts),
    inject_ids, extension_prompt_types, setExtensionPrompt, log,
    createCaller,
});

const customAgentSystem = createCustomAgentSystem({
    settings, getChatMetadata, getChat, EXT_KEY, saveChatConditional,
    saveSettings: saveSettingsDebounced,
    renderPrompt, generateRaw: (opts) => getContext().generateRaw(opts),
    createCaller,
    log,
});

function getActivatedWorldBookNames() {
    const books = new Set();
    const chatMeta = getChatMetadata();
    if (chatMeta?.world_info && world_names.includes(chatMeta.world_info)) {
        books.add(chatMeta.world_info);
    }
    if (Array.isArray(selected_world_info)) {
        for (const name of selected_world_info) {
            if (world_names.includes(name)) books.add(name);
        }
    }
    if (world_info && Array.isArray(world_info.charLore)) {
        for (const entry of world_info.charLore) {
            if (entry.name && world_names.includes(entry.name)) books.add(entry.name);
        }
    }
    return [...books];
}

const worldBookScanner = createWorldBookScanner({
    world_names, loadWorldInfo, log,
    getSelection: () => settings.worldBookSelection,
    getMaxEntries: () => settings.worldBookMaxEntries,
    getSourceMode: () => settings.worldBookSourceMode || 'st',
    getStSelection: getActivatedWorldBookNames,
    renderMacros: (text) => substituteParams(text, { replaceCharacterCard: false }),
});

const profileSystem = createProfileSystem({
    settings, EXT_KEY, getChatMetadata, getChat, getCharacters, saveChatConditional,
    getContext, setExtensionPrompt, inject_ids, extension_prompt_types,
    djb2Hash, hashChar, extractJsonObject, sanitizeJson,
    matchCharacterByName, getCurrentGroup, log,
    getLlmPickedSet: () => llmPickedSet,
    getLlmPickedAvatars: () => llmPickedAvatars,
    getRoundSpeakerCount: () => roundSpeakerCount,
    isRoundActive: () => isGroupChat,
    saveSettings,
    renderPrompt,
    createCaller,
});
const { buildCharacterProfilesText, generateProfilesBatch, validateAndWarnProfilePlaceholders,
    buildProfileLoaderPanel, checkProfileStartupStatus, detectCharacterChanges,
    refreshProfileManagementUI, bindProfileCardActions,
    getDefaultProfileGeneratorPrompt, getDefaultProfileSchema, getDefaultProfileRenderTemplate,
    computeProfileSchemaHash, getProfileContainer, getProfiles, getArchivedProfiles,
    saveProfile, diffProfiles, normalizeProfileFields,
    generateSingleProfile, syncProfiles, migrateProfileData } = profileSystem;

function log(...args) {
    if (settings.debugLogging) {
        console.log('[GroupDirector]', ...args);
    }
}

const { exportGroup, importGroup } = createExportImportSystem({
    settings, getCurrentGroup, getChat, getCharacters,
    world_names, getWorldNames: () => world_names,
    selected_world_info, world_info, getChatMetadata, log,
});

// ─── Profile Export System ──────────────────────────────────────────
const { exportProfiles, parseImportFile, applyImport, loadPreset, getPresetNames } =
    createProfileExportSystem({
        settings, getProfiles, saveSettings,
        getDefaultProfileGeneratorPrompt, getDefaultProfileSchema, getDefaultProfileRenderTemplate,
        getCurrentGroup, getCharacters, saveChatConditional,
        refreshProfileManagementUI, log,
    });

const profileLibrarySystem = createProfileLibrarySystem({
    settings,
    extension_settings,
    EXT_KEY,
    saveSettings: saveSettingsConfirmed,
    saveChatConditional,
    getProfiles,
    getCurrentGroup,
    getCharacters,
    getDefaultProfileGeneratorPrompt,
    getDefaultProfileSchema,
    getDefaultProfileRenderTemplate,
    parseImportFile,
    applyImport,
    refreshProfileManagementUI,
    hashChar,
    log,
});

// ─── NPC Export System ──────────────────────────────────────────────
const { exportNpcs, parseImportFile: parseNpcImportFile, applyImport: applyNpcImport,
    loadPreset: loadNpcPreset, getPresetNames: getNpcPresetNames } =
    createNpcExportSystem({
        settings, EXT_KEY, saveSettings, getCurrentGroup, getChatMetadata, saveChatConditional: saveNpcChatConfirmed,
        defaultNpcPrompt: DEFAULT_NPC_PROMPT, log,
    });

// ─── Summary Export System ──────────────────────────────────────────
const summaryExportSystem = createSummaryExportSystem({
    settings, EXT_KEY, getChatMetadata, saveChatConditional,
    chatSummarySystem: chatSummarySystem,
    getCurrentGroup,
    defaultSummaryPrompt: '',
    log,
});

// ─── Critique Export System ─────────────────────────────────────────
const critiqueExportSystem = createCritiqueExportSystem({
    settings, EXT_KEY, getChatMetadata, saveChatConditional,
    critiqueSystem: critiqueSystem,
    getCurrentGroup,
    defaultCritiquePrompt: '',
    log,
});

// ─── Memory Export System ───────────────────────────────────────────
const memoryExportSystem = createMemoryExportSystem({
    settings, EXT_KEY, getChatMetadata, getCharacters, getCurrentGroup,
    saveChatConditional, saveSettings, log,
    defaultMemoryPrompt: DEFAULT_MEMORY_PROMPT,
    defaultMemorySchema: DEFAULT_MEMORY_SCHEMA,
    defaultMemoryRender: DEFAULT_MEMORY_RENDER,
    defaultMemoryCompressPrompt: DEFAULT_MEMORY_COMPRESS_PROMPT,
});

// ─── Config Profile System ──────────────────────────────────────────
const configProfileSystem = createConfigProfileSystem({
    settings, EXT_KEY, extension_settings, saveSettingsDebounced, setProviderTimeoutDefault,
    variableSystem, customAgentSystem, log,
});

const critiqueAutoCoordinator = createCritiqueAutoCoordinator({
    getChatMetadata,
    getChat,
    getLatestActive: () => critiqueSystem.getLatestActive(),
    generateCritique: () => critiqueSystem.generateCritique(),
    saveChatConditional,
    EXT_KEY,
});
const { getPresetNames: getConfigPresetNames, loadPreset: loadConfigPreset } = configProfileSystem;

// ─── Custom Prompts System ──────────────────────────────────────────
const customPromptsSystem = createCustomPromptsSystem({
    settings, saveSettings,
    registerProvider: (p) => registerProvider(p),
    unregisterProvider: (id, owner) => unregisterProvider(id, owner),
    getProviders: () => getProviders(),
    log,
});

const scriptExecutorSystem = createScriptExecutorSystem({
    settings, saveSettings,
    renderPrompt, AgentTrace, log,
});

// ─── Agent Runtime — Context Pool Builder ─────────────────────────────

/**
 * Build the raw context pool injected into every agent execution.
 * All data is accessed via lazy getters — agents pull only what they declare
 * in contextAccess. Scoped via createScopedPool enforce.
 */
function buildContextPool(overrides = {}) {
    const group = overrides.group ?? getCurrentGroup();
    const enabledMembers = overrides.enabledMembers ??
        group?.members?.filter(a => !group.disabled_members?.includes(a)) ?? [];

    return {
        // Data
        chat: () => chat,
        recentMessages: (n) => chat.slice(-Math.min(n ?? 10, chat.length)),
        characters: () => characters,
        charactersRaw: () => characters,
        profilesText: () => buildCharacterProfilesText(),
        worldInfoText: () => wiState.text,
        ledger: () => getDirectorHistory(),
        group: () => group,
        groupMembers: () => enabledMembers,
        // Single character (for profile agent)
        character: (avatar) => {
            const av = avatar ?? overrides.characterAvatar;
            return characters.find(c => c.avatar === av) ?? null;
        },
        // Force-speak specific
        forceSpeakCharacter: () => overrides.forceSpeakChar ?? null,
        forceSpeakPrompt: () => settings.forceSpeakPrompt || null,
        // Summary specific
        summaryLatest: () => chatSummarySystem.getLatestActive?.() ?? null,
        critiqueLatest: () => critiqueSystem.getLatestActive?.() ?? null,
        // NPC specific (passed via overrides from npcSystem)
        npcExistingList: () => overrides.npcExistingList?.() ?? [],
        npcBatchSize: () => overrides.npcBatchSize?.() ?? settings.npcBatchSize ?? 3,
        npcGenerateFirstMes: () => overrides.npcGenerateFirstMes?.() ?? settings.npcGenerateFirstMes ?? false,
        // PostSpeech specific (passed via overrides)
        speakerMessage: () => overrides.speakerMessage ?? '',
        speakerName: () => overrides.speakerName ?? '',
        speakerDescription: () => overrides.speakerDescription ?? '',
        postSpeechMode: () => overrides.postSpeechMode ?? 'message',
        // Memory system (passed via overrides)
        memoryCharacter: () => overrides.memoryCharacter ?? null,
        memoryExistingList: () => overrides.memoryExistingList?.() ?? [],
        // Settings accessors
        settings: () => settings,
        llmWorldInfoEnabled: () => settings.llmWorldInfoEnabled,
        llmHistoryEnabled: () => settings.llmHistoryEnabled,
        llmScriptContinuity: () => settings.llmScriptContinuity,
        llmScriptContinuityMode: () => settings.llmScriptContinuityMode,
        llmScriptContinuityCount: () => settings.llmScriptContinuityCount,
        llmScriptContinuityWrapper: () => settings.llmScriptContinuityWrapper,
        llmScriptContinuityHistoryWrapper: () => settings.llmScriptContinuityHistoryWrapper,
        llmWorldInfoWrapper: () => settings.llmWorldInfoWrapper,
        profileEnabled: () => settings.profileEnabled,
        profileGeneratorDefault: () => getDefaultProfileGeneratorPrompt(),
        profileSchemaDefault: () => getDefaultProfileSchema(),
    };
}

// ─── Agent Registration ───────────────────────────────────────────────

// Director
AgentRegistry.register(createDirectorAgent({
    renderPrompt,
    getDefaultLlmPrompt,
    buildJsonSchema,
    parseLlmResponse,
    matchCharacterByName,
    buildCharacterProfilesText,
    getDirectorHistory,
    log,
}));

// ForceSpeak
AgentRegistry.register(createForceSpeakAgent({
    renderPrompt,
    getDefaultLlmPrompt,
    buildJsonSchema,
    parseLlmResponse,
    matchCharacterByName,
    buildCharacterProfilesText,
    log,
}));

// Profile
AgentRegistry.register(createProfileAgent({
    renderPrompt,
    extractJsonObject,
    log,
}));

// Summary
AgentRegistry.register(createSummaryAgent({ log }));
AgentRegistry.register(createCritiqueAgent({ log }));

// NPC
AgentRegistry.register(createNpcAgent({ renderPrompt, extractJsonObject, log }));

// PostSpeech
const postSpeechAgent = createPostSpeechAgent({ renderPrompt, log });
AgentRegistry.register(postSpeechAgent);

log('Agent Runtime registered:', AgentRegistry.list().map(a => a.id).join(', '));

// ─── NPC System ──────────────────────────────────────────────────────
const npcSystem = createNpcSystem({
    settings, EXT_KEY, getChatMetadata, getChat, saveChatConditional: saveNpcChatConfirmed, getCharacters, log,
    AgentRegistry, execute, buildContextPool, getCurrentGroup, createCaller, getContext, toastr: () => window.toastr,
});

const npcLibrarySystem = createNpcLibrarySystem({
    settings,
    extension_settings,
    EXT_KEY,
    saveSettings: saveSettingsConfirmed,
    getCurrentGroup,
    npcSystem,
    parseNpcImportFile,
    applyNpcImport,
    getDefaultNpcPrompt: () => DEFAULT_NPC_PROMPT,
    log,
});

// ─── Memory Agent + System ───────────────────────────────────────────
AgentRegistry.register(createMemoryAgent({ renderPrompt, extractJsonObject, log }));

const memorySystem = createMemorySystem({
    settings, EXT_KEY, getChatMetadata, getChat, getCharacters, saveChatConditional, log,
    AgentRegistry, execute, buildContextPool, getCurrentGroup, createCaller, getContext,
});

// ─── PostSpeech System ───────────────────────────────────────────────
const savePostSpeechChatConfirmed = createConfirmedPostSpeechChatSave({
    saveChatConditional, getCurrentChatId, getCurrentGroup: () => selected_group && groups.find(group => group.id === selected_group),
    getContext, getChatMetadata, getRequestHeaders, EXT_KEY,
});
const postSpeechSystem = createPostSpeechSystem({
    settings, EXT_KEY, getChatMetadata, getChat, saveChatConditional: savePostSpeechChatConfirmed, log,
});

// ─── PostSpeech Executor ─────────────────────────────────────────────
const postSpeechExecutor = createExecutor({
    blocking: settings.postSpeechBlocking !== false,
    log,
    resolveCapability: capabilityId => CapabilityRegistry.get(capabilityId),
    onExecuted: (capId, result) => {
        if (!result.success) log(`[Executor] ${capId} execution failed: ${result.error}`);
    },
});

// ─── Register built-in capabilities ─────────────────────────────────
// ─── User Provider Loader ────────────────────────────────────────────
const userProviderLoader = createUserProviderLoader({
    extension_settings, EXT_KEY, saveSettings: () => extension_settings[EXT_KEY] && saveSettingsDebounced(), log,
    getRegisteredProviderIds: () => [...getProviders().map(p => p.id)],
    getRegisteredProvider: id => getProviders().find(p => p.id === id),
    unregisterProvider: (id, owner) => unregisterProvider(id, owner),
    CapabilityRegistry,
    confirmImport: html => callGenericPopup(html, POPUP_TYPE.CONFIRM),
});

// ─── Expose core modules globally for user-imported .js files ───────
// User modules loaded via Blob URL can't resolve relative imports.
// These globals let user code use: const { CapabilityRegistry } = window.GroupDirector;
window.GroupDirector = {
    CapabilityRegistry,
    registerProvider: (p) => registerProvider(p),
    unregisterProvider: (id) => unregisterProvider(id),
    log,
};

// ─── Register built-in capabilities via AssetLoader ─────────────────
import { capabilityModules } from './assets/capabilities/manifest.js';
await AssetLoader.capabilities({ basePath: '../assets/capabilities', modules: capabilityModules }, { log });
// Register capability-list providers for both PostSpeech modes
registerCapabilityProviders({ registerProvider });
log('CapabilityRegistry:', CapabilityRegistry.list().map(c => c.id).join(', '));

// ─── Trigger Engine ───────────────────────────────────────────────────
function checkTriggers(characterName, characterAvatar, recentMessages) {
    if (!settings.triggerEnabled) return false;

    const char = characters.find(c => c.avatar === characterAvatar);
    if (!char) return false;

    const matched = matchesTrigger(char, recentMessages, { enabled: settings.triggerEnabled });
    if (matched) log(`Trigger matched for ${characterName}`);
    return matched;

    // Legacy implementation retained temporarily while the extracted trigger
    // engine is characterized by tests.

    // Extract keywords from character description + personality + scenario
    const desc = (char.description || '') + ' ' + (char.personality || '') + ' ' + (char.scenario || '');
    const keywords = desc
        .split(/[\s,.;!?，。；！？、]+/)
        .filter(w => w.length >= 2 && w.length <= 10)
        .map(w => w.toLowerCase());

    // Deduplicate
    const uniqueKeywords = [...new Set(keywords)];

    const text = recentMessages.map(m => m.mes || '').join(' ').toLowerCase();

    for (const kw of uniqueKeywords) {
        if (text.includes(kw)) {
            log(`Trigger matched: "${kw}" for ${characterName}`);
            return true;
        }
    }
    return false;
}

// ─── Initiative Engine ────────────────────────────────────────────────
function rollInitiative(avatar) {
    const roll = rollInitiativeValue({
        enabled: settings.initiativeEnabled,
        baseScore: settings.initiativeBaseScore,
    });
    roundInitiative[avatar] = roll;
    return roll;
}

// ─── Scoring System ───────────────────────────────────────────────────
function scoreCharacter(chId, recentMessages) {
    const char = characters[chId];
    if (!char) return -Infinity;

    const name = char.name;
    const avatar = char.avatar;
    const result = scoreFormulaCharacter({
        character: char,
        recentMessages,
        chat,
        scoreWeights: settings.scoreWeights,
        triggerScore: settings.triggerScore,
        consecutivePenalty: settings.consecutivePenalty,
        triggered: roundTriggeredAvatars.has(avatar),
        initiative: roundInitiative[avatar] || 0,
    });
    const { score, breakdown } = result;
    log(`Score for ${name}: ${score.toFixed(1)} (mention=${breakdown.mentionCount}, trigger=${breakdown.triggered}, recencyIdx=${breakdown.lastSpokenIndex}, consec=${breakdown.consecutiveCount}, talk=${breakdown.talkativeness.toFixed(2)})`);
    return score;

    /* Legacy implementation retained temporarily while this extraction is
     * characterized by tests. Remove after the next state-machine slice. */
    {
    const weights = settings.scoreWeights;

    let score = 0;

    // 1. Mention score: character name appears in recent messages.
    // \b only matches between \w and \W — CJK chars are \W, so \b is invisible
    // between them. Use substring indexOf for CJK names, \b for ASCII.
    const recentText = recentMessages.map(m => m.mes || '').join(' ');
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const hasCJK = /[⺀-⻿　-〿㇀-㇯㈀-㋿㐀-䶿一-鿿豈-﫿︰-﹏＀-￯]/.test(name);
    let mentionCount = 0;
    if (hasCJK) {
        // Substring scan for CJK names (simple indexOf loop, case-sensitive)
        let idx = 0;
        while ((idx = recentText.indexOf(name, idx)) !== -1) {
            mentionCount++;
            idx += name.length;
        }
    } else {
        mentionCount = (recentText.match(new RegExp('\\b' + escapedName + '\\b', 'gi')) || []).length;
    }
    score += mentionCount * weights.mention;

    // 2. Keyword trigger score
    if (roundTriggeredAvatars.has(avatar)) {
        score += settings.triggerScore;
    }

    // 3. Recency score: bonus for not having spoken recently
    const lastSpokenIndex = findLastSpokenIndex(avatar, recentMessages);
    if (lastSpokenIndex === -1) {
        // Hasn't spoken in recent messages at all — big bonus
        score += weights.recency;
    } else {
        // The more recent they spoke, the less bonus
        const ratio = lastSpokenIndex / Math.max(recentMessages.length, 1);
        score += weights.recency * ratio;
    }

    // 4. Consecutive speaking penalty
    const consecutiveCount = countConsecutiveMessages(avatar);
    score -= consecutiveCount * settings.consecutivePenalty;

    // 5. Talkativeness
    const talkativeness = (char.talkativeness === '' || isNaN(char.talkativeness)) ? 0.5 : Number(char.talkativeness);
    score += talkativeness * weights.talkativeness;

    // 6. Initiative roll
    score += roundInitiative[avatar] || 0;

    log(`Score for ${name}: ${score.toFixed(1)} (mention=${mentionCount}, trigger=${roundTriggeredAvatars.has(avatar)}, recencyIdx=${lastSpokenIndex}, consec=${consecutiveCount}, talk=${talkativeness.toFixed(2)})`);
    return score;
    }
}

function findLastSpokenIndex(avatar, recentMessages) {
    // Iterate from newest to oldest. Returns 0 for most recent speaker,
    // N-1 for earliest speaker in the window, -1 if never spoke.
    for (let i = recentMessages.length - 1; i >= 0; i--) {
        const msg = recentMessages[i];
        if (!msg.is_user && !msg.is_system) {
            const msgAvatar = msg.avatar || '';
            const msgName = msg.name || '';
            const char = characters.find(c => c.avatar === avatar);
            if (msgAvatar === avatar || (char && msgName === char.name)) {
                return recentMessages.length - 1 - i;
            }
        }
    }
    return -1;
}

function countConsecutiveMessages(avatar) {
    // Count how many of the most recent messages are from this avatar
    let count = 0;
    const char = characters.find(c => c.avatar === avatar);
    if (!char) return 0;

    for (let i = chat.length - 1; i >= 0; i--) {
        const msg = chat[i];
        if (msg.is_user || msg.is_system) break;
        const msgAvatar = msg.avatar || '';
        const msgName = msg.name || '';
        if (msgAvatar === avatar || msgName === char.name) {
            count++;
        } else {
            break;
        }
    }
    return count;
}

// ─── Round Initialization ─────────────────────────────────────────────
function getCurrentGroup() {
    if (!selected_group) return null;
    return groups.find(g => g.id === selected_group) || null;
}

function initFormulaRound() {
    roundScores = {};
    roundTriggeredAvatars.clear();
    roundInitiative = {};

    const group = getCurrentGroup();
    if (!group) return;

    const recentMessages = getRecentMessages();

    // Pre-compute triggers and initiative for all members
    for (const memberAvatar of group.members) {
        if (group.disabled_members?.includes(memberAvatar)) continue;

        const chId = characters.findIndex(c => c.avatar === memberAvatar);
        if (chId === -1) continue;

        const char = characters[chId];

        // Check triggers
        if (checkTriggers(char.name, memberAvatar, recentMessages)) {
            roundTriggeredAvatars.add(memberAvatar);
        }

        // Roll initiative
        rollInitiative(memberAvatar);

        // Score character
        roundScores[memberAvatar] = scoreCharacter(chId, recentMessages);
    }

    log('Round scores:', Object.entries(roundScores)
        .sort((a, b) => b[1] - a[1])
        .map(([a, s]) => `${characters.find(c => c.avatar === a)?.name || a}: ${s.toFixed(1)}`)
        .join(', '));
}

function getRecentMessages() {
    const count = Math.min(settings.recentMessageCount, chat.length);
    return chat.slice(-count);
}

// ─── Main Interceptor ─────────────────────────────────────────────────
// Runs once per activated character before its Generate() call.
globalThis.groupDirector_Interceptor = async function (chatArray, contextSize, abort, type) {
    // Gate 1: only intercept actual message generations.
    // Non-message types (image, TTS, voice, etc.) pass through untouched.
    if (type !== 'normal' && type !== 'swipe' && type !== 'regenerate') return;

    // Gate 2: detect force-speak button / /trigger (no user message before generation).
    // These use Generate('normal', { force_chid }) — a single-member forced generation
    // in a group chat. /send and /sendas add a user or character message first,
    // so lastMsgIsUser or normal round flags will be set — they fall through to Director.
    const lastMsgIsUser = chat.length > 0 && !!chat[chat.length - 1]?.is_user;
    const forceSpeakAction = getForceSpeakAction({
        roundInitialized,
        generationType: roundGenerateType,
        lastMessageIsUser: lastMsgIsUser,
        hasGroup: !!getCurrentGroup(),
        mode: settings.forceSpeakMode || 'native',
    });
    const isForceTriggered = forceSpeakAction !== 'pass';

    if (isForceTriggered) {
        const mode = forceSpeakAction;
        if (mode === 'block') {
            abort(false);
            return;
        }
        if (mode === 'llm') {
            const group = getCurrentGroup();
            if (group) {
                const ctx = getContext();
                const chId = ctx.characterId;
                if (chId !== undefined && chId !== null && characters[chId]) {
                    await initForceSpeakLLM(characters[chId], characters[chId].avatar);
                }
            }
            return;
        }
        // mode === 'native': confirm then pass through
        const msg = settings.lang === 'zh'
            ? '强制发言会绕过导演决策，可能破坏故事连续性。是否继续？'
            : 'Force-speak bypasses the director and may break story continuity. Continue?';
        if (await callGenericPopup(msg, POPUP_TYPE.CONFIRM)) return;
        abort(false);
        return;
    }

    if (settings.mode === MODE_OFF) return;

    const group = getCurrentGroup();
    if (!group) return;

    const ctx = getContext();
    const activeCharId = ctx.characterId;
    if (activeCharId === undefined || activeCharId === null) return;

    const char = characters[activeCharId];
    if (!char) return;

    const avatar = char.avatar;

    // First speaker of the round: initialize state (run rules or call LLM).
    // Use an in-flight Promise so concurrent interceptor calls on subsequent
    // characters all await the same init instead of racing past a null llmPickedSet.
    if (!roundInitialized) {
        roundInitialized = true;
        if (settings.mode === MODE_LLM) {
            initPromise = initRoundWithLLM();
            await initPromise;
            initPromise = null;
            if (!llmPickedAvatars || llmPickedAvatars.length === 0) {
                log('LLM produced no decision; falling back to transparent (allow all)');
            }
        } else {
            initFormulaRound();
        }

        // ─── Script Executor: decision trigger (blocking, runs once per round) ──
        const decAvatars = llmPickedAvatars || [];
        const decisionObj = {
            speakers: [...decAvatars],
            names: decAvatars.map(a => characters.find(c => c.avatar === a)?.name || '?'),
            reason: directorLastReason || '',
            scripts: { ...(directorScripts || {}) },
        };
        const scriptTurnId = scriptExecutorSystem.getTurnId();
        try {
            await scriptExecutorSystem.executeAllDecision({
                decision: decisionObj,
                chat, characters,
                group: getCurrentGroup(),
                settings,
                getContext,
            });
        } catch (e) {
            log('Script executor (decision): unexpected error', e);
        }
        if (scriptExecutorSystem.getTurnId() !== scriptTurnId) return;
        // Sync mutations back — decisionObj was mutated by reference
        if (decisionObj.speakers.length > 0) {
            const newAvatars = decisionObj.speakers.filter(a => characters.some(c => c.avatar === a));
            if (newAvatars.length > 0) {
                llmPickedAvatars = newAvatars;
                llmPickedSet = new Set(newAvatars);
                llmCursor = 0;
            }
        }
        if (decisionObj.scripts) {
            directorScripts = decisionObj.scripts;
        }
        directorLastReason = decisionObj.reason || directorLastReason;
    } else if (initPromise) {
        await initPromise;
    }

    // ─── Mode: LLM ──────────────────────────────────────────────────
    if (settings.mode === MODE_LLM) {
        // Manual ordered generation in progress — validate identity, inject script, let through
        if (roundOrchestrator.getSnapshot().takeoverRemaining > 0) {
            const takeoverDecision = roundOrchestrator.decideTakeoverTurn({
                generationType: roundGenerateType,
                avatar,
                plannedAvatars: llmPickedAvatars,
            });
            if (takeoverDecision.action === 'block') {
                abort(false);
                return;
            }
            if (!takeoverDecision.reroll) roundSpeakerCount++;
            // Safety-net script injection: ensure the correct per-character script is set
            const takeoverScript = await getScriptForChar(char.name, {
                speakerIndex: roundSpeakerCount,
                speakerIndex0: roundSpeakerCount - 1,
                speakerCount: llmPickedAvatars?.length || 0,
            });
            if (takeoverScript) {
                setExtensionPrompt(DIRECTOR_SCRIPT_KEY, takeoverScript, getScriptPosition(), 0, true);
            }
            console.warn(`[GroupDirector] MANUAL-GEN ALLOWED ${char.name} (takeoverRemaining→${takeoverDecision.remaining}, speaker #${roundSpeakerCount}${takeoverDecision.reroll ? ', reroll' : ''})`);
            return;
        }
        // ST's activation loop is being suppressed — abort all
        if (roundOrchestrator.getSnapshot().takeoverPending) {
            console.warn(`[GroupDirector] TAKEOVER-BLOCK ${char.name} (ST order suppressed, director will drive order)`);
            abort(false);
            return;
        }
        if (!llmPickedSet) {
            return;
        }
        // Swipe/regenerate: ST controls which message is re-rolled. Don't
        // filter by director picks — the swiped character may differ from
        // the original plan (e.g., user swipes a message from a prior round).
        const isSwipeOrRegen = roundGenerateType === 'swipe' || roundGenerateType === 'regenerate';
        const llmTurn = decideLlmSpeakerTurn({
            plannedAvatars: llmPickedAvatars,
            spokenAvatars: [...llmSpokenSet],
            cursor: llmCursor,
            avatar,
            generationType: roundGenerateType,
            respectOrder: settings.llmRespectOrder,
        });
        if (llmTurn.action === 'block') {
            log(`BLOCKED ${char.name} (not in LLM picks)`);
            abort(false);
            return;
        }
        if (isSwipeOrRegen) {
            // Re-rolls operate on an existing message, not a new Director
            // decision. Keep script context if available, but do not mutate
            // the plan cursor, spoken set, or round speaker count.
            const rerollScript = await getScriptForChar(char.name, {
                speakerIndex: Math.max(roundSpeakerCount, 1),
                speakerIndex0: Math.max(roundSpeakerCount - 1, 0),
                speakerCount: llmPickedAvatars?.length || 0,
            });
            setExtensionPrompt(DIRECTOR_SCRIPT_KEY, rerollScript || '', getScriptPosition(), 0, true);
            log(`REROLL ALLOWED ${char.name} (Director plan state unchanged)`);
            return;
        }
        // Normal LLM-mode generations commit the reducer's state in one
        // place; the legacy branch below is retained only during migration.
        llmSpokenSet = new Set(llmTurn.spokenAvatars);
        llmCursor = llmTurn.cursor;
        roundSpeakerCount++;
        const plannedScript = await getScriptForChar(char.name, {
            speakerIndex: roundSpeakerCount,
            speakerIndex0: roundSpeakerCount - 1,
            speakerCount: llmPickedAvatars?.length || 0,
        });
        setExtensionPrompt(DIRECTOR_SCRIPT_KEY, plannedScript || '', getScriptPosition(), 0, true);
        log(`ALLOWED ${char.name} (LLM pick #${roundSpeakerCount})`);
        return;
        if (!isSwipeOrRegen && !llmPickedSet.has(avatar)) {
            log(`BLOCKED ${char.name} (not in LLM picks)`);
            abort(false);
            return;
        }
        // Best-effort order tracking (non-takeover mode)
        if (settings.llmRespectOrder) {
            while (llmCursor < llmPickedAvatars.length && llmSpokenSet.has(llmPickedAvatars[llmCursor])) {
                llmCursor++;
            }
            const expected = llmPickedAvatars[llmCursor];
            if (expected && expected !== avatar) {
                log(`OUT-OF-ORDER: ${char.name} speaking before ${characters.find(c => c.avatar === expected)?.name || expected}. Still allowed.`);
                llmCursor = llmPickedAvatars.findIndex(a => !llmSpokenSet.has(a));
                if (llmCursor === -1) llmCursor = llmPickedAvatars.length;
            } else if (expected === avatar) {
                llmCursor++;
            }
        }
        // Validate: this character must be in the picked set
        if (!isSwipeOrRegen && !llmPickedSet.has(avatar)) {
            console.warn(`[GroupDirector] VALIDATION FAILED: ${char.name} (${avatar}) not in llmPickedSet! Aborting.`);
            abort(false);
            return;
        }
        llmSpokenSet.add(avatar);
        roundSpeakerCount++;
        // Inject per-character director script
        const charScript = await getScriptForChar(char.name, {
            speakerIndex: roundSpeakerCount,
            speakerIndex0: roundSpeakerCount - 1,
            speakerCount: llmPickedAvatars?.length || 0,
        });
        if (charScript) {
            setExtensionPrompt(DIRECTOR_SCRIPT_KEY, charScript, getScriptPosition(), 0, true);
        } else {
            setExtensionPrompt(DIRECTOR_SCRIPT_KEY, '', getScriptPosition(), 0, true);
        }
        log(`ALLOWED ${char.name} (LLM pick #${roundSpeakerCount})`);
        return;
    }

    // ─── Mode: Formula (Top-N) ──────────────────────────────────────
    const formulaTurn = decideFormulaTurn({
        scores: roundScores,
        topN: settings.topN,
        avatar,
        speakerCount: roundSpeakerCount,
    });
    const { allowed, score, nextSpeakerCount } = formulaTurn;

    if (allowed) {
        roundSpeakerCount = nextSpeakerCount;
        log(`ALLOWED ${char.name} (score=${score.toFixed(1)}, speaker #${roundSpeakerCount})`);
    } else {
        log(`BLOCKED ${char.name} (score=${score.toFixed(1)})`);
        abort(false);
    }
};

// ─── Event Listeners ─────────────────────────────────────────────────

eventSource.on(event_types.GROUP_WRAPPER_STARTED, (data) => {
    // Always capture the generation type, even for nested wrappers.
    // Auto-swipes during takeover need to be visible to the interceptor.
    roundGenerateType = data?.type || 'normal';
    const wrapperTransition = roundOrchestrator.startWrapper({ generationType: roundGenerateType });

    // If manual ordered generation is in progress (force_chid sub-calls),
    // don't reset state — the sub-wrapper is just a vehicle for single-char gen.
    if (wrapperTransition.kind === 'preserve_nested') {
        console.warn('[GroupDirector] Nested GROUP_WRAPPER_STARTED during manual gen — preserving state');
        return;
    }

    // Previous takeover failed mid-round: reuse the existing director decision
    // instead of making a new one. Chat already has partial messages from the
    // failed attempt; a new decision would conflict with existing dialog boxes.
    if (wrapperTransition.kind === 'retry_failed') {
        roundOrchestrator.retryFailed({ pending: settings.mode === MODE_LLM && settings.llmRespectOrder });
        llmSpokenSet = new Set();
        llmCursor = 0;
        roundSpeakerCount = 0;
        roundInitialized = true; // reuse existing director decision as documented
        roundGenerateType = data?.type || 'normal';
        console.warn('[GroupDirector] Retry after takeover failure — reusing existing director plan');
        return;
    }

    isGroupChat = true;

    // Regenerate / swipe: reuse the existing director decision — only reset
    // per-speaker tracking. Don't re-trigger takeover; let ST decide which
    // messages to regenerate. Reconstruct state from chat_metadata so it
    // survives browser restarts (in-memory state is gone on reload).
    if (wrapperTransition.kind === 'reuse_or_restore_plan') {
        // Allow PostSpeech to re-analyze the swiped messages
        postSpeechLastMsgIndex = -1;
        postSpeechRoundRan = false;
        postSpeechRoundQueue = [];
        scriptExecutorRoundRan = false;
        if (!llmPickedSet) {
            const history = getDirectorHistory();
            const lastPlan = history[history.length - 1];
            if (lastPlan && Array.isArray(lastPlan.speakers) && lastPlan.speakers.length > 0) {
                const group = getCurrentGroup();
                const members = group?.members?.filter(a => !group.disabled_members?.includes(a)) || [];
                const recovered = recoverDirectorPlan(lastPlan, {
                    enabledMembers: members,
                    maxSpeakers: settings.llmMaxSpeakers,
                    matchCharacterByName,
                });
                if (recovered) {
                    llmPickedAvatars = recovered.avatars;
                    llmPickedSet = new Set(recovered.avatars);
                    directorScripts = recovered.scripts;
                    llmSpokenSet = new Set();
                    llmCursor = 0;
                    roundSpeakerCount = 0;
                    roundOrchestrator.clearTakeover();
                    roundInitialized = true;
                    const saved = chat_metadata[EXT_KEY]?._counterSnapshots;
                    if (saved) {
                        for (const [name, val] of Object.entries(saved)) {
                            if (!scriptCounterSnapshots.has(name)) scriptCounterSnapshots.set(name, val);
                        }
                    }
                    log('Regenerate/swipe — restored director plan from history');
                    return;
                }
                const avatars = [];
                for (const name of lastPlan.speakers) {
                    const c = matchCharacterByName(name, members);
                    if (c) avatars.push(c.avatar);
                }
                if (avatars.length > 0) {
                    llmPickedAvatars = avatars;
                    llmPickedSet = new Set(avatars);
                    directorScripts = {};
                    if (lastPlan.scripts && typeof lastPlan.scripts === 'object') {
                        for (const [name, script] of Object.entries(lastPlan.scripts)) {
                            const c = matchCharacterByName(name, members);
                            if (c) directorScripts[c.name] = script;
                        }
                    }
                    roundInitialized = true;
                    // Restore counter snapshots from persisted data
                    const saved = chat_metadata[EXT_KEY]?._counterSnapshots;
                    if (saved) {
                        for (const [name, val] of Object.entries(saved)) {
                            if (!scriptCounterSnapshots.has(name)) {
                                scriptCounterSnapshots.set(name, val);
                            }
                        }
                    }
                    log('Regenerate/swipe — reconstructed director plan from chat_metadata');
                }
            }
        }
        if (!llmPickedSet) {
            // No history to reconstruct — transparent pass-through: let ST handle
            // the regenerate/swipe without director filtering. Must NOT fall through
            // to normal init, which would trigger a new LLM call.
            roundInitialized = true;
            log('Regenerate/swipe — no persisted plan, transparent pass-through');
            return;
        }
        // Reuse existing plan (reconstructed or in-memory)
        {
            llmSpokenSet = new Set();
            llmCursor = 0;
            roundSpeakerCount = 0;
            roundOrchestrator.clearTakeover();
            roundInitialized = true;
            // Restore counter snapshots (may be lost on page reload while plan survived in memory)
            const saved = chat_metadata[EXT_KEY]?._counterSnapshots;
            if (saved) {
                for (const [name, val] of Object.entries(saved)) {
                    if (!scriptCounterSnapshots.has(name)) {
                        scriptCounterSnapshots.set(name, val);
                    }
                }
            }
            log('Regenerate/swipe — reusing director plan, no takeover');
            return;
        }
    }

    roundScores = {};
    roundSpeakerCount = 0;
    roundTriggeredAvatars.clear();
    roundInitiative = {};
    llmPickedAvatars = null;
    llmPickedSet = null;
    llmSpokenSet = new Set();
    llmCursor = 0;
    roundInitialized = false;
    initPromise = null;
    generationStopped = false;
    roundOrchestrator.reset();
    manualGenInProgress = false;
    directorScripts = {};
    directorLastReason = '';
    scriptExecutorSystem.resetTurnShared();
    postSpeechRoundRan = false;
    postSpeechRoundQueue = [];
    scriptExecutorRoundRan = false;
    postSpeechLastMsgIndex = -1;
    setExtensionPrompt(DIRECTOR_SCRIPT_KEY, '', getScriptPosition(), 0, true);
    wiState.text = '';
    wiState.entries = [];
    roundCounterReset();
    scriptCounterSnapshots.clear();
    if (chat_metadata[EXT_KEY]) delete chat_metadata[EXT_KEY]._counterSnapshots;
    log(`Group generation started (mode=${settings.mode}, type=${roundGenerateType})`);
});

eventSource.on(event_types.GROUP_WRAPPER_FINISHED, async () => {
    isGroupChat = false;
    log('Group generation finished');

    if (roundOrchestrator.getSnapshot().takeoverPending && llmPickedAvatars && llmPickedAvatars.length > 0) {
        await runManualOrderedGeneration();
    }
    roundOrchestrator.setPending(false);
    let postSpeechRoundWasAborted = false;

    // PostSpeech per-round: run EXACTLY ONCE after ALL characters
    // (including takeover) have finished speaking.
    // Only fire when takeover is fully complete (not during nested wrappers)
    if (settings.postSpeechRoundEnabled && !postSpeechRoundRan && roundOrchestrator.canFinalize({
        manualGenerationInProgress: manualGenInProgress,
        generationStopped,
    })) {
        postSpeechRoundRan = true;

        generationStopped = false;
        postSpeechAbortController = new AbortController();

        const lang = settings.lang || 'zh';
        const msg = lang === 'zh'
            ? 'PostSpeech 正在分析本轮对话，请勿发送消息...'
            : 'PostSpeech analyzing this round, please wait...';
        log('PostSpeech round start notification:', msg);

        // Show persistent notification while PostSpeech processes
        if (typeof toastr !== 'undefined') {
            toastr.info(msg, '', { timeOut: 0, extendedTimeOut: 0, tapToDismiss: false, closeButton: true });
        } else if (typeof window !== 'undefined' && window.toastr) {
            window.toastr.info(msg, '', { timeOut: 0, extendedTimeOut: 0, tapToDismiss: false, closeButton: true });
        }
        const dismissNotify = () => {
            try { toastr?.clear?.(); } catch (_) { }
        };
        try {
            const agent = AgentRegistry.get('post-speech');
            if (agent) {
                const agentConfig = settings.agentConfigs?.['post-speech'] || {};
                const stGenerateRaw = (opts) => getContext().generateRaw(opts);
                const caller = createCaller(
                    agentConfig,
                    stGenerateRaw,
                    () => getContext().stopGeneration()
                );
                const modeConfig = { ...settings, postSpeechPrompt: settings.postSpeechRoundPrompt || undefined };

                const pool = buildContextPool({
                    group: getCurrentGroup(),
                    speakerMessage: '',    // round summary — no single speaker
                    speakerName: '',
                    speakerDescription: '',
                    postSpeechMode: 'round',
                });

                const callCfg = {
                    ...agentConfig.call,
                    signal: postSpeechAbortController.signal,
                    onRetry: ({ attempt, maxRetries }) => log(`PostSpeech round retry ${attempt}/${maxRetries}`),
                };

                let response = null;
                if (postSpeechAbortController.signal.aborted) {
                    postSpeechRoundWasAborted = true;
                } else {
                    response = await execute(agent, {
                        pool,
                        caller,
                        config: { ...modeConfig, call: callCfg, enableTrace: settings.debugLogging },
                    }).catch(e => {
                        if (e.name === 'AbortError' || postSpeechAbortController.signal.aborted) {
                            postSpeechRoundWasAborted = true;
                            log('PostSpeech round aborted');
                            return null;
                        }
                        throw e;
                    });
                }

                if (response) {
                    const policy = agent.parseResponse(response);
                    if (policy?.intents?.length) {
                        log('PostSpeech round policy:', policy);
                        const contexts = policy.intents.map(intent => ({
                            messageIndex: chat.length - 1,
                            messageName: '_round_',
                            intent,
                            policy,
                        }));
                        const reservation = postSpeechSystem.reserveExecution(contexts, { allowPending: true });
                        if (reservation.contexts.length) {
                            let trackingStarted = false;
                            try {
                                let execResult = await postSpeechExecutor.run(
                                    { ...policy, intents: reservation.contexts.map(context => context.intent) },
                                    CapabilityRegistry.listExecutableForMode('round')
                                );
                                if (execResult.deferred.length) {
                                    execResult = await postSpeechExecutor.executeDeferred(execResult.deferred);
                                }
                                trackingStarted = true;
                                await postSpeechSystem.trackExecution(execResult, reservation.contexts, reservation);
                            } catch (error) {
                                if (!trackingStarted) reservation.release();
                                throw error;
                            }
                        }
                    }
                }

            }
        } catch (e) {
            log('PostSpeech round skipped:', e.message);
        } finally {
            dismissNotify();
            const wasAborted = postSpeechAbortController?.signal.aborted ?? false;
            postSpeechAbortController = null;
            if (typeof toastr !== 'undefined') {
                if (wasAborted) {
                    toastr.info(
                        lang === 'zh' ? 'PostSpeech 回合分析已中止' : 'PostSpeech round aborted',
                        '', { timeOut: 2000 }
                    );
                } else {
                    toastr.success(
                        lang === 'zh' ? 'PostSpeech 回合分析完成' : 'PostSpeech round complete',
                        '', { timeOut: 2000 }
                    );
                }
            }
        }
    }

    // Deferred message actions belong to the caller and must drain at the real
    // round boundary even when the optional round-analysis agent is disabled
    // or fails.
    if (!postSpeechRoundWasAborted &&
        roundOrchestrator.canFinalize({
            manualGenerationInProgress: manualGenInProgress,
            generationStopped,
        }) &&
        postSpeechRoundQueue.length > 0) {
        try {
            await drainPostSpeechRoundQueue();
        } catch (e) {
            log('PostSpeech deferred execution failed:', e.message);
        }
    }

    // ─── Script Executor: round trigger (before auto summary, deduped) ──
    // Only fire when takeover is fully complete (same guard as PostSpeech round)
    if (!scriptExecutorRoundRan && roundOrchestrator.canFinalize({
        manualGenerationInProgress: manualGenInProgress,
        generationStopped,
    })) {
        scriptExecutorRoundRan = true;
        try {
            scriptExecutorSystem.executeAll('round', {
                chat,
                characters,
                group: getCurrentGroup(),
                settings,
                getContext,
            }).catch(err => log('Script executor (round):', err.message));
        } catch (e) { /* isolated */ }
    }

    // ─── Auto Summary & Auto Memory ────────────────────────────
    const lang = settings.lang || 'zh';
    const hasAutoCA = (settings.customAgents || []).some(a => a.enabled && a.autoEnabled);
    const _c1 = settings.autoSummaryEnabled || settings.autoMemoryEnabled || settings.autoCritiqueEnabled || hasAutoCA;
    const _c2 = roundOrchestrator.canFinalize({
        manualGenerationInProgress: manualGenInProgress,
        generationStopped,
    });
    const _c3 = !manualGenInProgress;
    console.log('[GD-auto] guard:', { _c1, _c2, _c3, tGC: roundOrchestrator.getSnapshot().takeoverRemaining, mGP: manualGenInProgress, allOk: _c1 && _c2 && _c3 });
    if (_c1 && _c2 && _c3) {
        const currentLen = chat.length;
        // Base prevLen on actual summary/memory coverage, not a possibly stale counter
        const summaryCovered = settings.autoSummaryEnabled && settings.summaryEnabled
            ? (chatSummarySystem.getLatestActive?.()?.rangeEnd ?? 0) : 0;
        const memCovered = settings.autoMemoryEnabled && settings.memoryEnabled
            ? Object.values(memorySystem.getStats?.() || {}).reduce((max, s) => Math.max(max, s.lastCoveredRound ?? s.lastCoveredAt ?? 0), 0) : 0;
        chat_metadata[EXT_KEY] = chat_metadata[EXT_KEY] || {};
        let legacyLen = chat_metadata[EXT_KEY]._autoCheckLength;

        // Auto Summary
        let sumLen = chat_metadata[EXT_KEY]._autoSumLen;
        if (sumLen === undefined) sumLen = legacyLen !== undefined ? legacyLen : summaryCovered;

        // Auto Memory
        let memLen = chat_metadata[EXT_KEY]._autoMemLen;
        if (memLen === undefined) memLen = legacyLen !== undefined ? legacyLen : memCovered;

        console.log('[GD-auto] ENTERED sumLen=', sumLen, 'memLen=', memLen, 'curLen=', currentLen);

        async function saveSumLen(val) {
            chat_metadata[EXT_KEY] = chat_metadata[EXT_KEY] || {};
            chat_metadata[EXT_KEY]._autoSumLen = val;
            await saveChatConditional();
        }

        async function saveMemLen(val) {
            chat_metadata[EXT_KEY] = chat_metadata[EXT_KEY] || {};
            chat_metadata[EXT_KEY]._autoMemLen = val;
            await saveChatConditional();
        }

        const memoryCoverage = (
            chat_metadata[EXT_KEY]._autoMemCharLen
            && typeof chat_metadata[EXT_KEY]._autoMemCharLen === 'object'
            && !Array.isArray(chat_metadata[EXT_KEY]._autoMemCharLen)
        ) ? chat_metadata[EXT_KEY]._autoMemCharLen : {};
        chat_metadata[EXT_KEY]._autoMemCharLen = memoryCoverage;

        async function saveMemoryTargetLen(target, val) {
            const hadPrevious = Object.prototype.hasOwnProperty.call(memoryCoverage, target);
            const previous = memoryCoverage[target];
            memoryCoverage[target] = val;
            try {
                await saveChatConditional();
            } catch (error) {
                if (hadPrevious) memoryCoverage[target] = previous;
                else delete memoryCoverage[target];
                throw error;
            }
        }

        async function runAutoMemoryBatch(targets, interval) {
            return await runAutoMemoryTargets({
                targets,
                currentLen,
                interval,
                defaultCovered: memLen,
                coveredByTarget: memoryCoverage,
                generateForTarget: avatar => memorySystem.generateForCharacter(avatar),
                onCovered: saveMemoryTargetLen,
                log,
            });
        }

        function resolveMemoryTargets(members, interval) {
            if (!settings.autoMemorySpeakers) return members;
            const history = getDirectorHistory();
            if (!history || !history.length) return members;
            const seen = new Set();
            const lookback = Math.min(interval, history.length);
            // speakers in ledger are names — resolve to avatars via enabled members
            const enabled = members;
            for (let i = history.length - lookback; i < history.length; i++) {
                const entry = history[i];
                const names = entry?.speakers || [];
                for (const n of names) {
                    if (!n) continue;
                    const c = matchCharacterByName(n, enabled);
                    if (c) seen.add(c.avatar);
                }
            }
            if (!seen.size) return members;
            const filtered = members.filter(a => seen.has(a));
            return filtered.length > 0 ? filtered : members;
        }

        if (roundGenerateType !== 'swipe' && roundGenerateType !== 'regenerate') {
            // Check Auto Summary
            if (settings.autoSummaryEnabled && settings.summaryEnabled) {
                const interval = settings.autoSummaryInterval || 10;
                if (sumLen === 0 && chat_metadata[EXT_KEY]._autoSumLen === undefined && legacyLen === undefined) {
                    console.log('[GD-auto-sum] path: first-enable currentLen=', currentLen);
                    if (currentLen >= interval) {
                        try {
                            log(`Auto-summary: first enable, ${currentLen} existing msgs`);
                            toastr?.info?.(lang === 'zh' ? `自动总结触发（检测到 ${currentLen} 条现有消息）...` : `Auto-summary (${currentLen} existing msgs)...`, '', { timeOut: 3000 });
                            await chatSummarySystem.generateSummary();
                            await saveSumLen(currentLen);
                            toastr?.success?.(lang === 'zh' ? '自动总结完成' : 'Auto-summary done', '', { timeOut: 2000 });
                        } catch (e) { log('Auto-summary failed:', e.message); }
                    } else {
                        await saveSumLen(currentLen);
                    }
                } else if (currentLen < sumLen) {
                    console.log('[GD-auto-sum] path: deletion');
                    await saveSumLen(currentLen);
                    toastr?.warning?.(lang === 'zh' ? '检测到消息被删除，自动总结计数器已重置。' : 'Messages deleted. Auto-summary counter reset.', '', { timeOut: 8000 });
                } else {
                    const newMsgs = currentLen - sumLen;
                    console.log('[GD-auto-sum] path: normal newMsgs=', newMsgs, 'interval=', interval);
                    if (newMsgs >= interval) {
                        try {
                            log(`Auto-summary triggered (${newMsgs} msgs)`);
                            toastr?.info?.(lang === 'zh' ? `自动总结触发（${newMsgs} 条新消息）...` : `Auto-summary (${newMsgs} msgs)...`, '', { timeOut: 3000 });
                            await chatSummarySystem.generateSummary();
                            await saveSumLen(currentLen);
                            toastr?.success?.(lang === 'zh' ? '自动总结完成' : 'Auto-summary done', '', { timeOut: 2000 });
                        } catch (e) { log('Auto-summary failed:', e.message); }
                    }
                }
            }

            // Check Auto Memory
            if (settings.autoMemoryEnabled && settings.memoryEnabled) {
                const interval = settings.autoMemoryInterval || 10;
                if (memLen === 0 && chat_metadata[EXT_KEY]._autoMemLen === undefined && legacyLen === undefined) {
                    console.log('[GD-auto-mem] path: first-enable currentLen=', currentLen);
                    if (currentLen >= interval) {
                        try {
                            log(`Auto-memory: first enable, ${currentLen} existing msgs`);
                            toastr?.info?.(lang === 'zh' ? `自动记忆提取触发（检测到 ${currentLen} 条现有消息）...` : `Auto-memory (${currentLen} existing msgs)...`, '', { timeOut: 3000 });
                            const g = getCurrentGroup();
                            const members = g ? g.members.filter(a => !g.disabled_members?.includes(a)) : [];
                            const targets = resolveMemoryTargets(members, interval);
                            if (targets.length < members.length) {
                                log(`Auto-memory: speakers filter ${targets.length}/${members.length} chars`);
                            }
                            const memoryRun = await runAutoMemoryBatch(targets, interval);
                            if (!memoryRun.complete) throw new Error('Auto-memory incomplete');
                            await saveMemLen(currentLen);
                            toastr?.success?.(lang === 'zh' ? '自动记忆提取完成' : 'Auto-memory done', '', { timeOut: 2000 });
                        } catch (e) { log('Auto-memory failed:', e.message); }
                    } else {
                        await saveMemLen(currentLen);
                    }
                } else if (currentLen < memLen) {
                    console.log('[GD-auto-mem] path: deletion');
                    for (const target of Object.keys(memoryCoverage)) {
                        memoryCoverage[target] = Math.min(Number(memoryCoverage[target]) || 0, currentLen);
                    }
                    await saveMemLen(currentLen);
                    toastr?.warning?.(lang === 'zh' ? '检测到消息被删除，自动记忆计数器已重置。' : 'Messages deleted. Auto-memory counter reset.', '', { timeOut: 8000 });
                } else {
                    const newMsgs = currentLen - memLen;
                    console.log('[GD-auto-mem] path: normal newMsgs=', newMsgs, 'interval=', interval);
                    if (newMsgs >= interval) {
                        try {
                            log(`Auto-memory triggered (${newMsgs} msgs)`);
                            toastr?.info?.(lang === 'zh' ? `自动记忆提取触发（${newMsgs} 条新消息）...` : `Auto-memory (${newMsgs} msgs)...`, '', { timeOut: 3000 });
                            const g = getCurrentGroup();
                            const members = g ? g.members.filter(a => !g.disabled_members?.includes(a)) : [];
                            const targets = resolveMemoryTargets(members, interval);
                            if (targets.length < members.length) {
                                log(`Auto-memory: speakers filter ${targets.length}/${members.length} chars`);
                            }
                            const memoryRun = await runAutoMemoryBatch(targets, interval);
                            if (!memoryRun.complete) throw new Error('Auto-memory incomplete');
                            await saveMemLen(currentLen);
                            toastr?.success?.(lang === 'zh' ? '自动记忆提取完成' : 'Auto-memory done', '', { timeOut: 2000 });
                        } catch (e) { log('Auto-memory failed:', e.message); }
                    }
                }
            }

            // Check Auto Critique
            if (settings.autoCritiqueEnabled && settings.critiqueEnabled) {
                const interval = settings.autoCritiqueInterval || 10;
                try {
                    const action = await critiqueAutoCoordinator.run({
                        interval,
                        legacyLength: legacyLen,
                        beforeExecute: ({ newMessages, firstEnable }) => {
                            const detail = firstEnable ? `${currentLen} existing msgs` : `${newMessages} msgs`;
                            log(`Auto-critique triggered (${detail})`);
                            toastr?.info?.(lang === 'zh'
                                ? `自动批判触发（${firstEnable ? `${currentLen} 条现有消息` : `${newMessages} 条新消息`}）...`
                                : `Auto-critique (${detail})...`, '', { timeOut: 3000 });
                        },
                    });
                    if (action.type === 'execute') {
                        toastr?.success?.(lang === 'zh' ? '自动批判完成' : 'Auto-critique done', '', { timeOut: 2000 });
                    } else if (action.type === 'reset') {
                        toastr?.warning?.(lang === 'zh' ? '检测到消息被删除，自动批判计数器已重置。' : 'Messages deleted. Auto-critique counter reset.', '', { timeOut: 8000 });
                    }
                } catch (e) {
                    log('Auto-critique failed:', e.message);
                }
            }

            // ─── Auto Custom Agents ────────────────────────
            const caInstances = (settings.customAgents || []).filter(a => a.enabled && a.autoEnabled);
            const caActions = planCustomAgentAutoRuns({
                instances: caInstances,
                currentLength: currentLen,
                counters: chat_metadata[EXT_KEY],
                getLatestRangeEnd: id => customAgentSystem.getData(id)?.rangeEnd ?? 0,
                legacyLength: legacyLen,
            });
            for (const action of caActions) {
                const inst = action.instance;
                try {
                    if (action.type === 'execute') {
                        log(`[GD-auto-ca] "${inst.name}" triggered (${action.newMessages} msgs)`);
                        toastr?.info?.(lang === 'zh' ? `"${inst.name}" 自动触发（${action.newMessages} 条消息）...` : `"${inst.name}" auto (${action.newMessages} msgs)...`, '', { timeOut: 3000 });
                        const result = await customAgentSystem.executeAuto(inst, action.currentLength);
                        if (!result) throw new Error('Custom agent returned no result');
                        toastr?.success?.(lang === 'zh' ? `"${inst.name}" 完成` : `${inst.name} done`, '', { timeOut: 2000 });
                    } else {
                        await customAgentSystem.setAutoCounter(inst.id, action.currentLength);
                        if (action.type === 'reset') {
                            toastr?.warning?.(lang === 'zh' ? `检测到消息被删除，"${inst.name}" 计数器已重置。` : `Msgs deleted. "${inst.name}" counter reset.`, '', { timeOut: 8000 });
                        }
                    }
                } catch (e) {
                    log(`[GD-auto-ca] "${inst.name}" failed:`, e.message);
                }
            }

        }
    }
});

// When messages are deleted, the chat timeline has rolled back.
// All in-memory runtime state based on the old timeline is now invalid.
// Clear it BEFORE pruning history so no stale pointers linger.
eventSource.on(event_types.GENERATION_STOPPED, () => {
    generationStopped = true;
    // Always abort PostSpeech if running, even in MODE_OFF (cleanup must run regardless)
    if (postSpeechAbortController) {
        postSpeechAbortController.abort();
        log('PostSpeech round aborted by user');
    }
    if (postSpeechMessageAbortController) {
        postSpeechMessageAbortController.abort();
        log('PostSpeech message aborted by user');
    }
    if (directorAbortController) {
        directorAbortController.abort();
        log('Director LLM aborted by user');
    }
    if (settings.mode === MODE_OFF) return;
});

// ─── Script Executor: message trigger (independent of PostSpeech) ─────
eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, async (messageId, msgType) => {
    try {
        if (msgType && msgType !== 'normal' && msgType !== 'swipe' && msgType !== 'regenerate') return;
        const msg = chat[chat.length - 1];
        if (!msg || msg.is_user || msg.is_system || !msg.name || !msg.mes) return;
        if (String(msg.name).startsWith('_')) return;
        const char = characters?.find(c => c.name === msg.name);
        const group = getCurrentGroup();
        if (!group) return;
        scriptExecutorSystem.executeAll('message', {
            message: msg,
            character: char || null,
            chat, characters,
            group,
            settings,
            getContext,
        }).catch(err => log('[GD] Script executor (message): unexpected error', err));
    } catch (e) { /* isolated */ }
});

// ─── PostSpeech: multimodal policy after each character message ─────
eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, async (messageId, msgType) => {
    if (!settings.postSpeechMessageEnabled) return;
    if (msgType && msgType !== 'normal' && msgType !== 'swipe' && msgType !== 'regenerate') return;

    const msg = chat[chat.length - 1];
    if (!msg || msg.is_user || msg.is_system || !msg.name || !msg.mes) return;
    if (String(msg.name).startsWith('_')) return;

    // Dedup: same message index, don't trigger twice.
    const msgIndex = chat.length - 1;
    const isReroll = roundGenerateType === 'swipe' || roundGenerateType === 'regenerate';
    if (!isReroll && msgIndex === postSpeechLastMsgIndex) return;
    postSpeechLastMsgIndex = msgIndex;

    const group = getCurrentGroup();
    if (!group) return;

    const agent = AgentRegistry.get('post-speech');
    if (!agent) return;

    // Brief notification while PostSpeech processes
    if (typeof toastr !== 'undefined') {
        toastr.info('PostSpeech analyzing...', '', { timeOut: 10000 });
    }

    // Per-message PostSpeech uses its own AbortController so user-Stop can cut
    // the render prompt (including slow providers) mid-flight.
    postSpeechMessageAbortController = new AbortController();

    try {
        const charName = msg.name || '';
        const char = characters.find(c => c.name === charName);
        const agentConfig = settings.agentConfigs?.['post-speech'] || {};
        // Inject mode-specific prompt via config — agent prompt() reads from config.postSpeechPrompt
        const modeConfig = { ...settings, postSpeechPrompt: settings.postSpeechMessagePrompt || undefined };
        const stGenerateRaw = (opts) => getContext().generateRaw(opts);
        const caller = createCaller(
            agentConfig,
            stGenerateRaw,
            () => getContext().stopGeneration()
        );

        const pool = buildContextPool({
            group,
            speakerMessage: msg.mes || '',
            speakerName: charName,
            speakerDescription: char?.description || '',
            postSpeechMode: 'message',
        });

        const callCfg = {
            ...agentConfig.call,
            signal: postSpeechMessageAbortController.signal,
            onRetry: ({ attempt, maxRetries }) => {
                log(`PostSpeech retry ${attempt}/${maxRetries}`);
            },
        };

        const response = await execute(agent, {
            pool,
            caller,
            config: { ...modeConfig, call: callCfg, enableTrace: settings.debugLogging },
        });

        // Dedup: skip if no new capabilities would be triggered.
        // For swipe/regenerate, allow re-analysis (message content changed).
        if (!isReroll) {
            const enabledCaps = CapabilityRegistry.listForMode('message').map(c => c.id);
            const allAlreadyExecuted = enabledCaps.every(cid =>
                postSpeechSystem.wasExecuted(msgIndex, cid) ||
                postSpeechSystem.isPending(msgIndex, cid) ||
                isPostSpeechIntentQueued(msgIndex, cid));
            if (allAlreadyExecuted) {
                log('PostSpeech: all capabilities already executed for message', msgIndex);
                return;
            }
        }

        // response is the raw LLM text; parse it
        if (!response) return;
        const policy = agent.parseResponse(response);
        if (!policy || !policy.intents?.length) return;

        log('PostSpeech policy:', policy);

        // Only execute intents that haven't been done yet
        const freshIntents = policy.intents.filter(i =>
            !postSpeechSystem.wasExecuted(msgIndex, i.type) &&
            !postSpeechSystem.isPending(msgIndex, i.type) &&
            !isPostSpeechIntentQueued(msgIndex, i.type)
        );
        if (!freshIntents.length) { log('PostSpeech: all intents already executed'); return; }

        // Run executor with filtered intents
        const timing = settings.postSpeechTiming || 'message';
        const intentContexts = freshIntents.map(intent => ({
            messageIndex: msgIndex,
            messageName: msg.name || '?',
            intent,
            policy,
        }));

        let activeContexts = intentContexts;
        let queuedByPolicy = false;
        if (timing === 'message' || timing === 'both') {
            const reservation = postSpeechSystem.reserveExecution(intentContexts);
            if (!reservation.contexts.length) return;
            activeContexts = reservation.contexts;
            let trackingStarted = false;
            try {
                const execResult = await postSpeechExecutor.run(
                    { ...policy, intents: activeContexts.map(context => context.intent) },
                    CapabilityRegistry.listExecutableForMode('message')
                );
                if (execResult.deferred.length) {
                    enqueuePostSpeechRoundJob(activeContexts, execResult.deferred);
                    reservation.release();
                    queuedByPolicy = true;
                    log(`PostSpeech: policy deferred ${activeContexts.length} intents to round end`);
                } else {
                    trackingStarted = true;
                    await postSpeechSystem.trackExecution(execResult, activeContexts, reservation);
                }
                log('PostSpeech execution (message):', execResult);
            } catch (error) {
                if (!trackingStarted) reservation.release();
                throw error;
            }
        }

        // Queue for round-end execution (round | both modes)
        if ((timing === 'round' || timing === 'both') && !queuedByPolicy) {
            enqueuePostSpeechRoundJob(activeContexts, [], timing === 'both');
            log(`PostSpeech: queued ${activeContexts.length} intents for round end (queue=${countQueuedPostSpeechIntents()})`);
        }

        // Done notification
        if (typeof toastr !== 'undefined') {
            toastr.success('PostSpeech done', '', { timeOut: 2000 });
        }
    } catch (e) {
        // PostSpeech failure never interrupts the conversation
        log('PostSpeech skipped:', e.message);
    } finally {
        if (postSpeechMessageAbortController) {
            const wasAborted = postSpeechMessageAbortController.signal.aborted;
            postSpeechMessageAbortController = null;
            if (wasAborted) log('PostSpeech message aborted by user');
        }
    }
});

// ───

eventSource.on(event_types.MESSAGE_DELETED, async (newChatLength) => {
    customAgentSystem.invalidateExecutions();
    roundScores = {};
    roundSpeakerCount = 0;
    roundTriggeredAvatars.clear();
    roundInitiative = {};
    llmPickedAvatars = null;
    llmPickedSet = null;
    llmSpokenSet = new Set();
    llmCursor = 0;
    roundInitialized = false;
    initPromise = null;
    generationStopped = false;
    roundOrchestrator.reset();
    manualGenInProgress = false;
    directorScripts = {};
    wiState.text = '';
    wiState.entries = [];
    scriptCounterSnapshots.clear();
    if (chat_metadata[EXT_KEY]) delete chat_metadata[EXT_KEY]._counterSnapshots;
    await pruneDirectorHistory();
    await chatSummarySystem.pruneSummaries();
    await postSpeechSystem.pruneAfter(newChatLength - 1);
    window.__gdRefreshVariables?.();
    window.__gdRefreshDashboard?.();
});

eventSource.on(event_types.CHAT_CHANGED, async () => {
    invalidatePostSpeechRoundQueue();
    postSpeechSystem.resetPending();
    customAgentSystem.invalidateExecutions();
    profileLibrarySystem.resetAutoLoadDedup?.();
    log('CHAT_CHANGED — pruning ledger and summaries for branch/fork');
    await pruneDirectorHistory();
    await chatSummarySystem.pruneSummaries();
    await critiqueSystem.pruneCritiques();
    // Reset auto-check counter on chat change
    if (chat_metadata[EXT_KEY]) {
        delete chat_metadata[EXT_KEY]._autoCheckLength;
        delete chat_metadata[EXT_KEY]._autoSumLen;
        delete chat_metadata[EXT_KEY]._autoMemLen;
        delete chat_metadata[EXT_KEY]._autoMemCharLen;
        delete chat_metadata[EXT_KEY]._autoCritiqueLen;
        // Clean up custom agent auto counters
        for (const key of Object.keys(chat_metadata[EXT_KEY])) {
            if (key.startsWith('_autoCAG_')) delete chat_metadata[EXT_KEY][key];
        }
    }
    postSpeechRoundRan = false;
    scriptExecutorRoundRan = false;
    if (settings.profileEnabled) {
        profileLibrarySystem.autoLoadForCurrentGroup('chat-changed')
            .then((result) => {
                if (result?.applied > 0) {
                    toastr.info(`Auto-loaded ${result.applied} profile(s)`);
                    window.__gdRefreshProfileLibrary?.();
                    window.__gdRefreshDashboard?.();
                }
            })
            .catch(e => console.warn('[GroupDirector] Profile library auto-load failed:', e.message || e));
    }
    window.__gdRefreshVariables?.();
    window.__gdRefreshDashboard?.();
});

// ─── Manual Ordered Generation (takeover) ─────────────────────────────
let manualGenInProgress = false;
async function runManualOrderedGeneration() {
    manualGenInProgress = true;
    roundOrchestrator.setPending(false);
    const schedule = roundOrchestrator.beginTakeover(llmPickedAvatars, {
        knownAvatars: new Set(characters.map(character => character.avatar)),
    });
    const orderedList = schedule.queue.map(step => step.avatar);
    const ctx = getContext();
    const savedChId = ctx.characterId;
    const savedChName = characters[savedChId]?.name || '';

    console.warn('[GroupDirector] TAKEOVER START — orderedList:', orderedList.map(a => characters.find(c => c.avatar === a)?.name));
    console.warn('[GroupDirector] takeoverRemaining:', roundOrchestrator.getSnapshot().takeoverRemaining);

    try {
        for (let i = 0; i < orderedList.length; i++) {
            const avatar = orderedList[i];
            const chId = characters.findIndex(c => c.avatar === avatar);
            if (chId === -1) {
                const remaining = roundOrchestrator.skipTurn();
                console.warn('[GroupDirector] SKIP unknown avatar, takeoverRemaining→', remaining);
                continue;
            }
            setCharacterId(chId);
            setCharacterName(characters[chId].name);
            // Validate: the context must now point to the character we intend to generate
            const verifyChId = getContext().characterId;
            const verifyAvatar = characters[verifyChId]?.avatar;
            if (verifyAvatar !== avatar) {
                console.error(`[GroupDirector] VALIDATION FAILED: takeover set chId=${chId} for avatar=${avatar}, but context has chId=${verifyChId} avatar=${verifyAvatar} — aborting this speaker`);
                roundOrchestrator.skipTurn();
                continue;
            }
            console.warn(`[GroupDirector] GEN #${i + 1}: ${characters[chId].name} (chId=${chId}, takeoverRemaining=${roundOrchestrator.getSnapshot().takeoverRemaining})`);

            // Inject per-character director script with order context.
            // Use original plan position so retries/skips don't shift the index.
            const origPos = llmPickedAvatars.indexOf(avatar);
            const charScript = await getScriptForChar(characters[chId].name, {
                speakerIndex: origPos + 1,
                speakerIndex0: origPos,
                speakerCount: llmPickedAvatars.length,
            });
            if (charScript) {
                setExtensionPrompt(DIRECTOR_SCRIPT_KEY, charScript, getScriptPosition(), 0, true);
            }
            try {
                // Re-set character identity right before generation, in case
                // something between setCharacterId and here mutated this_chid
                setCharacterId(chId);
                setCharacterName(characters[chId].name);
                // Small delay for SillyDroid / WebView compatibility:
                // ensures the JS bridge and async character context settle
                // before ST's nested generateGroupWrapper cycles characters.
                await new Promise(r => setTimeout(r, 150));
                await ctx.generate('normal', { force_chid: chId });
                // Post-generation: log full message snapshot for identity diagnostics
                if (chat.length > 0) {
                    const lastMsg = chat[chat.length - 1];
                    const expectedName = characters[chId]?.name || '?';
                    if (lastMsg && !lastMsg.is_user && !lastMsg.is_system) {
                        console.log(`[GroupDirector] POST-GEN #${i + 1}: expected="${expectedName}" actual="${lastMsg.name}" mes=${(lastMsg.mes || '').substring(0, 80)} reasoning=${lastMsg.extra?.reasoning ? (lastMsg.extra.reasoning.substring(0, 80) + '...') : 'none'} swipes=${lastMsg.swipes?.length || 0}`);
                        if (lastMsg.name !== expectedName) {
                            console.error(`[GroupDirector] POST-GEN MISMATCH: expected "${expectedName}" but got "${lastMsg.name}" — identity swapped!`);
                        }
                    }
                }
                console.warn(`[GroupDirector] GEN #${i + 1} DONE: ${characters[chId].name}`);
                roundOrchestrator.markCompleted(avatar);
            } catch (e) {
                console.error('[GroupDirector] GEN FAILED:', e.message, e.stack);
                roundOrchestrator.markFailed();
                // Preserve llmPickedAvatars, llmPickedSet, directorScripts, roundInitialized
                // so a retry reuses the same director decision instead of making a new one.
                return;
            } finally {
                if (charScript) {
                    setExtensionPrompt(DIRECTOR_SCRIPT_KEY, '', getScriptPosition(), 0, true);
                }
            }
        }

        console.warn('[GroupDirector] TAKEOVER COMPLETE — all speakers generated');
    } finally {
        console.warn('[GroupDirector] TAKEOVER FINALLY — resetting flags');
        roundOrchestrator.finishTakeover();
        manualGenInProgress = false;
        // Restore the original character context so ST doesn't stay stuck
        // on the last generated character after takeover
        if (savedChId !== undefined && savedChId !== null) {
            setCharacterId(savedChId);
            setCharacterName(savedChName);
        }
    }
}

/**
 * Story Blueprint completion handling is deliberately isolated from Director
 * decision parsing so blueprint state errors do not discard a valid speaker plan.
 */
function handleStoryBlueprintAdvance(source = 'director') {
    let storyAdvance;
    try {
        storyAdvance = storyBlueprintSystem.consumeCompletionSignal(source);
    } catch (e) {
        console.warn('[GroupDirector] Story Blueprint advance failed:', e.message || e);
        toastr.error(e.message || (settings.lang === 'zh' ? '故事蓝图推进失败' : 'Story Blueprint advance failed'));
        window.__gdRefreshStoryBlueprint?.();
        window.__gdRefreshDashboard?.();
        return;
    }

    if (!storyAdvance.advanced) return;

    const done = storyAdvance.complete;
    toastr.info(done
        ? (settings.lang === 'zh' ? '当前故事蓝图已完成，请生成或续写新的蓝图。' : 'Story Blueprint complete. Generate or continue a blueprint.')
        : (settings.lang === 'zh' ? '故事蓝图已推进到下一块。' : 'Story Blueprint advanced to the next step.'));
    window.__gdRefreshStoryBlueprint?.();
    window.__gdRefreshDashboard?.();

    if (!done || !settings.storyBlueprintAutoContinue || storyBlueprintSystem.isGenerating()) return;

    let continuation;
    try {
        continuation = storyBlueprintSystem.generateBlueprint('continue');
    } catch (e) {
        toastr.error(e.message || (settings.lang === 'zh' ? '自动续写故事蓝图失败' : 'Failed to continue Story Blueprint'));
        window.__gdRefreshStoryBlueprint?.();
        window.__gdRefreshDashboard?.();
        return;
    }

    toastr.info(settings.lang === 'zh' ? '正在后台续写故事蓝图...' : 'Continuing Story Blueprint in the background...');
    continuation
        .then(() => {
            toastr.success(settings.lang === 'zh' ? '已自动续写故事蓝图' : 'Story Blueprint continued');
            window.__gdRefreshStoryBlueprint?.();
            window.__gdRefreshDashboard?.();
        })
        .catch((e) => {
            toastr.error(e.message || (settings.lang === 'zh' ? '自动续写故事蓝图失败' : 'Failed to continue Story Blueprint'));
            window.__gdRefreshStoryBlueprint?.();
            window.__gdRefreshDashboard?.();
        });
}

/**
 * Force-speak LLM takeover — now delegates to ForceSpeak agent.
 */
async function initForceSpeakLLM(char, avatar) {
    const group = getCurrentGroup();
    if (!group) return;
    if (!chat.length) return;

    const enabledMembers = group.members.filter(a => !group.disabled_members?.includes(a));
    if (!enabledMembers.includes(avatar)) return;

    // Build world info for force-speak context so character names are injected
    if (settings.llmWorldInfoEnabled) {
        try {
            const wi = await buildDirectorWorldInfo(enabledMembers);
            wiState.text = wi.text;
            wiState.entries = wi.entries;
        } catch (e) { /* non-critical */ }
    }

    const agent = AgentRegistry.get('force-speak');
    if (!agent) {
        console.warn('[GroupDirector] ForceSpeak agent not registered');
        return;
    }

    try {
        directorAbortController = new AbortController();

        const agentConfig = settings.agentConfigs?.['force-speak'] || {};
        const stGenerateRaw = (opts) => getContext().generateRaw(opts);
        const caller = createCaller(
            agentConfig,
            stGenerateRaw,
            () => getContext().stopGeneration()
        );

        const pool = buildContextPool({
            group,
            enabledMembers,
            forceSpeakChar: char,
            characterAvatar: avatar,
        });

        const callCfg = {
            ...agentConfig.call,
            signal: directorAbortController.signal,
            onRetry: ({ attempt, maxRetries }) => {
                toastr.warning(`ForceSpeak 重试中 (${attempt}/${maxRetries})...`);
            },
        };
        const response = await execute(agent, {
            pool,
            caller,
            config: { ...settings, call: callCfg, enableTrace: settings.debugLogging },
        });
        directorAbortController = null;

        // Clear QUIET_PROMPT
        setExtensionPrompt(inject_ids.QUIET_PROMPT, '', extension_prompt_types.IN_PROMPT, 0, true);

        if (!response || !Array.isArray(response.speakers) || response.speakers.length === 0) {
            log('Force-speak LLM returned no valid speakers');
            return;
        }

        const parsed = response;

        // Record to ledger with user message anchor — normalize speakers to names for ledger consistency
        if (settings.llmHistoryEnabled) {
            const forceSpeakName = parsed.names?.[0] || char?.name || parsed.speakers?.[0] || '?';
            await addToDirectorHistory({
                ...parsed,
                speakers: [forceSpeakName],
                names: [forceSpeakName],
            });
            const history = getDirectorHistory();
            if (history.length > 0) {
                let userAnchor = null;
                for (let i = chat.length - 1; i >= 0; i--) {
                    if (chat[i].is_user) {
                        userAnchor = chat[i].send_date || null;
                        break;
                    }
                }
                if (userAnchor) {
                    history[history.length - 1]._anchorDate = userAnchor;
                    await saveChatConditional();
                }
            }
        }

        if (parsed.variable_update) {
            const result = variableSystem.applyUpdates(parsed.variable_update, { source: 'force-speak' });
            if (result.applied || result.ignored) {
                log(`Variables updated: ${result.applied} applied, ${result.ignored} ignored`);
                window.__gdRefreshDashboard?.();
            }
        }
        handleStoryBlueprintAdvance('force-speak');

        // Extract script for this character
        let script = '';
        if (parsed.scripts && typeof parsed.scripts === 'object') {
            for (const [name, s] of Object.entries(parsed.scripts)) {
                const c = matchCharacterByName(name, enabledMembers);
                if (c && c.name === char.name && s) { script = s; break; }
            }
        }
        if (!script && parsed.script) script = parsed.script;

        if (script) {
            directorScripts[char.name] = script;
            const charScript = await getScriptForChar(char.name, {
                speakerIndex: 1, speakerIndex0: 0, speakerCount: 1,
            });
            if (charScript) {
                setExtensionPrompt(DIRECTOR_SCRIPT_KEY, charScript, getScriptPosition(), 0, true);
            }
        }

        log(`Force-speak LLM: generated script for ${char.name}`);
    } catch (e) {
        directorAbortController = null;
        if (generationStopped || e?.name === 'AbortError') {
            console.warn('[GroupDirector] Force-speak LLM aborted');
            return;
        }
        console.warn('[GroupDirector] Force-speak LLM failed:', e.message);
    }
}

async function initRoundWithLLM() {
    const group = getCurrentGroup();
    if (!group) return;

    const enabledMembers = group.members.filter(a => !group.disabled_members?.includes(a));
    const agent = AgentRegistry.get('director');
    if (!agent) {
        console.warn('[GroupDirector] Director agent not registered');
        return;
    }

    try {
        directorAbortController = new AbortController();

        const agentConfig = settings.agentConfigs?.['director'] || {};
        const stGenerateRaw = (opts) => getContext().generateRaw(opts);
        const caller = createCaller(
            agentConfig,
            stGenerateRaw,
            () => getContext().stopGeneration()
        );

        const pool = buildContextPool({ group, enabledMembers });

        const callCfg = {
            ...agentConfig.call,
            signal: directorAbortController.signal,
            onRetry: ({ attempt, maxRetries }) => {
                toastr.warning(`Director 重试中 (${attempt}/${maxRetries})...`);
            },
        };
        const parsed = await execute(agent, {
            pool,
            caller,
            config: { ...settings, call: callCfg, enableTrace: settings.debugLogging },
        });
        directorAbortController = null;

        // Clean up QUIET_PROMPT
        setExtensionPrompt(inject_ids.QUIET_PROMPT, '', extension_prompt_types.IN_PROMPT, 0, true);

        if (!parsed) {
            log('LLM returned no valid response');
            return;
        }

        if (parsed.variable_update) {
            const result = variableSystem.applyUpdates(parsed.variable_update, { source: 'director' });
            if (result.applied || result.ignored) {
                log(`Variables updated: ${result.applied} applied, ${result.ignored} ignored`);
                window.__gdRefreshDashboard?.();
            }
        }

        handleStoryBlueprintAdvance('director');

        if (!parsed.speakers?.length) {
            log('LLM returned no valid speakers');
            return;
        }

        const capped = parsed.speakers.slice(0, settings.llmMaxSpeakers);

        llmPickedAvatars = capped;
        llmPickedSet = new Set(capped);
        llmCursor = 0;
        directorLastReason = parsed.reason ?? '';

        // Save to history — preserve all LLM fields, with safe defaults for core fields
        if (settings.llmHistoryEnabled) {
            await addToDirectorHistory({
                ...parsed,
                speakers: parsed.names || capped.map(a => characters.find(c => c.avatar === a)?.name || '?'),
                reason: parsed.reason ?? '',
                scripts: parsed.scripts ?? {},
                loreAssignments: parsed.loreAssignments ?? {},
            });
        }

        // Store director scripts
        directorScripts = {};
        if (settings.llmScriptEnabled && parsed.scripts && typeof parsed.scripts === 'object') {
            for (const [name, script] of Object.entries(parsed.scripts)) {
                if (script && typeof script === 'string') {
                    const c = matchCharacterByName(name, enabledMembers);
                    if (c) directorScripts[c.name] = script;
                }
            }
        }

        // Takeover
        if (settings.llmRespectOrder) {
            roundOrchestrator.setPending(true);
            console.warn('[GroupDirector] TAKEOVER SET — picked:', capped.map(a => characters.find(c => c.avatar === a)?.name));
        }

        log('LLM picked order:', capped.map(a =>
            characters.find(c => c.avatar === a)?.name).join(' → '),
            parsed.reason ? `(${parsed.reason})` : '');

    } catch (e) {
        directorAbortController = null;
        if (generationStopped || e?.name === 'AbortError') {
            console.warn('[GroupDirector] Director LLM aborted by user');
            llmPickedSet = new Set();
            llmPickedAvatars = null;
            return;
        }
        console.error('[GroupDirector] Director LLM failed:', e.message || e);

        // Fallback: reuse last plan from history
        const history = getDirectorHistory();
        const lastPlan = history[history.length - 1];
        if (lastPlan && Array.isArray(lastPlan.speakers) && lastPlan.speakers.length > 0) {
            const recovered = recoverDirectorPlan(lastPlan, {
                enabledMembers,
                maxSpeakers: settings.llmMaxSpeakers,
                matchCharacterByName,
            });
            if (recovered) {
                llmPickedAvatars = recovered.avatars;
                llmPickedSet = new Set(recovered.avatars);
                directorScripts = recovered.scripts;
                if (settings.llmRespectOrder) roundOrchestrator.setPending(true);
                return;
            }
            toastr.warning('导演决策失败，正在复用上一轮决策...');
            console.warn('[GroupDirector] Director failed — reusing last plan from history');
            const avatars = [];
            for (const name of lastPlan.speakers) {
                const c = matchCharacterByName(name, enabledMembers);
                if (c) avatars.push(c.avatar);
            }
            if (avatars.length > 0) {
                llmPickedAvatars = avatars.slice(0, settings.llmMaxSpeakers);
                llmPickedSet = new Set(llmPickedAvatars);
                if (lastPlan.scripts && typeof lastPlan.scripts === 'object') {
                    directorScripts = {};
                    for (const [name, script] of Object.entries(lastPlan.scripts)) {
                        const c = matchCharacterByName(name, enabledMembers);
                        if (c) directorScripts[c.name] = script;
                    }
                }
                if (settings.llmRespectOrder) roundOrchestrator.setPending(true);
                return;
            }
        }

        toastr.error('导演决策失败，且无历史记录。请检查网络后重试。');
        llmPickedSet = new Set();
    }
}

// parseLlmResponse, extractJsonObject, sanitizeJson — now in utils/json-utils.js

/**
 * Match a name from LLM output to a group member character.
 * Tries exact match first, then case-insensitive, then substring (longest wins).
 * Returns the character object or null.
 */
function matchCharacterByName(name, enabledMembers) {
    if (!name || typeof name !== 'string') return null;

    const trimmed = name.trim();
    if (!trimmed) return null;

    // 1. Exact match (case-sensitive)
    for (const avatar of enabledMembers) {
        const c = characters.find(c => c.avatar === avatar);
        if (c && c.name === trimmed) return c;
    }

    // 2. Case-insensitive exact match
    const lower = trimmed.toLowerCase();
    for (const avatar of enabledMembers) {
        const c = characters.find(c => c.avatar === avatar);
        if (c && c.name.toLowerCase() === lower) return c;
    }

    // 3. Substring match — character name contains the LLM name or vice versa
    let best = null;
    let bestLen = 0;
    for (const avatar of enabledMembers) {
        const c = characters.find(c => c.avatar === avatar);
        if (!c) continue;
        const cLower = c.name.toLowerCase();
        if (cLower.includes(lower) || lower.includes(cLower)) {
            if (c.name.length > bestLen) {
                best = c;
                bestLen = c.name.length;
            }
        }
    }

    return best;
}

function getDefaultLlmPrompt() {
    // Context at TOP — instruction/format at BOTTOM for maximum adherence in long contexts
    let base = `{{worldInfo}}{{previousPlans}}{{previousPlan}}Recent messages:
{{newRecentMessages}}

Available characters:
{{characters}}

Character profiles (detailed analysis):
{{character_profiles}}

Character memories (recent experiences):
{{charMemory}}

NPCs in the current scene (for context only — do NOT pick these as speakers):
{{npcList}}

---
You are a Group Chat Director. Decide which characters should respond next, and in what order.

CRITICAL: Only pick speakers from "Available characters" above. NPCs are NOT valid speakers — they appear in "NPCs in the current scene" for context only. Picking an NPC name as a speaker is an error.

Rules:
- Pick at most {{maxSpeakers}} character(s) from "Available characters" ONLY.
- Order them by who should speak FIRST, SECOND, etc.
- Only pick characters who have a meaningful reason to respond now.
- It is OK to pick just one character if only one fits.`;

    if (settings.llmScriptEnabled) {
        base += `
- Also write a SHORT stage direction for EACH picked character. The script tells the character HOW to act, not WHAT to say.
- Write scripts in imperative stage-direction style (e.g. "你紧张地搓着手，不敢直视对方"). Do NOT write long prose or dialogue.
- The character will see ONLY their own script, NOT the full plan. They are instructed to follow it without revealing its existence.`;

        if (settings.llmScriptPrompt) {
            base += `\n- Script theme / requirements: ${settings.llmScriptPrompt}`;
        }
    }

    // World book lore assignments — let director decide which lore entries
    // each character needs, based on the available world book inventory below.
    base += `

Available world book entries (you may assign relevant ones to each character):
{{worldBookImportance}}

For EACH picked character, optionally assign relevant world book entries
by their exact displayed names. Use the "loreAssignments" field.
Only assign entries that are actually relevant to that character's current situation.
It is OK to assign none (empty array) or different entries to different characters.`;

    base += `

{{variableMaintenance}}`;

    base += `

{{storyBlueprintCurrent}}`;

    base += '\n\n{{llmJsonSchema}}';
    return base;
}

function buildJsonSchema() {
    const scriptField = settings.llmScriptEnabled
        ? ',\n  "scripts": {\n    "NameOfFirstSpeaker": "short imperative stage direction",\n    "NameOfSecondSpeaker": "short imperative stage direction"\n  }'
        : '';
    const storyBlueprintDoneField = settings.storyBlueprintEnabled
        ? `\n      "${storyBlueprintSystem.getCompletionVariable()}": false\n    `
        : '';
    const schema = settings.llmJsonSchema ?? DEFAULT_SETTINGS.llmJsonSchema;
    return schema
        .replace(/\{\{scriptField\}\}/g, scriptField)
        .replace(/\{\{storyBlueprintDoneField\}\}/g, storyBlueprintDoneField)
        .replace(/\{\{llmJsonSchema\}\}/g, '');
}


// ─── Slash Commands ───────────────────────────────────────────────────
// TODO: Register slash commands for manual director control

// ─── Register Built-in Providers ──────────────────────────────────────
registerRecentMessages();
registerCharacters(settings, characters, buildCharacterProfilesText);
registerCharacterProfiles(buildCharacterProfilesText, getProfiles);

// MaxSpeakersProvider — kept inline (single-line, no deps needed)
registerProvider({
    id: 'maxSpeakers',
    placeholder: '{{maxSpeakers}}',
    render: (ctx) => ({ content: String(ctx.maxSpeakers || 1) }),
});

// ScriptField — expands to scripts JSON fragment or empty based on llmScriptEnabled
registerProvider({
    id: 'scriptField',
    placeholder: '{{scriptField}}',
    render: () => {
        const enabled = settings.llmScriptEnabled;
        return {
            content: enabled
                ? ',\n  "scripts": {\n    "NameOfFirstSpeaker": "short imperative stage direction",\n    "NameOfSecondSpeaker": "short imperative stage direction"\n  }'
                : '',
            data: { enabled },
        };
    },
});

// StoryBlueprintDoneField — expands inside variable_update.global when Story Blueprint is enabled.
registerProvider({
    id: 'storyBlueprintDoneField',
    placeholder: '{{storyBlueprintDoneField}}',
    render: () => {
        const enabled = settings.storyBlueprintEnabled;
        const variableName = storyBlueprintSystem.getCompletionVariable();
        return {
            content: enabled
                ? `\n      "${variableName}": false\n    `
                : '',
            data: { enabled, variableName },
        };
    },
});

// LlmJsonSchema — user-customizable JSON output format template
registerProvider({
    id: 'llmJsonSchema',
    placeholder: '{{llmJsonSchema}}',
    render: () => ({ content: buildJsonSchema() }),
});

registerWorldInfoProvider(settings, wiState, buildDirectorWorldInfo);
registerHistoryProviders(settings, getDirectorHistory);
registerDirectorLedger(settings, getDirectorHistory);
registerVariables({ variableSystem });
registerStoryBlueprint({ settings, storyBlueprintSystem });
registerTestProvider();
registerWorldBooks(worldBookScanner);
registerWorldBookImportance(worldBookScanner, () => settings.worldBookMaxEntries);
registerGdWorldBooks(worldBookScanner);
registerCharacterLore(getDirectorHistory);
registerSystemTime(settings);
registerRandomDice();
registerDice();
registerMoonPhase(settings);
registerTimeOfDay(settings);
registerKnowledge(settings);
registerChatSummary(() => chatSummarySystem.getActiveSummaryText());
registerImportedSummary(() => summaryExportSystem.renderEnabledSummaries());
registerImportedCritique(() => critiqueExportSystem.renderEnabledCritiques());
registerDirectorCritique(() => critiqueSystem.getActiveDirectorCritiqueText());
registerCharacterCritique(() => critiqueSystem.getActiveCharacterCritiqueData());
registerCharCritique(() => critiqueSystem.getActiveCharacterCritiqueData());
registerIdentity(settings);
registerCharMemory({
    getMemoriesForAll: () => {
        const result = {};
        const stats = memorySystem.getStats();
        for (const [av, s] of Object.entries(stats)) {
            const mems = memorySystem.listMemories(av);
            if (mems.length) result[s.name || av] = mems;
        }
        return result;
    },
    getMemoriesForChar: async (name) => {
        const char = characters.find(c => c.name === name);
        const avatar = char?.avatar;
        // 1. Exact avatar match
        if (avatar) {
            const mems = memorySystem.listMemories(avatar);
            if (mems.length > 0) return mems;
        }
        // 2. Exact name match in stats
        const stats = memorySystem.getStats();
        for (const [av, s] of Object.entries(stats)) {
            if (s.name === name) return memorySystem.listMemories(av);
        }
        // 3. Fuzzy match: avatar or name is a substring of the other
        for (const [av, s] of Object.entries(stats)) {
            if (!s.name || s.name === name) continue;
            const a = s.name.toLowerCase(), b = name.toLowerCase();
            if (a.includes(b) || b.includes(a)) {
                const mems = memorySystem.listMemories(av);
                if (mems.length > 0) {
                    // Auto-migrate: move memories to the current avatar key and clean old
                    if (avatar && av !== avatar) {
                        if (typeof memorySystem._setMemories !== 'function' || typeof memorySystem._deleteKey !== 'function') {
                            console.warn('[charMemory] _setMemories/_deleteKey not available, skipping auto-migration');
                            return mems;
                        }
                        const existing = memorySystem.listMemories(avatar);
                        await memorySystem._setMemories(avatar, [...existing, ...mems]);
                        await memorySystem._deleteKey(av);
                        log(`[charMemory] auto-migrated ${mems.length} memories: "${av}" → "${avatar}"`);
                    }
                    return avatar ? memorySystem.listMemories(avatar) : mems;
                }
            }
        }
        return [];
    },
    log,
});
registerNewRecentMessages(settings, getChat, () => chatSummarySystem.getLatestActive());
registerNpcList(() => npcSystem.getNpcs());
customAgentSystem.refreshProviders();

// ─── Init ─────────────────────────────────────────────────────────────
eventSource.on(event_types.APP_READY, async () => {
    const deps = {
        settings, EXT_KEY, chat_metadata, saveChatConditional, saveSettings,
        getCurrentGroup, getDefaultLlmPrompt, generateProfilesBatch, getProfiles,
        getDefaultProfileGeneratorPrompt, getDefaultProfileSchema, getDefaultProfileRenderTemplate,
        refreshProfileManagementUI, checkProfileStartupStatus, buildProfileLoaderPanel,
        detectCharacterChanges, validateAndWarnProfilePlaceholders,
        toastr, world_names, loadWorldInfo, renderPrompt, worldBookScanner,
        getDirectorHistory, updateEntry, clearEntry,
        isRoundActive: () => isGroupChat,
        onLatestEntryEdited: () => { llmPickedSet = null; },
        summarySystem: chatSummarySystem,
        critiqueSystem,
        customAgentSystem,
        getChat: () => chat,
        getCharacters: () => characters,
        exportGroup,
        importGroup,
        AgentRegistry,
        AgentTrace,
        createCaller,
        getContext,
        npcSystem,
        CapabilityRegistry,
        postSpeechSystem,
        userProviderLoader,
        memorySystem,
        exportProfiles, parseImportFile, applyImport, loadPreset, getPresetNames,
        profileLibrarySystem,
        exportNpcs, parseNpcImportFile, applyNpcImport, loadNpcPreset, getNpcPresetNames,
        npcLibrarySystem,
        summaryExportSystem,
        critiqueExportSystem,
        memoryExportSystem,
        configProfileSystem,
        getConfigPresetNames, loadConfigPreset,
        customPromptsSystem,
        scriptExecutorSystem,
        variableSystem,
        storyBlueprintSystem,
        storyBlueprintLibrarySystem,
    };
    await loadSettingsUI(deps);
    if (settings.profileEnabled) {
        profileLibrarySystem.autoLoadForCurrentGroup('app-ready')
            .then((result) => {
                if (result?.applied > 0) {
                    toastr.info(`Auto-loaded ${result.applied} profile(s)`);
                    window.__gdRefreshProfileLibrary?.();
                    window.__gdRefreshDashboard?.();
                }
            })
            .catch(e => console.warn('[GroupDirector] Profile library auto-load failed:', e.message || e));
    }
    // Restore user-imported providers and capabilities from persistent storage.
    // Inject window.GroupDirector so user modules don't need relative imports.
    CapabilityRegistry._scopeOverrides = settings._capabilityScopes || {};
    const userDeps = { log, CapabilityRegistry, registerProvider: (p) => registerProvider(p) };
    await userProviderLoader.restoreAll('provider', userDeps);
    await userProviderLoader.restoreAll('capability', userDeps);

    // Hook capability toggle to persist enabled state.
    // Always replace the monkey-patch so closure captures current settings/saveSettingsDebounced on hot reload.
    if (!CapabilityRegistry._gdOrigSetEnabled) {
        CapabilityRegistry._gdOrigSetEnabled = CapabilityRegistry.setEnabled.bind(CapabilityRegistry);
    }
    CapabilityRegistry.setEnabled = function (id, enabled) {
        CapabilityRegistry._gdOrigSetEnabled(id, enabled);
        userProviderLoader.persistCapabilityEnabled().catch(e => console.warn('[GroupDirector] Capability state save failed:', e.message || e));
        try {
            if (!settings._builtinCapEnabled) settings._builtinCapEnabled = {};
            settings._builtinCapEnabled[id] = enabled;
            saveSettingsDebounced();
        } catch (_) { }
    };
    // Restore built-in capability enabled states from previous session
    const builtinCaps = settings._builtinCapEnabled || {};
    for (const [id, enabled] of Object.entries(builtinCaps)) {
        try { CapabilityRegistry.setEnabled(id, enabled); } catch (_) { }
    }
    // Persist capability scopes for built-in and user-imported capabilities.
    if (!CapabilityRegistry._gdOrigSetScope) {
        CapabilityRegistry._gdOrigSetScope = CapabilityRegistry.setScope.bind(CapabilityRegistry);
    }
    CapabilityRegistry.setScope = function (id, scope) {
        CapabilityRegistry._gdOrigSetScope(id, scope);
        try {
            if (!settings._capabilityScopes) settings._capabilityScopes = {};
            settings._capabilityScopes[id] = scope;
            CapabilityRegistry._scopeOverrides[id] = scope;
            saveSettingsDebounced();
        } catch (_) { }
    };
    const capabilityScopes = settings._capabilityScopes || {};
    for (const [id, scope] of Object.entries(capabilityScopes)) {
        try { CapabilityRegistry.setScope(id, scope); } catch (_) { }
    }
    customPromptsSystem.initAll();
    // Warn about settings keys not covered by any config profile drawer
    const uncovered = configProfileSystem.getUncoveredKeys();
    if (uncovered.length) {
        console.warn(`[GroupDirector] ${uncovered.length} setting(s) not in any export drawer:`, uncovered.join(', '));
    }
    console.log(`Group World extension loaded (mode=${settings.mode})`);

    // 暴露重载入口：应用配置档后无需刷新页面即可生效（重渲染设置面板 + 重注册 user providers）
    window.__gdReloadExtension = async () => {
        await reloadSettingsUI(deps);
        // Keep the renderer's provider timeout default in sync after hot-reload.
        setProviderTimeoutDefault(extension_settings[EXT_KEY]?.providerTimeoutMs ?? 10000);
        customPromptsSystem.initAll();
        const ud = { log, CapabilityRegistry, registerProvider: (p) => registerProvider(p) };
        await userProviderLoader.restoreAll('provider', ud);
        await userProviderLoader.restoreAll('capability', ud);
    };
});
