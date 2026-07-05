# SillyTavern Group World

🌏 Language

- English: current page
- 中文: [README.md](README.md)

---

> **An operating system for group-chat narrative.** Not a speaker selector, not a message filter—it's a full Agent runtime that turns your group chat into a continuously evolving world.

---

# What It Does

**Your group chat gets a director.** No more everyone talking over each other. The Director decides who speaks, in what order, and gives each character private stage directions (invisible to others). Chaos turns into choreography.

**Characters remember what happened months ago.** The Memory system automatically extracts key events from conversations and persists them across sessions. When a topic resurfaces, characters recall it on their own.

**Long stories stay on the rails.** The Director's Ledger continuously tracks story progress, character relationships, and faction dynamics. Eighty rounds later, the Director still knows which chapter you're in and who has unfinished business with whom. Long-form narrative finally has maintainable state.

**Your world books stop gathering dust.** Instead of hoping ST's keyword triggers catch something, the Director actively scans world book entries and injects the relevant ones into each character's context.

**NPCs write themselves.** The story needs a passerby, a shopkeeper, a guard? The NPC system generates them on demand—with backstory, personality, and dialogue style. No need to pre-write character cards.

**AI critiques its own output.** After every Director decision, the Critique system reviews the plan—is someone hogging the spotlight? Did the plot veer off track?—and corrects it.

**Configurations switch in one click.** Different worlds, different directing styles, different character setups—save them as profiles, switch with a tap. Export and share with others. Zero friction.

**Built-in universal assistant: 暮羽 (Muyu).** An owl-girl who lives inside the plugin, carrying the complete Group World API documentation. Not sure how a feature works? Ask her. Configuration gone sideways? Ask her. Want to write an extension but don't know where to start? Ask her. She's faster than any documentation and more accurate than any search—because she's the plugin's chief architect.

---

# Getting Started

**1. Install** — ST Extensions panel → Install new extension → enter `https://github.com/Windy-Sora/SillyTavern-GroupWorld` → enable after download.

**2. Apply default config** — Open the Group World settings panel, select `group-world-default` from the dashboard preset dropdown → click Apply.

**3. Generate character profiles** — Click the "Gen Profiles" button on the dashboard and wait for completion.

**4. Enable world books** — Click the world book stat tile on the dashboard, check the entries you want to activate.

**5. Enter a group chat and start.** The Director takes it from here.

> 🦉 **Strongly recommend clicking the "Summon Muyu" button first.** Muyu is the built-in universal assistant—she'll be imported into your character list with the full Group World API documentation. Ask her anything: how to configure, how to fine-tune, how to write extensions, how to debug. She's faster than docs, more accurate than searching, and she lives in this plugin—she knows it better than you do.

---

# But That's Just the Start

Everything above comes out of the box.

But underneath, Group World is a full **Agent Runtime + Provider Extension Framework + Prompt DSL**.

If you can write a little:

- **Custom Prompts** — Bundle pages of world-building into a single placeholder. Keep your prompts clean and maintainable.
- **Custom Agents** — Define LLM-powered sub-tasks and plug them into the Director's pipeline.
- **Capabilities** — Give characters TTS, emotion analysis, image generation abilities.

If you can write JavaScript:

- **Provider Protocol** — Register custom data sources that inject into any prompt position in the runtime. Query fields directly with DSL path expressions.
- **Script Executor** — Insert your code at three trigger points: Director decisions, character messages, and round end. Modify decisions, read and write shared state.
- **Full Agent Framework** — Register any number of custom Agents. Define pipeline order, context access permissions, parse and validation logic.

Everything built into the plugin runs on this same framework. Your extensions run on the same runtime as the built-in logic.

---

# Breaking the Fourth Wall

Characters can know things beyond what's on their character card.

You can let real-time weather affect character moods. Let stock prices trigger plot events. Let characters access external rulebooks, setting documents, even the output of another AI. Characters don't know where the information comes from—it simply appears in their context as something they "ought to know."

Characters can do things beyond ST's built-in capabilities.

You can make characters actually speak aloud. Auto-generate illustrations at key moments. Let external programs react to a character's decisions. This all happens behind the curtain, invisible to the narrative—but it extends the story from plain text to any medium.

Everything can move in and out.

Characters, world books, config profiles, archives, memories, NPCs, summaries, critiques—each type of data has its own independent export and import channels. Pack up half a year of group chat state and move it to another machine. Import someone else's creation into your world. Take things out of the world, modify them outside, and put them back.

This is no longer "a bot in a group chat." This is **a controllable membrane between the narrative world and the real world.**

---

# What It Is Not

**Not a message filter.** It doesn't filter ST's output after the fact—it adds a decision layer *before* character generation. Characters haven't even started speaking yet, and the Director is already orchestrating.

**Not a pre-designed world.** State structures aren't defined by developers in code. The Director generates state naturally during runtime. The Ledger records it. Providers publish it. DSL queries it. Agents consume it. It gives you the mechanism, not the setting.

**Not a "group chat enhancer."** It's infrastructure for turning group chat into a **self-evolving narrative world.**

---

# Next Steps

- 📖 [User Guide](USER-GUIDE.md) — Every setting, every button, every workflow
- 🏗 [Design Doc](DESIGN.md) — Architecture, pipelines, APIs, protocol details
- 🦉 Muyu — Open the dashboard, click "Summon Muyu," and just ask her
