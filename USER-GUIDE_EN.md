# Group World — User Guide

## Table of Contents

1. [Quick Start (5 Minutes)](#1-quick-start-5-minutes)
2. [Dashboard — Command Center](#2-dashboard--command-center)
3. [Drawers & Cards Guide](#3-drawers--cards-guide)
   - [3.1 Director](#31-director)
   - [3.2 Characters](#32-characters)
   - [3.3 Continuity](#33-continuity)
   - [3.4 Reactions](#34-reactions)
   - [3.5 Tools](#35-tools)
4. [Two Director Modes](#4-two-director-modes)
5. [Placeholder Quick Reference](#5-placeholder-quick-reference)
6. [DSL Path Query Syntax](#6-dsl-path-query-syntax)
7. [Export & Import](#7-export--import)
8. [Script Executor](#8-script-executor)
9. [Common Scenario Recipes](#9-common-scenario-recipes)
10. [AI Critique](#10-ai-critique)
11. [FAQ](#11-faq)

---

## 1. Quick Start (5 Minutes)

### Installation

Place the `SillyTavern-GroupWorld` folder into ST's `public/scripts/extensions/third-party/` directory, restart ST. Enable it in the extension management panel.

### Three Steps to Start

**Step 1: Choose a mode** → Open the "Director" drawer, select LLM mode (better results) or Formula mode (zero tokens).

**Step 2: Prepare characters** → Open the "Characters" drawer, expand the "Character Profiles" card → Regenerate All. Expand the "Character Memory" card → Extract All.

**Step 3: Start chatting** → Enter a group chat and send a message normally. Characters no longer talk over each other—they speak in the Director's order.

### An Even Faster Way: Adopt Muyu

At the bottom of the dashboard, click **"🦉 Adopt Muyu"** — GD's built-in development assistant, an owl-girl living under a purple desk lamp. One-click import of character card + world book, then talk to her directly:

- **Not sure how to configure?** Ask her. The world book contains a complete configuration guide.
- **Want to write a Provider / Capability / Custom Agent / Script Executor?** Ask her. She'll help you find the most elegant solution by following the decision flow.
- **Hit a bug?** Ask her. She knows which logs to check and which counters to look at.

Muyu isn't a code generator—she's GD's chief architect. She won't pile on features; she'll guide you to solve problems by composing existing mechanisms.

### An Even Faster Way: Presets

Select `group-director-default` from the preset dropdown at the bottom of the dashboard → click "Apply" — all recommended configurations take effect immediately.

### Interface Layer Guide

| Level | Area | When to Use |
|------|------|------|
| **At a glance** | Dashboard | Every time you open it—current mode, last decision, data stats, preset switching |
| **Core config** | Director / Characters | Day one—choose mode, write prompts, generate profiles & memories |
| **Tuning** | Continuity | First week—manage ledgers, world books, context summaries |
| **On demand** | Reactions / Tools | As needed—multimodal, export/import, Agent config, custom Agents, debugging |

> **Recommended learning path**: Click "Adopt Muyu" → chat with her about your needs → she'll teach you step by step. Alternatively: dashboard to understand state → Director drawer to configure modes → Characters drawer to prepare data → start chatting. Advanced drawers are collapsed by default and won't interfere with daily use.

---

## 2. Dashboard — Command Center

After opening the Group World settings panel, the first thing you see is the dashboard. It **doesn't belong to any drawer—it's always visible**.

### Status Indicator

The colored dot on the far left:

| Indicator | Meaning |
|------|------|
| 🟢 Green breathing light | LLM mode, Director is active |
| 🟡 Amber | Formula mode, local scoring in progress |
| ⚫ Gray | Disabled |

The right side shows the mode name and language toggle.

### Last Decision

A left-bordered summary line below the status indicator, showing the Director's previous round choices:

> **LAST CALL** Alice → Bob → Charlie
> *Alice directly addressed Bob and Charlie has relevant intel*

### Data Statistics

Seven stat tiles + manual refresh button. Auto-refreshes when settings panel opens. **All tiles are clickable to expand**, showing detailed lists.

| Stat | Click-to-Expand Content |
|------|-------------|
| Profiles | Character name + status (green=ready/orange=generating/red=failed); expand row to see summary/tags/motivation |
| Memories | Character name + entry count; expand row to see 5 most recent memories |
| NPCs | Character name + description summary; expand row to see full description/personality/scenario |
| Ledger | Last 8 rounds of speaking order + reason; expand row to see full reason and scripts |
| Summary | Shows `covered/total messages`; expand row to see current summary content, supports editing |
| World Books | Select all / deselect all + individual checkboxes |
| 🔄 | Manually refresh all data (icon spins on click) |

#### Inline Editing

In expanded panels, hovering over any field reveals an "Edit" button. Click to turn the field into a textarea, Ctrl+Enter or click "Save" to write data, click "Cancel" to discard. Edits write directly to the underlying storage and stay in sync with corresponding edit areas in drawers.

| Panel | Editable Fields |
|------|-----------|
| Summary | summary content |
| Profiles | summary |
| Memories | event text |
| NPCs | description / personality / scenario |
| Ledger | reason |

Data also auto-refreshes when expanding/collapsing drawers. The summary panel and memory panel each have a set of auto-trigger controls (enable/auto/trigger every N messages) at the bottom, bidirectionally synced with the corresponding drawer cards.

### Quick Actions

Four quick-action buttons, only shown when their corresponding system is enabled:

| Button | Effect | Visibility |
|------|------|----------|
| Scan Archive | Recover profiles from chat archive + refresh memory list | profile or memory enabled |
| Gen Profiles | Generate character profiles for all group chat members | profile enabled |
| Extract Memories | Sequentially extract new memories for each character (no confirmation dialog) | memory enabled |
| Run Summary | Execute context summary. Auto-enables summary system if not already on | Always (in group chat) |

### Config Profile Management

A row at the bottom of the dashboard: dropdown + Apply + Import + Refresh buttons.

Dropdown options are organized in groups:

| Group | Content | When "Apply" is Clicked |
|------|------|---------------|
| **Built-in Profiles** | Factory presets such as `group-director-default` | Load into list first, then apply settings |
| **My Profiles** | User-saved or imported config profiles | Apply settings directly |

Right-side buttons:

| Button | Effect |
|------|------|
| Apply | Apply the currently selected config profile to global settings (page refresh needed for full effect) |
| Import Profile | Select a `.zip` file to import an external config profile |
| 🔄 Refresh | Manually sync the config profile list in the dropdown (auto-refreshes after save/delete) |

The config profile card in the Tools drawer has an identical dropdown—both sides always stay in sync.

---

## 3. Drawers & Cards Guide

### Reading Conventions

- **Drawer**: The entire collapsible area that expands when you click its title (ST native `inline-drawer`)
- **Card**: A collapsible info block inside a drawer. Each card has a title bar + expand arrow. Click to expand/collapse. **Card collapse state is remembered** and persists when you reopen settings

All control changes are **saved instantly**—no manual save button needed.

---

### 3.1 Director

**Who speaks, in what order, how they perform.** The core drawer of the entire plugin.

#### Mode Selection

Three side-by-side buttons: **Off** / **Formula** / **LLM**. Mutually exclusive radio selection.

#### Formula Parameters

Only visible in Formula mode. Controls the specific parameters of local scoring—Top-N, scoring weights, triggers, initiative. See the [Formula Mode](#formula-mode-zero-tokens) section for details.

#### LLM Parameters

Only visible in LLM mode. Contains four sub-cards:

**Director Prompt**

| Control | Purpose |
|------|------|
| Max speakers per round | How many characters the Director allows per round. Recommended: 2-3 |
| Context depth | How many recent messages the Director sees. Recommended: 10 |
| Director Prompt template | **Core configuration**. Uses placeholders to inject data. The model must return JSON |
| Restore default | Reset to the built-in Prompt |

**Continuity & Ledger** (expandable card)

| Control | Purpose |
|------|------|
| Record Director Ledger | Save the complete JSON after each decision to chat metadata |
| Clear | Delete all current ledger records |
| Use Director History | Inject historical ledger into the current prompt to maintain story continuity |
| Continuity Script Mode | Previous round only / Full history |
| History rounds | How many rounds to inject in full history mode |
| Wrapper template | Controls how historical JSON is wrapped for injection |

**World Books & Knowledge Base** (expandable card)

| Control | Purpose |
|------|------|
| World book injection | Inject activated world book entries into the Director Prompt |
| Wrapper template | Controls the wrapping format of world book text |
| Knowledge base | Stores reference text that won't be rendered. Referenced via `{{knowledge}}` |

**Force Speak** (expandable card)

ST's native force-speak feature requires plugin adaptation to avoid timeline corruption.

| Option | Effect |
|------|------|
| Native passthrough | Let ST handle it after a confirmation popup |
| Block directly | Completely prevent force-speak |
| LLM takeover | Call the model to generate a script for that character and record it in the ledger |

**Templates & Character Descriptions** (expandable card)

| Control | Purpose |
|------|------|
| Recursive rendering | Continue parsing `{{...}}` inside placeholder outputs |
| Max recursive passes | Prevent infinite loops. Recommended: 5 |
| Debug placeholders | Preserve unrecognized placeholders for troubleshooting |
| Character description control | Full inclusion / sliced truncation (recommended: 200 chars) |

#### Director Script

After checking "Enable Director Script", the Director outputs stage directions for each speaking character, injected into the character prompt to guide their performance.

| Control | Purpose |
|------|------|
| Injection position | Prompt start (weak intervention) / Near dialogue (strong intervention) |
| Script style requirements | Tell the Director what kind of script style you want |
| Character Prompt Injection Template | **The single entry point for all character info.** `{{script}}` replaced with actual script, `{{charMemoryCurrent}}`, `{{charCritique}}`, `{{characterLore}}` and other character-level Providers all render here. Can be restored to default |

#### Advanced: JSON Output Format

The Director requires the LLM to return JSON. Users can customize the JSON schema to control output fields.

| Control | Purpose |
|------|------|
| JSON Output Format | Customize the JSON schema template for LLM responses. Default includes speakers / reason / loreAssignments |
| `{{scriptField}}` | A placeholder inside the schema—expands to a scripts field when Director Script is enabled, disappears when disabled. You can add or remove any fields in the schema (e.g., emotion, pacing) |
| Restore default | Reset to the built-in JSON schema |

---

### 3.2 Characters

**The character data the Director knows about.** Four collapsible cards, each showing only title and status label by default.

#### Character Profiles (Card)

Generate structured character profiles (traits, motivations, relationships), injected into the Director Prompt as identity reference. The status label shows the number of ready profiles.

| Control | Purpose |
|------|------|
| Enable character profiles | Master switch |
| Scan archive | Recover existing profiles from chat archive |
| Detect changes | Detect characters joining/leaving |
| Token budget | Compress inactive characters when exceeded |
| Concurrency | Number of characters generated simultaneously |
| Generation Prompt / Schema / Render Template | All three templates customizable with restore-to-default |
| Regenerate all | One-click profile generation for all characters |
| Profile management cards | Each character expandable, supports edit/regenerate/delete |

#### Character Memory (Card)

Extracts key experiences and emotional changes from conversation history. Status label shows total entry count.

| Control | Purpose |
|------|------|
| Enable character memory | Master switch |
| Token budget | Limit total memory text length |
| Extract / Render / Compress Prompt + Schema | Customizable with restore-to-default |
| Compression keep recent | Preserve the most recent N original entries when compressing |
| Per-character limit | Auto-trim oldest entries when exceeded |
| Speakers only | Auto-extract only processes characters who spoke recently in the Director ledger, deduplicated to avoid full-scale calls |
| Memory management buttons | Refresh / Scan / Extract / Detect orphans / Reset |
| Memory cards | Each character expandable to browse/edit/delete individual memories |

#### NPC Generation (Card)

Batch-generate NPCs based on conversation context, can be imported as character cards. Status label shows NPC count.

#### Identity Anchor (Card)

Custom prompt to uniformly declare usage rules and priorities for profiles/memories/summaries. Manually injected into Director Prompt or Character Prompt Injection Template via `{{identity}}`. Not auto-injected.

---

### 3.3 Continuity

**What the Director remembers.** Three collapsible cards.

#### Context Summary (Card)

Compresses chat context into concise summaries, reducing token consumption. When enabled, `{{chatSummary}}` has content.

| Control | Purpose |
|------|------|
| Enable / Reuse last | Basic switches |
| Auto-summary / Trigger every N messages | Auto-execute summary when message threshold is reached |
| Summary Prompt | Customizable with restore-to-default |

| Action | Button |
|------|------|
| Scan archive summaries / Clear disabled / Hide disabled | Manage existing summaries |
| Execute / Redo / Rollback / Reset | Summary lifecycle |
| Edit summary result | Edit text directly then save |

The dashboard summary panel also has an identical set of auto-summary controls, kept in sync. Summary content supports inline editing in the panel, with changes bidirectionally synced to the drawer's textarea.

#### AI Critique (Card)

Has the AI review recent conversations, critiquing Director decision quality and character performance. When enabled, `{{directorCritique}}`, `{{characterCritique}}`, `{{charCritique}}` have content.

| Setting | Description |
|--------|------|
| AI Critique / Reuse | Enable critique system, reuse last covered range |
| Auto-critique / Trigger every N messages | Auto-execute critique when message threshold is reached |
| Critique Prompt | Customizable system prompt, uses built-in default when empty |
| JSON Schema | Customize output JSON field structure, uses built-in default when empty |
| Execute / Redo / Rollback / Reset / Refresh | Critique generation and lifecycle management |

**{{charCritique}} convention**: Regardless of JSON Schema customization, each character's critique must be an object where string values render as `[key] value` and array values render as `[key]` followed by an indented list.

The dashboard does not yet integrate the critique panel (planned for a future version).

#### Director Ledger (Card)

Browse, edit, and clear Director history decisions. Status label shows round count. Raw mode toggle between JSON and readable format. Auto-locked during generation.

#### World Books (Card)

Check which ST world book entries to inject into the Director Prompt. Refresh button syncs changes. Max injection entry limit (recommended: 15-30).

---

### 3.4 Reactions

**What happens after a character speaks.** Drawer collapsed by default.

#### Message-Level Feedback (Card)

After each character speaks, invoke the PostSpeech Agent to analyze emotions, trigger TTS, etc. ⚠ Enabling adds 1 LLM call per character message.

#### Round-Level Feedback (Card)

Invoked once after all characters in a round have finished speaking. Suitable for generating scene illustrations, updating world-building, etc. ⚠ Enabling adds 1 LLM call per round end.

#### Registered Capabilities (Card)

Enable/disable multimodal capabilities (emotion / tts / image). Custom capabilities can be imported via asset management.

#### Decision Records (Card)

Recent multimodal policy decisions. Persisted with chat, auto-deduplicated.

---

### 3.5 Tools

**Config profiles, export/import, Agents, Custom Agents, Custom Prompts, API reference, Script Executor, debugging.** Drawer collapsed by default. Nine collapsible cards.

#### Config Profile Management (Card)

Save, export, and import the entire plugin configuration as `.zip`. Create multiple config profiles to switch on demand. Scope selection on export (per-drawer checkboxes). API keys auto-redacted.

#### Export / Import (Card)

Export/import for four data types: Group Chat (character cards + world books `.zip`), Profiles (`.json`), Memories (`.json`), NPCs (`.json`), Summaries (`.json`). Auto-match characters on import (avatar exact → name exact → fuzzy match), confirmation popup for same-name conflicts.

#### Agent Configuration (Card)

Each Agent (Director / ForceSpeak / Profile / Summary / NPC / Memory / PostSpeech) can independently set its API endpoint and key. Supports OpenAI or Anthropic protocols. Test connection available.

#### Custom Agent (Card)

User-defined LLM Agents that auto-trigger every N messages or execute manually. No need for editor GUIs, buttons, lifecycle management—just write a Prompt and optional JSON Schema, and results are injected into any prompt via the `{{providerName}}` placeholder. All instances share the `custom-agent` API configuration in the Tools drawer's Agent Configuration card.

| Control | Purpose |
|------|------|
| Name / providerName | Display name + placeholder name (`{{providerName}}`) |
| Enable / Auto / Interval | Switch + auto-trigger every N messages |
| Order | Execute serially in ascending numerical order at round end |
| Prompt | Custom prompt (supports `{{placeholder}}` DSL path queries) |
| Schema | Optional JSON Schema, LLM output auto-validated + parsed |
| Results | Stored in chat metadata, referenced via `{{?providerName:field}}` |

Click the card header to expand/collapse the configuration panel.

#### Custom Prompt (Card)

Create your own `{{placeholder}}` Providers. Names limited to `a-z 0-9 _`. Each prompt can be edited/toggled/deleted. Supports batch export/import.

#### User Extensions (Card)

Import custom `.js` Provider or Capability files. Must export `register(deps)`. Takes effect immediately on import, auto-restored on restart.

#### API Reference (Card)

Pure reference documentation listing all 31 registered Provider placeholders and their descriptions (bilingual Chinese/English). Supports search filtering, add/edit/delete custom entries, export/import JSON files, one-click restore to defaults. No functional side effects—purely for helping users quickly understand available `{{placeholder}}` options in prompts.

#### Script Executor (Card)

Inject custom JS scripts at three key moments in the Director lifecycle (after decision / after message / after round). Access decisions, messages, characters, and shared state via `ctx`. Supports typed parameters, priority ordering, cross-script shared state, import/export (with version numbers).

See [Script Executor](#8-script-executor) for details.

#### Debugging (Card)

- **Template Tester**: Input a template + optional Locals JSON, test rendering results without triggering any generation
- **Execution Trace**: View Agent stage durations and outputs. Requires debug logging enabled

---

## 4. Two Director Modes

### Formula Mode (Zero Tokens)

```
Character Score = name mentioned × mentionWeight (default 30)
                + keyword match × triggerScore (default 40)
                + recent inactivity × recencyWeight (default 20)
                − consecutive speech × consecutivePenalty (default 15)
                + Talkativeness × talkativenessWeight (default 10)
                + random initiative (0 ~ initiativeBaseScore per round)
```

The top-N scoring characters are allowed to speak. Suitable for quick testing and lightweight daily use.

### LLM Mode

One extra LLM call per round. The Director analyzes context and returns JSON:

```json
{
  "speakers": ["Alice", "Bob"],
  "reason": "Alice was directly addressed, Bob has relevant knowledge",
  "scripts": { "Alice": "Notices Bob's hesitation...", "Bob": "Recalls the clue from earlier..." }
}
```

`speakers` order = speaking order. `scripts` is an optional field (requires Director Script enabled).

---

## 5. Placeholder Quick Reference

### Messages & Context

| Placeholder | Content | Use Case |
|------|------|------|
| `{{recentMessages}}` | Most recent N group chat messages (N=llmContextDepth) | Director Prompt |
| `{{newRecentMessages}}` | Smart context window (includes summary + new messages when summary exists) | Director Prompt |

### Characters

| Placeholder | Content | DSL Query |
|------|------|------|
| `{{characters}}` | Group chat character roster (name + description) | — |
| `{{character_profiles}}` | All character profiles | `{{?character_profiles:Alice.motivation}}` |
| `{{charMemory}}` | All character memories | — |
| `{{charMemoryCurrent}}` | Current speaking character's memory | Character Prompt Injection Template only |

### World Settings

| Placeholder | Content |
|------|------|
| `{{worldInfo}}` | Currently activated and checked world book entry text |
| `{{worldBooks}}` | Activated world book list |
| `{{worldBookImportance}}` | Entries sorted by importance |
| `{{characterLore}}` | World book trigger content relevant to current character |

### Director State

| Placeholder | Content |
|------|------|
| `{{directorLedger}}` | Latest Director plan JSON. Path query: `{{?directorLedger:scripts.$character}}` |
| `{{directorHistory}}` | Full Director history JSON array |
| `{{previousPlan}}` | Previous round Director plan (continuity mode) |
| `{{previousPlans}}` | N rounds of historical plans array |
| `{{npcList}}` | NPC roster. Path query: `{{?npcList:[0].description}}` |
| `{{llmJsonSchema}}` | User-customized JSON output format template. Edit via "Advanced: JSON Output Format" in settings |
| `{{scriptField}}` | Expands to scripts JSON field (when Director Script enabled) or empty (when disabled). Used inside the `{{llmJsonSchema}}` template |

### Environment & Tools

| Placeholder | Content |
|------|------|
| `{{identity}}` | User-customized identity anchor prompt (rendered) |
| `{{knowledge}}` | Knowledge base raw text (placeholders not rendered) |
| `{{chatSummary}}` | Currently active context summary |
| `{{directorCritique}}` | Director critique (readable text) | Director Prompt |
| `{{characterCritique}}` | All character critiques (JSON, supports DSL query) | Director Prompt + Character Script |
| `{{charCritique}}` | Current character critique (readable text, auto-resolves character name) | Character Script Wrapper |
| `{{importedSummary}}` | All checked imported summaries |
| `{{systemTime}}` | Current system time |
| `{{timeOfDay}}` | Time of day + season |
| `{{moonPhase}}` | Moon phase |
| `{{randomDice}}` | 0.00-1.00 random number |
| `{{dice}}` | Dice + luck value |
| `{{maxSpeakers}}` | Max speakers per round |

### Custom Agents

User-created Custom Agent instances auto-register as `{{providerName}}` Providers, queryable via `{{?providerName:field}}`.

### Runtime Variables (Character Prompt Injection Template only)

| Variable | Value | Example |
|------|------|------|
| `$character` | Current speaking character name | `{{?character_profiles:$character.summary}}` |
| `$speakerIndex` | Speaking order (1-based) | — |
| `$speakerIndex0` | Speaking order (0-based) | — |
| `$speakerCount` | Total speakers this round | — |
| `$it` | Current iteration element in block loops | `{{?npcList:all[$it].name}}` |

---

## 6. DSL Path Query Syntax

### Basic Queries

```
{{?name:field.subfield}}          → access nested field
{{?name:array[0]}}                → first array item
{{?name:array[-1]}}               → last array item
{{?name:[key=value].field}}       → exact match by key
```

### Practical Examples

```
{{?character_profiles:Alice.summary}}
  → "A battle-hardened kingdom knight who strictly follows the code of honor..."

{{?character_profiles:$character.motivation}}
  → Auto-resolves to the current character's motivation in Character Prompt Injection Template

{{?npcList:[name=老格里姆].description}}
  → Finds the description of NPC named "老格里姆"

{{?directorLedger:scripts.$character}}
  → Retrieves the Director's script for the current character in Character Prompt Injection Template

{{?worldBooks:allEntries[comment=地理与空间].content}}
  → Finds the content of the world book entry with comment "地理与空间"
```

### Block Loops

```
{{#provider:arrayPath}}
  Render this block for each element. $it is the current index
{{/provider}}
```

Example:
```
{{#npcList:all}}
  - {{?npcList:all[$it].name}}: {{?npcList:all[$it].description}}
{{/npcList}}
```

---

## 7. Export & Import

### Data-Level Export (with chat archive)

| Type | Location | Format | Granularity |
|------|------|------|------|
| Character Profiles | Tools → Export/Import → Profiles | `.json` | Per-character checkboxes |
| NPCs | Tools → Export/Import → NPCs | `.json` | Per-entry checkboxes |
| Character Memories | Tools → Export/Import → Memories | `.json` | Per-character checkboxes |
| Summaries | Tools → Export/Import → Summaries | `.json` | One-click export active summary |

Auto-match characters on import (avatar exact → name exact → fuzzy match), confirmation popup for same-name conflicts.

### Config-Level Export (Global)

| Type | Location | Format |
|------|------|------|
| Config Profile | Tools → Config Profile Management | `.zip` (contains manifest.json + custom module source code) |
| Custom Prompts | Tools → Custom Prompts | `.json` |

### Preset Files

Built-in presets (`assets/profiles/`):

| Preset | Type | Content |
|------|------|------|
| `group-director-default` | Config Profile | Recommended config: LLM mode + scripts + profiles + memories |
| `fantasy-rpg` | Character Profiles | 3 fantasy character examples |
| `npc-fantasy-tavern` | NPCs | 3 tavern NPC examples |

---

## 8. Script Executor

Inject custom JS scripts at three key moments in the group chat Director lifecycle. Not an Agent—no token consumption.

**Entry point**: Tools drawer → Script Executor card (below the Reactions drawer).

### Trigger Points

| Trigger Point | Timing | Execution Mode | Available Context |
|--------|------|----------|-----------|
| After Decision | Director decision complete, before character generation | Blocking (10s timeout) | `ctx.decision` (speakers/names/reason/scripts, mutable) |
| After Message | After each character's message is rendered | Fire-and-forget (5s timeout) | `ctx.message`, `ctx.character`, `ctx.decisionSnapshot` |
| After Round | After all characters have spoken this round | Fire-and-forget, deduplicated (5s timeout) | `ctx.decisionSnapshot` |
| Both | After Message + After Round | Respective modes | Phase-specific fields |
| All | All three trigger points | Respective modes | Phase-specific fields |

### Execution Context (ctx)

All scripts access data via `ctx`:

```js
ctx.params        // Script parameters (typed, renderable)
ctx.shared        // Round shared state (cross-script, cross-phase data transfer)
ctx.decision      // [decision only] Director decision object, live reference—directly mutable
ctx.decisionSnapshot  // [message/round] Decision phase snapshot, read-only
ctx.message       // [message only] Current message object { name, mes, ... }
ctx.character     // [message only] Current character object
ctx.chat          // Full chat array
ctx.characters    // Group chat character list
ctx.group         // Current group chat object
ctx.settings      // Plugin settings
ctx.getContext    // ST context function
```

### Shared State

When a script's "Return Mode" is set to "Write to Shared State", the returned object is merged into `ctx.shared`, accessible to subsequent scripts in the same round:

```js
// Script A (priority: 1, decision trigger)
return { x: 42 };

// Script B (priority: 2, decision trigger)
console.log(ctx.shared.x); // 42
```

Shared state auto-resets at the start of each round. Not persisted.

### Parameters

Each script can define typed parameters (string / number / boolean). Parameter values accessed via `ctx.params.key`. With "Render Params" enabled, string-type parameter default values pass through template rendering (single pass, non-recursive).

### Execution Order

Scripts at the same trigger point execute in **ascending priority order**. Priority can be negative. Timed-out or errored scripts are skipped without affecting subsequent scripts.

### Import/Export

Scripts can be exported as `.json` files (with version numbers), reusable across group chats. Importing a script with the same name triggers a confirmation popup for overwrite. Config profile management includes script executors.

### Quick Examples

**Log decision info** (decision trigger, for debugging):
```js
console.log('speakers:', ctx.decision?.speakers);
console.log('reason:', ctx.decision?.reason?.slice(0, 100));
```

**Swap first and last speaker** (decision trigger):
```js
const sp = ctx.decision.speakers;
if (sp.length > 1) {
    [sp[0], sp[sp.length - 1]] = [sp[sp.length - 1], sp[0]];
}
```

**Log message stats** (message trigger):
```js
console.log(`${ctx.character?.name}: ${ctx.message?.mes?.length} chars`);
```

---

## 9. Common Scenario Recipes

### Fantasy RPG Long-Form Narrative

```
Mode: LLM → 2-3 speakers per round → Character description slice 200
Enable Director Script ✓ → Script style "Epic fantasy, focus on character inner thoughts"
Enable Continuity → Full history 10 rounds
Enable Profiles ✓ → Enable Memories ✓ → World Book Injection ✓
When done: Tools → Config Profile Management → Save as config profile
```

### Lightweight Daily Chat

```
Mode: Formula → Top-N 2 → Mention weight 30 → Recency weight 20 → Consecutive penalty 15
Disable LLM Director, Scripts, Profiles, Memories
```

### Mystery/Thriller

```
Mode: LLM → 2 per round
Director Prompt append "Maintain suspense; every line of dialogue could be a clue"
Script style "Stay mysterious, don't reveal the truth"
Enable Memories ✓ (track what each character knows)
```

### Quick Character Testing

```
Formula → Top-N 1
Characters drawer → Regenerate All → Extract All Memories → Check world books → Start
```

---

## 10. AI Critique

The critique system evaluates each round's conversation quality from two dimensions—Director and Characters—injected into prompts via three Providers.

### JSON Schema Convention

Critique JSON must follow a two-layer structure:
- `directorCritique`: object — Director-dimension evaluation, each field rendered as `[field name] content`
- `characterCritiques`: map<string, object> — key is character name, value is that character's evaluation

Default Schema:
```json
{
  "directorCritique": {
    "pacing": "pacing evaluation",
    "spotlight": "spotlight distribution evaluation",
    "suggestions": ["suggestion 1", "suggestion 2"]
  },
  "characterCritiques": {
    "CharacterName": {
      "consistency": "consistency evaluation",
      "interaction": "interaction performance evaluation",
      "suggestions": ["suggestion 1"]
    }
  }
}
```

Users can customize field names and structure in the JSON Schema textarea—omit defaults, add new dimensions freely. `{{charCritique}}` and `{{directorCritique}}` render dynamically, adapting to any Schema.

### DSL Query Examples

```
{{?characterCritique:Alice.consistency}}          → Alice's consistency
{{?characterCritique:Bob.suggestions[0]}}         → Bob's first suggestion
{{#characterCritique:all}}                         → iterate all characters
  {{?characterCritique:all[$it].name}}
{{/characterCritique}}

{{charCritique}}                                   → auto-resolved to current character's critique
```

---

## 11. FAQ

**Q: The Director isn't working?**
A: Check the dashboard status indicator is not gray. For LLM mode, check Tools → Agent Configuration → Director's API connection test.

**Q: Character profiles are empty?**
A: You need to generate them first—Characters drawer → expand Character Profiles card → Regenerate All.

**Q: Will API keys leak?**
A: Agent API keys are automatically cleared when exporting config profiles. You'll need to re-enter them after importing.

**Q: Custom Prompt name rejected?**
A: Names limited to `a-z 0-9 _`. Cannot conflict with built-in Providers (like `recentMessages`) or ST macros (like `user` `char` `time` — 72 total).

**Q: How to completely reset configuration?**
A: Select `group-director-default` from the dashboard preset dropdown → click Apply.

**Q: What's the relationship between memory compression and memory export?**
A: Compression uses LLM to merge old memories into summaries. Compressed memories are marked and can be skipped during export.

**Q: Too many settings—can't find a specific configuration?**
A: Start from the dashboard stats—profile count wrong → Characters drawer. Ledger empty → Continuity drawer → check recording switch. The status labels on card headers help quickly locate problem areas.

---

> Architecture doc: [DESIGN.md](DESIGN.md) | Template syntax: [TEMPLATE-SYNTAX.md](TEMPLATE-SYNTAX.md)