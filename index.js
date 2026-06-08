import { eventSource, event_types } from '../../../events.js';
import { extension_settings, getContext } from '../../../extensions.js';
import { saveSettingsDebounced, chat_metadata, saveChatConditional, characters, chat, setCharacterId, setCharacterName, setExtensionPrompt, extension_prompt_types } from '../../../../script.js';
import { inject_ids } from '../../../constants.js';
import { groups, selected_group } from '../../../group-chats.js';
import { checkWorldInfo, world_info_include_names, world_names, loadWorldInfo } from '../../../world-info.js';
import { power_user } from '../../../power-user.js';
import { EXT_KEY, MODE_OFF, MODE_FORMULA, MODE_LLM, DEFAULT_SETTINGS } from './settings.js';
import { registerProvider, getProviders, getAvailablePlaceholders } from './provider-registry.js';
import { renderPrompt } from './prompt-renderer.js';
import { parseLlmResponse, extractJsonObject, sanitizeJson } from './utils/json-utils.js';
import { djb2Hash, hashChar } from './utils/string-utils.js';
import { roundCounterReset, roundCounterGet, roundCounterSet } from './utils/counter.js';
import { register as registerRecentMessages } from './providers/recent-messages.js';
import { register as registerCharacters } from './providers/characters.js';
import { register as registerCharacterProfiles } from './providers/character-profiles.js';
import { register as registerWorldInfoProvider } from './providers/world-info.js';
import { register as registerHistoryProviders } from './providers/history.js';
import { register as registerDirectorLedger } from './providers/director-ledger.js';
import { register as registerTestProvider } from './providers/test-provider.js';
import { register as registerWorldBooks } from './providers/world-books.js';
import { register as registerWorldBookImportance } from './providers/world-book-importance.js';
import { register as registerCharacterLore } from './providers/character-lore.js';
import { createHistorySystem } from './systems/history-system.js';
import { createWorldInfoSystem } from './systems/world-info-system.js';
import { createProfileSystem } from './systems/profile-system.js';
import { createWorldBookScanner } from './systems/world-book-scanner.js';
import { loadSettingsUI } from './ui/settings-init.js';

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
let roundGenerateType = 'normal';    // captured from GROUP_WRAPPER_STARTED, read by interceptor
const wiState = { text: '', entries: [] };  // WI cache for WorldInfoProvider
const scriptCounterSnapshots = new Map();   // charName → counter value at first render
let generationStopped = false;               // set by GENERATION_STOPPED, checked in retry loop

// Custom extension prompt key for director script (not QUIET_PROMPT to avoid leakage)
const DIRECTOR_SCRIPT_KEY = 'group_director_script';

async function getScriptForChar(charName, extraContext) {
    const script = directorScripts[charName];
    if (!script) return '';
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

const { getDirectorHistory, addToDirectorHistory, pruneDirectorHistory } =
    createHistorySystem({ getChatMetadata, getChat, EXT_KEY, saveChatConditional, settings, log });

const { buildDirectorWorldInfo } =
    createWorldInfoSystem({ settings, getChat, getCharacters, checkWorldInfo, world_info_include_names, getContext, power_user, log });

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

    // 1. Mention score: character name appears in recent messages
    const recentText = recentMessages.map(m => m.mes || '').join(' ');
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const mentionRegex = new RegExp('\\b' + escapedName + '\\b', 'gi');
    const mentionCount = (recentText.match(mentionRegex) || []).length;
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
    const talkativeness = isNaN(char.talkativeness) ? 0.5 : Number(char.talkativeness);
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
    if (settings.mode === MODE_OFF) return;
    if (type === 'quiet' || type === 'impersonate' || type === 'continue') return;

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
                    console.warn(`[GroupDirector] takeoverSwipeCount exceeded (${takeoverSwipeCount}) — aborting takeover for ${char.name}`);
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
                console.error(`[GroupDirector] TAKEOVER MISMATCH: ${char.name} (${avatar}) not in director plan — aborting!`);
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
                setExtensionPrompt(DIRECTOR_SCRIPT_KEY, takeoverScript, extension_prompt_types.IN_PROMPT, 0, true);
            }
            console.warn(`[GroupDirector] MANUAL-GEN ALLOWED ${char.name} (takeoverGenCount→${takeoverGenCount}, speaker #${roundSpeakerCount}${isReroll ? ', reroll' : ''})`);
            return;
        }
        // ST's activation loop is being suppressed — abort all
        if (takeoverPending) {
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
            setExtensionPrompt(DIRECTOR_SCRIPT_KEY, charScript, extension_prompt_types.IN_PROMPT, 0, true);
        } else {
            setExtensionPrompt(DIRECTOR_SCRIPT_KEY, '', extension_prompt_types.IN_PROMPT, 0, true);
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
        console.warn('[GroupDirector] Nested GROUP_WRAPPER_STARTED during manual gen — preserving state');
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
        roundInitialized = false; // allow fresh director eval on retry
        roundGenerateType = data?.type || 'normal';
        console.warn('[GroupDirector] Retry after takeover failure — reusing existing director plan');
        return;
    }

    isGroupChat = true;

    // Regenerate / swipe: reuse the existing director decision — only reset
    // per-speaker tracking. Don't re-trigger takeover; let ST decide which
    // messages to regenerate. Reconstruct state from chat_metadata so it
    // survives browser restarts (in-memory state is gone on reload).
    if (roundGenerateType === 'regenerate' || roundGenerateType === 'swipe') {
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
    directorScripts = {};
    setExtensionPrompt(DIRECTOR_SCRIPT_KEY, '', extension_prompt_types.IN_PROMPT, 0, true);
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
});

// When messages are deleted, the chat timeline has rolled back.
// All in-memory runtime state based on the old timeline is now invalid.
// Clear it BEFORE pruning history so no stale pointers linger.
eventSource.on(event_types.GENERATION_STOPPED, () => {
    generationStopped = true;
});

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
    directorScripts = {};
    wiState.text = '';
    wiState.entries = [];
    scriptCounterSnapshots.clear();
    if (chat_metadata[EXT_KEY]) delete chat_metadata[EXT_KEY]._counterSnapshots;
    await pruneDirectorHistory(newChatLength);
});

// ─── Manual Ordered Generation (takeover) ─────────────────────────────
async function runManualOrderedGeneration() {
    takeoverPending = false;
    const orderedList = [...llmPickedAvatars];
    takeoverGenCount = orderedList.length;
    const ctx = getContext();
    const savedChId = ctx.characterId;
    const savedChName = characters[savedChId]?.name || '';

    console.warn('[GroupDirector] TAKEOVER START — orderedList:', orderedList.map(a => characters.find(c => c.avatar === a)?.name));
    console.warn('[GroupDirector] takeoverGenCount:', takeoverGenCount);

    try {
        for (let i = 0; i < orderedList.length; i++) {
            const avatar = orderedList[i];
            // Resume after failure: skip characters already generated
            if (takeoverCompleted.has(avatar)) {
                takeoverGenCount--;
                console.warn(`[GroupDirector] SKIP already completed: ${characters.find(c => c.avatar === avatar)?.name}, takeoverGenCount→${takeoverGenCount}`);
                continue;
            }
            const chId = characters.findIndex(c => c.avatar === avatar);
            if (chId === -1) {
                takeoverGenCount--;
                console.warn('[GroupDirector] SKIP unknown avatar, takeoverGenCount→', takeoverGenCount);
                continue;
            }
            setCharacterId(chId);
            setCharacterName(characters[chId].name);
            // Validate: the context must now point to the character we intend to generate
            const verifyChId = getContext().characterId;
            const verifyAvatar = characters[verifyChId]?.avatar;
            if (verifyAvatar !== avatar) {
                console.error(`[GroupDirector] VALIDATION FAILED: takeover set chId=${chId} for avatar=${avatar}, but context has chId=${verifyChId} avatar=${verifyAvatar} — aborting this speaker`);
                takeoverGenCount--;
                continue;
            }
            console.warn(`[GroupDirector] GEN #${i + 1}: ${characters[chId].name} (chId=${chId}, takeoverGenCount=${takeoverGenCount})`);

            // Inject per-character director script with order context.
            // Use original plan position so retries/skips don't shift the index.
            const origPos = llmPickedAvatars.indexOf(avatar);
            const charScript = await getScriptForChar(characters[chId].name, {
                speakerIndex: origPos + 1,
                speakerIndex0: origPos,
                speakerCount: llmPickedAvatars.length,
            });
            if (charScript) {
                setExtensionPrompt(DIRECTOR_SCRIPT_KEY, charScript, extension_prompt_types.IN_PROMPT, 0, true);
            }
            try {
                // Re-set character identity right before generation, in case
                // something between setCharacterId and here mutated this_chid
                setCharacterId(chId);
                setCharacterName(characters[chId].name);
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
                takeoverCompleted.add(avatar);
            } catch (e) {
                console.error('[GroupDirector] GEN FAILED:', e.message, e.stack);
                takeoverGenCount = 0;
                takeoverFailed = true;
                // Preserve llmPickedAvatars, llmPickedSet, directorScripts, roundInitialized
                // so a retry reuses the same director decision instead of making a new one.
                return;
            } finally {
                if (charScript) {
                    setExtensionPrompt(DIRECTOR_SCRIPT_KEY, '', extension_prompt_types.IN_PROMPT, 0, true);
                }
            }
        }

        console.warn('[GroupDirector] TAKEOVER COMPLETE — all speakers generated');
    } finally {
        console.warn('[GroupDirector] TAKEOVER FINALLY — resetting flags');
        takeoverGenCount = 0;
        // Restore the original character context so ST doesn't stay stuck
        // on the last generated character after takeover
        if (savedChId !== undefined && savedChId !== null) {
            setCharacterId(savedChId);
            setCharacterName(savedChName);
        }
    }
}

async function initRoundWithLLM() {
    const group = getCurrentGroup();
    if (!group) return;

    const enabledMembers = group.members.filter(a => !group.disabled_members?.includes(a));
    const maxRetries = 3;

    try {
        generationStopped = false;

        const llmDepth = Math.min(settings.llmContextDepth, chat.length);
        const recentMessages = chat.slice(-llmDepth);

        const runtimeContext = {
            recentMessages,
            enabledMembers,
            maxSpeakers: settings.llmMaxSpeakers,
        };

        const promptTemplate = settings.llmPrompt || getDefaultLlmPrompt();
        let filled = await renderPrompt(promptTemplate, runtimeContext, {
            maxPasses: settings.templateMaxPasses,
            recursive: settings.templateRecursive,
            debugPlaceholders: settings.templateDebugPlaceholders,
        });

        // Auto-inject WI if the template lacks the placeholder (custom prompts)
        if (settings.llmWorldInfoEnabled && !promptTemplate.includes('{{worldInfo}}') && wiState.text) {
            const wiWrapper = settings.llmWorldInfoWrapper || '{{worldInfo}}';
            filled = wiWrapper.replace('{{worldInfo}}', wiState.text) + '\n\n' + filled;
        }

        // Auto-inject director history continuity if the template lacks the placeholder
        if (settings.llmHistoryEnabled && settings.llmScriptContinuity) {
            const hasPrevPlan = promptTemplate.includes('{{previousPlan}}');
            const hasPrevPlans = promptTemplate.includes('{{previousPlans}}');
            if (!hasPrevPlan && !hasPrevPlans) {
                const history = getDirectorHistory();
                if (history.length > 0) {
                    if (settings.llmScriptContinuityMode === 'history') {
                        const count = settings.llmScriptContinuityCount > 0
                            ? Math.min(settings.llmScriptContinuityCount, history.length)
                            : history.length;
                        const plansJson = JSON.stringify(history.slice(-count), null, 2);
                        const wrapper = settings.llmScriptContinuityHistoryWrapper || '{{previousPlans}}';
                        filled = wrapper.replace('{{previousPlans}}', plansJson) + '\n\n' + filled;
                    } else {
                        const lastJson = JSON.stringify(history[history.length - 1], null, 2);
                        const wrapper = settings.llmScriptContinuityWrapper || '{{previousPlan}}';
                        filled = wrapper.replace('{{previousPlan}}', lastJson) + '\n\n' + filled;
                    }
                }
            }
        }

        // Auto-inject character profiles if the template lacks the placeholder
        if (settings.profileEnabled && !promptTemplate.includes('{{character_profiles}}')) {
            const profilesText = buildCharacterProfilesText();
            if (profilesText) {
                filled = profilesText + '\n\n' + filled;
            }
        }

        const ctx = getContext();
        let response;
        let attempts = 0;
        while (attempts < maxRetries) {
            if (generationStopped) {
                console.warn('[GroupDirector] Director LLM aborted by user');
                llmPickedSet = new Set();
                llmPickedAvatars = null;
                return;
            }
            attempts++;
            try {
                response = await ctx.generateRaw({ prompt: filled });
                generationStopped = false;
                break; // success
            } catch (err) {
                if (generationStopped || err?.name === 'AbortError') throw err;
                console.warn(`[GroupDirector] Director LLM attempt ${attempts}/${maxRetries} failed:`, err.message);
                if (attempts < maxRetries) {
                    toastr.warning(`Director 决策失败 (${attempts}/${maxRetries})，正在重试...`);
                    await new Promise(r => setTimeout(r, 2000));
                }
            }
        }
        if (!response) {
            throw new Error('Director LLM failed after ' + maxRetries + ' attempts');
        }

        // Clear quiet prompt extension to prevent Director text leaking
        // into subsequent character generation prompts.
        setExtensionPrompt(inject_ids.QUIET_PROMPT, '', extension_prompt_types.IN_PROMPT, 0, true);

        log('LLM raw response:', response);

        const parsed = parseLlmResponse(response, log);
        if (!parsed || !Array.isArray(parsed.speakers) || parsed.speakers.length === 0) {
            log('LLM returned no valid speakers');
            return;
        }

        // Save full parsed JSON to history (independent of continuity injection)
        if (settings.llmHistoryEnabled) {
            await addToDirectorHistory(parsed);
        }

        // Map names → avatars in declared order; dedupe
        const orderedAvatars = [];
        const seen = new Set();
        for (const name of parsed.speakers) {
            const c = matchCharacterByName(name, enabledMembers);
            if (c && !seen.has(c.avatar)) {
                seen.add(c.avatar);
                orderedAvatars.push(c.avatar);
            } else if (!c) {
                log(`LLM returned unrecognized name: "${name}" — skipped`);
            }
        }

        // Cap at maxSpeakers
        const capped = orderedAvatars.slice(0, settings.llmMaxSpeakers);

        if (capped.length === 0) {
            log('LLM names did not match any group member. Speakers returned:', parsed.speakers);
            return;
        }

        llmPickedAvatars = capped;
        llmPickedSet = new Set(capped);
        llmCursor = 0;

        // Validate: every picked avatar must be a current enabled group member
        for (const av of capped) {
            if (!enabledMembers.includes(av)) {
                console.warn(`[GroupDirector] VALIDATION FAILED: picked avatar ${av} not in enabled members! Removing.`);
                llmPickedSet.delete(av);
            }
        }
        llmPickedAvatars = capped.filter(av => llmPickedSet.has(av));
        if (llmPickedAvatars.length === 0) {
            console.warn('[GroupDirector] All picked speakers failed validation — aborting director round');
            llmPickedAvatars = null;
            llmPickedSet = null;
            return;
        }

        // Store director script if present
        // Store per-character scripts from LLM response
        directorScripts = {};
        if (settings.llmScriptEnabled && parsed.scripts && typeof parsed.scripts === 'object') {
            for (const [name, script] of Object.entries(parsed.scripts)) {
                if (script && typeof script === 'string') {
                    // Match to actual character name
                    const c = matchCharacterByName(name, enabledMembers);
                    if (c) directorScripts[c.name] = script;
                }
            }
        }
        // Fallback: single script field → assign to all picked characters
        if (Object.keys(directorScripts).length === 0 && settings.llmScriptEnabled && parsed.script) {
            for (const a of capped) {
                const c = characters.find(c => c.avatar === a);
                if (c) directorScripts[c.name] = parsed.script;
            }
        }

        // If strict order requested, takeover the round: suppress ST's loop
        // then manually drive generation in LLM's declared order.
        if (settings.llmRespectOrder) {
            takeoverPending = true;
            console.warn('[GroupDirector] TAKEOVER SET — suppressing ST order, picked:', capped.map(a => characters.find(c => c.avatar === a)?.name));
        }

        log('LLM picked order:', capped.map(a =>
            characters.find(c => c.avatar === a)?.name).join(' → '),
            parsed.reason ? `(${parsed.reason})` : '');
    } catch (e) {
        if (generationStopped || e?.name === 'AbortError') {
            // User-initiated pause — no retry, no history reuse, no toastr. Just stop.
            console.warn('[GroupDirector] Director LLM aborted by user');
            llmPickedSet = new Set();
            llmPickedAvatars = null;
            return;
        }
        console.error(`[GroupDirector] Director LLM failed after retries:`, e.message || e);
        // Fallback: reuse the last known director plan from history
        const history = getDirectorHistory();
        const lastPlan = history[history.length - 1];
        if (lastPlan && Array.isArray(lastPlan.speakers) && lastPlan.speakers.length > 0) {
            toastr.warning(`导演决策失败（已重试${maxRetries}次），正在复用上一轮决策...`);
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
                if (settings.llmRespectOrder) {
                    takeoverPending = true;
                }
                return;
            }
        }
        // No history — block the round instead of transparent pass-through
        toastr.error(`导演决策失败（已重试${maxRetries}次），且无历史记录。请检查网络后重试。`);
        console.warn('[GroupDirector] Director failed and no history — round blocked');
        // Set to empty to block all characters (safer than letting chaos through).
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
{{recentMessages}}

Available characters:
{{characters}}

Character profiles (detailed analysis):
{{character_profiles}}

---
You are a Group Chat Director. Decide which characters should respond next, and in what order.

Rules:
- Pick at most {{maxSpeakers}} character(s).
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

Reply with ONLY a JSON object, no prose, no code fences:
{
  "speakers": ["NameOfFirstSpeaker", "NameOfSecondSpeaker"],
  "reason": "short justification"`;

    if (settings.llmScriptEnabled) {
        base += `,
  "scripts": {
    "NameOfFirstSpeaker": "short imperative stage direction",
    "NameOfSecondSpeaker": "short imperative stage direction"
  }`;
    }

    base += `,
  "loreAssignments": {
    "NameOfFirstSpeaker": ["exact entry name", "another entry"],
    "NameOfSecondSpeaker": []
  }
}`;
    return base;
}


// ─── Slash Commands ───────────────────────────────────────────────────
// TODO: Register slash commands for manual director control

// ─── Register Built-in Providers ──────────────────────────────────────
registerRecentMessages();
registerCharacters(settings, characters, buildCharacterProfilesText);
registerCharacterProfiles(buildCharacterProfilesText);

// MaxSpeakersProvider — kept inline (single-line, no deps needed)
registerProvider({
    id: 'maxSpeakers',
    placeholder: '{{maxSpeakers}}',
    render: (ctx) => ({ content: String(ctx.maxSpeakers || 1) }),
});

registerWorldInfoProvider(settings, wiState, buildDirectorWorldInfo);
registerHistoryProviders(settings, getDirectorHistory);
registerDirectorLedger(settings, getDirectorHistory);
registerTestProvider();
registerWorldBooks(worldBookScanner);
registerWorldBookImportance(worldBookScanner, () => settings.worldBookMaxEntries);
registerCharacterLore(getDirectorHistory);

// ─── Init ─────────────────────────────────────────────────────────────
jQuery(async () => {
    await loadSettingsUI({
        settings, EXT_KEY, chat_metadata, saveChatConditional, saveSettings,
        getCurrentGroup, getDefaultLlmPrompt, generateProfilesBatch, getProfiles,
        getDefaultProfileGeneratorPrompt, getDefaultProfileSchema, getDefaultProfileRenderTemplate,
        refreshProfileManagementUI, checkProfileStartupStatus, buildProfileLoaderPanel,
        detectCharacterChanges, validateAndWarnProfilePlaceholders,
        toastr, world_names, loadWorldInfo,
    });
    console.log(`Group Director extension loaded (mode=${settings.mode})`);
});
