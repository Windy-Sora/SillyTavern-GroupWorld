import { eventSource, event_types } from '../../../events.js';
import { extension_settings, getContext } from '../../../extensions.js';
import { saveSettingsDebounced, chat_metadata, saveChatConditional, characters, chat, setCharacterId, setCharacterName, setExtensionPrompt, extension_prompt_types } from '../../../../script.js';
import { callGenericPopup, POPUP_TYPE } from '../../../popup.js';
import { inject_ids } from '../../../constants.js';
import { groups, selected_group } from '../../../group-chats.js';
import { checkWorldInfo, world_info_include_names, world_names, loadWorldInfo, selected_world_info, world_info } from '../../../world-info.js';
import { power_user } from '../../../power-user.js';
import { EXT_KEY, MODE_OFF, MODE_FORMULA, MODE_LLM, DEFAULT_SETTINGS } from './settings.js';
import { registerProvider, unregisterProvider, getProviders, getAvailablePlaceholders } from './provider-registry.js';
import { renderPrompt } from './prompt-renderer.js';
import { parseLlmResponse, extractJsonObject, sanitizeJson } from './utils/json-utils.js';
import { djb2Hash, hashChar } from './utils/string-utils.js';
import { roundCounterReset, roundCounterGet, roundCounterSet } from './utils/counter.js';
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
import { createCritiqueSystem } from './systems/critique-system.js';
import { createCustomAgentSystem } from './systems/custom-agent-system.js';
import { createExportImportSystem } from './systems/export-import-system.js';
import { createProfileExportSystem } from './systems/profile-export-system.js';
import { createNpcExportSystem } from './systems/npc-export-system.js';
import { createSummaryExportSystem } from './systems/summary-export-system.js';
import { createCritiqueExportSystem } from './systems/critique-export-system.js';
import { createMemoryExportSystem } from './systems/memory-export-system.js';
import { createConfigProfileSystem } from './systems/config-profile-system.js';
import { createCustomPromptsSystem } from './systems/custom-prompts-system.js';
import { createScriptExecutorSystem } from './systems/script-executor-system.js';
import { loadSettingsUI, reloadSettingsUI } from './ui/settings-init.js';
import { AssetLoader } from './systems/asset-loader.js';
import { providerModules } from './assets/providers/manifest.js';

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
import { createMemoryAgent, DEFAULT_MEMORY_PROMPT, DEFAULT_MEMORY_SCHEMA, DEFAULT_MEMORY_RENDER, DEFAULT_MEMORY_COMPRESS_PROMPT } from './agents/memory.js';
import { createMemorySystem } from './systems/memory-system.js';
import { createPostSpeechAgent } from './agents/post-speech.js';
import { createExecutor } from './systems/executor.js';
import { CapabilityRegistry, registerCapabilityProviders } from './systems/capability-registry.js';
import { createUserProviderLoader } from './systems/user-provider-loader.js';
import { createPostSpeechSystem } from './systems/post-speech-system.js';

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

let settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
settings.scoreWeights = Object.assign({}, DEFAULT_SETTINGS.scoreWeights, loaded.scoreWeights || {});
extension_settings[EXT_KEY] = settings;

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
let takeoverPending = false;
let takeoverGenCount = 0;
let takeoverFailed = false;          // set when manual generation fails mid-round
let takeoverCompleted = new Set();    // avatars already generated (for resume after failure)
let takeoverSwipeCount = 0;          // auto-swipe counter per character (cap at 5)
let directorScripts = {};           // { characterName: scriptText } from LLM
let directorLastReason = '';         // reason from last director decision, exposed to script executors
let roundGenerateType = 'normal';    // captured from GROUP_WRAPPER_STARTED, read by interceptor
const wiState = { text: '', entries: [] };  // WI cache for WorldInfoProvider
const scriptCounterSnapshots = new Map();   // charName → counter value at first render
let generationStopped = false;               // set by GENERATION_STOPPED, checked in retry loop
let postSpeechRoundQueue = [];                  // intents deferred to group wrapper finished
let postSpeechRoundRan = false;                 // dedup flag for GROUP_WRAPPER_FINISHED
let scriptExecutorRoundRan = false;              // dedup flag for script executor round trigger
let postSpeechLastMsgIndex = -1;                // dedup for per-message renders
let postSpeechAbortController = null;           // AbortController for PostSpeech round LLM call
let directorAbortController = null;             // AbortController for Director + ForceSpeak LLM calls

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
    const ctx = { character: charName, ...extraContext };
    return await renderPrompt(combined, ctx, {
        maxPasses: settings.templateMaxPasses,
        recursive: settings.templateRecursive,
        debugPlaceholders: settings.templateDebugPlaceholders,
    });
}

function saveSettings() {
    extension_settings[EXT_KEY] = settings;
    saveSettingsDebounced();
}

// ─── Systems ──────────────────────────────────────────────────────────
// chat_metadata, chat, and characters are export let in ST — they get
// replaced on chat load. Pass as getters so modules always read current values.
const getChatMetadata = () => chat_metadata;
const getChat = () => chat;
const getCharacters = () => characters;

const { getDirectorHistory, addToDirectorHistory, pruneDirectorHistory, updateEntry, clearEntry } =
    createHistorySystem({ getChatMetadata, getChat, EXT_KEY, saveChatConditional, settings, log });

const { buildDirectorWorldInfo } =
    createWorldInfoSystem({ settings, getChat, getCharacters, checkWorldInfo, world_info_include_names, getContext, power_user, log });

const chatSummarySystem = createChatSummarySystem({
    settings, getChatMetadata, getChat, EXT_KEY, saveChatConditional,
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
    renderPrompt, generateRaw: (opts) => getContext().generateRaw(opts),
    createCaller,
    log,
});

const worldBookScanner = createWorldBookScanner({
    world_names, loadWorldInfo, log,
    getSelection: () => settings.worldBookSelection,
    getMaxEntries: () => settings.worldBookMaxEntries,
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
        console.log('[GroupWorld]', ...args);
    }
}

const { exportGroup, importGroup } = createExportImportSystem({
    settings, getCurrentGroup, getChat, getCharacters,
    world_names, selected_world_info, world_info, getChatMetadata, log,
});

// ─── Profile Export System ──────────────────────────────────────────
const { exportProfiles, parseImportFile, applyImport, loadPreset, getPresetNames } =
    createProfileExportSystem({
        settings, getProfiles, saveSettings,
        getDefaultProfileGeneratorPrompt, getDefaultProfileSchema, getDefaultProfileRenderTemplate,
        getCurrentGroup, getCharacters, saveChatConditional,
        refreshProfileManagementUI, log,
    });

// ─── NPC Export System ──────────────────────────────────────────────
const { exportNpcs, parseImportFile: parseNpcImportFile, applyImport: applyNpcImport,
    loadPreset: loadNpcPreset, getPresetNames: getNpcPresetNames } =
    createNpcExportSystem({
        settings, EXT_KEY, saveSettings, getCurrentGroup, getChatMetadata, saveChatConditional,
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
    saveChatConditional, saveSettings: () => extension_settings[EXT_KEY] && saveSettingsDebounced(), log,
    defaultMemoryPrompt: DEFAULT_MEMORY_PROMPT,
    defaultMemorySchema: DEFAULT_MEMORY_SCHEMA,
    defaultMemoryRender: DEFAULT_MEMORY_RENDER,
    defaultMemoryCompressPrompt: DEFAULT_MEMORY_COMPRESS_PROMPT,
});

// ─── Config Profile System ──────────────────────────────────────────
const configProfileSystem = createConfigProfileSystem({
    settings, EXT_KEY, extension_settings, saveSettingsDebounced, log,
});
const { getPresetNames: getConfigPresetNames, loadPreset: loadConfigPreset } = configProfileSystem;

// ─── Custom Prompts System ──────────────────────────────────────────
const customPromptsSystem = createCustomPromptsSystem({
    settings, saveSettings: () => extension_settings[EXT_KEY] && saveSettingsDebounced(),
    registerProvider: (p) => registerProvider(p),
    unregisterProvider: (id) => unregisterProvider(id),
    getProviders: () => getProviders(),
    log,
});

const scriptExecutorSystem = createScriptExecutorSystem({
    settings, saveSettings: () => extension_settings[EXT_KEY] && saveSettingsDebounced(),
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
    settings, EXT_KEY, getChatMetadata, saveChatConditional, characters, log,
    AgentRegistry, execute, buildContextPool, getCurrentGroup, createCaller, getContext, toastr: () => window.toastr,
});

// ─── Memory Agent + System ───────────────────────────────────────────
AgentRegistry.register(createMemoryAgent({ renderPrompt, extractJsonObject, log }));

const memorySystem = createMemorySystem({
    settings, EXT_KEY, getChatMetadata, getChat, getCharacters, saveChatConditional, log,
    AgentRegistry, execute, buildContextPool, getCurrentGroup, createCaller, getContext,
});

// ─── PostSpeech System ───────────────────────────────────────────────
const postSpeechSystem = createPostSpeechSystem({
    settings, EXT_KEY, getChatMetadata, getChat, saveChatConditional, log,
});

// ─── PostSpeech Executor ─────────────────────────────────────────────
const postSpeechExecutor = createExecutor({
    blocking: settings.postSpeechBlocking !== false,
    log,
    onExecuted: (capId, result) => {
        if (!result.success) log(`[Executor] ${capId} execution failed: ${result.error}`);
    },
});

// ─── Register built-in capabilities ─────────────────────────────────
// ─── User Provider Loader ────────────────────────────────────────────
const userProviderLoader = createUserProviderLoader({
    extension_settings, EXT_KEY, saveSettings: () => extension_settings[EXT_KEY] && saveSettingsDebounced(), log,
    getRegisteredProviderIds: () => [...getProviders().map(p => p.id)],
    unregisterProvider: (id) => unregisterProvider(id),
});

// ─── Expose core modules globally for user-imported .js files ───────
// User modules loaded via Blob URL can't resolve relative imports.
// These globals let user code use: const { CapabilityRegistry } = window.GroupWorld;
window.GroupWorld = {
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
    if (!settings.initiativeEnabled) return 0;
    // Initiative: random base + slight variation
    const base = settings.initiativeBaseScore;
    const roll = Math.random() * base;
    roundInitiative[avatar] = roll;
    return roll;
}

// ─── Scoring System ───────────────────────────────────────────────────
function scoreCharacter(chId, recentMessages) {
    const char = characters[chId];
    if (!char) return -Infinity;

    const name = char.name;
    const avatar = char.avatar;
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
    const isForceTriggered = !roundInitialized
        && roundGenerateType !== 'swipe'
        && roundGenerateType !== 'regenerate'
        && !lastMsgIsUser
        && !!getCurrentGroup();

    if (isForceTriggered) {
        const mode = settings.forceSpeakMode || 'native';
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
        if (takeoverGenCount > 0) {
            // Auto-swipe/regenerate during takeover: same character re-rolling,
            // don't consume the takeover count. Detected via roundGenerateType
            // which is now captured before the nested START guard.
            const isReroll = roundGenerateType === 'swipe' || roundGenerateType === 'regenerate';
            if (isReroll) {
                takeoverSwipeCount++;
                if (takeoverSwipeCount > 5) {
                    console.warn(`[GroupWorld] takeoverSwipeCount exceeded (${takeoverSwipeCount}) — aborting takeover for ${char.name}`);
                    takeoverFailed = true;
                    takeoverGenCount = 0;
                    abort(false);
                    return;
                }
            } else {
                takeoverGenCount--;
                roundSpeakerCount++;
                takeoverSwipeCount = 0; // new character, reset swipe counter
            }
            // Verify this character is actually in the director's plan
            if (llmPickedAvatars && !llmPickedAvatars.includes(avatar)) {
                console.error(`[GroupWorld] TAKEOVER MISMATCH: ${char.name} (${avatar}) not in director plan — aborting!`);
                abort(false);
                return;
            }
            // Safety-net script injection: ensure the correct per-character script is set
            const takeoverScript = await getScriptForChar(char.name, {
                speakerIndex: roundSpeakerCount,
                speakerIndex0: roundSpeakerCount - 1,
                speakerCount: llmPickedAvatars?.length || 0,
            });
            if (takeoverScript) {
                setExtensionPrompt(DIRECTOR_SCRIPT_KEY, takeoverScript, getScriptPosition(), 0, true);
            }
            console.warn(`[GroupWorld] MANUAL-GEN ALLOWED ${char.name} (takeoverGenCount→${takeoverGenCount}, speaker #${roundSpeakerCount}${isReroll ? ', reroll' : ''})`);
            return;
        }
        // ST's activation loop is being suppressed — abort all
        if (takeoverPending) {
            console.warn(`[GroupWorld] TAKEOVER-BLOCK ${char.name} (ST order suppressed, director will drive order)`);
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
        if (!llmPickedSet.has(avatar)) {
            console.warn(`[GroupWorld] VALIDATION FAILED: ${char.name} (${avatar}) not in llmPickedSet! Aborting.`);
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
    const sortedAvatars = Object.entries(roundScores)
        .sort((a, b) => b[1] - a[1])
        .map(([a]) => a);
    const topN = Math.min(settings.topN, sortedAvatars.length);
    const allowedAvatars = new Set(sortedAvatars.slice(0, topN));
    const score = roundScores[avatar] ?? -Infinity;

    if (allowedAvatars.has(avatar)) {
        roundSpeakerCount++;
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

    // If manual ordered generation is in progress (force_chid sub-calls),
    // don't reset state — the sub-wrapper is just a vehicle for single-char gen.
    if (takeoverGenCount > 0) {
        console.warn('[GroupWorld] Nested GROUP_WRAPPER_STARTED during manual gen — preserving state');
        return;
    }

    // Previous takeover failed mid-round: reuse the existing director decision
    // instead of making a new one. Chat already has partial messages from the
    // failed attempt; a new decision would conflict with existing dialog boxes.
    if (takeoverFailed) {
        takeoverFailed = false;
        takeoverPending = settings.mode === MODE_LLM && settings.llmRespectOrder;
        takeoverGenCount = 0;
        llmSpokenSet = new Set();
        llmCursor = 0;
        roundSpeakerCount = 0;
        roundInitialized = true; // reuse existing director decision as documented
        roundGenerateType = data?.type || 'normal';
        console.warn('[GroupWorld] Retry after takeover failure — reusing existing director plan');
        return;
    }

    isGroupChat = true;

    // Regenerate / swipe: reuse the existing director decision — only reset
    // per-speaker tracking. Don't re-trigger takeover; let ST decide which
    // messages to regenerate. Reconstruct state from chat_metadata so it
    // survives browser restarts (in-memory state is gone on reload).
    if (roundGenerateType === 'regenerate' || roundGenerateType === 'swipe') {
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
            takeoverPending = false;
            takeoverGenCount = 0;
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
    takeoverPending = false;
    takeoverGenCount = 0;
    takeoverFailed = false;
    takeoverCompleted = new Set();
    takeoverSwipeCount = 0;
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

    if (takeoverPending && llmPickedAvatars && llmPickedAvatars.length > 0) {
        await runManualOrderedGeneration();
    }
    takeoverPending = false;

    // PostSpeech per-round: run EXACTLY ONCE after ALL characters
    // (including takeover) have finished speaking.
    // Only fire when takeover is fully complete (not during nested wrappers)
    if (settings.postSpeechRoundEnabled && !postSpeechRoundRan && takeoverGenCount === 0 && !manualGenInProgress) {
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
                const caller = createCaller(agentConfig, stGenerateRaw);
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

                if (postSpeechAbortController.signal.aborted) return;

                const response = await execute(agent, {
                    pool,
                    caller,
                    config: { ...modeConfig, call: callCfg, enableTrace: settings.debugLogging },
                }).catch(e => {
                    if (e.name === 'AbortError' || postSpeechAbortController.signal.aborted) {
                        log('PostSpeech round aborted');
                        return null;
                    }
                    throw e;
                });

                if (!response) return;

                if (response) {
                    const policy = agent.parseResponse(response);
                    if (policy?.intents?.length) {
                        log('PostSpeech round policy:', policy);
                        await postSpeechExecutor.run(policy, CapabilityRegistry.listForMode('round'));
                        for (const intent of policy.intents) {
                            await postSpeechSystem.record(chat.length - 1, '_round_', intent.type, intent.params, policy);
                        }
                    }
                }

                // Drain deferred per-message intents (round/both timing)
                if (postSpeechRoundQueue.length > 0) {
                    const pendingIntents = postSpeechRoundQueue.splice(0);
                    log(`PostSpeech: executing ${pendingIntents.length} deferred per-message intents`);
                    await postSpeechExecutor.run(
                        { intents: pendingIntents },
                        CapabilityRegistry.listForMode('message')
                    );
                    for (const intent of pendingIntents) {
                        await postSpeechSystem.record(chat.length - 1, '_round_deferred', intent.type, intent.params, {});
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

    // ─── Script Executor: round trigger (before auto summary, deduped) ──
    // Only fire when takeover is fully complete (same guard as PostSpeech round)
    if (!scriptExecutorRoundRan && takeoverGenCount === 0 && !manualGenInProgress) {
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
    const _c2 = takeoverGenCount === 0;
    const _c3 = !manualGenInProgress;
    console.log('[GD-auto] guard:', { _c1, _c2, _c3, tGC: takeoverGenCount, mGP: manualGenInProgress, allOk: _c1 && _c2 && _c3 });
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
                    await saveSumLen(currentLen);
                    if (currentLen >= interval) {
                        try {
                            log(`Auto-summary: first enable, ${currentLen} existing msgs`);
                            toastr?.info?.(lang === 'zh' ? `自动总结触发（检测到 ${currentLen} 条现有消息）...` : `Auto-summary (${currentLen} existing msgs)...`, '', { timeOut: 3000 });
                            await chatSummarySystem.generateSummary();
                            toastr?.success?.(lang === 'zh' ? '自动总结完成' : 'Auto-summary done', '', { timeOut: 2000 });
                        } catch (e) { log('Auto-summary failed:', e.message); }
                    }
                } else if (currentLen < sumLen) {
                    console.log('[GD-auto-sum] path: deletion');
                    await saveSumLen(currentLen);
                    toastr?.warning?.(lang === 'zh' ? '检测到消息被删除，自动总结计数器已重置。' : 'Messages deleted. Auto-summary counter reset.', '', { timeOut: 8000 });
                } else {
                    const newMsgs = currentLen - sumLen;
                    console.log('[GD-auto-sum] path: normal newMsgs=', newMsgs, 'interval=', interval);
                    if (newMsgs >= interval) {
                        await saveSumLen(currentLen);
                        try {
                            log(`Auto-summary triggered (${newMsgs} msgs)`);
                            toastr?.info?.(lang === 'zh' ? `自动总结触发（${newMsgs} 条新消息）...` : `Auto-summary (${newMsgs} msgs)...`, '', { timeOut: 3000 });
                            await chatSummarySystem.generateSummary();
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
                    await saveMemLen(currentLen);
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
                            for (const av of targets) {
                                try { await memorySystem.generateForCharacter(av); } catch (e2) { log('Auto-memory fail:', av, e2.message); }
                            }
                            toastr?.success?.(lang === 'zh' ? '自动记忆提取完成' : 'Auto-memory done', '', { timeOut: 2000 });
                        } catch (e) { log('Auto-memory failed:', e.message); }
                    }
                } else if (currentLen < memLen) {
                    console.log('[GD-auto-mem] path: deletion');
                    await saveMemLen(currentLen);
                    toastr?.warning?.(lang === 'zh' ? '检测到消息被删除，自动记忆计数器已重置。' : 'Messages deleted. Auto-memory counter reset.', '', { timeOut: 8000 });
                } else {
                    const newMsgs = currentLen - memLen;
                    console.log('[GD-auto-mem] path: normal newMsgs=', newMsgs, 'interval=', interval);
                    if (newMsgs >= interval) {
                        await saveMemLen(currentLen);
                        try {
                            log(`Auto-memory triggered (${newMsgs} msgs)`);
                            toastr?.info?.(lang === 'zh' ? `自动记忆提取触发（${newMsgs} 条新消息）...` : `Auto-memory (${newMsgs} msgs)...`, '', { timeOut: 3000 });
                            const g = getCurrentGroup();
                            const members = g ? g.members.filter(a => !g.disabled_members?.includes(a)) : [];
                            const targets = resolveMemoryTargets(members, interval);
                            if (targets.length < members.length) {
                                log(`Auto-memory: speakers filter ${targets.length}/${members.length} chars`);
                            }
                            for (const av of targets) {
                                try { await memorySystem.generateForCharacter(av); } catch (e2) { log('Auto-memory fail:', av, e2.message); }
                            }
                            toastr?.success?.(lang === 'zh' ? '自动记忆提取完成' : 'Auto-memory done', '', { timeOut: 2000 });
                        } catch (e) { log('Auto-memory failed:', e.message); }
                    }
                }
            }

            // Check Auto Critique
            if (settings.autoCritiqueEnabled && settings.critiqueEnabled) {
                const interval = settings.autoCritiqueInterval || 10;
                let criLen = chat_metadata[EXT_KEY]._autoCritiqueLen;
                if (criLen === undefined) criLen = critiqueSystem.getLatestActive?.()?.rangeEnd ?? 0;

                if (criLen === 0 && chat_metadata[EXT_KEY]._autoCritiqueLen === undefined && legacyLen === undefined) {
                    console.log('[GD-auto-cri] path: first-enable currentLen=', currentLen);
                    chat_metadata[EXT_KEY]._autoCritiqueLen = currentLen;
                    await saveChatConditional();
                    if (currentLen >= interval) {
                        try {
                            log(`Auto-critique: first enable, ${currentLen} existing msgs`);
                            toastr?.info?.(lang === 'zh' ? `自动批判触发（检测到 ${currentLen} 条现有消息）...` : `Auto-critique (${currentLen} existing msgs)...`, '', { timeOut: 3000 });
                            await critiqueSystem.generateCritique();
                            toastr?.success?.(lang === 'zh' ? '自动批判完成' : 'Auto-critique done', '', { timeOut: 2000 });
                        } catch (e) { log('Auto-critique failed:', e.message); }
                    }
                } else if (currentLen < criLen) {
                    console.log('[GD-auto-cri] path: deletion');
                    chat_metadata[EXT_KEY]._autoCritiqueLen = currentLen;
                    await saveChatConditional();
                    toastr?.warning?.(lang === 'zh' ? '检测到消息被删除，自动批判计数器已重置。' : 'Messages deleted. Auto-critique counter reset.', '', { timeOut: 8000 });
                } else {
                    const newMsgs = currentLen - criLen;
                    console.log('[GD-auto-cri] path: normal newMsgs=', newMsgs, 'interval=', interval);
                    if (newMsgs >= interval) {
                        chat_metadata[EXT_KEY]._autoCritiqueLen = currentLen;
                        await saveChatConditional();
                        try {
                            log(`Auto-critique triggered (${newMsgs} msgs)`);
                            toastr?.info?.(lang === 'zh' ? `自动批判触发（${newMsgs} 条新消息）...` : `Auto-critique (${newMsgs} msgs)...`, '', { timeOut: 3000 });
                            await critiqueSystem.generateCritique();
                            toastr?.success?.(lang === 'zh' ? '自动批判完成' : 'Auto-critique done', '', { timeOut: 2000 });
                        } catch (e) { log('Auto-critique failed:', e.message); }
                    }
                }
            }

            // ─── Auto Custom Agents ────────────────────────
            const caInstances = (settings.customAgents || []).filter(a => a.enabled && a.autoEnabled);
            console.log('[GD-auto-ca] instances found:', caInstances.length, 'total in settings:', (settings.customAgents || []).length);
            if (caInstances.length) {
                const sorted = [...caInstances].sort((a, b) => (a.order || 0) - (b.order || 0));
                for (const inst of sorted) {
                    const caKey = `_autoCAG_${inst.id}`;
                    let caLen = chat_metadata[EXT_KEY][caKey];
                    if (caLen === undefined) {
                        const store = customAgentSystem.getData(inst.id);
                        caLen = store?.rangeEnd ?? 0;
                    }
                    const interval = inst.autoInterval || 10;

                    if (caLen === 0 && chat_metadata[EXT_KEY][caKey] === undefined && legacyLen === undefined) {
                        chat_metadata[EXT_KEY][caKey] = currentLen;
                        await saveChatConditional();
                        if (currentLen >= interval) {
                            try {
                                log(`[GD-auto-ca] "${inst.name}": first-enable, ${currentLen} msgs`);
                                toastr?.info?.(lang === 'zh' ? `"${inst.name}" 自动触发（${currentLen} 条现有消息）...` : `"${inst.name}" auto (${currentLen} msgs)...`, '', { timeOut: 3000 });
                                await customAgentSystem.execute(inst);
                                toastr?.success?.(lang === 'zh' ? `"${inst.name}" 完成` : `${inst.name} done`, '', { timeOut: 2000 });
                            } catch (e) { log(`[GD-auto-ca] "${inst.name}" failed:`, e.message); }
                        }
                    } else if (currentLen < caLen) {
                        chat_metadata[EXT_KEY][caKey] = currentLen;
                        await saveChatConditional();
                        toastr?.warning?.(lang === 'zh' ? `检测到消息被删除，"${inst.name}" 计数器已重置。` : `Msgs deleted. "${inst.name}" counter reset.`, '', { timeOut: 8000 });
                    } else {
                        const newMsgs = currentLen - caLen;
                        if (newMsgs >= interval) {
                            chat_metadata[EXT_KEY][caKey] = currentLen;
                            await saveChatConditional();
                            try {
                                log(`[GD-auto-ca] "${inst.name}" triggered (${newMsgs} msgs)`);
                                toastr?.info?.(lang === 'zh' ? `"${inst.name}" 自动触发（${newMsgs} 条新消息）...` : `"${inst.name}" auto (${newMsgs} msgs)...`, '', { timeOut: 3000 });
                                await customAgentSystem.execute(inst);
                                toastr?.success?.(lang === 'zh' ? `"${inst.name}" 完成` : `${inst.name} done`, '', { timeOut: 2000 });
                            } catch (e) { log(`[GD-auto-ca] "${inst.name}" failed:`, e.message); }
                        }
                    }
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

    try {
        const charName = msg.name || '';
        const char = characters.find(c => c.name === charName);
        const agentConfig = settings.agentConfigs?.['post-speech'] || {};
        // Inject mode-specific prompt via config — agent prompt() reads from config.postSpeechPrompt
        const modeConfig = { ...settings, postSpeechPrompt: settings.postSpeechMessagePrompt || undefined };
        const stGenerateRaw = (opts) => getContext().generateRaw(opts);
        const caller = createCaller(agentConfig, stGenerateRaw);

        const pool = buildContextPool({
            group,
            speakerMessage: msg.mes || '',
            speakerName: charName,
            speakerDescription: char?.description || '',
            postSpeechMode: 'message',
        });

        const callCfg = {
            ...agentConfig.call,
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
                postSpeechSystem.wasExecuted(msgIndex, cid));
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
            !postSpeechSystem.wasExecuted(msgIndex, i.type)
        );
        if (!freshIntents.length) { log('PostSpeech: all intents already executed'); return; }

        // Run executor with filtered intents
        const timing = settings.postSpeechTiming || 'message';

        if (timing === 'message' || timing === 'both') {
            const execResult = await postSpeechExecutor.run(
                { ...policy, intents: freshIntents },
                CapabilityRegistry.listForMode('message')
            );
            log('PostSpeech execution (message):', execResult);
        }

        // Queue for round-end execution (round | both modes)
        if (timing === 'round' || timing === 'both') {
            postSpeechRoundQueue.push(...freshIntents);
            log(`PostSpeech: queued ${freshIntents.length} intents for round end (queue=${postSpeechRoundQueue.length})`);
        }

        // Record each executed intent
        for (const intent of freshIntents) {
            await postSpeechSystem.record(msgIndex, msg.name || '?', intent.type, intent.params, policy);
        }

        // Done notification
        if (typeof toastr !== 'undefined') {
            toastr.success('PostSpeech done', '', { timeOut: 2000 });
        }
    } catch (e) {
        // PostSpeech failure never interrupts the conversation
        log('PostSpeech skipped:', e.message);
    }
});

// ───

eventSource.on(event_types.MESSAGE_DELETED, async (newChatLength) => {
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
    takeoverPending = false;
    takeoverGenCount = 0;
    takeoverFailed = false;
    takeoverCompleted = new Set();
    takeoverSwipeCount = 0;
    manualGenInProgress = false;
    directorScripts = {};
    wiState.text = '';
    wiState.entries = [];
    scriptCounterSnapshots.clear();
    if (chat_metadata[EXT_KEY]) delete chat_metadata[EXT_KEY]._counterSnapshots;
    await pruneDirectorHistory();
    await chatSummarySystem.pruneSummaries();
    await postSpeechSystem.pruneAfter(newChatLength - 1);
});

eventSource.on(event_types.CHAT_CHANGED, async () => {
    log('CHAT_CHANGED — pruning ledger and summaries for branch/fork');
    await pruneDirectorHistory();
    await chatSummarySystem.pruneSummaries();
    await critiqueSystem.pruneCritiques();
    await postSpeechSystem.clearAll();
    postSpeechRoundQueue = [];
    // Reset auto-check counter on chat change
    if (chat_metadata[EXT_KEY]) {
        delete chat_metadata[EXT_KEY]._autoCheckLength;
        delete chat_metadata[EXT_KEY]._autoSumLen;
        delete chat_metadata[EXT_KEY]._autoMemLen;
        delete chat_metadata[EXT_KEY]._autoCritiqueLen;
        // Clean up custom agent auto counters
        for (const key of Object.keys(chat_metadata[EXT_KEY])) {
            if (key.startsWith('_autoCAG_')) delete chat_metadata[EXT_KEY][key];
        }
    }
    postSpeechRoundRan = false;
    scriptExecutorRoundRan = false;
});

// ─── Manual Ordered Generation (takeover) ─────────────────────────────
let manualGenInProgress = false;
async function runManualOrderedGeneration() {
    manualGenInProgress = true;
    takeoverPending = false;
    const orderedList = [...llmPickedAvatars];
    takeoverGenCount = orderedList.length;
    const ctx = getContext();
    const savedChId = ctx.characterId;
    const savedChName = characters[savedChId]?.name || '';

    console.warn('[GroupWorld] TAKEOVER START — orderedList:', orderedList.map(a => characters.find(c => c.avatar === a)?.name));
    console.warn('[GroupWorld] takeoverGenCount:', takeoverGenCount);

    try {
        for (let i = 0; i < orderedList.length; i++) {
            const avatar = orderedList[i];
            // Resume after failure: skip characters already generated
            if (takeoverCompleted.has(avatar)) {
                takeoverGenCount--;
                console.warn(`[GroupWorld] SKIP already completed: ${characters.find(c => c.avatar === avatar)?.name}, takeoverGenCount→${takeoverGenCount}`);
                continue;
            }
            const chId = characters.findIndex(c => c.avatar === avatar);
            if (chId === -1) {
                takeoverGenCount--;
                console.warn('[GroupWorld] SKIP unknown avatar, takeoverGenCount→', takeoverGenCount);
                continue;
            }
            setCharacterId(chId);
            setCharacterName(characters[chId].name);
            // Validate: the context must now point to the character we intend to generate
            const verifyChId = getContext().characterId;
            const verifyAvatar = characters[verifyChId]?.avatar;
            if (verifyAvatar !== avatar) {
                console.error(`[GroupWorld] VALIDATION FAILED: takeover set chId=${chId} for avatar=${avatar}, but context has chId=${verifyChId} avatar=${verifyAvatar} — aborting this speaker`);
                takeoverGenCount--;
                continue;
            }
            console.warn(`[GroupWorld] GEN #${i + 1}: ${characters[chId].name} (chId=${chId}, takeoverGenCount=${takeoverGenCount})`);

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
                        console.log(`[GroupWorld] POST-GEN #${i + 1}: expected="${expectedName}" actual="${lastMsg.name}" mes=${(lastMsg.mes || '').substring(0, 80)} reasoning=${lastMsg.extra?.reasoning ? (lastMsg.extra.reasoning.substring(0, 80) + '...') : 'none'} swipes=${lastMsg.swipes?.length || 0}`);
                        if (lastMsg.name !== expectedName) {
                            console.error(`[GroupWorld] POST-GEN MISMATCH: expected "${expectedName}" but got "${lastMsg.name}" — identity swapped!`);
                        }
                    }
                }
                console.warn(`[GroupWorld] GEN #${i + 1} DONE: ${characters[chId].name}`);
                takeoverCompleted.add(avatar);
            } catch (e) {
                console.error('[GroupWorld] GEN FAILED:', e.message, e.stack);
                takeoverGenCount = 0;
                takeoverFailed = true;
                // Preserve llmPickedAvatars, llmPickedSet, directorScripts, roundInitialized
                // so a retry reuses the same director decision instead of making a new one.
                return;
            } finally {
                if (charScript) {
                    setExtensionPrompt(DIRECTOR_SCRIPT_KEY, '', getScriptPosition(), 0, true);
                }
            }
        }

        console.warn('[GroupWorld] TAKEOVER COMPLETE — all speakers generated');
    } finally {
        console.warn('[GroupWorld] TAKEOVER FINALLY — resetting flags');
        takeoverGenCount = 0;
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
        console.warn('[GroupWorld] ForceSpeak agent not registered');
        return;
    }

    try {
        directorAbortController = new AbortController();

        const agentConfig = settings.agentConfigs?.['force-speak'] || {};
        const stGenerateRaw = (opts) => getContext().generateRaw(opts);
        const caller = createCaller(agentConfig, stGenerateRaw);

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
            console.warn('[GroupWorld] Force-speak LLM aborted');
            return;
        }
        console.warn('[GroupWorld] Force-speak LLM failed:', e.message);
    }
}

async function initRoundWithLLM() {
    const group = getCurrentGroup();
    if (!group) return;

    const enabledMembers = group.members.filter(a => !group.disabled_members?.includes(a));
    const agent = AgentRegistry.get('director');
    if (!agent) {
        console.warn('[GroupWorld] Director agent not registered');
        return;
    }

    try {
        directorAbortController = new AbortController();

        const agentConfig = settings.agentConfigs?.['director'] || {};
        const stGenerateRaw = (opts) => getContext().generateRaw(opts);
        const caller = createCaller(agentConfig, stGenerateRaw);

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

        if (!parsed || !parsed.speakers?.length) {
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
            takeoverPending = true;
            console.warn('[GroupWorld] TAKEOVER SET — picked:', capped.map(a => characters.find(c => c.avatar === a)?.name));
        }

        log('LLM picked order:', capped.map(a =>
            characters.find(c => c.avatar === a)?.name).join(' → '),
            parsed.reason ? `(${parsed.reason})` : '');

    } catch (e) {
        directorAbortController = null;
        if (generationStopped || e?.name === 'AbortError') {
            console.warn('[GroupWorld] Director LLM aborted by user');
            llmPickedSet = new Set();
            llmPickedAvatars = null;
            return;
        }
        console.error('[GroupWorld] Director LLM failed:', e.message || e);

        // Fallback: reuse last plan from history
        const history = getDirectorHistory();
        const lastPlan = history[history.length - 1];
        if (lastPlan && Array.isArray(lastPlan.speakers) && lastPlan.speakers.length > 0) {
            toastr.warning('导演决策失败，正在复用上一轮决策...');
            console.warn('[GroupWorld] Director failed — reusing last plan from history');
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
                if (settings.llmRespectOrder) takeoverPending = true;
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

    base += '\n\n{{llmJsonSchema}}';
    return base;
}

function buildJsonSchema() {
    const scriptField = settings.llmScriptEnabled
        ? ',\n  "scripts": {\n    "NameOfFirstSpeaker": "short imperative stage direction",\n    "NameOfSecondSpeaker": "short imperative stage direction"\n  }'
        : '';
    const schema = settings.llmJsonSchema ?? DEFAULT_SETTINGS.llmJsonSchema;
    return schema
        .replace(/\{\{scriptField\}\}/g, scriptField)
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

// LlmJsonSchema — user-customizable JSON output format template
registerProvider({
    id: 'llmJsonSchema',
    placeholder: '{{llmJsonSchema}}',
    render: () => ({ content: buildJsonSchema() }),
});

registerWorldInfoProvider(settings, wiState, buildDirectorWorldInfo);
registerHistoryProviders(settings, getDirectorHistory);
registerDirectorLedger(settings, getDirectorHistory);
registerTestProvider();
registerWorldBooks(worldBookScanner);
registerWorldBookImportance(worldBookScanner, () => settings.worldBookMaxEntries);
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
        toastr, world_names, loadWorldInfo, renderPrompt,
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
        exportNpcs, parseNpcImportFile, applyNpcImport, loadNpcPreset, getNpcPresetNames,
        summaryExportSystem,
        critiqueExportSystem,
        memoryExportSystem,
        configProfileSystem,
        getConfigPresetNames, loadConfigPreset,
        customPromptsSystem,
        scriptExecutorSystem,
    };
    await loadSettingsUI(deps);
    // Restore user-imported providers and capabilities from persistent storage.
    // Inject window.GroupWorld so user modules don't need relative imports.
    const userDeps = { log, CapabilityRegistry, registerProvider: (p) => registerProvider(p) };
    userProviderLoader.restoreAll('provider', userDeps);
    userProviderLoader.restoreAll('capability', userDeps);

    // Hook capability toggle to persist enabled state.
    // Always replace the monkey-patch so closure captures current settings/saveSettingsDebounced on hot reload.
    if (!CapabilityRegistry._gdOrigSetEnabled) {
        CapabilityRegistry._gdOrigSetEnabled = CapabilityRegistry.setEnabled.bind(CapabilityRegistry);
    }
    CapabilityRegistry.setEnabled = function (id, enabled) {
        CapabilityRegistry._gdOrigSetEnabled(id, enabled);
        try { userProviderLoader.persistCapabilityEnabled(); } catch (_) { }
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
    customPromptsSystem.initAll();
    // Warn about settings keys not covered by any config profile drawer
    const uncovered = configProfileSystem.getUncoveredKeys();
    if (uncovered.length) {
        console.warn(`[GroupWorld] ${uncovered.length} setting(s) not in any export drawer:`, uncovered.join(', '));
    }
    console.log(`Group World extension loaded (mode=${settings.mode})`);

    // 暴露重载入口：应用配置档后无需刷新页面即可生效（重渲染设置面板 + 重注册 user providers）
    window.__gdReloadExtension = async () => {
        await reloadSettingsUI(deps);
        const ud = { log, CapabilityRegistry, registerProvider: (p) => registerProvider(p) };
        userProviderLoader.restoreAll('provider', ud);
        userProviderLoader.restoreAll('capability', ud);
    };
});
