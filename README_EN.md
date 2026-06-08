# SillyTavern Group World

🌏 Language

* English: Current Page
* 中文: [README.md](README.md)

---

> A Programmable Narrative Runtime for Open-Ended Storytelling in SillyTavern

Group Director started as an AI director for group chats.

Over time, it evolved into something much larger:

* AI Director
* Director Scripts
* Director Ledger
* Provider Runtime
* Prompt DSL
* Recursive Rendering
* Character Profile System
* Long-Term Story State

Its purpose is not merely to decide who speaks next.

Its purpose is to help maintain a coherent, evolving narrative world across long-running multi-character stories.

---

# Why Group Director?

Traditional group chats often suffer from the same problem:

> Everyone wants to speak at once.

A single user message may trigger responses from every active character:

```text
User: What should we do tonight?

Knight: I think we should...
Mage: According to my research...
Merchant: I have a proposal...
Maid: Master...
Assassin: ...
```

The result is often:

* Chaotic pacing
* Excessively long replies
* Characters competing for attention
* Important characters being buried
* Loss of narrative focus

Group Director introduces a dedicated Director layer before character generation.

Instead of asking:

> Which characters are activated?

It asks:

> Which characters should actually speak in this scene?

---

# Core Features

## Formula Director

A local scoring-based director.

No API calls.
No additional token cost.

Characters are ranked using factors such as:

* Mention detection
* Trigger keywords
* Recent speaking activity
* Consecutive speaking penalties
* Talkativeness
* Initiative randomness

Best suited for:

* Large group chats
* Long-term roleplay
* Low-cost operation

---

## LLM Director

A language model acting as the director.

The Director analyzes:

* Recent conversation
* Character descriptions
* Character profiles
* World Info / Lorebook
* Previous director plans
* Story state

Then decides:

* Who should speak
* Speaking order
* Scene progression
* Optional character scripts

Example:

```json
{
  "speakers": [
    "Knight",
    "Mage",
    "King"
  ],
  "reason": "The king should make the final decision after hearing advice."
}
```

---

## Director Scripts

The Director can generate private instructions for individual characters.

Example:

```json
{
  "scripts": {
    "Alice": "Remain calm, but gradually reveal anxiety.",
    "Bob": "Suppress your anger. Do not explode immediately."
  }
}
```

Each character only sees their own script.

Characters never see:

* The Director
* Other characters' scripts
* The full director plan

This enables:

* Emotional steering
* Atmosphere control
* Dramatic tension
* Coordinated performances

---

## Director Ledger

One of the most powerful features of Group Director.

Director outputs can be stored as structured JSON and persisted across generations.

Example:

```json
{
  "speakers": ["Alice"],

  "story": {
    "chapter": 3,
    "progress": 42
  },

  "relationships": {
    "Alice-Bob": 75
  }
}
```

The Ledger does not enforce a schema.

You are free to store:

* Story progression
* Relationship systems
* Faction states
* Quest states
* World states
* Political systems
* Economic systems
* Any custom narrative variables

This makes the Ledger a persistent narrative state container rather than a simple history log.

---

## Narrative Continuity

Directors can reference either:

* The previous plan
* The complete director history

This allows the system to maintain:

* Story arcs
* Character relationships
* Emotional development
* Long-term goals
* Foreshadowing

Especially useful for:

* Long-form storytelling
* Serialized RP
* Multi-chapter narratives

---

## World Info Awareness

The Director can access activated World Info entries before making decisions.

This provides awareness of:

* Worldbuilding
* Regional context
* Factions
* Historical events
* Current environment

Allowing the Director to make decisions with actual knowledge of the setting.

---

# Prompt Runtime

Group Director includes a unified Prompt Runtime.

All editable prompts share the same data layer:

* Director Prompt
* Script Wrapper
* History Wrapper
* World Info Wrapper
* Profile Generator Prompt
* Profile Template

All can access the same Providers.


Standardized Provider Extension API

Group Director provides a standardized Provider interface.

New data sources can be integrated without modifying the core runtime.

A Provider can expose:

Human-readable content
Structured JSON data
Runtime-accessible state
Custom prompt variables

Example:

registerProvider({
    id: 'relationshipGraph',

    async render(ctx) {
        return {
            content: 'Relationship Graph',
            data: {
                Alice: {
                    Bob: 75
                }
            }
        };
    }
});

Once registered, the Provider becomes immediately available throughout the runtime:

{{relationshipGraph}}

{{?relationshipGraph:Alice.Bob}}

Providers automatically integrate with:

Director Prompts
Script Wrappers
Profile Generators
Recursive Rendering
Path Queries
Runtime Variables

This allows developers to build custom systems such as:

Memory Systems
Relationship Graphs
Quest Trackers
Faction Systems
Economy Simulations
World-State Services
External Data Connectors

without modifying Group Director itself.
---

## Built-in Providers

```text
{{recentMessages}}

{{characters}}

{{character_profiles}}

{{worldInfo}}

{{previousPlan}}

{{previousPlans}}

{{directorLedger}}

{{directorHistory}}
```

---

## Path Queries

Extract structured values directly from Provider data.

Examples:

```text
{{?directorLedger:reason}}

{{?directorLedger:scripts.$character}}

{{?directorHistory:[-1].reason}}

{{?directorLedger:story.chapter}}

{{?directorLedger:relationships.Alice-Bob}}
```

Supported features:

* Nested property access
* Array indexing
* Negative indexing
* Property filtering
* Default values
* Runtime variables

---

# Recursive Rendering

Group Director supports recursive template rendering.

Example:

First pass:

```text
{{directorLedger}}
```

Produces:

```text
{{?directorLedger:story.chapter}}
```

Second pass:

```text
Chapter 3
```

The maximum recursion depth is configurable.

A debug mode is also available to preserve unresolved placeholders for troubleshooting.

In fact, you can even allow the large model to generate the extended ledger JSON by itself, and at the same time inject query statements into the script provided to the role or other custom interfaces, achieving self-production and self-sales. Or let the large model help you dynamically inject the interfaces you provide.

---

# Character Profile System

Group Director includes a structured profile generation system.

Features include:

* Batch profile generation
* Automatic synchronization
* Change detection
* Token budget optimization
* Custom JSON schemas
* Custom rendering templates

Default schema:

```json
{
  "summary": "",
  "tags": [],
  "motivation": "",
  "relationships": ""
}
```

However, schemas are fully customizable.

Example:

```json
{
  "goal": "",
  "fear": "",
  "secret": "",
  "emotional_state": ""
}
```

---

# Emergent World State

Unlike traditional systems, Group Director does not require developers to define all possible state structures beforehand.

The Director can gradually build new world structures over time:

```json
{
  "politics": {},
  "economy": {},
  "factions": {},
  "religions": {}
}
```

These structures can then be queried anywhere through the Prompt DSL.

This makes Group Director particularly suitable for:

* Long-form narratives
* Open-ended worlds
* Multi-character roleplay
* Persistent world simulation

---

# Workflow

```text
User Input
     ↓
Director Analysis
     ↓
Read:
- World Info
- Character Profiles
- Director Ledger
     ↓
Generate:
- Speaking Order
- Character Scripts
- State Updates
     ↓
Character Generation
     ↓
Write Back To Ledger
     ↓
Next Round
```

---

# Use Cases

Group Director is particularly effective for:

* Tavern roleplay
* School settings
* Adventure parties
* Court politics
* Family sagas
* Military campaigns
* Long-form stories
* Collaborative storytelling

The more characters involved, the greater the benefit.

---

# Installation

## Extension Manager

Install directly through the SillyTavern Extension Manager.

## Manual Installation

```bash
git clone https://github.com/Windy-Sora/SillyTavern-GroupWorld.git
```

Place it into:

```text
SillyTavern/public/scripts/extensions/third-party/
```

Restart SillyTavern.

---

# Settings

The settings panel exposes nearly every major system for customization:

* Director Mode (Off / Formula / LLM)
* Trigger Engine
* Initiative System
* Director Prompt
* Script Prompt
* Script Wrapper
* History Modes
* World Info Integration
* Profile System
* Recursive Rendering
* Debug Mode
* Localization

---

# Design Philosophy

The Group Director is not a filter for dialogue.

Nor is it merely a simple speaker selector.

It is more akin to a runtime environment designed for open-ended storytelling.

Do not design the world itself.

Instead, provide a mechanism that allows the world to grow.

Enable the entire world to evolve continuously.

Allow states, relationships, narrative elements, and the worldview to accumulate over time, ready to be reused and to influence one another in the future.

Create a real virtual world.
