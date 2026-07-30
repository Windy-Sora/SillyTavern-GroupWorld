# SillyTavern Group World

English | [中文](README.md)

A group chat is at its best when its characters feel gathered around the same table. It is at its worst when everyone lunges for the first line.

Group World places a quiet Director in your SillyTavern group chat. Before generation, it looks at what has just happened and decides who has something worth saying, who should hold the silence, and who should enter the scene at exactly the right moment. The result is not merely fewer interruptions: it is dialogue with breathing room, scenes with rhythm, and a story that can slowly become a world.

## A Director for a Living World

- Formula Director: local speaker scoring with no extra API call
- LLM Director: model-selected speakers and optional order control
- Top-N speaking, keyword triggers, initiative, and consecutive-speaker penalties
- Per-character Director Script injection
- Persistent Director Ledger
- Character profiles, world info, memory, variables, and story-state helpers
- Provider, prompt-template, and custom-agent extension points

It is more than a filter for deciding who talks. The Ledger remembers where the story has reached, variables hold what is happening now, and world info and character profiles can return to the scene when they matter. A long conversation no longer has to begin from amnesia every round.

## When a Message Arrives

```text
User message
  → Director analyzes the group chat
  → Relevant speaker(s) are selected
  → Optional character direction is prepared
  → SillyTavern generates the reply
```

## Begin the Story

Install this repository from SillyTavern's extension installer, refresh the page, then open **Group World** from the left settings sidebar.

The extension does not modify SillyTavern core files. Its settings live in extension settings and current-chat metadata.

## Your First Rehearsal

1. Open a group chat.
2. Enable **Formula Director** in Group World settings.
3. Start with Top-N set to `1`.
4. Tune mention, recency, initiative, and consecutive-speaker weights.
5. Switch to **LLM Director** when you want model-driven narrative selection.

## Two Ways to Direct

### Formula Director: Follow the Clues

Ranks characters using name mentions, keyword triggers, recency, consecutive-speaking penalties, initiative, and Talkativeness. The highest-ranked Top-N characters may speak.

### LLM Director: Read the Room

A Director model returns a speaker plan. With ordered takeover enabled, Group World generates the planned characters one by one; otherwise it filters unselected speakers while retaining SillyTavern's normal group-generation loop.

## Let It Grow with Your Story

Start with Formula Director and let the cast learn to take turns. Once the rhythm feels right, bring in LLM Director, scripts, variables, and long-term state one layer at a time. They are not switches you must enable all at once; they are tools your world can grow into.

When reporting an issue, include Group World logs, group-chat mode, and reproduction steps.

## Beyond Group Chat

For those who want to go further, Group World is also an Agent Runtime, a Provider extension framework, and a Prompt DSL. New data sources can enter any prompt position; custom agents can work at Director decision time, character-message time, or round end. Memory, NPCs, world state, relationships, and quests are all stage machinery you can add as the story asks for them.

The point is not to design a flawless world before the first message. It is to give the story a way to remember, respond, and grow its world through conversation.

## Next

- [User Guide](USER-GUIDE_EN.md): settings and everyday use
- [Design Notes](DESIGN_EN.md): architecture, pipeline, and extension points

## License

See [LICENSE](LICENSE).
