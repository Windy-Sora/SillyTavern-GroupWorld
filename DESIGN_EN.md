# Group World — Design Document

## 1. Overview

Group World is a **group-chat context pipeline**: collect data → Agent decision → inject character prompt.

It ships with 10 configurable LLM call groups by default: Director, ForceSpeak, Profile, Summary, NPC, Memory, PostSpeech (multimodal strategy), Critique, Story Blueprint, and Custom Agent (user-defined — not registered as an Agent, calls LLM directly through the system). Runtime-registered Agents use the declarative pipeline; Story Blueprint and Custom Agent call the LLM directly through their systems, but still have independent API configurations.

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
  'story-blueprint': { ... }, // Story Blueprint generation/continuation
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

### 3.2 Render Behavior (v0.6.1+)

- **Parallel execution** — Phase 1 runs all providers via `Promise.allSettled` concurrently. One provider's timeout/error does not affect siblings.
- **Per-provider timeout** — Default 10s (`settings.providerTimeoutMs`, GUI-adjustable). Providers may declare `timeoutMs` to override (priority: `provider.timeoutMs` > call option > global default). Set to 0 to disable. Timeouts log `[GroupDirector] Provider "xxx" timed out` in Console.
- **Signal/abort** — `renderPrompt` accepts a `signal` option (wired from Director/ForceSpeak/PostSpeech agents). User-Stop aborts in-flight providers with AbortError.
- **Error isolation** — Timed-out or throwing providers degrade to empty `{content:'', data:null}`. Sibling providers are unaffected.
- **World-book scanner dedup** — `{{worldBooks}}` and `{{worldBookImportance}}` share an in-flight promise dedup so parallel Phase 1 does not duplicate `loadWorldInfo` calls.

### 3.3 Registered Providers (47 built-in + N Custom Agent dynamic registrations)

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
| `storyBlueprintDoneField` | `{{storyBlueprintDoneField}}` | Expands to the completion variable field when Story Blueprint is enabled, or empties when disabled |
| `worldBooks` | `{{worldBooks}}` | Activated world book list |
| `worldBookImportance` | `{{worldBookImportance}}` | Entry importance ranking |
| `gdWorldBooksFull` | `{{gdWorldBooksFull}}` | Full text of all entries in currently active world books (macros substituted) |
| `gdWorldBooksConstant` | `{{gdWorldBooksConstant}}` | Text of always-on entries in currently active world books |
| `gdWorldBooksNames` | `{{gdWorldBooksNames}}` | List of currently active world book names |
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
| `globalVars` | `{{globalVars}}` | Global variable list (readable text) |
| `charVars` | `{{charVars}}` | Character variable list (grouped by character) |
| `vars` | `{{vars}}` | Full variable snapshot JSON |
| `varsJson` | `{{varsJson}}` | Full variable snapshot JSON (same as vars) |
| `variableMaintenance` | `{{variableMaintenance}}` | Variable maintenance instructions (injected into Director Prompt, tells LLM how to return variable_update) |
| `storyBlueprintCurrent` | `{{storyBlueprintCurrent}}` | Current Story Blueprint step; completion notice is consumed once by Director |
| `storyBlueprintCurrentJson` | `{{storyBlueprintCurrentJson}}` | Current progression node JSON |
| `storyBlueprintProgress` | `{{storyBlueprintProgress}}` | Blueprint progress summary |
| `storyBlueprintSchemaHint` | `{{storyBlueprintSchemaHint}}` | Completion variable protocol hint |
| `storyBlueprintFullJson` | `{{storyBlueprintFullJson}}` | Full blueprint JSON |

### 3.4 Variable System (v0.7)

The variable system provides structured, long-term state tracking for Group World. Unlike `ledger_update` (free-form JSON), the variable system offers typed, validated, auto-updated named variables.

**Core features:**
- **22 built-in variable templates** — story_phase, current_goal, party_funds, danger_level, trust_user, emotion, health, etc., covering narrative/economic/relationship/status tracking
- **Two scopes** — `global` and `character` (per-character independent values)
- **Six data types** — string, number, boolean, enum, object, array
- **Four update modes** — replace, delta (numeric increment/decrement), append, merge (shallow object merge)
- **Value validation & clamping** — number has min/max, enum checks allowed values, delta auto-calculates
- **Change log** — last 100 operations, with messageId/hash for stale detection
- **Stale detection** — variables marked as "possibly stale" when messages are deleted or modified
- **Rollback support** — revert to the previous non-ignored record
- **Transactional import** — success is returned only after asynchronous chat-metadata persistence succeeds; on failure, a `before / applied / current` three-way rollback removes imported writes while preserving concurrent edits made during the save
- **Locking** — locked=true records LLM updates but does not write values
- **Config profile integration** — variable data syncs with config profile export/import

**LLM interaction:** `{{variableMaintenance}}` injected into Director system prompt → LLM returns `variable_update` field in JSON response → `applyUpdates()` parses and writes to `chat_metadata`.

**Storage:** `chat_metadata[EXT_KEY].variables = { defs: [...], values: { global: {...}, character: {...} }, log: [...] }`

**Import rollback:** definitions and values use path-aware three-way rollback. Arrays use a longest-common-subsequence match to derive the `applied → current` sequence delta and replay concurrent additions/removals over the pre-import array. Logs remove only the imported segment and retain records appended while persistence was pending. A failed save therefore leaves neither imported data behind nor overwrites unrelated edits or same-array concurrent sequence additions/removals with an old snapshot.

**UI:** Tools drawer → Variables card (list + editor + templates + import/export); Dashboard → Variables panel (click "Variables" button to expand, real-time view/edit/rollback/lock).

### 3.5 Story Blueprint System

Story Blueprint is the story-structure system in the continuity layer. The framework only stores a structured blueprint and progress; it does not decide in code whether the story is narratively complete. Director/ForceSpeak declare completion through a boolean variable protocol.

**Core protocol:**
- The completion variable defaults to `gd_story_chapter_done`, stored as a global boolean variable.
- The Director JSON schema uses `{{storyBlueprintDoneField}}` inside `variable_update.global`; when Story Blueprint is disabled, this placeholder renders empty.
- When the LLM sets the completion variable to `true`, the system advances one step and immediately resets it to `false`.
- If ForceSpeak returns the completion variable, the signal is consumed there too so it does not leak into the next Director round.

**Blueprint shape:** `nodes` is a dynamic tree: flat, chapter/section/beat, or deeper. Progression modes are `leaf`, `all`, and `level`. `content` is a free-form object owned by prompt authors.

**Generation and continuation:**
- Generation/continuation prompts use the normal Provider renderer, so they can reference characters, profiles, world books, ledgers, summaries, variables, and custom interfaces.
- The default generation prompt includes `{{storyBlueprintFullJson}}` and `{{storyBlueprintProgress}}` so regeneration can preserve existing continuity; users can remove those interfaces from the prompt for a hard restart.
- Story Blueprint uses `agentConfigs['story-blueprint']`, configurable in the Tools drawer's Agent Configuration card.
- Auto-continuation runs in the background and does not block the current Director decision; `continuePending` drives the "continuing" UI state.
- Continuation appends nodes after re-normalizing ids with the current top-level offset, then recursively resolves id collisions to protect `doneSignals`.
- Continuation that returns no nodes fails explicitly instead of reporting success with no change.

**Manual editing:**
- The UI can create a user-authored blank blueprint, append root-level chapters, inspect progression rows, and use the location button separately to set the current step.
- Blueprint title, meta fields, and current/viewed node `content` fields are inline-editable. Saves reuse `setBlueprint(..., { resetProgress:false })` and do not reset progress.

**State and safety:**
- Blueprint content and progress live in `chat_metadata[EXT_KEY].storyBlueprint`; configuration lives in `extension_settings`.
- `doneSignals` records completed node id, step index, chat length, timestamp, and source.
- The completion notice is consumed once only by Director prompt rendering; UI preview and ForceSpeak cannot steal it.
- Import and advanced JSON editing validate a non-empty `nodes` array before saving.
- Config profiles sync Story Blueprint configuration plus variable definitions/data, not the current chat's blueprint body or progress. Blueprint body uses the Story Blueprint card's own import/export.

### 3.6 Reusable Library Systems (Profile / NPC / Story Blueprint Library)

Three library systems (`profile-library-system` / `npc-library-system` / `story-blueprint-library-system`) share a unified architecture: a convenience layer that saves the current group's data as reusable library entries, applicable across group chats. Entries persist in `extension_settings` (not exported with chat) and reuse each system's existing export/import payload, only adding a `libraryMeta` wrapper (name, description, timestamps, counts).

**Unified API**: `saveCurrentAsLibrary` / `getLibrary` / `deleteLibrary` / `applyLibrary` / `exportLibrary` / `importFileToLibrary`; `genId` uses a timestamp + counter.

| Library | Storage field | What it stores | Highlights |
|---|---|---|---|
| Profile Library | `settings.profileLibraries` | All `ready` character profiles in the current group | Smart-match apply: hash -> avatar+name -> name only; can skip already-ready characters; **auto-load**; export includes generator prompt / schema / render template |
| NPC Library | `settings.npcLibraries` | Current group NPCs | Preview distinguishes new / overwrite counts |
| Story Blueprint Library | `settings.storyBlueprintLibraries` | Current story blueprint (optionally with progress) | Counts nodes; import accepts both bare and wrapped blueprint formats |

**Profile library auto-load** (core capability): `settings.profileLibraryAutoLoad` configures `enabled` / `mode('best'|'fixed')` / `fixedId` / match rules / `overwriteExisting` / `importTemplate`. `findBestLibrary` scores by "usable matches×100 + total matches×10 + match rate" and picks the best library; triggered automatically on `CHAT_CHANGED` and `APP_READY` (when `profileEnabled`), with a toastr toast and UI refresh on success; `lastAutoLoadKey` dedupes to avoid repeated applies.

**Library persistence transaction boundary**: Profile and Story Blueprint Library save, delete, file-import, and Profile auto-load setting mutations are serialized and await confirmed settings persistence. “Save current” captures the current chat name and a detached content payload before entering the queue, so switching chats while an earlier operation is pending cannot change the requested source. Failure compensation removes only this operation's addition, restores a deletion relative to surviving neighbors, or restores only configuration fields still owned by the failed write; it never replaces the whole library snapshot. Dedicated cards and dashboard actions await completion before success feedback or refresh. Export always releases its temporary node and Blob URL. Profile Library application relies on Profile Import's single chat save, while Story Blueprint Library delegates to `applyImportTextAndSave()` for one awaited save plus a readback of the original chat header. A definite mismatch triggers three-way rollback that retains concurrent object fields and array additions, followed by another confirmed compensation save; compensation failure is reported as incomplete. If the verification request itself fails, the outcome is marked `persistenceUnknown` and the possibly persisted in-memory state is retained rather than overwritten by compensation.

**Relationship to config profiles**: library entries are "reusable content data", explicitly excluded by `INTENTIONALLY_UNCOVERED_KEYS` in `config-profile-system` and not saved/restored with config profiles.

**Profile persistence transaction boundary**: `saveProfile()` owns single-profile writes and `archiveProfiles()` owns active-to-archive moves; both must `await saveChatConditional()`. On persistence failure, compensation is applied per avatar and only to slots that still equal this operation's applied state, so a whole-store snapshot never overwrites concurrent edits to the same or another character. Synchronization, change detection, and card deletion all delegate to this transaction API instead of mutating both maps in the UI.

**Profile management UI safety boundary**: every asynchronous load, generation, save, and delete handler catches rejection, displays failure feedback, and restores disabled controls in `finally`. Imported avatar values enter markup only through HTML attribute encoding; edit panels are located through card DOM ancestry rather than avatar-derived HTML IDs or CSS selectors.

### 3.7 Group ZIP Import and Export

`export-import-system.js` exports PNG cards for enabled group members, activated world books, and `group.json`. It snapshots group and world-book selection before the first asynchronous request. Failed card requests are excluded from the manifest; if all cards fail, no unusable ZIP is downloaded. Partial exports show a warning, and temporary download nodes and Blob URLs are released even when clicking fails.

Import validates the full archive before any host POST: manifest member and option types, safe single-level paths, no duplicate files, exactly one PNG for every member, and readable world-book JSON with an `entries` field. Character uploads omit `preserved_name` so SillyTavern assigns a non-conflicting filename; member remapping uses only validated full card filenames, so basename or archive-path aliases cannot overwrite another member. World-book names avoid both the host's live name list and names already allocated by the current system instance. The host character endpoint can return `{ error: true }` with HTTP 200, so only a valid `file_name` counts as success. A group is created only when every required character was imported, with members remapped to the returned filenames.

Remote character and world-book uploads are independent irreversible effects, not an atomic transaction. Results distinguish complete success, incomplete work after a write request, and definite zero-write preflight failure. Once a write request has been sent, even a failed response must prompt users to inspect host resources rather than claiming nothing was created or announcing success. UI handlers catch unexpected rejections and restore controls. The same plugin instance reserves world-book names synchronously before upload, preventing sequential or concurrent imports from overwriting one another; eliminating races across pages or clients still requires an atomic no-overwrite host contract.

### 3.8 Coding Rules

- Providers with switches return empty string inside `render()`, don't use `enabled` to skip
- Mutable values passed via getters
- `settings.js` is the single source of truth for defaults

---

## 4. Template Rendering Engine (prompt-renderer.js)

### 4.1 Five-Phase Pipeline

```
Phase 0   — {[{...}]} passthrough slots → sentinel replacement
Phase 1   — Execute all Providers in parallel (Promise.allSettled + per-provider timeout + signal abort), cache to cache[id] = { content, data }
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

`settings.worldBookSourceMode` decides which world books `worldBookScanner.getSelectedNames()` scans: `st` (default) follows SillyTavern's currently active world books (aggregated from chat metadata `world_info`, `selected_world_info`, `charLore`; see `getActivatedWorldBookNames()`); `gd` fully uses the user's manual `worldBookSelection` from the GD panel, decoupled from ST activation. The scanner also exposes `getRenderedBooks()` / `buildSnapshot()`, which run `substituteParams` macro substitution on entry content and produce `fullText` / `constantText` plus character-count stats, consumed by the `{{gdWorldBooksFull}}` / `{{gdWorldBooksConstant}}` / `{{gdWorldBooksNames}}` providers.

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

### 7.1 Round Orchestrator and State Ownership

`systems/round-orchestrator.js` is the stateful coordinator for takeover rounds. `index.js` receives SillyTavern events and performs generation side effects, but no longer derives remaining-speaker counts, retry state, or finalization readiness on its own.

| Module | Responsibility |
|------|------|
| `round-state.js` | Pure wrapper/takeover transitions with no retained runtime state |
| `takeover-scheduler.js` | Builds the queue in Director order and excludes completed or unavailable characters |
| `round-finalization.js` | Determines whether round-end work may run |
| `round-orchestrator.js` | Owns takeover state and composes the rules above for `index.js` |

Key invariants:

- Blocking an out-of-plan character does not consume `takeoverRemaining`.
- Swipe/regenerate preserves the plan and only advances the safety-limit counter.
- Round finalization is blocked while takeover is pending, failed, manually generating, or stopped by the user.
- Nested wrappers preserve the active takeover; a failed plan enters the retry path on the next normal wrapper.
- `takeoverCompleted` survives retries, so resumed scheduling does not regenerate completed characters.

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

### 9.9 Testable UI Security Boundaries

UI sections retain event binding and DOM mutation, while security-sensitive rules such as input normalization, output encoding, and display/editor separation live in pure helpers in the same directory and are called directly by production sections. Current boundaries include:

- `custom-agent-helpers.js`: UI numeric bounds and exact `data-id` comparison; the system validator owns the import contract.
- `execution-trace-helpers.js`: trace summarization and safe stage HTML encoding.
- `profile-summary-helpers.js`: separation of composite profile display text from the raw editor value.

These helpers use DOM-free `node:test` behavior contracts. Browser-level tests are reserved for event propagation, focus, layout, or SillyTavern-owned widget behavior.

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
│   │   └── group-world-default.json
│   ├── providers/             # 29 built-in Providers
│   │   ├── manifest.js
│   │   ├── chatSummary.js
│   │   ├── director-critique.js
│   │   ├── character-critique.js
│   │   ├── char-critique.js
│   │   ├── variables.js          # Variable system Provider (5 placeholders)
│   │   ├── gd-world-books.js     # GD-managed world book Provider (3 placeholders)
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
│   ├── round-state.js         # Pure wrapper/takeover state transitions
│   ├── takeover-scheduler.js  # Ordered takeover queue and skip reasons
│   ├── round-finalization.js  # Round-end gating rules
│   ├── round-orchestrator.js  # Takeover state owner and coordination entry point
│   ├── capability-registry.js # CapabilityRegistry (multimodal capability registration)
│   ├── executor.js            # PostSpeech Executor (resolve→schedule→execute)
│   ├── history-system.js      # Director ledger CRUD
│   ├── world-info-system.js   # ST checkWorldInfo() wrapper
│   ├── asset-loader.js        # Dynamic import + register for assets/ modules
│   ├── user-provider-loader.js # User Provider/Capability import
│   ├── profile-system.js      # Character profile full workflow
│   ├── profile-export-system.js
│   ├── profile-library-system.js  # Profile reusable library (with auto-load)
│   ├── npc-system.js          # NPC generation + character card import
│   ├── npc-export-system.js
│   ├── npc-library-system.js  # NPC reusable library
│   ├── memory-system.js       # Character memory full workflow
│   ├── memory-export-system.js
│   ├── post-speech-system.js  # PostSpeech decision persistence
│   ├── config-profile-system.js # Config profile management (with JSZip fallback loading)
│   ├── custom-prompt-validation.js # Shared Custom Prompt import/field contract
│   ├── custom-prompts-system.js # Custom Prompt templates
│   ├── variable-system.js      # Variable system (defs/values/validation/log/rollback/stale detection)
│   ├── world-book-scanner.js  # World book scanning
│   ├── chat-summary-system.js # Context summarization
│   ├── critique-validation.js # Shared critique/import data contract
│   ├── critique-parser.js     # Balanced LLM JSON extraction and normalization
│   ├── critique-repository.js # History, activation chain, revert, transactions
│   ├── critique-execution.js  # LLM lock and quiet-prompt cleanup
│   ├── critique-auto-coordinator.js # Auto-critique checkpoint policy
│   ├── critique-system.js     # AI critique business facade
│   ├── custom-agent-validation.js # Shared Custom Agent/import/profile contract
│   ├── custom-agent-system.js # CRUD, import/export, result storage, Provider lifecycle
│   ├── custom-agent-execution.js # Serial execution, deduplication, stale checks, result transaction
│   ├── custom-agent-auto-coordinator.js # Pure auto-trigger scheduling policy
│   ├── story-blueprint-system.js  # Story Blueprint system
│   ├── story-blueprint-library-system.js # Story Blueprint reusable library
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
        ├── variables.js       # Variable settings + dashboard panel
        ├── ledger.js          # Ledger browser
        ├── forceSpeak.js      # Force speak
        ├── chatSummary.js     # Context summary
        ├── storyBlueprint.js   # Story Blueprint
        ├── storyBlueprintLibrary.js # Story Blueprint reusable library UI
        ├── critique.js        # AI critique
        ├── summaryExport.js   # Summary export/import
        ├── templateTester.js  # Template tester
        ├── profile.js         # Character profiles
        ├── profileExport.js   # Profile export/import
        ├── profileLibrary.js   # Profile reusable library UI
        ├── npc.js             # NPC generation
        ├── npcExport.js       # NPC export/import
        ├── npcLibrary.js       # NPC reusable library UI
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
| `worldBookSourceMode` | `'st'` | World book source mode: `st` (follow ST activation) / `gd` (GD manual selection) |
| `profileLibraries` | `[]` | Profile library entries (stored in extension_settings) |
| `profileLibraryAutoLoad` | `{ enabled:false, mode:'best', fixedId:'', matchHash:true, matchAvatarName:true, matchNameOnly:false, overwriteExisting:false, importTemplate:false }` | Profile library auto-load config |
| `npcLibraries` | `[]` | NPC library entries |
| `storyBlueprintLibraries` | `[]` | Story Blueprint library entries |

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
│  Scripts can modify ctx.decision (per-script isolated copy)  │
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
| `decision` | After Director decision | blocking await all, 10s timeout | `ctx.decision` (isolated, mutable copy) |
| `both` | message + round | same as respective modes | Phase-specific fields |
| `all` | All three | same as respective modes | Phase-specific fields |

### 12.3 ctx Shape

The three phases have different `ctx` shapes, providing phase-appropriate fields:

| Field | decision | message | round |
|------|:---:|:---:|:---:|
| `ctx.params` | ✓ | ✓ | ✓ |
| `ctx.shared` (turnShared) | ✓ | ✓ | ✓ |
| `ctx.decision` (isolated copy) | ✓ | - | - |
| `ctx.decisionSnapshot` (read-only) | - | ✓ | ✓ |
| `ctx.message` | - | ✓ | - |
| `ctx.character` | - | ✓ | - |
| `ctx.chat` | ✓ | ✓ | ✓ |
| `ctx.characters` | ✓ | ✓ | ✓ |
| `ctx.group` | ✓ | ✓ | ✓ |
| `ctx.settings` | ✓ | ✓ | ✓ |
| `ctx.getContext` | ✓ | ✓ | ✓ |

### 12.4 Shared State (turnShared)

System-instance closure state, not persisted to settings; separate executor system instances never share turn state:

- **Creation**: `resetTurnShared()` resets to `{}` on `GROUP_WRAPPER_STARTED`
- **Write**: Script sets `returnMode: 'shared'` and returns a validated plain object → clone before merging into `turnShared`
- **Read**: All scripts read an isolated `ctx.shared` copy; mutating that copy does not write back
- **Lifetime**: decision → message → round throughout, reset next round

After the decision phase completes, `decisionSnapshot = deepFreeze({ decision: deepClone, shared: deepClone(turnShared) })` is provided as read-only for message/round scripts.

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
    success + returnMode='shared' → validate and clone result, then merge into turnShared
    timeout/exception → trace record → continue to next
```

- **decision**: Blocking, await all complete then return snapshot
- **message/round**: Fire-and-forget, does not block character generation
- A timeout does not cancel already-running asynchronous JS; its late result and retained `ctx.shared`/`ctx.decision` references cannot mutate executor-owned state. After a turn reset, the old execution chain will not start later scripts. Host objects passed to scripts and page globals remain accessible; this is not a sandbox.
- Execution trace recorded via `AgentTrace` for per-stage duration and status

### 12.7 Import/Export

Export format: `{ version: 1, type: 'script-executor-export', exportedAt, executors: [...], migrations: [] }`

Import is split between UI and system layers: the UI only reads the file, shows the security warning, and collects same-name overwrite choices. `script-executor-system` uses `script-executor-validation` to validate the complete file and every entry, resolve conflicts on a candidate list, then replace settings once and save once. Import shares the mutation queue with add, update, remove, and toggle; another write cannot interleave while a conflict choice is pending. An invalid entry, transaction cancellation, or persistence failure leaves the existing list unchanged. Overwrites retain the trusted existing ID, new entries receive trusted IDs, and external IDs are ignored.

The shared contract bounds trigger and return-mode enums, integer priority (`-100..100`), boolean fields, and parameter types. Parameter keys must be non-empty and unique; `__proto__`, `prototype`, and `constructor` are rejected. System CRUD, standalone import, and config-profile import reuse this contract. Config profile management includes `scriptExecutors`.

Add, update, remove, and toggle return Promises, execute serially within the system instance, and await the injected `saveSettings` callback. An observable callback failure compensates only that operation while preserving edits to other executors made during the wait. The UI refreshes after the Promise settles and reports rejection. SillyTavern's current `saveSettingsDebounced` does not return the actual save Promise, and its direct save function catches network failures internally; the plugin therefore cannot guarantee server persistence from these APIs. This rollback contract applies when the injected callback throws or rejects.

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

**Executor boundary:** malformed intents and non-string `type` values are skipped; valid intents resolve by exact Capability ID, then Schema alias, and only then by ID substring, while disabled entries never enter a plan. Numeric Schema parameters accept only finite numbers or convertible non-empty numeric strings before defaults, range clamps, and enum fallbacks are applied. Nested parameters and Schema defaults passed to a Capability are isolated copies, so Capability mutations cannot contaminate the LLM policy or later executions. `immediate`, `deferred`, and `round_end` are the only scheduling modes; unknown values are logged and fall back to immediate execution. Both blocking and non-blocking execution invoke and isolate `onExecuted` after every action, and non-blocking `completion` settles only after both the Capability and any asynchronous callback finish.

---

### 13.3 Critique Module Boundaries

Critique separates the data contract, parsing, persistence, LLM side effects, and automatic scheduling. `critique-system.js` only orchestrates these boundaries and exposes a stable API to the UI, providers, and entry point.

| Module | Sole responsibility |
|--------|---------------------|
| `critique-validation.js` | Validate core containers, character entries, and JSON-compatible values for both LLM and import data |
| `critique-parser.js` | Extract balanced JSON from Markdown/noisy output, remove trailing commas, and invoke validation |
| `critique-repository.js` | Maintain one active record, basedOn revert, pruning, and persistence rollback |
| `critique-execution.js` | Share the run lock, call the LLM, and clear the quiet prompt after success or failure |
| `critique-auto-coordinator.js` | Compute first-enable, interval, and rollback actions and persist checkpoints transactionally |
| `ui/sections/critique.js` | DOM state and feedback; edited results must pass through the system facade |

A generation captures its starting chat and metadata references. If the chat changes before completion, it rejects with `StaleExecutionError` and cannot write into the new chat. Export/import reuses the same validator, and CRUD restores in-memory state when persistence fails.

On a failed save, repository add/update/revert/reset/prune compensates only its own writes by entry identity and field revision; an older rollback must not overwrite a newer concurrent edit. The auto counter uses a checkpoint revision for the same reason. Auto execution checks chat identity after `beforeExecute`, generation, and counter save; generation and regeneration check again after result save. A successful save followed by a chat switch reports stale without undoing the result already stored in the old chat. Result and counter saves are separate steps.

Imported critiques are stored independently of the live critique history. A failed add removes its own entry by identity, a failed update compensates only fields still owned by that write, and a failed delete restores order relative to surviving neighbors. Mutations check metadata identity after saving and report `StaleExecutionError` on a chat switch without writing to the new chat. Export releases its temporary anchor and Blob URL on success or failure; UI handlers report failed imports, deletes, toggles, and downloads without showing success.

---

## 14. Custom Agent — User-Defined LLM Agent

User-defined lightweight LLM Agents that auto-trigger every N rounds or execute manually. Users write a prompt + optional JSON schema; results are exposed for DSL consumption via the `{{providerName}}` Provider.

### 14.1 Design Highlights

- **Thin entry orchestration** — `index.js` only consumes pure scheduling actions; execution, counters, and persistence stay in the system layer
- **Shared API config** — `agentConfigs['custom-agent']`, not split per instance
- **Independent per-instance counters** — `_autoCAG_{id}` in chat_metadata, no cross-interference
- **Ordering** — User fills in an order number; execute serially in ascending order
- **Dynamic Provider registration** — `providerName` field → `{{providerName}}` → DSL queries
- **Disabled = Provider deactivated** — enabled=false returns '' from render()
- **No proactive data cleanup** — Deleting an instance unregisters the Provider; data silently remains in chat_metadata
- **Single write boundary** — The UI never mutates settings or chat results directly; CRUD, imports, and result edits use `customAgentSystem`, and the UI waits for persistence before refreshing or reporting success
- **Configuration transactions** — CRUD and imports commit serially and await `saveSettings`; failures compensate this operation's list and Provider changes without erasing unrelated edits made while saving
- **Execution isolation** — Concurrent calls for one instance are deduplicated and all jobs are serialized; chat changes, deletions, or config changes invalidate old results, including changes during a pending chat save
- **Transactional commit** — Auto-run result and `_autoCAG_{id}` checkpoint are saved together; on failure, result and counter revisions roll back only writes still owned by that transaction, preserving newer edits

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

Executes within GROUP_WRAPPER_FINISHED, after Critique. `custom-agent-auto-coordinator.js` is a pure policy that sorts by order and emits `execute`, `checkpoint`, or `reset` actions; the entry point only consumes those actions.

Each instance's independent checkpoint is stored as `chat_metadata[EXT_KEY]._autoCAG_{id}`, with a three-way branch (first-enable / deletion / normal) following the same pattern as Summary/Critique.

### 14.4 Module Boundaries

| Module | Sole responsibility |
|--------|---------------------|
| `custom-agent-validation.js` | Fields, Schema, ID/providerName uniqueness, and safe disabled imports |
| `custom-agent-system.js` | Validate-then-commit CRUD, Provider rollback, import conflicts, and result editing |
| `custom-agent-execution.js` | Request snapshots, serial queue, same-ID deduplication, stale checks, and chat-save transaction |
| `custom-agent-auto-coordinator.js` | Compute auto-trigger actions without side effects |
| `ui/sections/customAgents.js` | DOM rendering, event collection, and user feedback without owning business state |

Config Profile imports reuse the same validator, replace external IDs, and disable imported agents. Profile apply validates Provider conflicts on a detached copy and restores settings and registrations on failure.

### 14.5 Provider Rendering

The Provider render closure captures the instance's `id`. Each call checks `settings.customAgents.find(a => a.id === capturedId && a.enabled)` to confirm the instance still exists and is enabled. Returns `''` when not found or disabled.

---

## 15. Export/Import System

Group World provides full export/import capability for five data types:

| | Profile | NPC | Summary | Memory | Config |
|------|------|------|------|------|------|
| Granularity | Per character | Per entry | One-click | Per character | Per drawer |
| Format | `.json` | `.json` | `.json` | `.json` | `.zip` |
| Storage | chat_metadata | chat_metadata | Independent key | chat_metadata | extension_settings |

### Summary export/import boundary

Imported files validate the root object, version, summary object, and content fields, not just the envelope; malformed legacy entries are skipped by list and Provider rendering. Updates to an imported summary accept only `name`, `content`, and `enabled`; callers cannot replace internal IDs. Add, update, and delete await chat persistence. On failure, compensation uses entry identity, field revisions, and surviving neighbors to preserve newer edits made while saving. A chat-reference switch detected after persistence reports a stale operation without writing to the new chat or undoing an already saved result in the old one. Download failures still release the temporary node and Blob URL, and the UI reports asynchronous failures rather than success.

### Chat Summary persistence transaction boundary

Chat Summary bodies use a different collection from the imported summaries above. Generation, regeneration, content edits, revert, reset, pruning, and clearing are serialized by `chat-summary-system.js` and remain bound to the `chat_metadata` captured when each operation begins. The UI may call only the system facade; it must not mutate the summary array or save chat state directly. Scan numbering is valid only for its current view: while pruning or clearing waits for persistence, index-based editing stays locked. Whether the operation succeeds, definitely fails and rolls back, or ends with `persistenceUnknown` while retaining current memory, the UI must rebuild the scan text and indexes from the live repository before releasing editing controls, so old numbers cannot target a compacted array. Because the host's `saveChatConditional()` swallows internal save failures, the production entry point uses `chat-metadata-save-confirmation.js` to read back the original group or character chat header and confirms success only when it contains either the submitted Summary state or the current concurrent state included by that host save. A definite mismatch triggers compensation by entry identity or applied field values, undoing only changes still owned by that operation while preserving concurrent additions, edits, and ordering; an unsafe partial compensation is reported through `rollbackIncomplete`. A failed verification request is `persistenceUnknown`, so possibly persisted memory is retained without destructive compensation. A chat switch after a successful save raises `StaleExecutionError` without undoing the old chat's persisted state. Public reads are detached snapshots, so callers cannot bypass the transaction boundary through query APIs.

### Global Config Export/Import (Config Profile System)

**Storage**: `settings.configProfiles = [{ id, name, description, drawers, settings }]`

**Export format**: `.zip` = `manifest.json` + optional `user-providers/*.js` + `user-capabilities/*.js`

**Import and apply boundary**: JSON, ZIP, and built-in presets share `config-profile-validation.js`, which validates the root object, version, settings/drawers/variables shapes, and every Prompt, Provider, and Capability array entry. JSON imports strip `agentConfigs` and name-only Provider/Capability stubs; ZIP imports may restore source from matching `.js` files. Applying a profile first prepares default merging and Prompt conflict handling on a detached settings copy, then imports variables and commits once. Unrelated settings edits made while variable persistence is pending are replayed at commit. If the later settings commit fails, the variable import transaction performs a three-way compensation that preserves concurrent updates to the same variable. Save, delete, JSON/ZIP import, and preset loading retain list changes only after persistence succeeds; failures are reported by the UI without success refreshes. The Tools-drawer apply handler retains the Prompt merge mode across the entire asynchronous success path so the post-refresh `keep`/`skip` result message remains safe to build.

**JSZip loading**: Uses `ensureJSZip()` with script tag fallback — tries `import()` first, then injects `<script>` tag on failure, compatible with non-module environments.

**Variable transaction chat boundary**: Import and later compensation retain the original chat and variable-store references and cannot write into a newly selected chat. Only a genuine save failure rolls back memory. A chat switch detected after a successful save reports stale but retains the saved old-chat value, preventing memory/persistence divergence.

**UI location**:
- Dashboard: Config profile dropdown (built-in + user, optgroup) + Apply button + Import button
- Tools drawer → Config Profile card: Full management panel (save/export/delete/preset loading)

### Reusable Libraries (Profile / NPC / Story Blueprint Library)

Three libraries provide "reusable packages" that share the export/import lineage above but persist independently: save the current group's data as named library entries (stored in `extension_settings`, not exported with chat), applicable across group chats. Entries reuse each system's export payload, adding only `libraryMeta` (name/description/timestamps/counts).

| Library | Entry card | Storage field | Auto-load |
|---|---|---|---|
| Profile Library | Characters drawer -> Character Profiles card | `profileLibraries` + `profileLibraryAutoLoad` | Yes (best/fixed, triggered on APP_READY and CHAT_CHANGED) |
| NPC Library | Characters drawer -> NPC Generation card | `npcLibraries` | No |
| Story Blueprint Library | Continuity drawer -> Story Blueprint card | `storyBlueprintLibraries` | No |

NPC Library save, delete, and file import await the injected settings persistence adapter. On failure, compensation uses entry identity or surviving neighbors to retain unrelated library edits made while saving. The production adapter calls the host's direct `saveSettings()` and requires the `SETTINGS_UPDATED` event emitted after a successful save; the debounced wrapper exposes no completion result, while the direct host function swallows request errors, so awaiting its Promise alone is insufficient. The event has no request ID, leaving an extreme concurrent-host-save attribution limit. Malformed legacy entries do not block valid entries from rendering; invalid export data is rejected, and failed downloads still release the temporary node and Blob URL. Both the dedicated card and dashboard deletion await the operation, refresh after rollback, and avoid false success feedback. Library application and direct file import share `npc-export-system.applyImport()`.

Profile and Story Blueprint Libraries use the same confirmed settings adapter and serialized-write rule. Profile auto-load toggles are system-owned field transactions, `getAutoLoadSettings()` returns a snapshot, and the UI never mutates the live settings object. Story Blueprint application gives the Story Blueprint System sole ownership of chat persistence and concurrency-safe compensation, avoiding an unawaited inner save followed by a redundant outer save.

**NPC import application transaction:** The NPC list is updated first, then `saveChatConditional()` is awaited. On failure, three-way compensation touches only entries added or overwritten by this import, preserving unrelated NPCs and concurrent field edits to the same NPC. If the chat changes after a successful save, the operation reports stale without undoing the saved old chat or applying the global prompt. An optional prompt is applied only after chat persistence, and the observable result of `saveSettings()` is awaited. If it rejects, the prompt is restored only while still owned by this operation, and a compensating NPC save is attempted. Chat metadata and plugin settings are not an atomic store: failed compensation, a chat switch, or a concurrent edit to a newly imported NPC is reported as potentially incomplete. In production `saveSettings()` merely schedules a debounced save, so awaiting it cannot prove that a later disk write succeeded.

**NPC System mutation boundary:** Generation, manual edit, and deletion update the original chat's NPC list and await `saveChatConditional()` before reporting success. On failure, generation removes only its still-unedited additions, edit compensates owned fields using per-instance revisions, and delete restores position relative to surviving neighbors. Other NPCs and later same-value edits are preserved; incomplete compensation is reported explicitly. A chat switch after a successful save is stale but does not undo the saved old chat. Generation returns NPCs actually added, not the raw model output rejected by deduplication or capacity. The NPC edit/delete UI awaits these operations and reports failures without success feedback or dashboard refresh. Remote character-card creation and its tracking receipt remain a separate boundary.

Library entries are content data, explicitly excluded by `INTENTIONALLY_UNCOVERED_KEYS` in `config-profile-system` and not saved/restored with config profiles. See section 3.6 for details.

---

## 16. Custom Prompt Templates

Users create custom placeholders, auto-registered as `{{name}}` Providers.

**Storage**: `settings.customPrompts = [{ id, name, content, dataJson, scope, enabled }]`

**Naming rules**: Only `\w+` allowed; auto-detects naming conflicts with built-in Providers.

**Two-level control**: Master switch `customPromptsEnabled` + per-item `enabled`.

**Boundary and transactions**: `custom-prompt-validation.js` is the shared structural contract for CRUD, standalone imports, and config-profile imports. Batch import checks every name for Provider/placeholder conflicts before mutating the list, so an invalid later entry cannot leave a partial import. Every mutation is serialized in the system layer and awaits `saveSettings`; failure compensates only fields that have not since been changed concurrently. Providers are registered with a stable owner/entry ID, and hot reload reconciles a managed ledger so removed placeholders are cleaned up without replacing or deleting another subsystem's Provider.

---

## 17. Asset Management & User Import

### AssetLoader

Unified loading of extension modules under `assets/`. Each subdirectory has a `manifest.js` → AssetLoader dynamically `import()`s + `register(deps)`.

### User Import System

Select `.js` → FileReader → store in `extension_settings` → Blob URL → `import(url)` → `register(deps)`. Auto-restored on restart. Core API injected via `register(deps)` parameter or `window.GroupDirector` global. Module evaluation and asynchronous `register()` each have a 10-second lifecycle bound. The operation token closes on success, failure, or timeout, rejecting late Provider/Capability writes while rolling back registrations already made by that owner.

---

## 18. Failure Fallback

- Agent call failure → managedCall retries `retries` times → reuse history → block round
- User actively pauses → `generationStopped` flag → silent cutoff
- `selected_group` empty → transparent passthrough
- `type` is `quiet` / `impersonate` / `continue` → no interception
- Takeover mid-failure → `takeoverFailed = true`, retry reuse next time
- JSZip load failure → `import()` fails → script tag injection → 10s timeout error

### 18.1 Asynchronous Generation Consistency

Asynchronous results from Summary, Critique, Memory, NPC, Profile, Story Blueprint, and Custom Agent must follow capture → await → validate → commit in the system layer. UI sections never own the commit.

- `systems/execution-snapshot.js` captures the active `chat_metadata` reference, chat-array reference, serialized chat contents, and a business-resource snapshot.
- After any LLM/render await that can yield control, and before persistence, the system calls `assertExecutionSnapshot()`. Chat switches, in-place message appends/edits, manual result edits, reverts, and resets invalidate the older request with `StaleExecutionError`.
- Resource snapshots serialize only fields that affect the request input or result ownership. Persistence rollback is conditional so it cannot overwrite a newer revision.
- Irreversible external side effects do not use ordinary stale rollback. NPC character-card import performs its final snapshot check before POST, then reconciles a successful create by stable `importId`. If the card exists but tracking persistence fails, `NpcImportTrackingError` carries the `avatarName`; the UI reports partial success and retains an in-memory receipt for a later save.

---

## 19. Development Quick Reference

| Task | Files to Change |
|------|-----------|
| Add new Agent | `agents/xxx.js` (new) + `index.js` register + UI auto-generated |
| Modify Agent behavior | `agents/xxx.js` → pipeline stage methods |
| Add new protocol | `utils/custom-api.js` → add `makeXxxCaller()` |
| Add Prompt placeholder | `assets/providers/xxx.js` + manifest.js + `index.js` import/register |
| Add business logic module | `systems/*.js` (new) + `index.js` import/assemble |
| Add variable definition | UI Variables card → New/Template; or `variableSystem.upsertDefinition()` |
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
| Modify interceptor event wiring | `index.js` → `groupDirector_Interceptor` / wrapper event listeners |
| Modify takeover state rules | Prefer `round-state.js` / `takeover-scheduler.js` / `round-finalization.js`, composed by `round-orchestrator.js` |
| Add a static checker | Create `tools/gd-test/checks/*.check.mjs` plus its unit test; no CLI/runner edits |
| Add a behavior test | Place it under `tests/{unit,regression,integration,contract}` by business ownership; follow `tests/README.md`; no CLI/runner edits |

### 19.1 GD Test Lab Module Boundaries

- `core/project-index.mjs` only builds facts such as files, sources, JSON, the import graph, and reachability; it produces no rule verdicts.
- `checks/*.check.mjs` owns one rule domain per file, is auto-discovered, and never calls another checker.
- `core/check-runner.mjs` only validates contracts, orders deterministically, provides hard Worker isolation, and aggregates results; checker loading and execution stay off the main thread, and timeouts await `worker.terminate()` before advancing.
- `core/test-runner.mjs` only invokes Node `node:test`; behavior tests remain auto-discovered from `tests/**/*.test.js` / `tests/**/*.test.mjs`.
- `reporters/*` only consume structured results; the CLI only wires components and sets the exit code.
- The complete Checker v1 standard lives in `tools/gd-test/checks/README.md`.
- The Behavior Test v1 standard for suite ownership, naming, concurrent isolation, regression contracts, and size thresholds lives in `tests/README.md`.

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
| A factory captures the `characters` array | SillyTavern may replace the entire array, leaving the closure on a stale reference | Inject `getCharacters()` and resolve the live value at use time |
| An editor reuses a display summary | Tags, motivation, and HTML enter the stored source value | Keep the editor value separate from the display formatter |
| Import validation checks only the array container | Malformed values such as `entries: [null]` throw during later field access | Validate both the container and every element at the parse boundary |
| Only the chat-array reference is compared | SillyTavern appends or edits messages in place, so the reference stays stable while prompt input changes | Snapshot both the array reference and serialized contents |
| Ordinary stale rollback runs after remote success | The POST already created a character card, so a later local stale error misreports real success as failure | Validate before the side effect, reconcile by stable ID, and explicitly report partial success |

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
| User Provider/Capability lifecycle | Ownership isolation | Imported entries are owned by file name; ID replacement across built-ins or other imports is rejected, and delete/failure rollback can remove only registrations owned by that entry |
| User Provider/Capability lifecycle | Async transactions and restore reconciliation | Async `register()` and settings persistence are awaited and compensated on failure. Startup/hot reload refreshes actual IDs and removes registrations omitted from current settings |
| Script Executor import | GUI security warning banner | Similarly displays detected dangerous APIs |
| Config profile import | Confirmation popup | Importing config profiles also imports userProviders/userCapabilities; ST native confirmation popup reminds users to check when clicking import |
| Config profile export | API Key stripping | `apiKey` in `agentConfigs` is automatically cleared on export |
| Config profile import | API Key stripping | `agentConfigs` is discarded on import to prevent endpoint hijacking |
| Custom Agent import | Field allowlist and ID normalization | Ignores external IDs, bounds numeric fields, imports disabled, and avoids interpolating IDs into jQuery selectors |
| Memory import | Nested structure validation | Validates character objects, names, the `entries` array, and every entry; malformed data returns a structured error |
| Execution Trace | Output escaping | Escapes stage summaries and object keys before inserting them into the DOM |
| Script Executor | Execution timeout | Decision scripts time out after 10 seconds; message/round scripts after 5 seconds. Execution continues, but the script's own asynchronous side effects are not cancelled. |
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
