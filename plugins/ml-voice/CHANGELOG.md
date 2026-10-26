# Changelog

What each ml-voice version changed. Every change to the plugin raises the version and adds its section here with `bun scripts/plugin-version.ts bump` (AGENTS.md, Releasing a plugin).

## 0.3.0

- `/ml-voice:read` plays on a laptop when Claude Code runs on a remote box reached over SSH: the laptop's own connection carries a `RemoteForward 4714`, and a small listener there plays each clip; pause stops it there too. `/ml-voice:remote-audio` sets it up with one line run on the laptop (macOS launchd or a Linux systemd user service).
- The voice pane's status line names where the sound goes (`♪ laptop (SSH)`, `♪ this PC (box)`, `♪ this Mac`); when both work, `o` or a click switches, and the pick is kept. Voice samples play there too. With no speaker reachable the pane says why and what to do instead of reading silently.
- On Linux, parts play through mpv, ffplay, pw-play or paplay when one is installed; Claude Code plays nothing there by itself.

## 0.2.1

- The pane drops its prev and next buttons and their j and k keys; click a part to jump to it.

## 0.2.0

- The pane's **voice** button lists the voices the provider serves (Fish Audio's library searched as you type, OpenRouter's per model, Kokoro's, a self-hosted server's, macOS say's) through `agent-config choices`; a press plays a sample in that voice, and **use** keeps it in the layer it came from. OpenRouter's model is picked the same way, then its voices.
- `/ml-voice:read` asks for a voice when no layer sets one: the pane opens on the list, and the reply is read once one is used. **keep default** saves the default voice so it is not asked again; **not now** reads in it and asks next time.
- `say.voice` picks a macOS voice; empty keeps the system one, and the audio it already cached.
- The voice and model keys name `scripts/voices.ts` as their `choices`, so `/agent-config` and onboarding offer the same lists. Needs ml-agent-config 0.13.0.

## 0.1.0

- `/ml-voice:read` opens a pane that reads Claude's latest reply aloud. Haiku first retells it as talk (code, tables and diagrams explained), or with `narration.style: compact` keeps only decisions, results, numbers, risks and actions. The part being read is highlighted, and a click on any part jumps there.
- The pane lists the session's earlier replies to read instead. A band above the prompt keeps pause, stop and open in reach while the pane is out of sight.
- Voices through agent-config (namespace `voice-reader`), onboarded on first use: Fish Audio (drama-3 and the S2 models), OpenRouter, a local Kokoro server, a self-hosted OpenAI-shaped server, or macOS `say`. Paid requests are logged as JSON lines with OpenRouter's stated cost.
- Audio and narrations are cached on disk, so a reply read again costs nothing; `cache.maxAgeDays` (30) and `cache.maxSizeMB` (500) bound the cache.
