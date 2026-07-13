# Group World — Design Document

## 1. Overview

Group World is a **group-chat context pipeline**: collect data → Agent decision → inject character prompt.

It ships with 9 Agent groups by default: Director, ForceSpeak, Profile, Summary, NPC, Memory, PostSpeech (multimodal strategy), Critique, and Custom Agent (user-defined — not registered as an Agent, calls LLM directly through the system). The first 8 Agents each have independent API configurations; Custom Agent shares the `custom-agent` API configuration.

The framework is not bound to any specific use case — replace prompt templates to implement dungeon master, debate referee, combat system, social simulation, and other scenarios.

### 1.1 Four-Layer Architecture

```
┌── Agent Registry ─────────────────────────────────────────────────┐
│   register(agent) / get(id) / list()                              │
│   Agent = { id, pipelineOrder, pipeline, contextAccess }          │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ┌─ Agent Layer ───────────────────────────────────────────────┐  │
│  │  agent.run({ pool, caller, config })                        │  │
│  │  Declares pipeline: context → prompt → call → parse → validate │
│  │  Declares contextAccess: permission boundary                 │  │
│  ├─────────────────────────────────────────────────────────────┤  │
│  │  Runtime Layer                                               │  │
│  │  execute() — state-driven execution by pipelineOrder         │  │
│  │  createScopedPool() — Proxy-enforced contextAccess           │  │
│  │  managedCall() — retry + timeout + onRetry callback          │  │
│  ├─────────────────────────────────────────────────────────────┤  │
│  │  Protocol Layer                                              │  │
│  │  createCaller(config) — ST Native / OpenAI / Anthropic       │  │
│  │  config.agentConfigs[id] → extension_settings (Key is here)  │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                    │
├── Provider Layer ──────────────────────────────────────────────────┤
│   {{placeholder}} → data injection (stateless)                      │
├── Systems Layer ────────────────────────────────────────────────────┤
│   Stateful business logic (factory + dependency injection)          │
├── UI Layer ─────────────────────────────────────────────────────────┤
│   Dashboard + 5 drawers + card system + self-registration pattern   │
│   (registerSection)                                                  │
└────────────────────────────────────────────────────────────────────┘
```

### 1.2 Key Design Decisions

| Decision | Rationale |
|------|------|
| Agent = declarative pipeline | Runtime executes; Agent doesn't touch control flow — traceable, debuggable |
| contextAccess per Agent | Proxy-enforced; unauthorized access warn/throw; prevents data contamination |
| Unified callModel governance | retry + timeout + fallback; not scattered everywhere |
| Independent Protocol layer | Agents unaware of OpenAI/Anthropic differences; adding a protocol only changes one file |
| Keys stored in extension_settings | Not exported with chat; survives restarts |
| Mutable values via getters | `chat`/`characters`/`chat_metadata` are ST's `export let` |
| Zero ST core modifications | Pure Extension API: `generate_interceptor` + `abort(false)` |
| Dashboard always visible | State (mode, decision, stats) shouldn't be hidden in drawers |
| Cards collapsed by default + state persisted | 100+ config items can't all be flat; `settings.uiState.cardStates` records collapse state |

---

## 2. Agent Runtime (Core)

### 2.1 Agent Definition

```js
const directorAgent = {
  id: 'director',
  displayName: 'Director',
  contextAccess: ['chat', 'recentMessages', 'characters', 'profiles', ...],
  pipelineOrder: ['context', 'prompt', 'call', 'parse', 'validate'],
  pipeline: {
    async context(input, ctx, pool, config) { /* → state.ctx */ },
    async prompt(input, ctx, pool, config)  { /* → state.prompt */ },
    // call: null → Runtime unified governance (managedCall)
    async parse(input, ctx, pool, config)   { /* → state.parsed */ },
    async validate(input, ctx, pool, config){ /* → state.parsed */ },
  },
};
```

- `contextAccess`: Declares which pool keys this Agent needs to access. Undeclared keys are intercepted by Proxy.
- `pipelineOrder`: Stage execution order. Stages not in the list are not executed — naturally optional.
- `pipeline.call = null`: Governed by Runtime (retry + timeout). Agents can also implement custom `call`.

### 2.2 Execution Engine (execute)

```
execute(agent, { pool, caller, config })
  │
  ├─ createScopedPool(pool, contextAccess, agent, config)
  │    → Proxy enforce: strictMode=true → throw; false → warn+undefined
  │    → Records usedAccess Set
  │
  ├─ for (stage of pipelineOrder)
  │    ├─ 'call' + null → managedCall(caller, prompt, callConfig)
  │    ├─ other stages → fn(input, state.ctx, scoped, config)
  │    └─ state[stage] = result
  │
  └─ console.log(accessReport) // declared vs actual usage diff
```

**State Object**: `{ ctx, prompt, raw, parsed }` — each stage reads and writes explicit keys, no mixing.

### 2.3 Context Pool

```js
buildContextPool({ group, enabledMembers, ... }) → {
  chat:           () => chat,
  recentMessages: (n) => chat.slice(-n),
  characters:     () => characters,
  profilesText:   () => buildCharacterProfilesText(),
  worldInfoText:  () => wiState.text,
  ledger:         () => getDirectorHistory(),
  group:          () => group,
  settings:       () => settings,
  // ... per-agent overrides
}
```

Agents declare which fields they need via `contextAccess`. The Pool enforces constraints through Proxy.

### 2.4 Execution Trace (Observability Layer)

Agent execution is fully traceable. Enable via `config.enableTrace = true`; zero overhead when disabled.

| Principle | Implementation |
|------|------|
| append-only | Each entry is `Object.freeze()`-d after writing, immutable |
| No control flow involvement | Trace variables never appear in `if/return/throw`; only push |
| Shallow copy | External data snapshots only copy metadata (length, key lists) |
| Disabled by default | `config.enableTrace` not passed = zero overhead |

#### Data Structure

```js
trace.snapshot() → {
  agentId: 'director',
  startTime: '2026-06-20T...',
  stages: [
    { stage: '_start', pipeline: ['context','prompt','call','parse','validate'],
      contextAccess: ['chat','recentMessages',...], time: ..., elapsed: 0 },
    { stage: 'context', duration: 1.2, outputSummary: { type:'object', keys:[...] } },
    { stage: 'prompt',  duration: 45.3, outputSummary: { type:'text', length: 3200 } },
    { stage: 'call',    duration: 2100, retries: 1, promptLength: 3200 },
    { stage: 'parse',   duration: 0.3, outputSummary: { type:'object', keys:['speakers','reason'] } },
    { stage: 'validate', duration: 0.1, outputSummary: { type:'object', keys:['speakers'] } },
    { stage: '_done', result: { type:'object', keys:[...] }, contextUsed: ['chat','recentMessages',...] }
  ],
  contextUsed: ['chat', 'recentMessages', 'characters', ...]
}
```

### 2.5 Protocol Layer (createCaller)

```js
createCaller(config, stGenerateRaw) → { generate(prompt), test() }

config.useCustom = false → ST native generateRaw
config.useCustom = true  → openaiCompatible / anthropicCompatible

// OpenAI:  POST {base}/v1/chat/completions
// Anthropic: POST {base}/v1/messages (anthropic-version: 2023-06-01)
```

### 2.6 Agent Registration

```js
AgentRegistry.register(createDirectorAgent({ renderPrompt, ... }));
AgentRegistry.register(createForceSpeakAgent({ renderPrompt, ... }));
AgentRegistry.register(createProfileAgent({ renderPrompt, ... }));
AgentRegistry.register(createSummaryAgent({ log }));
AgentRegistry.register(createCritiqueAgent({ log }));
AgentRegistry.register(createNpcAgent({ renderPrompt, ... }));
AgentRegistry.register(createMemoryAgent({ renderPrompt, ... }));
AgentRegistry.register(createPostSpeechAgent({ renderPrompt, log }));
```

### 2.7 Configuration Storage

```js
settings.agentConfigs = {
  'director':    { useCustom: false, protocol: 'openai', endpoint: '', apiKey: '',
                   model: '', call: { retries: 2, timeout: 30000 }, strictMode: false },
  'force-speak': { ... },
  'profile':     { ... },
  'summary':     { ... },
  'npc':         { ... },
  'memory':      { ... },
  'post-speech': { ... },
  'custom-agent': { ... },  // All Custom Agent instances coexist
};
```

Stored in `extension_settings[EXT_KEY].agentConfigs`. Not mixed with chat data; not leaked on export.

---

## 3. Provider System

### 3.1 Interface

```js
registerProvider({
    id: 'myFeature',
    placeholder: '{{myFeature}}',
    render: async (ctx) => ({
        content: 'summary text',        // {{myFeature}} → this text
        data: { key: 'val' },          // {{?myFeature:key}} → "val"
    }),
});
```

### 3.2 Registered Providers (33 built-in + N Custom Agent dynamic registrations)

| Provider | Placeholder | Description |
|----------|--------|------|
| `recentMessages` | `{{recentMessages}}` | Recent N messages |
| `newRecentMessages` | `{{newRecentMessages}}` | Smart context window |
| `characters` | `{{characters}}` | Character list |
| `character_profiles` | `{{character_profiles}}` | Character profiles |
| `maxSpeakers` | `{{maxSpeakers}}` | Max speakers per round |
| `worldInfo` | `{{worldInfo}}` | ST world book entries |
| `previousPlan` | `{{previousPlan}}` | Previous round Director plan |
| `previousPlans` | `{{previousPlans}}` | Historical Director plans array |
| `directorLedger` | `{{directorLedger}}` | Latest Director plan JSON |
| `directorHistory` | `{{directorHistory}}` | Full Director history JSON |
| `llmJsonSchema` | `{{llmJsonSchema}}` | User-editable JSON output format template, containing `{{scriptField}}` |
| `scriptField` | `{{scriptField}}` | Expands to scripts field fragment when scripts enabled, or emptied when disabled |
| `worldBooks` | `{{worldBooks}}` | Activated world book list |
| `worldBookImportance` | `{{worldBookImportance}}` | Entry importance ranking |
| `characterLore` | `{{characterLore}}` | Character world book trigger words |
| `chatSummary` | `{{chatSummary}}` | Context summary |
| `directorCritique` | `{{directorCritique}}` | Director critique (readable text) |
| `characterCritique` | `{{characterCritique}}` | Full character critiques (JSON + DSL) |
| `charCritique` | `{{charCritique}}` | Current character critique (readable, auto-resolves character name) |
| `npcList` | `{{npcList}}` | NPC list + path queries |
| `charMemory` | `{{charMemory}}` | All character memories |
| `charMemoryCurrent` | `{{charMemoryCurrent}}` | Current speaking character's memory |
| `importedSummary` | `{{importedSummary}}` | Imported summaries (independent storage) |
| `identity` | `{{identity}}` | Identity anchor prompt |
| `systemTime` | `{{systemTime}}` | System date/time |
| `randomDice` | `{{randomDice}}` | 0.00-1.00 random number |
| `dice` | `{{dice}}` | Dice + luck value |
| `moonPhase` | `{{moonPhase}}` | Moon phase |
| `timeOfDay` | `{{timeOfDay}}` | Time of day + season |
| `knowledge` | `{{knowledge}}` | Knowledge base raw text |
| `script` | `{{script}}` | Current character's Director script (Character Prompt Injection Template only) |
| `importedCritique` | `{{importedCritique}}` | Imported critiques (independent storage) |
| `test` | `{{test}}` | Template syntax test |

### 3.3 Coding Rules

- Providers with switches return empty string inside `render()`, don't use `enabled` to skip
- Mutable values passed via getters
- `settings.js` is the single source of truth for defaults

---

## 4. Template Rendering Engine (prompt-renderer.js)

### 4.1 Five-Phase Pipeline

```
Phase 0   — {[{...}]} passthrough slots → sentinel replacement
Phase 1   — Execute all Providers, cache to cache[id] = { content, data }
Phase 1.5 — Block loops {{#provider:path}}...{{/provider}}
Phase 2   — Simple placeholders {{name}} → cache[id].content
Phase 3   — Path queries {{?name:path|fallback}}
Post      — Recursive stabilization → restore passthrough slots
```

### 4.2 Path Query Syntax

```
{{?directorLedger:scripts.$character}}
{{?history:plans[reason=开场].scripts}}
{{?directorLedger:events[-1].title}}
{{?worldBooks:allEntries[comment=地理与空间].content}}
```

### 4.3 Runtime Variables

| Variable | Context | Meaning |
|------|------|------|
| `$character` | Script Wrapper | Current character name |
| `$speakerIndex` | Script Wrapper | Speaking order (1-based) |
| `$speakerIndex0` | Script Wrapper | Speaking order (0-based) |
| `$speakerCount` | Script Wrapper | Total speakers this round |
| `$it` | Inside block loops | Current iteration element |

---

## 5. World Book Pipeline

```
User checks world books
  ↓
worldBookScanner.scanAll()
  ↓
{{worldBookImportance}} → Director Prompt: entry name + keywords + importance
  ↓
Director returns loreAssignments: { "Alice": ["entry1", "entry2"] }
  ↓
{{characterLore}} → Script Wrapper: [World lore: entry1, entry2]
  ↓
ST checkWorldInfo detects keywords → activates entries → injects content
```

---

## 6. Modes

### 6.1 `off` — Disabled
Does not interfere with ST's default behavior. force-speak is not affected.

### 6.2 `formula` — Formula Scoring
Local scoring, zero API calls:

```
score(c) = mention(c)×w_mention + trigger(c)×triggerScore
         + recency(c)×w_recency − consecutive(c)×w_consecutivePenalty
         + talkativeness(c)×w_talkativeness + initiative(c)
```

CJK character names use `indexOf` substring matching; ASCII names use `\b` word boundary regex.

### 6.3 `llm` — LLM Decision
Invokes LLM through the Director Agent:
1. Agent context stage collects context
2. Agent prompt stage renders template
3. Runtime managedCall sends the request
4. Agent parse stage parses JSON (supports pass-through of extra fields to ledger)
5. Agent validate stage validates speakers

Failure fallback: 3 retries → reuse historical plan → block the round.

**JSON Schema Auto-Injection**: When Director and ForceSpeak Agents detect that the custom template doesn't contain the `{{llmJsonSchema}}` placeholder during the prompt stage, they automatically call `buildJsonSchema()` to append the schema text to the end of the prompt. `buildJsonSchema()` uses `??` (not `||`) to handle empty values, respecting the user's intent when clearing textareas; it also strips the `{{llmJsonSchema}}` literal to prevent self-referential recursion. The `{{scriptField}}` placeholder inside is expanded to a scripts field fragment (when scripts enabled) or an empty string (when disabled).

**ledger_update free-form record field**: The default schema reserves `"ledger_update": {}` as an LLM catch-all output. This is a completely open object field—the LLM can decide on its own to write any observed information (plot, foreshadowing, emotions, new NPCs, etc.) into it. Data is persisted with the Director ledger and queryable via `{{?directorLedger:ledger_update.xxx}}`. No pre-declaration of field structure is needed.

---

## 7. Interceptor State Machine

```
GROUP_WRAPPER_STARTED
  ├─ takeoverGenCount > 0 → return (nested sub-call)
  ├─ takeoverFailed → reuse old plan
  ├─ swipe/regenerate → rebuild/passthrough/reuse
  └─ normal new round → clear state

Interceptor
  ├─ force-speak detection (executes first, unaffected by mode disable)
  ├─ first character → Formula/Agent initialization
  ├─ takeover → verify identity + inject script
  └─ filter → not in pickedSet → abort

GROUP_WRAPPER_FINISHED
  ├─ takeoverPending → runManualOrderedGeneration()
  └─ cleanup

GENERATION_STOPPED → generationStopped = true
MESSAGE_DELETED → trim ledger + trim summary + clear state
CHAT_CHANGED → trim ledger + trim summary (branch/switch)
```

---

## 8. How to Add a New Agent

1. Create `agents/xxx.js` → declare `{ id, displayName, contextAccess, pipelineOrder, pipeline }`
2. In `index.js`, call `AgentRegistry.register(createXxxAgent({...}))`
3. UI auto-generates config blocks from `AgentRegistry.list()`

---

## 9. UI Architecture (v2)

### 9.1 Overall Structure

```
┌── Dashboard (always visible) ──────────────────────────────────────┐
│   Status light · Last decision · Statistics · Quick actions · Presets│
├──────────────────────────────────────────────────────────────────┤
│  ▼ Director — Mode / LLM params / Scripts / Continuity / World Books / Force Speak │
│  ▼ Characters — Profile cards / Memory cards / NPC cards / Identity Anchor cards   │
│  ▼ Continuity — Summary cards / Ledger cards / World Book cards                    │
│  ▼ Reactions — PostSpeech Message cards / PostSpeech Round cards / Capability cards│
│  ▼ Tools — Config Profile cards / Export/Import cards / Agent cards / Custom Prompt cards │
│           / User Extension cards / API Reference cards / Script Executor cards / Debug cards │
└──────────────────────────────────────────────────────────────────┘
```

### 9.2 Design Principles

- **Dashboard is the information layer**: Mode indicator, last decision summary, data statistics (including world books), quick actions. Not part of any drawer—always visible. MutationObserver auto-triggers refresh when settings panel opens; other sections trigger updates via `window.__gdRefreshDashboard`.
- **Cards are the content layer**: Each functional module is a collapsible card. Title bar shows name + status label (e.g., `3 ready`, `off`). Collapse state persisted via `settings.uiState.cardStates`.
- **Drawers are the category layer**: 5 drawers organized by user mental model (Director/Characters/Continuity/Reactions/Tools), replacing the old 10 drawers organized by code modules.

### 9.3 Self-Registration Pattern

UI sections register via `registerSection(name, initFn)`. `initAllSections(ctx)` initializes them all. Sections communicate through:

| Mechanism | Purpose |
|------|------|
| `window.__gdRefreshDashboard` | Trigger dashboard data refresh |
| `window.__gdRefreshConfigList` | Trigger config profile list refresh |
| `ctx` shared dependencies | settings, saveSettings, system instances |

### 9.4 Auto-Refresh on Open

A `MutationObserver` watches the `#gd-settings-panel` element for `closedDrawer` class changes — when the user clicks the GD tab, the panel expands, and the observer detects the class removal, immediately triggering `refreshAll()`. No need to manually pull drawers to trigger a refresh.

### 9.5 Stats Panel Expansion & Inline Editing

All 5 stat tiles are clickable to expand inline panels. Each panel shares the `statPanels` configuration and unified `togglePanel()` control, with mutual exclusion (opening one auto-closes the previous). Expanded items support inline editing: hover a field to reveal an "Edit" button → textarea → Save/Ctrl+Enter writes back to the underlying data → `saveChatConditional()` persists. Edit buttons use event delegation, so rebuilt buttons after save remain editable.

### 9.6 World Book Selection Panel

The fifth stat tile in the dashboard stats bar, "World Books," shows the current checked/total count. Click to expand an inline panel with Select All/Deselect All buttons and a per-item checkbox list, sharing the same `settings.worldBookSelection` as the world book list in the Continuity drawer.

### 9.7 Dashboard Quick Action Buttons

| Button | Implementation | Visibility |
|------|------|----------|
| Scan Archive | Triggers profile scan + memory refresh | profile or memory enabled |
| Gen Profiles | Triggers `#gd-profile-regenerate-all` | profile enabled |
| Extract Memories | Directly calls `memorySystem.generateForCharacter()` | memory enabled |
| Run Summary | Triggers `#gd-summary-execute`; auto-enables if disabled | Always (in group chat) |
| Config Profile Dropdown | Built-in presets + user profiles (optgroup), select then Apply | Always |

### 9.8 Config Profile Sync

The dashboard and Tools drawer each have a config profile dropdown (`#gd-dash-cfg-preset` and `#gd-cfg-preset`), updated simultaneously via `refreshPresetSelector()`. Options are grouped with `<optgroup>`:
- **Built-in Profiles**: Read from `getConfigPresetNames()`, requires `loadConfigPreset` then `applyProfile` after selection
- **My Profiles**: Read from `configProfileSystem.getProfiles()`, value prefixed with `__prof__:id`, directly `applyProfile` after selection

Save/delete/import operations auto-refresh both dropdowns and the config profile list.

---

## 10. Directory Structure

```
SillyTavern-GroupWorld/
├── manifest.json
├── index.js                   # Entry point: assembly layer, runtime state, interceptor, event listeners
├── settings.js                # Constants + default settings (single source of truth)
├── settings.html              # Settings panel (dashboard + 5 drawers + cards)
├── style.css                  # Dashboard + cards + status light animations
├── prompt-renderer.js         # Five-phase template rendering engine
├── provider-registry.js       # Provider registry
├── DESIGN.md                  # This file
├── USER-GUIDE.md              # User guide
├── TEMPLATE-SYNTAX.md         # Template syntax reference
│
├── assets/                    # Pluggable resources
│   ├── profiles/              # Preset files (JSON)
│   │   ├── manifest.js        # profilePresets[] + npcPresets[] + configPresets[]
│   │   ├── fantasy-rpg.json
│   │   ├── npc-fantasy-tavern.json
│   │   └── group-director-default.json
│   ├── providers/             # 29 built-in Providers
│   │   ├── manifest.js
│   │   ├── chatSummary.js
│   │   ├── director-critique.js
│   │   ├── character-critique.js
│   │   ├── char-critique.js
│   │   └── ...
│   └── capabilities/          # 3 built-in Capabilities
│       ├── manifest.js
│       ├── emotion.js
│       ├── tts.js
│       └── image.js
│
├── agents/                    # Agent layer — one file per Agent
│   ├── director.js
│   ├── force-speak.js
│   ├── profile.js
│   ├── summary.js
│   ├── critique.js
│   ├── npc.js
│   ├── memory.js
│   └── post-speech.js
│
├── systems/                   # Stateful business logic
│   ├── agent-runtime.js       # execute + managedCall + createScopedPool + AgentRegistry + Trace
│   ├── capability-registry.js # CapabilityRegistry (multimodal capability registration)
│   ├── executor.js            # PostSpeech Executor (resolve→schedule→execute)
│   ├── history-system.js      # Director ledger CRUD
│   ├── world-info-system.js   # ST checkWorldInfo() wrapper
│   ├── asset-loader.js        # Dynamic import + register for assets/ modules
│   ├── user-provider-loader.js # User Provider/Capability import
│   ├── profile-system.js      # Character profile full workflow
│   ├── profile-export-system.js
│   ├── npc-system.js          # NPC generation + character card import
│   ├── npc-export-system.js
│   ├── memory-system.js       # Character memory full workflow
│   ├── memory-export-system.js
│   ├── post-speech-system.js  # PostSpeech decision persistence
│   ├── config-profile-system.js # Config profile management (with JSZip fallback loading)
│   ├── custom-prompts-system.js # Custom Prompt templates
│   ├── world-book-scanner.js  # World book scanning
│   ├── chat-summary-system.js # Context summarization
│   ├── critique-system.js     # AI critique
│   ├── summary-export-system.js
│   ├── export-import-system.js # Group chat export/import (JSZip fallback)
│   └── script-executor-system.js # Script executor engine
│
├── utils/                     # Pure function utilities
│   ├── custom-api.js          # createCaller (ST/OpenAI/Anthropic)
│   ├── path-resolver.js
│   ├── counter.js
│   ├── json-utils.js
│   └── string-utils.js
│
└── ui/                        # UI layer (self-registration pattern)
    ├── settings-init.js       # loadSettingsUI() entry point
    ├── i18n.js                # Chinese/English dictionary (single zh + single en block)
    ├── dom.js                 # $c() + bind helpers + bindSetting
    └── sections/              # One self-registering module per settings area
        ├── registry.js        # registerSection() / initAllSections()
        ├── dashboard.js       # Dashboard (v2)
        ├── modes.js           # Mode selection
        ├── formula.js         # Formula mode parameters
        ├── director.js        # LLM parameters, scripts
        ├── continuity.js      # Continuity mode
        ├── worldinfo.js       # World book toggles
        ├── worldBooks.js      # World book selection
        ├── ledger.js          # Ledger browser
        ├── forceSpeak.js      # Force speak
        ├── chatSummary.js     # Context summary
        ├── critique.js        # AI critique
        ├── summaryExport.js   # Summary export/import
        ├── templateTester.js  # Template tester
        ├── profile.js         # Character profiles
        ├── profileExport.js   # Profile export/import
        ├── npc.js             # NPC generation
        ├── npcExport.js       # NPC export/import
        ├── memory.js          # Character memory
        ├── memoryExport.js    # Memory export/import
        ├── configProfiles.js  # Config profile management
        ├── quickStart.js      # Quick start (superseded by dashboard, kept for backward compatibility)
        ├── identity.js        # Identity anchor
        ├── exportImport.js    # Group chat export/import
        ├── postSpeech.js      # PostSpeech configuration
        ├── executionTrace.js  # Execution trace
        ├── userProviders.js   # User extension management
        ├── providerReference.js # API reference
        ├── customPrompts.js   # Custom prompts
        ├── agents.js          # Agent API independent configuration (dynamically generated)
        └── scriptExecutors.js # Script executor UI
```

---

## 11. Configuration Overview

| Field | Default | Description |
|------|------|------|
| `mode` | `formula` | `off` \| `formula` \| `llm` |
| `topN` | 1 | Formula mode pass-through count |
| `recentMessageCount` | 10 | Recent messages to analyze |
| `consecutivePenalty` | 15 | Consecutive speech penalty |
| `scoreWeights.*` | (see settings.js) | Scoring weights |
| `triggerEnabled` / `triggerScore` | true / 40 | Trigger engine |
| `initiativeEnabled` / `initiativeBaseScore` | true / 5 | Initiative perturbation |
| `llmPrompt` | (built-in) | Director Prompt template |
| `llmMaxSpeakers` | 3 | Max speakers per round |
| `llmRespectOrder` | true | Strict ordered speech |
| `llmContextDepth` | 10 | Recent messages passed to LLM |
| `llmCharDescMode` / `llmCharDescLength` | slice / 200 | Character description control |
| `llmScriptEnabled` | false | Enable Director scripts |
| `llmScriptPrompt` | '' | Script style requirements |
| `llmScriptWrapper` | (built-in) | Script injection wrapper template |
| `llmJsonSchema` | (built-in) | JSON output format template, containing `{{scriptField}}` and `ledger_update` |
| `llmHistoryEnabled` | true | Record Director ledger |
| `llmScriptContinuity` | false | Continuity scripts |
| `llmWorldInfoEnabled` | false | World book injection |
| `templateMaxPasses` | 5 | Max recursive rendering rounds |
| `templateRecursive` | true | Enable recursive rendering |
| `templateDebugPlaceholders` | false | Preserve unregistered placeholders |
| `identityPrompt` | '' | Identity anchor prompt |
| `forceSpeakMode` | `native` | `native` \| `block` \| `llm` |
| `postSpeechMessageEnabled` | false | Trigger PostSpeech after each message |
| `postSpeechRoundEnabled` | false | Trigger PostSpeech after round end |
| `postSpeechBlocking` | true | PostSpeech blocking mode |
| `agentConfigs` | `{}` | Per-Agent independent API config |
| `uiState` | `{ cardStates: {} }` | UI persisted state (card collapse) |
| `customPrompts` | `[]` | Custom Prompt list |
| `customPromptsEnabled` | `true` | Custom Prompt master switch |
| `scriptExecutors` | `[]` | Script executor list |
| `autoMemorySpeakers` | `false` | Auto-memory only extracts speaking characters |
| `critiqueEnabled` | `false` | Enable AI critique |
| `critiqueReuse` | `false` | Reuse last critique |
| `critiqueAuto` | `false` | Auto-critique |
| `critiqueAutoInterval` | `5` | Trigger auto-critique every N messages |
| `critiquePrompt` | `''` | Critique system prompt (custom) |
| `critiqueSchema` | `''` | Critique output JSON Schema (custom) |

---

## 12. Script Executor

User-written JS scripts that execute at three trigger points in the Director lifecycle. Not an Agent, no LLM calls, pure local JS runtime.

### 12.1 Trigger Point Lifecycle

```
GROUP_WRAPPER_STARTED  → turnShared = {}, reset dedup flags
  ↓
Director decision (LLM/Formula)
  ↓
┌─ decision hook (blocking, await all, 10s timeout) ──────────┐
│  ctx.decision.speakers / .names / .reason / .scripts        │
│  Scripts can directly modify ctx.decision (live reference)  │
│  Modified snapshot serves message/round stages as read-only │
└─────────────────────────────────────────────────────────────┘
  ↓
Character generation one by one → message hook (fire-and-forget, 5s timeout)
  ↓
GROUP_WRAPPER_FINISHED → round hook (fire-and-forget, dedup)
  ↓
Next round GROUP_WRAPPER_STARTED → turnShared reset
```

### 12.2 Trigger Modes

| Mode | Trigger Point | Execution | ctx-unique Fields |
|------|--------|----------|-------------|
| `message` | CHARACTER_MESSAGE_RENDERED | fire-and-forget, 5s timeout | `ctx.message`, `ctx.character`, `ctx.decisionSnapshot` |
| `round` | GROUP_WRAPPER_FINISHED | fire-and-forget, dedup, 5s timeout | `ctx.decisionSnapshot` |
| `decision` | After Director decision | blocking await all, 10s timeout | `ctx.decision` (live, mutable) |
| `both` | message + round | same as respective modes | Phase-specific fields |
| `all` | All three | same as respective modes | Phase-specific fields |

### 12.3 ctx Shape

The three phases have different `ctx` shapes, providing phase-appropriate fields:

| Field | decision | message | round |
|------|:---:|:---:|:---:|
| `ctx.params` | ✓ | ✓ | ✓ |
| `ctx.shared` (turnShared) | ✓ | ✓ | ✓ |
| `ctx.decision` (live) | ✓ | - | - |
| `ctx.decisionSnapshot` (read-only) | - | ✓ | ✓ |
| `ctx.message` | - | ✓ | - |
| `ctx.character` | - | ✓ | - |
| `ctx.chat` | ✓ | ✓ | ✓ |
| `ctx.characters` | ✓ | ✓ | ✓ |
| `ctx.group` | ✓ | ✓ | ✓ |
| `ctx.settings` | ✓ | ✓ | ✓ |
| `ctx.getContext` | ✓ | ✓ | ✓ |

### 12.4 Shared State (turnShared)

Module closure variable, not persisted to settings:

- **Creation**: `resetTurnShared()` resets to `{}` on `GROUP_WRAPPER_STARTED`
- **Write**: Script sets `returnMode: 'shared'` and returns an object → `Object.assign(turnShared, result)`
- **Read**: All scripts read current snapshot via `ctx.shared`
- **Lifetime**: decision → message → round throughout, reset next round

After the decision phase completes, `decisionSnapshot = { decision: deepClone, shared: {...turnShared} }` is provided as read-only for message/round scripts.

### 12.5 Data Structure

```js
{
  id: 'se_xxx',
  name: 'My Script',
  triggerOn: 'decision',     // 'message' | 'round' | 'decision' | 'both' | 'all'
  priority: 0,               // Ascending execution order
  code: '...',               // JS code body, executed via new Function('ctx', code)
  enabled: true,
  params: [{ key, label, type, default }],  // Typed parameters
  renderParams: false,       // Whether to render string params (single pass, string fields only)
  returnMode: 'ignore',      // 'ignore' | 'shared'
}
```

### 12.6 Execution Model

```
Filter enabled && triggerOn match → sort by priority ascending →
  new Function('ctx', code) per script → Promise.race(script, timeout) →
    success + returnMode='shared' → Object.assign(turnShared, result)
    timeout/exception → trace record → continue to next
```

- **decision**: Blocking, await all complete then return snapshot
- **message/round**: Fire-and-forget, does not block character generation
- Execution trace recorded via `AgentTrace` for per-stage duration and status

### 12.7 Import/Export

Export format: `{ version: 1, type: 'script-executor-export', exportedAt, executors: [...], migrations: [] }`

Import prompts confirmation for same-name overwrite. Config profile management includes scriptExecutors.

---

## 13. PostSpeech Multimodal Strategy

### 13.1 Architecture

```
Character speaks → CHARACTER_MESSAGE_RENDERED → PostSpeech Agent (per-message)
Round end → GROUP_WRAPPER_FINISHED             → PostSpeech Agent (per-round)
                                                       ↓
                                             LLM outputs policy JSON
                                                       ↓
                                             Executor: resolve → schedule → execute
                                                       ↓
                                             Capability.executor() → TTS / Image / ...
```

### 13.2 Capability System

**CapabilityRegistry** — independent of AgentRegistry:

```
Register: CapabilityRegistry.register({ id, displayName, description, promptHint, schema, executor, constraints })
Query: CapabilityRegistry.get(id) / list() / listEnabled()
Toggle: CapabilityRegistry.setEnabled(id, true/false)
```

---

## 14. Custom Agent — User-Defined LLM Agent

User-defined lightweight LLM Agents that auto-trigger every N rounds or execute manually. Users write a prompt + optional JSON schema; results are exposed for DSL consumption via the `{{providerName}}` Provider.

### 14.1 Design Highlights

- **No custom orchestration** — Each instance runs on GROUP_WRAPPER_FINISHED, independent of other systems
- **Shared API config** — `agentConfigs['custom-agent']`, not split per instance
- **Independent per-instance counters** — `_autoCAG_{id}` in chat_metadata, no cross-interference
- **Ordering** — User fills in an order number; execute serially in ascending order
- **Dynamic Provider registration** — `providerName` field → `{{providerName}}` → DSL queries
- **Disabled = Provider deactivated** — enabled=false returns '' from render()
- **No proactive data cleanup** — Deleting an instance unregisters the Provider; data silently remains in chat_metadata

### 14.2 Data Model

settings:
```js
customAgents: [
  {
    id: 'ca_xxx',
    name: 'Faction Tracker',
    providerName: 'factionTracker',
    prompt: 'Analyze recent messages...',
    schema: '',     // Optional JSON schema; empty = no parsing
    enabled: false,
    autoEnabled: false,
    autoInterval: 10,
    order: 1,
  }
]
```

chat_metadata storage:
```js
chat_metadata[EXT_KEY]._caData = {
  'ca_xxx': {
    rangeEnd: 42,
    content: 'raw LLM output',
    data: { ... },  // Parsed JSON (if schema provided)
    timestamp: ...,
  }
}
```

### 14.3 Auto-Trigger

Executes within GROUP_WRAPPER_FINISHED, after Critique. Sorted by order, each instance checks `chat.length - checkpoint >= interval`, and if met, calls `customAgentSystem.execute()`.

Each instance's independent checkpoint is stored as `chat_metadata[EXT_KEY]._autoCAG_{id}`, with a three-way branch (first-enable / deletion / normal) following the same pattern as Summary/Critique.

### 14.4 Provider Rendering

The Provider render closure captures the instance's `id`. Each call checks `settings.customAgents.find(a => a.id === capturedId && a.enabled)` to confirm the instance still exists and is enabled. Returns `''` when not found or disabled.

---

## 15. Export/Import System

Group World provides full export/import capability for five data types:

| | Profile | NPC | Summary | Memory | Config |
|------|------|------|------|------|------|
| Granularity | Per character | Per entry | One-click | Per character | Per drawer |
| Format | `.json` | `.json` | `.json` | `.json` | `.zip` |
| Storage | chat_metadata | chat_metadata | Independent key | chat_metadata | extension_settings |

### Global Config Export/Import (Config Profile System)

**Storage**: `settings.configProfiles = [{ id, name, description, drawers, settings }]`

**Export format**: `.zip` = `manifest.json` + optional `user-providers/*.js` + `user-capabilities/*.js`

**JSZip loading**: Uses `ensureJSZip()` with script tag fallback — tries `import()` first, then injects `<script>` tag on failure, compatible with non-module environments.

**UI location**:
- Dashboard: Config profile dropdown (built-in + user, optgroup) + Apply button + Import button
- Tools drawer → Config Profile card: Full management panel (save/export/delete/preset loading)

---

## 16. Custom Prompt Templates

Users create custom placeholders, auto-registered as `{{name}}` Providers.

**Storage**: `settings.customPrompts = [{ id, name, content, enabled }]`

**Naming rules**: Only `\w+` allowed; auto-detects naming conflicts with built-in Providers.

**Two-level control**: Master switch `customPromptsEnabled` + per-item `enabled`.

---

## 17. Asset Management & User Import

### AssetLoader

Unified loading of extension modules under `assets/`. Each subdirectory has a `manifest.js` → AssetLoader dynamically `import()`s + `register(deps)`.

### User Import System

Select `.js` → FileReader → store in `extension_settings` → Blob URL → `import(url)` → `register(deps)`. Auto-restored on restart. Core API injected via `register(deps)` parameter or `window.GroupWorld` global.

---

## 18. Failure Fallback

- Agent call failure → managedCall retries `retries` times → reuse history → block round
- User actively pauses → `generationStopped` flag → silent cutoff
- `selected_group` empty → transparent passthrough
- `type` is `quiet` / `impersonate` / `continue` → no interception
- Takeover mid-failure → `takeoverFailed = true`, retry reuse next time
- JSZip load failure → `import()` fails → script tag injection → 10s timeout error

---

## 19. Development Quick Reference

| Task | Files to Change |
|------|-----------|
| Add new Agent | `agents/xxx.js` (new) + `index.js` register + UI auto-generated |
| Modify Agent behavior | `agents/xxx.js` → pipeline stage methods |
| Add new protocol | `utils/custom-api.js` → add `makeXxxCaller()` |
| Add Prompt placeholder | `assets/providers/xxx.js` + manifest.js + `index.js` import/register |
| Add business logic module | `systems/*.js` (new) + `index.js` import/assemble |
| Add settings item | `settings.js` + `settings.html` + `ui/sections/*.js` |
| Add/modify UI area | `settings.html` + `ui/sections/newname.js` + `ui/settings-init.js` import |
| Add UI text | `ui/i18n.js` (one line each in zh+en) |
| Modify dashboard | `ui/sections/dashboard.js` |
| Modify rendering engine | `prompt-renderer.js` |
| Modify LLM response parsing | `utils/json-utils.js` |
| Add script executor trigger point | `systems/script-executor-system.js` + hook registration in `index.js` |
| Modify script executor UI | `ui/sections/scriptExecutors.js` |
| Add new Capability | `assets/capabilities/xxx.js` + one line in manifest |
| User import extension | Tools → User Extensions → select `.js` file |
| Modify interceptor behavior | `index.js` → `groupDirector_Interceptor` |

---

## 20. Development Standards

### Agent Standards

```
1. Must declare contextAccess  — Only access declared pool keys. Proxy-enforced.
2. Must declare pipelineOrder — Stages not in the list are not executed; naturally optional.
3. pipeline.call = null        — Governed by Runtime managedCall.
4. Agents never touch the network — Only receive caller.generate(). Protocol details fully isolated.
5. Adding a new Agent takes three steps — agents/xxx.js → index.js register → auto UI.
```

### Context Pool Standards

```
1. buildContextPool getter name = contextAccess declared key.
2. Agent-specific data passed via overrides → pool must register corresponding getter.
3. Forgetting to register a pool getter → Agent gets undefined → silent failure.
4. Mutable values passed via getter closures, not direct references.
```

### renderPrompt Calling Standards

```
1. Data replacement must happen before renderPrompt or via locals. Never post-hoc {{...}} string replacement.
2. Recursive rendering re-scans replaced text — if replaced content contains {{...}} it will be cleared.
3. Text containing user data → inject via locals + recursive: false.
```

---

## 21. Lessons Learned

| Pitfall | Cause | Lesson |
|----|------|------|
| CJK `\b` never matches Chinese names | JS regex `\b` has no word boundaries for CJK characters | Use `indexOf` loop substring matching |
| Two `{{...}}` systems conflict | renderPrompt Phase 2 clears Agent locals as unregistered Providers | Added `locals` mechanism |
| Director history stores avatars mixed with names | Two save paths with inconsistent formats | Unified to store names only |
| i18n file has multiple `en:` keys | Multiple appends cause duplicate object keys; last one overwrites all previous | Merge into single zh + single en block |
| `cp` doesn't overwrite existing files | In some environments `cp` silently skips same-content files | `rm -f` then `cp` |
| JSZip `import()` fails | Non-module JS files can't be loaded via `import()` | Script tag injection fallback |
| Config profile dropdowns out of sync | Dashboard and card share the same ID; two codebases overwrite each other | Separate IDs, `refreshPresetSelector()` updates both |

---

## 22. Security Notes

### 22.1 User Code Trust Model

Group World allows users to import and write custom code (User Providers, User Capabilities, Script Executors). This code runs in SillyTavern's page context with the same privileges as SillyTavern itself — including access to localStorage, making HTTP requests, and manipulating the DOM.

**Design decision**: The system trusts code written by the user themselves, but takes defensive measures against external imports (config profiles shared by others, script executor packages).

### 22.2 Defensive Measures

| Layer | Measure | Description |
|------|------|------|
| User Provider/Capability import | Static scan `DANGEROUS_PATTERNS` | Detects `eval`, `Function`, `fetch`, `XMLHttpRequest`, `WebSocket`, `import(`, and other dangerous APIs; displays red security warning on match |
| User Provider/Capability import | GUI security warning banner | Displays detected dangerous APIs prominently above the file list during import |
| Script Executor import | GUI security warning banner | Similarly displays detected dangerous APIs |
| Config profile import | Confirmation popup | Importing config profiles also imports userProviders/userCapabilities; ST native confirmation popup reminds users to check when clicking import |
| Config profile export | API Key stripping | `apiKey` in `agentConfigs` is automatically cleared on export |
| Config profile import | API Key stripping | `agentConfigs` is discarded on import to prevent endpoint hijacking |
| Script Executor | Execution timeout | Each script has a 10-second timeout; skipped on timeout, continues execution |
| Script Executor | Exception isolation | Individual script exceptions don't affect other scripts or the Director flow |

### 22.3 Destructive Operation Confirmations

All destructive operations use ST's native `callGenericPopup` + `POPUP_TYPE.CONFIRM` popup confirmation, no longer using browser native `confirm()`:

- Context Summary: Reset, Import, Manual Generation
- Character Memory: Reset, Extract, Compress, Delete, Rollback
- Config Profile: Import
- Script Executor: Import
- Custom Prompt: Import
- Dashboard: Reset
- User Provider: Delete
- Director Ledger: Clear
- NPC: Reset, Delete
- Profiles: Regenerate All

### 22.4 Static Code Scanning Rules

The `DANGEROUS_PATTERNS` regex array defined in `systems/user-provider-loader.js`:

```js
const DANGEROUS_PATTERNS = [
    /\beval\s*\(/,
    /\bnew\s+Function\s*\(/,
    /\bfetch\s*\(/,
    /\bXMLHttpRequest\b/,
    /\bWebSocket\b/,
    /\bimport\s*\(/,
    /\bdocument\.cookie\b/,
    /\blocalStorage\b/,
    /\bsessionStorage\b/,
    /\bindexedDB\b/,
];
```

Note: `fetch` being flagged as dangerous doesn't mean it's completely forbidden — it warns the user that the code makes external network requests. The same rules are used for scanning Script Executors. `localStorage` / `sessionStorage` / `indexedDB` are also flagged to alert users that the code may read/write persistent data.