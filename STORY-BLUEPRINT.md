# Story Blueprint

Story Blueprint is a lightweight story-structure layer for Group World.

It does not decide narrative policy in code. The framework only stores a dynamic outline, exposes the current step through providers, and advances by one step when the Director sets one boolean variable.

## Core Protocol

```text
completion variable: gd_story_chapter_done
true once = advance one progression step
doneSignals.length = completed step count
current step = flatten(nodes)[doneSignals.length]
doneSignals.length >= steps.length = blueprint complete
```

The Director should set:

```json
{
  "variable_update": {
    "global": {
      "gd_story_chapter_done": true
    }
  }
}
```

Only set it when the current Story Blueprint step is complete.

The completion variable is created as a global boolean variable with `injectMode: "manual"` and `autoUpdate: true`. It is not included in `{{variableMaintenance}}`; it is exposed through the Story Blueprint provider text and through `{{storyBlueprintDoneField}}` in the Director JSON schema. If the variable is locked by the user, Group World logs a warning and does not silently rewrite the lock.

## Blueprint Shape

```json
{
  "version": 1,
  "title": "Story title",
  "meta": {
    "premise": "Short premise",
    "style": "Genre, tone, pacing"
  },
  "nodes": [
    {
      "id": "node_001",
      "type": "chapter",
      "title": "Chapter title",
      "content": {
        "purpose": "Why this block exists",
        "director_prompt": "How the Director should guide this block",
        "completion_rule": "When this block counts as complete"
      },
      "children": []
    }
  ]
}
```

`nodes` is a dynamic tree. Users can write one layer, chapters and sections, or deeper structures. The framework only requires `nodes` and optional `children`; `content` is free-form and belongs to prompt authors.

If a node has no `id`, the system generates one from `type/title + path`. During continuation, incoming node ids are re-normalized with the current top-level offset and then recursively deduplicated. This protects `doneSignals`, which uses node ids as stable progress anchors.

## Progression Modes

```text
leaf  - advance only leaf nodes
all   - advance every node in depth-first order
level - advance nodes at a chosen depth
```

Default mode is `leaf`.

## Providers

```text
{{storyBlueprintCurrent}}
{{storyBlueprintCurrentJson}}
{{storyBlueprintProgress}}
{{storyBlueprintSchemaHint}}
{{storyBlueprintFullJson}}
```

The default Director prompt includes `{{storyBlueprintCurrent}}`. When Story Blueprint is disabled, providers return nothing and no progression is consumed.

`{{storyBlueprintDoneField}}` is a schema-only placeholder registered by `index.js`. When Story Blueprint is enabled, it expands inside `variable_update.global` to the current completion variable field, for example:

```json
"gd_story_chapter_done": false
```

When Story Blueprint is disabled, it expands to an empty string.

`{{storyBlueprintCurrent}}` has one controlled side effect: after the blueprint is complete, the completion notice is consumed only once, and only when rendered for the Director agent. UI previews and ForceSpeak rendering do not consume that notice.

## Prompt Rendering

Story Blueprint generation and continuation prompts are rendered through the normal Group World provider pipeline before calling the LLM. Prompt authors can use any provider in those prompt boxes, such as summaries, variables, character profiles, ledger data, or custom providers.

The default generation prompt also includes `{{storyBlueprintFullJson}}` and `{{storyBlueprintProgress}}`. This gives the LLM the existing blueprint and current progress when a user regenerates instead of starting from an empty plan. Users can remove those placeholders from the prompt if they want a hard restart.

The default generation and continuation prompts inject always-on world book entries via `{{gdWorldBooksConstant}}` (replacing the older `{{worldBooks}}` reference), so the LLM sees constant world-setting context while generating or continuing the blueprint. See [TEMPLATE-SYNTAX.md](TEMPLATE-SYNTAX.md) for the full set of `gdWorldBooks*` placeholders.

Generation and continuation are guarded by an execution snapshot. Switching chats, editing/replacing the blueprint, changing progress signals, or appending/editing chat messages while the LLM is pending invalidates the older response with `StaleExecutionError`; the stale response cannot overwrite the newer chat or blueprint state.

Generation uses `settings.agentConfigs["story-blueprint"]`, so it can have an independent API endpoint, key, model, retry policy, and timeout in the Tools drawer's Agent Configuration card.

Continuation rules:

```text
Generate Blueprint  -> replaces the current blueprint and resets progress
Continue Blueprint  -> appends new nodes and keeps existing progress
Auto Continue       -> starts in the background after the last step completes
```

Auto Continue does not block the current Director round. While it is running, `continuePending` is true and the UI shows a "continuing" state. If continuation fails or returns no nodes, `lastError` is written and the existing completed blueprint remains available for manual retry or rollback.

## GUI

The Continuity drawer contains the Story Blueprint card:

- enable/disable provider
- auto-continue on completion
- progression mode and level
- completion variable name
- generation node count
- create a blank user-authored blueprint
- append a blank root-level chapter without resetting progress
- click a progression row to inspect that node without changing progress
- click the location icon on a progression row to set that row as the current step
- generate / continue / rollback / reset progress / health check / refresh
- editable blueprint title, meta fields, and node content cards
- advanced JSON editor with validation
- generation prompt, continuation prompt, output schema, provider template, and restore-default buttons
- import/export for blueprint JSON

The dashboard has a Story Blueprint stat panel with status, enable switch, generate button, preview, and background continuation state.

## Library

The Story Blueprint Library is a reusable, persistent storage layer over the blueprint export format. It lives in `extension_settings` (not per-chat), so saved blueprints can be applied across different group chats.

Each library entry wraps a blueprint export payload with a `libraryMeta` block (name, description, timestamps, node count). The library card (inside the Story Blueprint card in the Continuity drawer) exposes:

- **Save Current** - snapshot the current chat's blueprint into a named library entry, optionally including progress
- **Apply** - load a library entry back into the current chat, optionally restoring progress
- **Import / Export** - import a blueprint JSON file as a library entry, or export an entry as JSON
- **Delete** - remove a library entry (with confirmation)

Library entries are content data, not configuration: they are intentionally excluded from config profiles. Use the card's own import/export for sharing blueprint content across chats.

## State

Blueprint content and progress are stored per chat:

```text
chat_metadata[group-director].storyBlueprint
```

Global settings store only configuration such as enable state, progression mode, provider template, prompt text, and completion variable name.

Config profiles include Story Blueprint configuration under the continuity/context-ledger drawer, but do not include the current chat's blueprint body or progress. Use the Story Blueprint card's import/export buttons for blueprint content.
