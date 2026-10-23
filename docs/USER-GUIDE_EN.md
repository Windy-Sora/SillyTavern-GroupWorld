# GroupWorld — User Guide

> The public UI is classic settings plus the Muyu floating window. Use GroupWorld install/profile names while retaining compatibility API and archive names. Enable only GD or GW, not both, and back up before upgrading. See [Muyu quick start](../README_EN.md#muyu-assistant) and [migration checks](../MIGRATION.md).

Optional services now use collapsible “Local documents & workspace”, “Public web pages” and “Text validation” groups. Click “Check service capabilities” first; each switch shows support and preference status. Missing/legacy services never expose unavailable tools, and previously enabled preferences can still be turned off. Enabling is not data consent or write approval. Updating existing documents needs document search for a revision baseline. Public page reading is independent of globe search. GroupWorld memory, director and summary features do not depend on the optional service.

Workspace documents (service 0.6.0): Muyu Settings → Storage & memory → Optional services → Check capabilities. Enable Workspace drafts and JSON syntax validation independently (off by default). Saves private text/JSON documents only, not ST/GroupWorld configuration; no installation/execution. Normal mode requires full change review and exact approval; read-all is not write permission. Full-access preview-only never writes. Updates require document search for old revisions. Drafts expire in five minutes; oversize changes are rejected, not truncated. Receipts describe historical sync/readback, not current state; never retry unknown outcomes. Update all seven service .cjs files and restart ST.

Public page text (optional, off by default): update all six service .cjs files to 0.5.0, including web-page.cjs, and restart ST. In Muyu Settings → Storage & memory → Optional services, check capabilities and enable “Allow public web page reading.” This permits public URL requests independently of Brave keys/globe search. URLs and query parameters go to websites; text goes to the current model. Never put keys, private chat or configuration in URLs. At most six attempts per task; returned excerpts count against the data budget and do not guarantee full article coverage. No internal addresses, login, JS rendering or PDFs. Missing/disabled services leave normal chat unchanged. Fake-IP DNS in 198.18/15 is blocked; use real public resolution. See [deployment boundaries](../muyu/server-plugin/README.md).

Local document search (optional, off by default): update all five service .cjs files to 0.4.0, including documents.cjs, and restart ST. In Muyu Settings → Storage & memory → Optional services, check capabilities, then enable local document search. The next task can list approved roots, search text and read excerpts. Enabling is not consent to send data to your model provider; existing permissions, refusals and data budgets apply, and reads can increase model/tool calls. Missing or legacy services and disabled tools do not affect normal chat. The default root is the authenticated ST account’s private `.group-director/muyu/workspace`, not automatically created; additional roots require server-administrator configuration, described in the [deployment guide](../muyu/server-plugin/README.md). No arbitrary disk paths, writes or code execution. Partial results are not complete coverage; documents are untrusted references, not instructions or proof of live configuration.

Service error records: update all service .cjs files to 0.3.0, including diagnostics.cjs, and restart ST. Under Settings → Storage & memory → Optional services, check capabilities and expand “Service errors (last 30 minutes).” View/refresh, export JSON or clear locally without model calls or deleting conversations. Only this account’s history/search/storage-test failure classifications are retained: up to 200 events for 30 minutes, with earlier removal under capacity pressure or on restart. No bodies, keys, paths or CMD logs. Muyu can read them through existing data permissions; read-all follows its existing policy. Classifications do not prove root causes; empty records do not prove no failures occurred.

Optional service management is under Muyu Settings → Storage & memory → “Optional services · File history & web.” History and search settings have shortcuts. Check the service version and capabilities locally without model or paid search calls. “Test history storage (writes a temporary file)” explicitly writes, reads and removes an isolated temporary file without modifying conversations. Passing does not confirm existing conversations are saved or validate search credentials. Update all service `.cjs` files, including `service-status.cjs`, then restart ST. Without the service, chat, configuration management and browser/account-settings storage remain usable.

When conversation auto-save is enabled, ordinary configuration operations and bundle steps also save separate browser/account-local checkpoints. Expand “Operation checkpoints · Local recovery records” below the conversation to review proposed differences, recorded steps and results. Missing final results must be treated as unknown: verify actual settings before repeating. Records never restore permissions, automatically replay or undo operations, and do not sync with server history across devices. Turning auto-save off stops new checkpoints without deleting old ones. Deleting a checkpoint does not undo its operation. Private Prompt/variable text may appear in stored differences.

New supported checkpoints offer “Verify locally and preview remaining steps”, followed by a separate “Approve and execute these remaining changes”. Verification uses local data only, without a model call or restored grants. It requires the original chat, matching baselines and matching confirmed results; completed steps are not repeated. Uncertain results, changed data, scripts, special side-effect settings and legacy records lacking complete intent must be reviewed manually through a fresh request. A durable parent/child claim prevents duplicate recovery attempts. Retain unfinished parent records: deleting them prevents linked attempts from being verified.

Confirmed ordinary single configuration operations with complete backups and no save/conflict warnings also offer “Verify and preview settings undo”, then “Confirm undo of these settings”. Only the listed leaves are restored to prior values, affecting all chats. Changed values or dependencies block undo; unrelated edits are preserved. This is a new save with its own checkpoint and can fail or remain unconfirmed. No automatic rollback or retry, and no one-click redo. Bundles, variables, scripts, asset edits, memory pruning and special side effects are not undoable here.

Muyu gear → Data and permissions → Access mode offers Ask, Allow reads; approve changes, and Full access. Allow reads sends requested chat/card/preset data to the current model provider, without authorizing changes, code execution or business generation. Selection saves automatically; existing users default to Ask. Switching back leaves no automatic source grants, but existing manual grants remain valid. Full access is dangerous and connection-local. Cancel pending authorization before switching. Web search follows the globe; existing-history transport follows its separate context preference.

## Interface and Muyu entry

The public entry currently uses Classic. The navigation-preview entry is disabled while its code is retained; the historical instructions below no longer describe an available interface switcher.

Click “Summon Mu” on the dashboard to choose:

- **Open Muyu Agent (recommended)**: open the independent chat window for questions, permission-scoped reads, configuration previews and supported tools. No character-card import is required. Reopen it through the same entry after closing. Configure its model inside the window, using a compatible current SillyTavern connection or an independent endpoint.
- **Import Muyu character card and world book**: confirm before the existing import flow runs, then start a character chat from the character list. This is separate from the Agent window and does not automatically share sessions, permissions or tool capabilities. Import success does not confirm actual world-book injection.

The menu does not expand the settings layout. Click outside or press Escape to close it; arrow keys select items. Ordinary Agent preferences save automatically, with a short delay for text; failures retain input and offer retry. Credentials/endpoints still use explicit connection submission. Auto-saving preferences does not bypass data permissions or modification approvals.

### Muyu web search (optional)

Web search in Muyu’s gear settings provides **Get service plugin** and **Check installation**. If the service has not been confirmed available, the globe opens the installation guide and checks the local service without sending your draft or enabling search.

Repository: [SillyTavern Muyu Services](https://github.com/Windy-Sora/SillyTavern-Muyu-Services). Install on the computer/server running ST, not through the frontend extension installer. Enable `enableServerPlugins` and restart ST as instructed; phones accessing ST over LAN still require installation on the host computer. Copy the installation command or select it manually if clipboard access is unavailable. Update an existing installation in place instead of installing a duplicate. This UI does not install anything or edit `config.yaml`.

Installation checks need neither a model connection nor a search key and only confirm the local service is reachable, not that Brave credentials work. Then configure a separate Brave Search API key (not your model key) and enable the globe. Queries go to Brave and may incur charges; results contain links and snippets, not full pages. Chat, configuration management and browser/account-settings storage remain available without the server plugin.

<details>
<summary>Historical navigation preview (entry currently disabled)</summary>

Use the Interface selector at the top of the extension panel to switch between
Classic (the default) and New · Preview. Four common categories are visible;
Automation and Advanced are under More. Each category initially shows 1–3 common
features, with the rest in an expandable list. Navigation to a less common feature
automatically expands its category and list. Categories use two rows in narrow
panels and one row in wide panels. The Control board shows the mode and last speaker
decision, with profile change detection, memory extraction, summary generation and
blueprint continuation alongside links to their full pages. Mode and speaker limit
are saved globally. Disabled features must be enabled on their pages first.
Memory batches report successes and failures and stop remaining work after a chat
switch. Page navigation does not cancel started generation. Detail links provide a
return path to the board; NPCs, variables, world books and presets are linked below.
The debug collection toggle is under Advanced & help → More features → Template
tester & traces. In Classic it remains on the dashboard.

Profiles now use a compact single page with chat profiles first,
with scanning and regeneration under More actions and a separate library disclosure.
Budget/concurrency and a model-connection link with a return path remain on the page.
Prompts, schema and render template expand in place; parameters and templates
retain automatic saving on input and apply globally, while profile data belongs to
the current chat. Disabling still hides content without deleting profiles. Classic
restores the original control order. Speaker rules now trial a compact single page:
speaker/context limits remain visible, with scoring details and LLM prompts/output
format expanded in place. Memories and summaries follow the same compact approach:
data, daily actions, automatic rules and short parameters stay on one page,
templates expand in place, and reset/revert/maintenance stays under More actions.
Edited summary results still require Save. Changing memory limits triggers existing
pruning, so lower them carefully. Mode, enable and generation locks retain their
existing behavior. Connection links provide a return to the source feature.
All other preview routes now use compact headings and controls. Auxiliary prompts
and templates for NPCs, blueprints, critique and feedback expand in place, as do
NPC/blueprint libraries and injection previews. Library shortcuts open their target.
Identity, agents, scripts, variables, connections and testing retain their core
editors and existing business behavior; this is not a replacement of those editors.
Classic restores the original content order.
Switching changes presentation without rebuilding controls or changing
business settings. You can return to Classic at any time. The preference is stored
locally for this browser/site, not in exported profiles; session switching still
works when storage is unavailable. Applying configuration profiles still rebuilds
the panel as before: finish unsaved edits first. Draft protection across that
rebuild is not part of this iteration.

</details>

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

### An Even Faster Way: Summon Muyu

Click **“Summon Mu” → “Open Muyu Agent (recommended)”** to open the owl-girl assistant in an independent window. Alternatively, choose “Import Muyu character card and world book” for a SillyTavern character chat.

- **Need configuration help?** Ask for UI explanations or checks of supported settings, with permission requested for private data.
- **Designing a Provider, DSL template or complex system?** The Agent can consult specialist skills and distinguish data, display and state updates.
- **Hit a bug?** Ask it to inspect available state and diagnostics; unavailable server logs, files and unsupported interfaces remain unknown.

Muyu prioritizes a minimal solution using existing mechanisms. Explanations and previews must not silently become applied changes; capabilities depend on current tools and permissions. The Agent can load specialist DSL, structured Provider data and system-design skills on demand. Code candidates, synthetic tests, imports and real execution are separate stages; inaccessible server logs and files must not be described as checked.

### An Even Faster Way: Presets

Select `group-world-default` from the preset dropdown at the bottom of the dashboard → click "Apply" — all recommended configurations take effect immediately.

### Interface Layer Guide

| Level | Area | When to Use |
|------|------|------|
| **At a glance** | Dashboard | Every time you open it—current mode, last decision, data stats, preset switching |
| **Core config** | Director / Characters | Day one—choose mode, write prompts, generate profiles & memories |
| **Tuning** | Continuity | First week—manage ledgers, world books, context summaries |
| **On demand** | Reactions / Tools | As needed—multimodal, export/import, Agent config, custom Agents, debugging |

> **Recommended learning path**: “Summon Mu” → “Open Muyu Agent (recommended)” → describe your goal. Alternatively: dashboard to understand state → Director drawer to configure modes → Characters drawer to prepare data → start chatting. Advanced drawers are collapsed by default and won't interfere with daily use.

---

## 2. Dashboard — Command Center

After opening the GroupWorld settings panel, the first thing you see is the dashboard. It **doesn't belong to any drawer—it's always visible**.

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
| **Built-in Profiles** | Factory presets such as `group-world-default` | Load into list first, then apply settings |
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
| Provider render timeout (ms) | Per-provider render time ceiling. Default: 10000 (10s), 0 = unlimited. Timed-out providers degrade to empty content |
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

**Profile Library** (inside the Character Profiles card)

Save all ready character profiles in the current group as a named "profile library", reusable across group chats. Library entries live in global settings, not exported with chat.

| Control | Purpose |
|------|------|
| Save Current | Prompt for a name, save all ready profiles in the current group as a new library |
| Apply / Import to Library / Export / Delete | Operations on the selected or a specific library |
| Auto-fill | When enabled, automatically match and apply the best library when switching chats or on startup |
| Set as Auto | Set a library as the fixed auto-load target (fixed mode) |
| Overwrite existing / Allow name-only match / Apply template | Matching and apply options |

Apply matches current group members by hash -> avatar+name -> name only, in three tiers; already-ready characters are skipped by default (unless "Overwrite existing" is checked). Each library card shows a match preview (importable / skipped counts).

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

After a successful “Import as Card,” the NPC shows an imported badge and the duplicate-import button is hidden. Renames or content edits made while the import is pending are preserved. If SillyTavern creates the character card but chat-metadata persistence fails, the UI explicitly reports “character created, import status not saved.” Do not import the same card again; once storage recovers, a later chat save can flush the in-memory tracking receipt.

**NPC Library** (inside the NPC Generation card)

Save the current group's NPCs as a named "NPC library", reusable across group chats. Library entries live in global settings, not exported with chat.

| Control | Purpose |
|------|------|
| Save Current | Prompt for a name, save current NPCs as a new library |
| Apply / Import as Library / Export / Delete | Operations on NPC libraries |
| Apply template | Also import the NPC generation prompt template on apply |

Each NPC library card previews how many NPCs would be newly created vs overwritten.

#### Identity Anchor (Card)

Custom prompt to uniformly declare usage rules and priorities for profiles/memories/summaries. Manually injected into Director Prompt or Character Prompt Injection Template via `{{identity}}`. Not auto-injected.

---

### 3.3 Continuity

**What the Director remembers.** Includes context summaries, Story Blueprint, AI critique, Director ledger, world books, and related continuity tools.

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

#### Story Blueprint (Card)

Uses a structured outline to guide Director so the story can progress through dynamic chapters, sections, beats, or deeper layers. When enabled, the default Director Prompt injects `{{storyBlueprintCurrent}}`.

| Control | Purpose |
|------|------|
| Enable Story Blueprint Provider | Master switch. When disabled, blueprint providers are empty; Director cannot see chapter information and is not asked to return the completion variable |
| Auto-continue when complete | After the current blueprint is complete, call the LLM in the background to append the next segment without blocking the current Director round |
| Progression mode | `leaf` advances only leaf nodes; `all` advances all nodes depth-first; `level` advances a selected depth |
| Completion variable | Default `gd_story_chapter_done`. Director/ForceSpeak set it to `true` to advance one step; the system resets it to `false` immediately |
| Generated node count | Suggested number of leaf nodes for generation/continuation |
| New Blueprint | Create a user-authored blank blueprint with one editable starting chapter |
| Add Chapter | Append a blank root-level chapter without resetting existing progress |
| Generate / Continue | Use the independent Story Blueprint API configuration to create a new blueprint or append nodes |
| Rollback one / Reset progress | Correct progress after context deletion or accidental completion |
| Progression node list | Click a row to view that node in the right panel; click the location icon to set it as the current step |
| Blueprint title / node cards | Click the title, meta values, or node content fields to edit and autosave |
| Advanced JSON editor | Directly edit blueprint JSON; saving validates that `nodes` is non-empty |
| Generation Prompt / Continuation Prompt / Schema / Provider Template | Customizable with restore-default buttons; generation and continuation prompts support normal Provider rendering |
| Export / Import | Export or import the current chat's blueprint body and progress |

The default generation prompt includes `{{storyBlueprintFullJson}}` and `{{storyBlueprintProgress}}` so regeneration can preserve existing continuity. Remove those placeholders from the prompt when you intentionally want a clean restart.

Blueprint body and progress are stored in the current chat. Config profiles sync blueprint configuration only, not the concrete story blueprint. Story Blueprint uses the `story-blueprint` independent API settings in the Tools drawer's Agent Configuration card.

**Story Blueprint Library** (inside the Story Blueprint card)

Save the current story blueprint as a named "blueprint library", reusable across group chats. Library entries live in global settings, not exported with chat.

| Control | Purpose |
|------|------|
| Save Current | Save the current blueprint as a new library (optionally with progress) |
| Apply / Import as Library / Export / Delete | Operations on blueprint libraries; applying can optionally restore progress |

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

**Source mode** (`worldBookSourceMode`):

- **ST** (default): follow SillyTavern's currently active world books (chat-bound world book + global selection + character world books). The selection list below is read-only
- **GroupWorld**: fully use the manual selection list below (`worldBookSelection`), decoupled from ST activation

**Selection list**: Select All / Deselect All + per-item checkboxes (editable in GroupWorld mode).

**Provider preview**: scans currently active world books in real time and previews the rendered text and character-count stats of `{{gdWorldBooksConstant}}` / `{{gdWorldBooksFull}}` / `{{gdWorldBooksNames}}`, with one-click copy buttons for each placeholder.

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

**Config profiles, export/import, Agents, Custom Agents, Custom Prompts, Variables, API reference, Script Executor, debugging.** Drawer collapsed by default.

#### Config Profile Management (Card)

Save, export, and import the entire plugin configuration as `.zip`. Create multiple config profiles to switch on demand. Scope selection on export (per-drawer checkboxes). API keys auto-redacted.

#### Export / Import (Card)

Export/import covers Group Chat (character cards + world books `.zip`), Profiles (`.json`), Memories (`.json`), NPCs (`.json`), and Summaries (`.json`). Each JSON module applies its own character-matching rules; Group ZIP uses the manifest and card filenames to map members.

Group ZIP exports contain only enabled character cards that were retrieved successfully. Missing cards or world books produce a partial-export warning; if every card fails, no unusable archive is downloaded. Import checks the manifest, cards, and world books before uploading. It does not force existing character-card filenames to be overwritten, and it chooses a different name for known world-book collisions. If an upload fails partway through, resources already imported are not automatically deleted. The group is created only after all required characters import successfully, and a partial-success warning identifies the need to review created resources.

#### Agent Configuration (Card)

Each LLM call group (Director / ForceSpeak / Profile / Summary / NPC / Memory / PostSpeech / Critique / Story Blueprint / Custom Agent) can independently set its API endpoint and key. Supports OpenAI or Anthropic protocols. Test connection available.

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

Pure reference documentation listing all 44 built-in Provider placeholders and their descriptions (bilingual Chinese/English). Supports search filtering, add/edit/delete custom entries, export/import JSON files, one-click restore to defaults. No functional side effects—purely for helping users quickly understand available `{{placeholder}}` options in prompts.

#### Variables (Card)

Manages GroupWorld's variable tracking system. 22 built-in templates (story_phase, party_funds, trust_user, health, etc.) with global and character scopes. The LLM auto-maintains variable values each round; the dashboard variable panel provides real-time view/edit/rollback/lock. Supports import/export of variable definitions and data.

| Control | Purpose |
|------|------|
| New Variable | Create a custom variable (id/label/scope/type/updateMode/rule) |
| Template dropdown | Select from 22 presets to add to the current chat |
| Variable list | Browse/edit/delete existing variables, copy `{{?vars:...}}` query tokens |
| Editor | Modify variable definition (scope/type/update mode/validation rules/default value) |
| Maintenance preview | View the actual {{variableMaintenance}} content injected into the Director Prompt |
| Export/Import | Export variable definitions + data as JSON, reusable across group chats |

A variable import reports success only after chat persistence completes. If persistence fails, the import is rolled back while other edits completed during the pending save are retained, including concurrent appends to the same array variable.

> **Dashboard Variable Panel**: Click the "Variables" button on the dashboard action bar to expand. Includes index quick-jump, template dropdown, new variable creation, and export/import. Variable values are grouped by global/character with inline editing, rollback to previous record, and variable locking. Check "Hide unchanged character vars" to filter inactive rows.

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
| `{{gdWorldBooksFull}}` | Full text of all entries in currently active world books |
| `{{gdWorldBooksConstant}}` | Always-on (constant) entries in currently active world books |
| `{{gdWorldBooksNames}}` | List of currently active world book names |
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

### Variable System

| Placeholder | Content | DSL Query |
|------|------|------|
| `{{globalVars}}` | Readable list of global variables (label: value) | `{{?globalVars:party_funds.value}}` |
| `{{charVars}}` | Character variables grouped by character | `{{?charVars:trust_user.values.$character}}` |
| `{{vars}}` | Full variable snapshot JSON | `{{?vars:global.story_phase.value}}` |
| `{{varsJson}}` | Full variable snapshot JSON (same as vars) | Same as above |
| `{{variableMaintenance}}` | Variable maintenance instructions (auto-injected into Director Prompt) | — |

The variable system provides 22 built-in variable templates (story_phase, party_funds, trust_user, health, etc.). The LLM can auto-update values each round via the `variable_update` JSON field. Variables support four update modes: replace/delta/append/merge. Click the "Variables" button on the dashboard to view/edit/rollback/lock values in real time.

### Story Blueprint

| Placeholder | Content | DSL Query |
|------|------|------|
| `{{storyBlueprintCurrent}}` | Current Story Blueprint progression block. The completion notice is consumed once only in Director prompt rendering | — |
| `{{storyBlueprintCurrentJson}}` | Current progression node JSON | `{{?storyBlueprintCurrentJson:content.completion_rule}}` |
| `{{storyBlueprintProgress}}` | Progress summary, e.g. `3/8 current chapter` | `{{?storyBlueprintProgress:complete}}` |
| `{{storyBlueprintSchemaHint}}` | Completion variable protocol hint | `{{?storyBlueprintSchemaHint:completionVariable}}` |
| `{{storyBlueprintFullJson}}` | Full blueprint JSON | `{{?storyBlueprintFullJson:title}}` |
| `{{storyBlueprintDoneField}}` | Director JSON Schema field fragment, usually placed inside `variable_update.global` | — |

When Story Blueprint is disabled, these providers return empty content or do not advance progress. `{{storyBlueprintDoneField}}` expands to an empty string when disabled.

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

### Reusable Libraries (Cross-Chat)

Character Profiles / NPC / Story Blueprint each have a "library" card (inside the Character Profiles and NPC Generation cards in the Characters drawer, and the Story Blueprint card in the Continuity drawer). They save the current group's data as named reusable packages, applicable across group chats. Library entries live in global settings, not exported with chat; each library supports Save Current, Apply, Import file, Export JSON, and Delete. The Profile library additionally supports auto-matching and loading when switching chats.

See each card's section for details.

### Config-Level Export (Global)

| Type | Location | Format |
|------|------|------|
| Config Profile | Tools → Config Profile Management | `.zip` (contains manifest.json + custom module source code) |
| Custom Prompts | Tools → Custom Prompts | `.json` |

### Preset Files

Built-in presets (`assets/profiles/`):

| Preset | Type | Content |
|------|------|------|
| `group-world-default` | Config Profile | Recommended config: LLM mode + scripts + profiles + memories |
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
A: Select `group-world-default` from the dashboard preset dropdown → click Apply.

**Q: What's the relationship between memory compression and memory export?**
A: Compression uses LLM to merge old memories into summaries. Compressed memories are marked and can be skipped during export.

**Q: Too many settings—can't find a specific configuration?**
A: Start from the dashboard stats—profile count wrong → Characters drawer. Ledger empty → Continuity drawer → check recording switch. The status labels on card headers help quickly locate problem areas.

---

## Muyu troubleshooting log

For auto-save errors, check the safe error code and advice under Settings → Storage & memory. If storage is unavailable, restore connectivity/browser storage access and click “Retry saving.” If a preference save fails, check the ST connection and change that option again. Do not clear records first; export this conversation before reloading. An enabled auto-save preference does not confirm every save succeeded.

Unavailable storage does not prevent saving your auto-save preference; a checked option is not confirmation of a saved conversation. Under Settings → Storage & memory → Conversation history, select one “Read history from” source: browser, account settings, world books or server files. “Write locations (multiple)” independently controls subsequent saves; all switches off still permits reading old records. Preferences save automatically. Switch sources while idle without reloading the page; each source retains its own page records, drafts and scroll position. Finish or cancel pending tasks first. Switching or enabling writes does not move old history, and an explicitly selected unavailable source never silently falls back.

“Import read-only backup” compares content against imported backups in the current read source and this page. Identical files open an existing read-only backup without adding a duplicate; archived backups stay archived. Changed content creates a separate read-only version, never overwriting the original conversation. Other backends are not merged, and grants or task execution are never restored. With auto-save off, new imports remain page-only: check storage status or export a backup. Previously existing duplicates are not automatically deleted.

Re-enabling a write location applies to subsequent saves; it does not immediately backfill the whole library. Retry addresses pending or failed records; use explicit copy to move saved history. A failed location does not mean every location failed: check each result. When using world-book history on a computer and phone, use them in sequence rather than editing the same conversation simultaneously.

“Currently reading” and each location’s last save status are shown separately. Partial success is not overall success. Retry unconfirmed content; identical confirmed copies are not written again. If source writes are off, new content may exist only at other selected locations; the UI says the read location was not updated. Rename, archive and delete affect only the current read location and require its write switch; other backups are not deleted. Saving may read same-ID target records to prevent overwrites, without merging them into history or sending them to the model. Divergent versions remain conflicts, not automatic merges. Export important content before switching.

After switching to world books, expand “Copy old history to world books…”, select the old location and click “Confirm copy to world books (keep originals)”. Export a backup and stop editing on other devices first. “This browser” reads only this browser’s records. Only saved conversations are copied; originals remain, identical records are skipped and conflicts are never overwritten. Completed copies remain after failure; check connectivity or capacity and retry. Grants, running tasks and configuration checkpoints are not migrated. Do not continue the same conversation in both locations.

Refreshing history or re-enabling auto-save detects loaded conversations changed or deleted in storage. Page content remains, with a warning; sending and auto-saving that old record are paused. Export anything needed, then choose “Reload stored version…” and confirm. This discards unsaved conversation-record changes but retains unsent text and does not undo executed operations. Failed reads or switching chats during reload do not replace current content. This is not background synchronization or merging.

World-book storage needs no service plugin and lets you continue Muyu conversations across desktop and phone browsers using the same ST account. New conversations share disabled `GD-Muyu-History-v2-…` volumes; existing v1 books remain in place. Do not enable, bind or manually edit them. Deleting a volume affects ALL its conversations; renaming may make history unavailable. Conversations are plaintext, limited to 8 MiB each and 64 MiB total. Avoid simultaneous editing across devices; refresh history after changing devices. GroupWorld's normal world-book tools and Providers exclude these archives, but other plugins may still read the files. Configuration checkpoints remain in the current browser and do not sync with conversations.

Under Conversation history → World-book volume settings, the new-conversation volume target defaults to 8 MiB and accepts integers from 1 to 16. Changes save automatically. Placement counts the entire serialized book in UTF-8 and opens another volume when needed. Lowering the target never moves or truncates existing data. A long conversation can occupy an oversized volume, and existing conversations grow in place. Saves exceeding the 20 MiB hard limit are rejected with page content retained; export a backup. This setting does not reorganize old volumes, merge old books or change other storage locations.

For older one-conversation-per-book archives, open Consolidate legacy world-book archives… and choose Confirm consolidation (keep old books). First export backups and close other devices and old tabs. Select world books as the read source and enable their write switch. Consolidation preserves conversation IDs, revisions and deletion markers, using the current volume target. New volumes become authoritative without mixing duplicate copies; failures can be retried. Old books remain as static backups: later updates and deletions do not update them, and old text may remain. External changes to old backups cause a conflict rather than an automatic version choice.

To reduce the world-book list, separately choose Remove consolidated old books… and then Confirm removal of old books (irreversible). Only verified, unchanged, already-consolidated legacy copies are deleted; new volumes, ordinary lore and other storage backends are untouched. Unconsolidated, divergent or damaged data is not removed. Export backups and close old tabs to prevent stale code recreating old books. Refresh the native world-book list if needed. There is no cross-device atomic transaction guarantee; do not write from another device concurrently.

The service plugin now supports ST's default relative data directory. After updating it, restart ST on the host computer, then reload the phone/desktop page and retry saving; refreshing the browser alone cannot reload server code. A successful health check does not prove history reads/writes work. `HISTORY_IDENTITY_UNAVAILABLE` means the service did not receive a valid user directory. Check that the updated service is loaded after restarting; do not clear history to resolve it.

When a Muyu task fails, open **Conversation tools → Troubleshooting log → Export diagnostic log JSON** and share the file with the developer. Export before reloading or clearing runtime records. It contains retained execution segments, safe error codes, failure stages, budgets and read progress for this conversation—not complete history or server/CMD logs.

Export is local, needs no data permission and makes no model calls. It excludes conversation/Prompt bodies, thinking text, character names, endpoint URLs, keys and real session IDs. If downloading is unavailable, expand the read-only log text and copy it manually. Previously recorded `UNKNOWN_ERROR` values cannot be reconstructed.

> Architecture doc: [DESIGN.md](DESIGN.md) | Template syntax: [TEMPLATE-SYNTAX.md](TEMPLATE-SYNTAX.md)
