# Changelog

What each ml-voice version changed. Every change to the plugin raises the version and adds its section here with `bun scripts/plugin-version.ts bump` (AGENTS.md, Releasing a plugin).

## 0.1.0

- `/ml-voice:read` opens a pane that reads Claude's latest reply aloud. Haiku first retells it as talk (code, tables and diagrams explained), or with `narration.style: compact` keeps only decisions, results, numbers, risks and actions. The part being read is highlighted, and a click on any part jumps there.
- The pane lists the session's earlier replies to read instead. A band above the prompt keeps pause, stop and open in reach while the pane is out of sight.
- Voices through agent-config (namespace `voice-reader`), onboarded on first use: Fish Audio (drama-3 and the S2 models), OpenRouter, a local Kokoro server, a self-hosted OpenAI-shaped server, or macOS `say`. Paid requests are logged as JSON lines with OpenRouter's stated cost.
- Audio and narrations are cached on disk, so a reply read again costs nothing; `cache.maxAgeDays` (30) and `cache.maxSizeMB` (500) bound the cache.
