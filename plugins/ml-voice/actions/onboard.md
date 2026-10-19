---
id: onboard
type: prompt
parallel: false
---

ml-voice's voice settings (agent-config namespace `voice-reader`, read by `/ml-voice:read`) are missing the keys in `keys`. Ask the user, with
`AskUserQuestion`, then write the answers with `agent-config write voice-reader --layer global`.
Describe the keys first with `agent-config describe voice-reader`. Pass `--from <mod dir>` (the
parent of this `actions/` folder) to every `agent-config` call.

1. **`voice.provider`**: who synthesizes the voice. Offer, in this order:
   - `fish-audio`: Fish Audio's own API; drama-3 is the most expressive voice. Paid from API
     credit, which fish.audio bills apart from platform credit.
   - `kokoro`: local and free; needs the Kokoros server listening (check with
     `curl -s -m2 -o /dev/null -w '%{http_code}' http://127.0.0.1:3030/`).
   - `openrouter`: drama-3 and other speech models through OpenRouter, about $2 per million
     characters for drama-3.
   - `self-hosted`: the user's own speech server (drama-3 needs a 48 GB+ NVIDIA GPU or a 64 GB+
     Mac; it does not fit a 32 GB Mac).
   - `say`: macOS built-in, robotic, always works.
2. **The model**, for fish-audio (`fishAudio.model`: drama-3, s2.1-pro, s2-pro, s2.1-pro-free),
   openrouter (`openrouter.model`) or self-hosted (`selfHosted.model`). Each has a default; offer
   the choices as options with the default first.
3. **The credential**, for fish-audio (`credentials.fishAudioKey`) or openrouter
   (`credentials.openrouterKey`): where the key lives (`1password`, `env`, `dotenv`, `keychain` or
   `command`). Never accept the key itself as text. `agent-config 1password items` lists 1Password
   items by name, never a value; for 1Password, store `{ source, ref, account }` with the
   account's URL or id so `op` reads the right account.
4. **`selfHosted.url`** (self-hosted only): the server's `/v1/audio/speech` URL.
5. Voices have defaults; ask only if the user wants to pick one.

Recommend the global layer: the voice follows the person, not the project. `write` replaces the
whole layer, so read it first and write the merged whole. Then run the `verify` action.
