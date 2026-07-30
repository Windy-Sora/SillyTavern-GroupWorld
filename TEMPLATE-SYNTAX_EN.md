# Template Placeholder Syntax Reference

## 1. Overview

Group World's template system supports six placeholder syntax types, usable in **any template** (Director Prompt, Script Wrapper, Custom Prompt):

| Syntax | Purpose | Example |
|------|------|------|
| `{{name}}` | Render a Provider's full text content | `{{recentMessages}}` |
| `{{?name:path\|fallback}}` | Extract a value by path from a Provider's JSON data | `{{?directorLedger:memory.location}}` |
| `{{#name:path}}...{{/name}}` | Iterate over an array, rendering inner template for each element | `{{#ledger:items}}...{{/ledger}}` |
| `{[{content}]}` | Zero-render passthrough—content is completely unparsed | `{[{ {{characters}} }]}` → `{{characters}}` |
| `{{counter}}` / `{{counter0}}` | Auto-incrementing counter | `{{counter}}` |

---

## 2. Simple Placeholders `{{name}}`

```
{{recentMessages}}  {{characters}}  {{previousPlan}}  {{directorLedger}}
{{worldInfo}}  {{character_profiles}}  {{maxSpeakers}}  {{previousPlans}}
{{worldBookImportance}}  {{characterLore}}  {{worldBooks}}
{{gdWorldBooksFull}}  {{gdWorldBooksConstant}}  {{gdWorldBooksNames}}
{{globalVars}}  {{charVars}}  {{vars}}  {{varsJson}}  {{variableMaintenance}}
{{storyBlueprintCurrent}}  {{storyBlueprintProgress}}  {{storyBlueprintCurrentJson}}
{{storyBlueprintSchemaHint}}  {{storyBlueprintFullJson}}  {{storyBlueprintDoneField}}
```

Inserts the Provider's rendered result for `name` directly into the template. Behavior for unregistered placeholders is controlled by the `templateDebugPlaceholders` setting:

| Setting | Behavior |
|------|------|
| `false` (default) | Unregistered → silently cleared to `''`, won't pollute LLM context |
| `true` | Unregistered → preserved as-is `{{typoName}}`, for debugging typos |

### 2.1 Auto-increment Counter `{{counter}}` / `{{counter0}}`

| Placeholder | Lifetime | Start Value | Reset Condition |
|--------|---------|--------|---------|
| `{{counter}}` | Full round (across multiple `renderPrompt` calls) | 0 | `GROUP_WRAPPER_STARTED` normal new round |
| `{{counter0}}` | Single `renderPrompt` call | 0 | Auto-reset on each `renderPrompt` entry |

**`{{counter}}` swipe protection:** When a character's script is first rendered, the counter value is snapshotted and persisted to `chat_metadata._counterSnapshots`. Subsequent swipes for that character restore the counter to the snapshot value. Survives page reloads via chat_metadata recovery.

Example:
```
New round → counter=0
Appears 3 times in Director Prompt → 0, 1, 2
Alice's script first render → snapshot=3 → appears 2 times → 3, 4
Bob's script first render → snapshot=5 → appears 2 times → 5, 6
User regenerates Bob → restores snapshot=5 → Bob re-renders → 5, 6 (consistent)
Page reload then swipe Bob → chat_metadata restores snapshot → 5, 6 (consistent)
```

---

## 3. Block Loops `{{#name:path}}...{{/name}}`

### 3.1 Basic Format

```
{{#provider:path.to.array}}
  ... inner template, can use any {{...}} placeholder ...
{{/provider}}
```

- `path.to.array` resolves to an array; inner template is rendered for each element
- Results joined with newline `\n`
- Automatic Set deduplication (for primitive types like strings/numbers)
- Empty array / null / non-array → entire block outputs empty string (silent fallback)
- Innermost-first processing, supports nested block loops

### 3.2 The `$it` Variable

Inside block loops, `$it` is bound to the current iteration element:

```
{{#directorLedger:loreAssignments.$character}}
  {{?worldBooks:allEntries[comment=$it].content}}
{{/directorLedger}}
```

`$it` can also be used in `$variable` expansion and nested path queries.

### 3.3 Rendering Order

Block loops execute in Phase 1.5 (Providers cached, placeholders not yet replaced). The inner template then goes through the full Phase 2+3 pipeline. So any placeholder can be used inside, including counters:

```
{{#ledger:steps}}
  Step {{counter}}: {{?ledger:details[$speakerIndex0]}}
{{/ledger}}
```

---

## 4. Path Queries `{{?name:path|fallback}}`

### 4.1 Basic Format

```
{{?provider:path.to.value}}
{{?provider:path.to.value|Default value}}
```

- `?` — path query marker
- `path.to.value` — JSON path expression
- `|Default value` — used when the path doesn't exist or the value is empty

### 4.2 Path Syntax

#### Dot Access
```
{{?directorLedger:memory.location}}        → data.memory.location
{{?directorLedger:scripts.Alice}}          → data.scripts.Alice
```

#### Array Indexing (negative indices count from end)
```
{{?directorLedger:events[0].title}}        → first
{{?directorLedger:events[-1].title}}       → last
{{?previousPlans:[-2].reason}}             → second to last
```

#### Property Filtering
```
{{?worldBooks:allEntries[comment=地理与空间].content}}
{{?history:plans[reason=开场].scripts}}
```
`[key=value]` finds the first matching element in an array.

#### Quoted Keys (containing special characters)
```
{{?directorLedger:["key.with.dots"]}}
{{?directorLedger:['weird-key']}}
```

#### Combined Usage
```
{{?directorLedger:chapters[0].["scene.title"].text}}
```

### 4.3 Nested Path Queries

Paths can contain inner `{{...}}` placeholders, resolved from innermost outward:

```
{{?directorLedger:scripts[{{?ledger:currentSpeaker}}]}}
{{?worldBooks:allEntries[comment={{?ledger:entryName}}].content}}
```

### 4.4 Runtime Variables `$`

| Variable | Available In | Meaning |
|------|---------|------|
| `$character` | Script Wrapper | Current character name |
| `$speakerIndex` | Script Wrapper | Speaking order (1-based) |
| `$speakerIndex0` | Script Wrapper | Speaking order (0-based) |
| `$speakerCount` | Script Wrapper | Total speakers this round |
| `$it` | Inside block loops | Current iteration element |

Variable values containing path special characters are automatically wrapped with `["..."]`.

### 4.5 Value Extraction Rules

| Type | Output |
|------|------|
| `string` | Output as-is |
| `number` | `String(value)` |
| `boolean` | `String(value)` |
| `object` / `array` | `JSON.stringify(value, null, 2)` |
| `null` / `undefined` | Returns fallback value; empty string if no fallback |

---

## 5. Provider Data Contract

### 5.1 Format

```js
// Text-only
return { content: 'some text' };
return 'some text';  // backward compatible

// Structured (supports path queries)
return {
    content: 'summary text for {{name}}',
    data: { key1: 'val1', nested: { key2: 'val2' } },
};
```

### 5.2 Registered Provider Reference

| Provider | Placeholder | content | data | Registered At |
|----------|--------|---------|------|------|
| `recentMessages` | `{{recentMessages}}` | Recent messages text | — | `providers/recent-messages.js` |
| `characters` | `{{characters}}` | Character list | — | `providers/characters.js` |
| `character_profiles` | `{{character_profiles}}` | Character profiles | — | `providers/character-profiles.js` |
| `maxSpeakers` | `{{maxSpeakers}}` | Number string | — | `index.js` |
| `worldInfo` | `{{worldInfo}}` | ST world book entries | — | `providers/world-info.js` |
| `previousPlan` | `{{previousPlan}}` | Previous round plan | Previous round raw object | `providers/history.js` |
| `previousPlans` | `{{previousPlans}}` | History plans array | History raw array | `providers/history.js` |
| `directorLedger` | `{{directorLedger}}` | Latest plan JSON | Latest plan raw object | `providers/director-ledger.js` |
| `directorHistory` | `{{directorHistory}}` | Full history JSON | Full history raw array | `providers/director-ledger.js` |
| `worldBooks` | `{{worldBooks}}` | World book list | `{ books, allEntries }` | `providers/world-books.js` |
| `worldBookImportance` | `{{worldBookImportance}}` | Importance ranking | Sorted array | `providers/world-book-importance.js` |
| `gdWorldBooksFull` | `{{gdWorldBooksFull}}` | Full text of all entries in currently active world books (macros substituted) | `{ books, entries, names, stats }` | `providers/gd-world-books.js` |
| `gdWorldBooksConstant` | `{{gdWorldBooksConstant}}` | Text of always-on entries in currently active world books | `{ entries, names, stats }` | `providers/gd-world-books.js` |
| `gdWorldBooksNames` | `{{gdWorldBooksNames}}` | Comma-separated list of currently active world book names | Names array | `providers/gd-world-books.js` |
| `characterLore` | `{{characterLore}}` | Character trigger words | — | `providers/character-lore.js` |
| `chatSummary` | `{{chatSummary}}` | Context summary | — | `providers/chat-summary.js` |
| `newRecentMessages` | `{{newRecentMessages}}` | Smart context (summary + new messages) | — | `providers/new-recent-messages.js` |
| `knowledge` | `{{knowledge}}` | Knowledge base raw text (zero-render) | — | `providers/knowledge.js` |
| `systemTime` | `{{systemTime}}` | Current date and time | Structured time fields | `providers/system-time.js` |
| `randomDice` | `{{randomDice}}` | 0.00–1.00 random number | `{ value }` | `providers/random-dice.js` |
| `dice` | `{{dice}}` | Dice 1–6 | `{ die, luck }` | `providers/dice.js` |
| `moonPhase` | `{{moonPhase}}` | Moon phase (8 phases + illumination) | Structured moon phase fields | `providers/moon-phase.js` |
| `timeOfDay` | `{{timeOfDay}}` | Time of day + season | `{ timeOfDay, season }` | `providers/time-of-day.js` |
| `test` | `{{test}}` | Test text | Test data | `providers/test-provider.js` |
| `globalVars` | `{{globalVars}}` | Global variable list | `{ [id]: { ...def, value } }` | `providers/variables.js` |
| `charVars` | `{{charVars}}` | Character variable list (grouped by character) | `{ [id]: { ...def, values, names } }` | `providers/variables.js` |
| `vars` | `{{vars}}` | Full variable snapshot JSON | `{ global, character, currentCharacter, log }` | `providers/variables.js` |
| `varsJson` | `{{varsJson}}` | Full variable snapshot JSON (same as vars) | Same as above | `providers/variables.js` |
| `variableMaintenance` | `{{variableMaintenance}}` | Variable maintenance instructions (injected into Director Prompt) | Full snapshot object | `providers/variables.js` |
| `storyBlueprintCurrent` | `{{storyBlueprintCurrent}}` | Current Story Blueprint step; completion notice consumed once by Director | `{ blueprint, progress, current, doneSignals }` | `providers/story-blueprint.js` |
| `storyBlueprintCurrentJson` | `{{storyBlueprintCurrentJson}}` | Current progression node JSON | Current node object | `providers/story-blueprint.js` |
| `storyBlueprintProgress` | `{{storyBlueprintProgress}}` | Blueprint progress summary | `{ current, done, total, complete, currentIndex }` | `providers/story-blueprint.js` |
| `storyBlueprintSchemaHint` | `{{storyBlueprintSchemaHint}}` | Completion variable protocol hint | `{ completionVariable }` | `providers/story-blueprint.js` |
| `storyBlueprintFullJson` | `{{storyBlueprintFullJson}}` | Full blueprint JSON | Blueprint object | `providers/story-blueprint.js` |
| `storyBlueprintDoneField` | `{{storyBlueprintDoneField}}` | Director JSON Schema field fragment | `{ enabled, variableName }` | `index.js` |

### 5.3 Variable System Provider Details

Group World v0.7 adds a variable tracking system. The following 5 providers are all registered by `providers/variables.js`.

#### `{{globalVars}}` — Global Variable List

Renders all `scope: "global"` variables as readable text:

```
- Story Phase (story_phase): Prologue
- Current Goal (current_goal): Explore the ruins
- Party Funds (party_funds): 150
- Danger Level (danger_level): 25
```

**data structure:**
```json
{
  "story_phase": { "id": "story_phase", "label": "Story Phase", "scope": "global", "type": "string", "value": "Prologue", "rule": "..." },
  "party_funds": { "id": "party_funds", "label": "Party Funds", "scope": "global", "type": "number", "value": 150, "min": 0, "updateMode": "delta" }
}
```

**Path query examples:**
```
{{?globalVars:story_phase.value}}          → Prologue
{{?globalVars:party_funds.value}}          → 150
{{?globalVars:danger_level.value|0}}       → 25 (falls back to 0)
```

---

#### `{{charVars}}` — Character Variable List

Renders character variables based on context. With a current character, renders only that character; without, renders all active characters:

```
[Alice]
  - Trust Toward User (trust_user): 60
  - Emotion (emotion): curious
  - Health (health): 95
[Bob]
  - Trust Toward User (trust_user): 30
  - Emotion (emotion): wary
  - Health (health): 80
```

**data structure:**
```json
{
  "trust_user": {
    "id": "trust_user", "label": "Trust Toward User", "scope": "character", "type": "number", "updateMode": "delta", "min": 0, "max": 100,
    "values": { "alice_avatar_hash": 60, "bob_avatar_hash": 30 },
    "names": { "alice_avatar_hash": "Alice", "bob_avatar_hash": "Bob" }
  }
}
```

**Path query examples:**
```
{{?charVars:trust_user.values.$character}}          → current character's trust
{{?charVars:health.values.$character|100}}          → current character's health, defaults to 100
```

> **Note:** `$character` is only available in Script Wrapper context (value is the current character name). In Director Prompt, use a specific avatar or character name.

---

#### `{{vars}}` / `{{varsJson}}` — Full Snapshot JSON

Both output the same content: a complete JSON snapshot of all variables.

**data structure:**
```json
{
  "global": {
    "story_phase": { "id": "story_phase", "label": "Story Phase", "type": "string", "value": "Prologue", "rule": "..." },
    "party_funds": { "id": "party_funds", "type": "number", "value": 150, "min": 0, "updateMode": "delta" }
  },
  "character": {
    "trust_user": { "id": "trust_user", "type": "number", "values": { "alice_hash": 60, "bob_hash": 30 }, "names": { "alice_hash": "Alice", "bob_hash": "Bob" } }
  },
  "currentCharacter": "alice_hash",
  "log": [ /* last 20 change log entries */ ]
}
```

**Path query examples:**
```
{{?vars:global.story_phase.value}}                    → Prologue
{{?vars:character.trust_user.values.alice_hash}}      → 60
{{?vars:currentCharacter}}                            → alice_hash
```

---

#### `{{variableMaintenance}}` — Variable Maintenance Instructions

**This is the core bridge between the variable system and the LLM.** It is automatically injected at the end of the Director's system prompt, telling the LLM which variables need maintenance, their update rules, and how to return updates via JSON.

**Rendered content example:**
```md
[Variables to maintain]
Update these only when the conversation gives clear evidence. Use small numeric deltas when updateMode is delta.
For character variables, use only the character names listed below as keys in the character object.

Valid character names: "Alice", "Bob", "Charlie"

- global.story_phase (string, replace) current=Prologue
  Rule: Update when the story phase clearly changes. Keep it short.
- global.party_funds (number, delta) current=150
  Rule: Adjust when the group gains or spends money. Use deltas for changes.
- character.*.trust_user (number, delta) default=50
  Rule: Adjust only when this character gains or loses trust in the user. Use small deltas.
- character.*.emotion (string, replace) default=
  Rule: Track the character current dominant emotion in a few words.

Return updates in this optional JSON field:
"variable_update": {
  "global": { "var_id": { "value": "...", "reason": "..." } },
  "character": { "Exact Character Name": { "var_id": { "value": "+1 or new value", "reason": "..." } } }
}
```

**LLM return format specification:**

```json
{
  "speakers": ["Alice", "Bob"],
  "reason": "...",
  "variable_update": {
    "global": {
      "story_phase": { "value": "Chapter 2 - Departure", "reason": "Story transitions from prologue to chapter 2" },
      "party_funds": { "value": "-30", "reason": "Spent 30 gold at the tavern" }
    },
    "character": {
      "Alice": {
        "trust_user": { "value": "+5", "reason": "User saved her" },
        "emotion": { "value": "grateful" }
      },
      "Bob": {
        "suspicion": { "value": "+10", "reason": "User's behavior is suspicious" }
      }
    }
  },
  "scripts": { ... }
}
```

**Update mode reference:**

| updateMode | Value format | Example | Behavior |
|---|---|---|---|
| `replace` | Any matching type | `"Chapter 2"` | Directly replaces old value |
| `delta` (number only) | `"+5"` / `-10` / `3` | `"+5"` | Old value + delta, clamped to [min, max] |
| `append` (array/string) | Single value or array | `"new entry"` / `["a","b"]` | Appends to end |
| `merge` (object only) | JSON object | `{"key": "val"}` | Shallow merge into old object |

**Injection location:** `{{variableMaintenance}}` is appended to the system prompt in `index.js`'s `buildDirectorSystemPrompt()` (before `{{llmJsonSchema}}`), so the LLM sees the variable maintenance instructions in every Director round and Force Speak.

**`variable_update` processing flow:**

```
LLM returns JSON
  → initRoundWithLLM() / initForceSpeakLLM() parses parsed.variable_update
    → variableSystem.applyUpdates(update, { source: 'director' | 'force-speak' })
      → Iterates global and character fields
        → Per variable: checks autoUpdate / locked
          → Calls setValue() → coerceValue() type validation
            → Writes to chat_metadata → saveChatConditional()
              → pushLog() records change
                → Refreshes dashboard UI
```

**Auto-update controls:**
- `autoUpdate: false` — LLM updates are recorded as `ignored` (log kept, value unchanged)
- `locked: true` — Same as above, plus dashboard shows lock icon
- `injectMode: "manual"` — Variable does not appear in `{{variableMaintenance}}` output (LLM won't see it)

---

## 6. Zero-Render Passthrough `{[{...}]}`

Content inside `{[{...}]}` is **completely unparsed**—Phase 0 replaces it with sentinels, and after all rendering stages complete, the original content is restored.

```
{[{ {{recentMessages}} }]}     → rendered result: {{recentMessages}}
{[{ {{?ledger:reason}} }]}     → rendered result: {{?ledger:reason}}
```

**Purpose**: Teach the LLM to use DSL interfaces within the Director Prompt.

Difference from `{{knowledge}}`: `{[{...}]}` is inline syntax that can be embedded anywhere in a prompt. `{{knowledge}}` is a dedicated settings panel text area for conveniently entering large reference documents.

---

## 7. Rendering Pipeline

```
Phase 0   — {[{...}]} passthrough slots → sentinel replacement
Phase 1   — Execute all Providers, cache to cache[id] = { content, data }
Phase 1.5 — Block loops {{#name:path}}...{{/name}} (innermost first, per-element render after dedup)
Phase 2   — Simple placeholders {{name}} → cache[id].content
            {{counter}}/{{counter0}} increment replacement
Phase 3   — Path queries {{?name:path|fallback}}
            1. resolveInnerPlaceholders(path) — expand nested {{...}} in path
            2. expandVariables(path) — expand $variable
            3. parsePath → resolvePath → formatValue

Post-loop — Repeat Phase 1.5+2+3, up to maxPasses rounds
Final     — Restore Phase 0 passthrough slots + unescapeKnowledge ({{knowledge}} content)
            Each round checks result === before, exits early if no change
            Counters preserved as-is during re-rounds, not incremented
```

---

## 8. Complete Examples

### 8.1 Director Prompt (Factory Default)

```
{{worldInfo}}{{previousPlans}}{{previousPlan}}Recent messages:
{{recentMessages}}

Available characters:
{{characters}}

Character profiles:
{{character_profiles}}

---
You are a Group Chat Director.

Knowledge reference:
{{knowledge}}

Available world book entries:
{{worldBookImportance}}

For EACH picked character, optionally assign relevant world book entries
by their exact displayed names. Only assign entries actually relevant
to that character's current situation.

Reply with ONLY a JSON object:
{
  "speakers": ["Name1", "Name2"],
  "reason": "short justification",
  "scripts": { "Name1": "stage direction", "Name2": "stage direction" },
  "loreAssignments": { "Name1": ["entry name"], "Name2": [] }
}
```

### 8.2 Script Wrapper (Factory Default)

```
{{characterLore}}[Director's stage direction for this character:
{{script}}

Follow this guidance. NEVER mention the director, the script,
or that you are following stage directions. Act naturally as your character.]
```

### 8.3 `{{worldBookImportance}}` Output Example

```
1. [地理与空间] _Girl world_ importance=0.850 (always-on)
2. [eldoria] _Eldoria_ importance=0.420 (keys:eldoria,wood,forest)
3. [娱乐室/游戏区] _girls world location indoor_ importance=0.330 (keys:台球,飞镖)

## Always-On (10)
- [地理与空间] _Girl world_ importance=0.850
- [社会结构] _Girl world_ importance=0.850
```

### 8.4 `{{characterLore}}` Output Example

When the Director returns `loreAssignments: { "Alice": ["地理与空间", "社会结构"] }`:

```
[World lore: 地理与空间, 社会结构]
```

ST detects these keywords, then automatically activates the corresponding world book entries and injects their content.

---

## 9. Adding a New Provider

### 9.1 Text-Only

```js
import { registerProvider } from '../provider-registry.js';
export function register() {
    registerProvider({
        id: 'myProvider',
        placeholder: '{{myProvider}}',
        render: (ctx) => ({ content: 'text content' }),
    });
}
```

### 9.2 Providing Structured Data

```js
render: (ctx) => ({
    content: 'summary text',
    data: { key1: 'value1', nested: { key2: 'value2' } },
}),
```

Users can then use `{{?myProvider:key1}}`, `{{?myProvider:nested.key2}}`.

### 9.3 Providing Arrays (Iterable via Block Loops)

```js
render: (ctx) => ({
    content: '...',
    data: { items: ['a', 'b', 'c'] },
}),
```

Users can iterate with `{{#myProvider:items}}{{?other:$it}}{{/myProvider}}`.

---

## 10. Limitations

- **No wildcard traversal**: `{{?provider:events[*].title}}` is invalid. Use block loops instead.
- **No expressions**: Paths can only be pure field access.
- **No recursive template expansion inside data**: String values in `data` are not parsed as templates a second time (though the post-render recursive pass will scan again).
- **Fallback values cannot contain `}`**: The default value portion cannot include `}`.
