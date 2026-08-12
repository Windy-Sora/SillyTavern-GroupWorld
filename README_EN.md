# SillyTavern Group World

English | [中文](README.md)

A director and continuity extension for [SillyTavern](https://github.com/SillyTavern/SillyTavern) group chats. Before each generation, Group World selects the characters that should speak and supplies tools for character data, memory, world information, story state, and extensible prompt data sources.

> Current version: 0.6.0

## Features

- **Formula Director** — Local speaker scoring based on mentions, keywords, recency, initiative, and consecutive-speaker penalties. No additional API request is required.
- **LLM Director** — Model-planned speakers and order. It can take over ordered generation or only filter unselected characters.
- **Speaking controls** — Top-N selection, per-character keyword triggers, Talkativeness, and consecutive-speaker penalties.
- **Director Ledger and Scripts** — Persist each round's decision and inject character-specific instructions for the current turn.
- **Continuity tools** — Character profiles, character memory, chat summaries, world books, NPCs, variables, and story state.
- **Extensible runtime** — Providers, prompt templates, capabilities, custom agents, and script executors.
- **Configuration profiles** — Built-in default and example profiles, plus profile import and export.

## Requirements

- A working installation of SillyTavern.
- A group chat.
- Formula Director makes no extra model call. LLM Director and AI-powered features such as profiles, memory, and summaries require a model connection configured in SillyTavern.

## Installation

### Extension Manager

1. Open **Extension Manager** in SillyTavern.
2. Choose the option to install from a URL and enter:

   ```text
   https://github.com/Windy-Sora/SillyTavern-GroupWorld
   ```

3. Install the extension, then refresh the page.
4. Open **Group World** from the left settings sidebar and confirm that the extension is enabled.

### Manual installation

Clone or download this repository into the following SillyTavern directory:

```text
public/scripts/extensions/third-party/SillyTavern-GroupWorld
```

Restart or refresh SillyTavern afterwards. The extension does not modify SillyTavern core files.

## Quick Start

1. Open a group chat and the **Group World** settings.
2. In the Director section, choose a mode. Start with **Formula Director** to inspect speaker selection without spending additional tokens.
3. Set **Top-N** to `1` so one character is selected per turn by default.
4. Send messages and tune the mention, keyword, recency, initiative, and consecutive-speaker weights as needed.
5. Switch to **LLM Director** when you want the model to decide speakers and order from the scene; configure its prompt and model connection.

To apply a recommended starting configuration, select the `group-world-default` profile at the bottom of the dashboard and click Apply.

## Director Modes

| Mode | Best for | Selection method | Extra model call |
| --- | --- | --- | --- |
| Formula Director | Predictable control, low latency, or no added token cost | Local weighted scoring and Top-N selection | No |
| LLM Director | Story-aware choices based on relationships and scene context | Model returns a speaker plan and optional order | Yes |

## Common Workflows

| Goal | Recommended features |
| --- | --- |
| Reduce characters talking over each other | Formula Director + Top-N `1` + consecutive-speaker penalty |
| Control who appears and in what order | LLM Director + ordered takeover |
| Preserve long-running context | Profiles, character memory, Director Ledger, and chat summaries |
| Give a character turn-specific direction | Director Script |
| Manage a world, NPCs, or quest state | World books, variables, story state, and custom providers |
| Save or share settings | Profile import / export |

## Documentation

- [User Guide](USER-GUIDE_EN.md): interface, settings, recipes, and FAQ.
- [Template Syntax](TEMPLATE-SYNTAX_EN.md): Prompt DSL, placeholders, and path queries.
- [Design Notes](DESIGN_EN.md): architecture, execution pipeline, and extension points.
- [Story Blueprint](STORY-BLUEPRINT.md): story-state and blueprint documentation.
- [Testing](TESTING.md): automated test platform and coverage.

## Development and Testing

The extension uses native ES modules and does not require a build step. Automated tests require Node.js 22 or later:

```bash
npm test
```

Other available commands:

```bash
npm run test:static
npm run test:unit
npm run test:integration
npm run test:full
npm run test:coverage
```

## Feedback and Contributions

Issues and pull requests are welcome. For a bug report, please include:

- SillyTavern and Group World versions;
- Director mode, group-chat mode, and relevant settings;
- Group World logs; and
- repeatable steps to reproduce the issue.

## License

This project is licensed under the [MIT License](LICENSE).
