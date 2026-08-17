# Onboarding

Read this when `bun "$F" config check` reports missing configuration. Finish by verifying — not by writing a file and hoping.

Ask the user these four things. Use `AskUserQuestion` so they can pick rather than type:

1. **Where is the Fellow API key?** They generate one in Fellow under User Settings → Developer API (paid workspaces only; an admin must have enabled the API in Workspace Security Settings). Never accept the key itself as text and never write it into a config file — store a *reference* to it.

2. **Which workspace?** The API is workspace-scoped: the base URL is `https://{subdomain}.fellow.app/api/v1`. The subdomain is visible in the URL when they use Fellow in a browser. If they aren't sure, ask them to check that URL.

3. **Which config layer?** Recommend global (`~/.agents/config/fellow/config.json`) for the credential and workspace — they follow the person, not whichever project happens to be open.

4. **What should be stored, and where?** Ask whether they want meeting recaps, transcripts, and media saved into the project, and at what paths — anything not configured just isn't written. Transcripts are bulky and often sensitive, so it's reasonable to keep them out of a repo entirely with an absolute path.

Then:

- Write the config with the `Write` tool. `bun "$F" config path --layer global` prints the exact destination. Copy the shape from `../config.example.json` next to this file.
- Verify with `bun "$F" config check`, which makes a real `/me` call — show the user the authenticated identity it returns. Configured means that call succeeded, not that a file exists.
- If the credential came from 1Password, Keychain, or a command, add `"cacheVar": "FELLOW_API_KEY"` to it and tell the user to seed the variable once per shell session — `export FELLOW_API_KEY="$(op read '<their ref>')"`. Without it every command re-resolves the secret from scratch: ~5s and a fresh Touch ID prompt each time. Print the `export` line for them to run; never run it yourself and never echo the key.

Layering, merge rules, and credential-reference shapes are in the [Agent Config Standard](../../../../../standards/agent-config.md); read it for anything the four questions above don't cover.
