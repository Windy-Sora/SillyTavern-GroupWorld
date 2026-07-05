# GroupWorld

🌏 Language

- English: [README_EN.md](README_EN.md)
- 中文: [README.md](README.md)

---

> A programmable runtime for SillyTavern group chat scenarios

GroupWorld is a third-party plugin for SillyTavern. It was initially created to solve the problem of "all characters talking over each other" in group chats, and has since evolved into a more general-purpose narrative runtime: not only deciding who speaks, but also organizing character profiles, world knowledge, director ledger, script injection, and long-term state management.

Its goal is not to turn group chat into a smarter filter, but to turn it into a continuously evolving world model.

---

## What it can do

GroupWorld primarily provides the following capabilities:

* Group chat speaking control
* Local formula director (no API required)
* LLM director (decision-making by the main model)
* Director script injection
* Persistent director ledger
* Character profile system
* World info injection
* Unified provider data interface
* Prompt DSL and path queries
* Recursive rendering and template composition
* Long-term story state management

---

## Why it's needed

Common problems in traditional SillyTavern group chats include:

* All characters respond at once
* Chaotic speaking order
* Characters stealing the spotlight
* Loss of narrative focus
* Difficulty maintaining long-term storylines
* Fragmented world info, character cards, and context

GroupWorld adds a director layer before character generation, transforming group chat from "random grabbing" into "organized narrative orchestration":

```text
User input
    ↓
Director
    ↓
Select characters
    ↓
Generate scripts
    ↓
Character generation
```

---

## More than just a director plugin

Although the project retains the Director as the default controller, it is only the first controller provided by the system.

The truly important infrastructure is:

* Provider Runtime
* Prompt DSL
* Ledger
* Recursive rendering
* Character profile system
* World info integration

These capabilities can be combined to achieve far more than just "director" functions, for example:

* Long-term memory system
* World state system
* Faction system
* Relationship system
* Quest system
* Story state machine
* Custom agents
* Custom world controllers

---

## Core Modes

### Formula Director

Local scoring mode, no API calls required.

Calculates priority for each character based on:

* Name mentions
* Keyword triggers
* Recent messages
* Consecutive speaking penalty
* Talkativeness
* Initiative

Suitable for:

* Large group chats
* Low-cost operation
* Role-playing scenarios requiring stable control

---

### LLM Director

The large language model handles director decisions.

It can comprehensively analyze:

* Recent messages
* Character information
* Character profiles
* World info
* Historical director plans
* Current state

Then decide:

* Who should speak
* Speaking order
* How to advance the scene
* Individual scripts for each character

---

## Director Script

The Director can not only select characters but also output individual scripts for each character, then inject them into the character generation prompt.

For example:

```json
{
  "scripts": {
    "Alice": "Stay calm, but gradually show unease.",
    "Bob": "Don't burst out in anger; test the waters first."
  }
}
```

This enables:

* Emotional control
* Atmosphere shaping
* Narrative tension
* Collaborative performance
* Subtle guidance

---

## Director Ledger

The director ledger is used to store structured state and persists across the chat session.

For example:

```json
{
  "speakers": ["Alice"],
  "story": {
    "chapter": 3
  },
  "relationships": {
    "Alice-Bob": 75
  }
}
```

The ledger structure is open, allowing you to freely extend it with:

* Story progress
* World state
* Character relationships
* Faction relations
* Economic systems
* Political systems
* Custom variables

---

## Unified Prompt Runtime

GroupWorld includes a built-in unified prompt runtime. Multiple template entry points share the same data interface:

* Director Prompt
* Character Prompt Injection Template
* History Wrapper
* World Info Wrapper
* Profile Generator
* Profile Render Template

### Built-in Providers

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

## Provider Extension Mechanism

GroupWorld provides a unified provider registration interface. You can register new data sources with the runtime without modifying core code.

A provider can simultaneously provide:

* Readable text content
* Structured JSON data
* Long-term state information
* Variables accessible to prompts

Example:

```js
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
```

Once registered, you can use it directly in prompts:

```text
{{relationshipGraph}}
{{?relationshipGraph:Alice.Bob}}
```

---

## Path Queries

GroupWorld supports reading fields from structured data:

```text
{{?directorLedger:reason}}
{{?directorLedger:scripts.$character}}
{{?directorHistory:[-1].reason}}
{{?directorLedger:story.chapter}}
{{?directorLedger:relationships.Alice-Bob}}
```

Supports:

* Nested access
* Array indexing
* Reverse indexing
* Attribute filtering
* Default values
* Runtime variables

---

## Recursive Rendering

GroupWorld supports recursive template parsing.

For example:

```text
{{directorLedger}}
```

After rendering, it might produce:

```text
{{?directorLedger:story.chapter}}
```

Then continue parsing until the final result is obtained.

This allows you to compose prompts with prompts, and generate more complex structured data from structured data.

---

## Character Profile System

Built-in character profile system for compressing character cards into more manageable structured profiles.

Supports:

* Batch generation
* Automatic synchronization
* Change detection
* Token budget compression
* Custom schemas
* Custom rendering templates

Default profile fields include:

```json
{
  "summary": "",
  "tags": [],
  "motivation": "",
  "relationships": ""
}
```

You can also define your own structure, e.g.:

```json
{
  "goal": "",
  "fear": "",
  "secret": "",
  "emotional_state": ""
}
```

---

## World Info and Long-term Story

GroupWorld does not require world info and long-term state to be strictly standardized in advance.

You can bring world knowledge, story state, character relationships, and quest states into the same runtime, and then read them anywhere via providers and the prompt DSL.

This makes it especially suitable for:

* Long-form storytelling
* Open worlds
* Multi-character RP
* Continuously evolving world models
* Group chat narrative control

---

## Workflow

```text
User input
      ↓
Director
      ↓
Read:
- World info
- Character profiles
- Director ledger
      ↓
Generate:
- Speaking order
- Director scripts
- State updates
      ↓
Character generation
      ↓
Write back to Ledger
      ↓
Continue to next round
```

---

## Installation & Usage

1. Place this plugin into SillyTavern's extensions directory.
2. Enable GroupWorld in SillyTavern.
3. Configure director mode, character profiles, world info, and prompt templates.
4. Choose according to your narrative needs:
   - Formula mode
   - LLM mode
   - Custom prompts / providers

---

## Design Philosophy

GroupWorld is not a speaking filter, nor just a tool that decides "who talks".

It is more like a runtime for open-ended narrative:

* Characters are no longer just cards
* The world is no longer just an article
* State is no longer just temporary variables
* The Director is no longer just a fixed algorithm

Its goal is to allow the world to continuously evolve, enabling characters, knowledge, state, and story to accumulate and influence each other over the long term.

Ultimately, SillyTavern group chat is not just chatting—it's a programmable narrative world.
