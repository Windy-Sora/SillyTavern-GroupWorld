# Group World — Make Your Group Chat Come Alive as a World

> **A group-chat narrative operating system.** Not a speaker selector, not a message filter—it's a full Agent runtime that turns your group chat into a continuously evolving world.

---

## What It Does

**Your group chat gets a director.** No more everyone talking over each other. The Director decides who speaks, in what order, and gives each character private stage directions (invisible to others). That sense of chaos? Gone.

**Characters remember things you said six months ago.** The Memory system automatically extracts key events from conversations and persists them across sessions. When a topic resurfaces, characters recall it on their own.

**Long stories don't fizzle out.** The Director's Ledger continuously tracks story progress, character relationships, and faction dynamics. Eighty rounds later, the Director still knows which chapter you're in and who has unfinished business with whom. Long-form narrative finally has maintainable state.

**Your world books stop gathering dust.** Instead of relying on ST's keyword triggers and hoping for the best, the Director actively scans world book entries and injects the relevant ones into each character's context.

**NPCs write themselves.** The story needs a passerby, a shopkeeper, a guard? The NPC system generates them on demand—with backstory, personality, and dialogue style. No need to pre-write character cards.

**AI critiques its own output.** After every Director decision, the Critique system reviews the script quality—is someone hogging the spotlight? Did the plot veer off track?—and corrects it.

**Configurations switch in one click.** Different worlds, different directing styles, different character setups—save them as config profiles, switch with a tap. Export and share with others. Zero friction.

**Built-in universal assistant: 暮羽 (Muyu).** An owl-girl who lives inside the plugin, carrying the complete Group World API documentation. Not sure how a feature works? Ask her. Configuration gone sideways? Ask her. Want to write an extension but don't know where to start? Ask her.

---

## More Than That: An Extensible Agent Runtime

Everything above comes out of the box. But underneath, Group World is a full **Agent Runtime + Provider Extension Framework + Prompt DSL**.

**If you can write a little:**
- **Custom Prompt** — Bundle pages of world-building into a single placeholder. Keep your prompts clean and maintainable.
- **Custom Agent** — Define LLM-powered sub-tasks and plug them into the Director's pipeline.
- **Capability Extensions** — Give characters TTS, emotion analysis, image generation abilities.

**If you can write JavaScript:**
- **Provider Protocol** — Register custom data sources that inject into any prompt position in the runtime. Query fields directly with DSL path expressions.
- **Script Executor** — Insert your code at three trigger points: Director decisions, character messages, and round end. Modify decisions, read and write shared state.
- **Full Agent Framework** — Register any number of custom Agents. Define pipeline order, context access permissions, parse and validation logic.

Everything built into the plugin runs on this same framework. Your extensions and the built-in logic run on the same runtime.

---

## Breaking the Fourth Wall

What characters can know isn't limited to what's on their character card. You can let real-time weather affect character moods. Let stock prices trigger plot events. Let characters access external rulebooks, setting documents, even the output of another AI.

What characters can do isn't limited to ST's built-in capabilities. You can make characters actually speak aloud. Auto-generate illustrations at key moments. Let external programs react to a character's decisions.

Everything can move in and out. Characters, world books, config profiles, archives, memories, NPCs, summaries, critiques—each type of data has its own independent export and import channels. Pack up half a year of group chat state and move it to another machine.

**This isn't "a bot in a group chat." This is a controllable membrane between the narrative world and the real world.**

---

## What It Is Not

- **Not a message filter.** It doesn't filter ST's output after the fact—it adds a decision layer *before* character generation. Characters haven't even started speaking yet, and the Director is already orchestrating.
- **Not a pre-designed world.** State structures aren't defined by developers in code. The Director generates state naturally during runtime. The Ledger records it. Providers publish it. DSL queries it. Agents consume it. It gives you the mechanism, not the setting.
- **Not a "group chat enhancer."** It's infrastructure for turning group chat into a self-evolving narrative world.

---

## Quick Start

1. **Install** — ST Extensions panel → Install new extension → enter `https://github.com/Windy-Sora/SillyTavern-GroupWorld` → enable
2. **Apply default config** — Settings panel → Dashboard → select `group-world-default` from the config profile dropdown → Apply
3. **Generate character profiles** — Click the "Gen Profiles" button on the dashboard
4. **Enable world books** — Click the world book stat tile on the dashboard, check the entries you want to activate
5. **Enter a group chat and start.**
6. **🦉 Strongly recommend clicking the "Summon Muyu" button.** She'll be imported into your character list with the full API documentation. Any question—just ask her.

---

## Source Code

[GitHub](https://github.com/Windy-Sora/SillyTavern-GroupWorld) — Full source code publicly available for security review.

---

## ⚠️ High-Privilege Operations Disclosure

The following disclosures comply with the mandatory declaration requirements for high-privilege/sensitive operations in the LeiNao community's "Malicious Code Prevention Regulations."

### Out-of-Card Data Operations

| Type | Target | Purpose |
|------|--------|---------|
| Read | All character card data (name, description, avatar, personality, scenario) | Director scheduling needs character information; NPC generation checks for name conflicts; Profile Agent builds character portraits |
| Read | Activated world book entries | World book scanner proactively injects relevant entries into character context |
| Write | Character cards (via ST API creation) | NPC system auto-generates background characters; Muyu assistant imports built-in help character |
| Write | World books (via ST API import/activate) | Muyu assistant imports companion world book |

### In-Card Data Operations

| Type | Target | Purpose |
|------|--------|---------|
| Read | Chat history (complete conversation history of the current group chat) | Memory extraction, context summarization, critique review, Director decisions—all Agents need to read conversation history |
| Write | `chat_metadata` (chat metadata) | Persist narrative state: NPC list, character memories, Director ledger, critique results, auto-task counters, summaries |
| Write | Extension Prompt (character prompt) | Director delivers private stage directions to each speaking character via extension prompt, invisible to other characters |
| Write | Character switching (setCharacterId / setCharacterName) | Force-speak and PostSpeech Agents temporarily switch current character during processing |

### Code Execution

| Operation | Description |
|-----------|-------------|
| Provider / Capability import | Users can import arbitrary `.js` files via file picker, dynamically loaded through `import()`, running in page context with the same privileges as the plugin. Before import, the plugin performs static scanning of source code and displays a warning when dangerous APIs (`fetch()`, `eval()`, `document.cookie`, `localStorage`, etc.) are detected, but users may still choose to proceed. **Only import code from absolutely trusted sources.** |
| Script Executor | Users can write custom JS code in the settings panel that executes automatically at three trigger points: after Director decision, before character speaks, after round ends. Code runs in page context, can access ST API via `getContext()`, and can read/write shared state via `turnShared`. **Only run code you wrote yourself or absolutely trust.** |

### Device Information Access

| Operation | Purpose |
|-----------|---------|
| System time read (`new Date()` / `Date.now()`) | `{{systemTime}}`, `{{timeOfDay}}`, `{{moonPhase}}` Providers read the device system clock for narrative context injection (current date/time, season/time of day, moon phase). Does not leave the browser, does not upload to any server. |
| `{{randomDice}}` Provider | Uses `Math.random()` to generate random numbers. No network requests involved. |

### API Key Storage

API keys configured by users for each Agent are stored in ST's local `extension_settings` and used only by the browser when making LLM requests. They never pass through the author's or any third-party server.

---

## 🌐 Third-Party Request Disclosure

This plugin supports users configuring custom LLM API endpoints for each Agent (Director, Memory, Critique, etc.). Users can configure any OpenAI-compatible (`/v1/chat/completions`, `/v1/models`) or Anthropic-compatible (`/v1/messages`) API address in the settings panel.

**All LLM request destinations are entirely user-configured and sent directly from the browser. No data passes through the author's server.** Users are responsible for the privacy policies and data security of their configured API endpoints.

The plugin itself does not make requests to any external domain. All requests target the ST local server (`localhost`) or user-configured API endpoints.

---

## 🔒 Security Vulnerability Reporting

If you discover a security vulnerability, please report it privately via:
- GitHub Issues (recommended: use the "Report a security vulnerability" feature)
- Direct message to LeiNao community management

Please do not disclose specific exploit methods in public channels first, to prevent malicious exploitation.

---

## Useful Links

- 📖 [User Guide](USER-GUIDE.md) — Every setting, every button, every workflow
- 🏗 [Design Document](DESIGN.md) — Architecture, pipelines, APIs, protocol details
- 💻 [GitHub Repository](https://github.com/Windy-Sora/SillyTavern-GroupWorld)
- 🦉 Muyu — Open the dashboard, click "Summon Muyu," and just ask her