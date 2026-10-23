# SillyTavern Group World

[中文](README.md) | English

A group-chat director and story-management extension for [SillyTavern](https://github.com/SillyTavern/SillyTavern). Choose who speaks, maintain character memories and story state, or ask the built-in **Muyu assistant** to inspect information, troubleshoot problems and adjust settings.

Current version: 0.6.0 · [User Guide](docs/USER-GUIDE_EN.md) · [Installation](#installation)

## Features

### Muyu Assistant

Muyu is an owl-girl assistant who helps you look after your Tavern. Click the floating feather to open her chat window and tell her what you'd like to do. She works on desktop and mobile, with no group chat required.

Ask about a confusing switch, review your configuration, or plan a currency system. You don't need to learn internal field names or decide which module to use first.

- **Understand and troubleshoot.** Find controls, explain settings and inspect authorized chat, memories, variables, world books, character cards and presets to investigate a problem.
- **Prepare and carry out changes.** Adjust supported settings and manage content such as character cards and world books. Larger requests can start with a plan and change previews, then proceed under your chosen permission mode.
- **Keep working across conversations.** A history sidebar, new conversations, import/export, context compaction and long-term notes support ongoing tasks. Built-in Skills provide specialist workflows, and you can manage your own Skills too.

Try asking:

> “Review my current settings for conflicts. Analyze only; don't change anything.”
>
> “Set the per-character memory limit to 10. Preview it first; do not apply.”
>
> “I'd like a currency system. Help me plan what needs to change.”

The Agent does not require importing a character card or world book first. If you prefer Muyu's character-card experience, that import option is still available from the summon menu.

### Group-chat Director

Keep every character from jumping into every turn. Select speakers from the current conversation, with optional ordering and turn-specific instructions.

- **Formula Director:** Score mentions, keywords, initiative and consecutive-speaker penalties, then choose the Top-N characters. No additional model call.
- **LLM Director:** Let a model plan speakers and their order from the scene, with scripts and individual instructions for the turn.

### Memory and story management

Character profiles, memories and chat summaries help preserve people and events. NPCs, world books, variables and story blueprints organize the cast, setting and story progress. View and edit related content, and reuse it through resource libraries.

### Customization and sharing

Edit feature prompts, organize data sources with Providers and the template DSL, or write scripts and custom Agents. Import and export configuration profiles to save your setup or share it with others.

## Installation

1. In SillyTavern, open **Extensions → Install extension** and enter:

   ```text
   https://github.com/Windy-Sora/SillyTavern-GroupWorld
   ```

2. Refresh after installation and confirm the extension is enabled.
3. Open **Group World** settings to get started.

Alternatively, place the repository in `public/scripts/extensions/third-party/SillyTavern-GroupWorld` and refresh. No build step or changes to SillyTavern core files are required.

## Getting started

### Talk to Muyu

1. In Group World settings, choose **Open Muyu Agent (recommended)** from the summon menu, or click the floating feather.
2. Open the window's gear → **Connection**. Reuse a supported current Tavern API or configure an independent endpoint.
3. Describe your goal. Start with an explanation or read-only review, then try a change preview. For another thread, click **New conversation** in Muyu's history sidebar.

### Set up the Director

1. Open a group chat and choose a Director mode in Group World.
2. For a simple starting point, use Formula Director with **Top-N** set to `1`, then tune the weights from the results.
3. For model-planned speakers and order, switch to LLM Director and configure its model and prompt.

You can also review and apply the `group-world-default` configuration profile as a starting setup. See the [User Guide](docs/USER-GUIDE_EN.md) for detailed settings.

## Before you start

- **Models and costs:** Muyu, LLM Director and other AI generation features need a working model connection and may incur charges. Formula-based speaker selection adds no model call. Available capabilities depend on the model and Tavern version.
- **Permissions and changes:** Approval mode lets you preview changes before confirming execution. Broad read access and a dangerous full-access mode are also available. Understand their scope and back up important content. Not every Tavern operation is supported.
- **Privacy and storage:** Authorized sources and included history may be sent to the model service. History supports browser, account-settings, world-book and optional server storage; keep backups. Internal history books are plaintext archives: keep their entries disabled, and do not activate, bind or manually rename them.
- **Upgrade compatibility:** Enable **only one** of GroupWorld and GroupDirector. Legacy APIs, settings keys and archive identifiers intentionally remain unchanged; do not rename them. The two extensions do not provide isolated data stores.

### Optional Muyu Services

The base Agent does not need a companion service. For server-side history, web search or local-document features, optionally install [SillyTavern Muyu Services](https://github.com/Windy-Sora/SillyTavern-Muyu-Services). This is a Tavern **server plugin**, not a front-end extension; follow its README. Web search also needs its own configuration. Without the service, basic conversations and Director features still work.

## Documentation and feedback

- [User Guide](docs/USER-GUIDE_EN.md): interface, settings and common questions.
- [Templates and DSL](docs/TEMPLATE-SYNTAX_EN.md) · [Story Blueprint](docs/STORY-BLUEPRINT.md)
- [Muyu capabilities and boundaries](docs/MUYU-AGENT-STATUS.md)
- [Architecture](docs/DESIGN_EN.md) · [Testing](docs/TESTING.md) · [Documentation index](docs/README.md)
- [Migration and compatibility notes](MIGRATION.md)

Issues are welcome. Include your Tavern and extension versions, reproduction steps, and error details with credentials and private content removed.

## License

[MIT License](LICENSE)
