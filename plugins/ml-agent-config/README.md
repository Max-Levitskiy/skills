# ml-agent-config

The Agent Config Standard (ACS v1) — layered settings, secret-free credential references, and a re-runnable onboarding flow — packaged as a skill plus a zero-dependency TypeScript loader. `fellow` and `orchestrate` both vendor it instead of maintaining their own copy; see [`standards/agent-config.md`](../../standards/agent-config.md) for the full spec this implements.

```bash
/plugin install ml-agent-config@max-skills
```

## Who it is for

**Your skill needs a setting or a credential right now.** Ask Claude. It invokes `/ml-agent-config:setup`, walks you through which layer each value belongs in and where the credential lives, writes the file, and verifies it with a real call.

**You're building a skill or subagent that needs configuration.** Read the standard and vendor `lib/config.ts` and `lib/credentials.ts` — see [Vendoring](#vendoring) — instead of writing a loader, a merge function, and five credential resolvers from scratch.

## What it gives you

Settings live in three layers, deep-merged in order — global → repo → local. Objects merge key by key; arrays and scalars replace wholesale; an explicit `null` deletes an inherited key.

| Layer | Path | Committed? | Holds |
| --- | --- | --- | --- |
| **global** | `~/.agents/config/<name>/config.json` | n/a | your defaults across every project |
| **repo** | `<repo>/.agents/config/<name>/config.json` | yes | settings the whole team shares |
| **local** | `<repo>/.agents/config/<name>/config.local.json` | no — gitignored | per-checkout overrides, personal paths |

A config file never contains a secret, only a reference to where one lives — the repo layer is committed, so a config file that could hold a secret eventually leaks one:

| Source | Resolves via |
| --- | --- |
| `1password` | `op read <ref>` |
| `env` | an environment variable |
| `dotenv` | a `KEY=value` file (must itself be gitignored) |
| `keychain` | macOS Keychain, via `security find-generic-password` |
| `command` | any shell command — the escape hatch for Bitwarden, `pass`, Vault, and the rest |

Any reference can also carry `"cacheVar": "MY_API_KEY"`. When that environment variable holds a non-empty value the resolver uses it and never touches the source — one Touch ID prompt per shell session instead of one per command, since every CLI invocation is a fresh process. Nothing is cached to disk: the variable dies with the shell, which is what makes it safe.

## On Claude Code

The plugin also ships a hooks module, `claude-code/register.ts`, which Claude Code loads and other harnesses do not. Codex reads its own manifest, `.codex-plugin/plugin.json`, which names no hooks, so it uses the CLI and skill exactly as before. On Claude Code the module adds:

- **The start step, done for the skill.** When a skill of a v2 component expands, the module runs `agent-config start` and puts the output ahead of the skill's text, so the model does not look for the binary or run the step.
- **One 1Password approval per session.** For a ready component, the module runs one `load` for its `1password` references, so you approve once. It keeps the secrets in the `AGENT_CONFIG_SECRETS` environment variable of the Claude Code process, and every later `load` reads them there instead of calling `op`. They are never written to disk or put into the conversation. If you decline, the module does not ask again on the next skill, unless a reference changed since; a reference added or changed after an approval is asked for on the next skill. `/agent-config unlock <name>` asks again, `/agent-config forget` clears the cache, and the session's end clears it too. While secrets are cached, a band above the prompt says so. **Forget** drops the cache, **×** closes the band for this session, and **Don't show again** saves `notices.cacheBanner: false` in agent-config's own global layer (`~/.agents/config/agent-config/config.json`, declared in `claude-code/agent-config.json`), so the band stays hidden in later sessions. Turn it back on in the `/agent-config` pane, under agent-config.
- **A reload without typing.** The tool `mcp__ml-agent-config__reload_plugins` runs `/reload-plugins` after an install and resumes the work.
- **A settings pane.** `/agent-config` with no name opens a pane of short screens, one at a time, each with **‹ Back**:
  - **Components**: every installed component with a declaration, plus agent-config itself, and whether each is ready.
  - **Settings**: each declared key, its value, and the level it comes from (`beta · This checkout, overrides acme`). **Show: Effective ›**, beside the path, opens a short screen that switches the rows to one level's own values. Every key, on/off ones included, opens its edit screen on press, and is saved from there. A component that needs setup has **Set up with Claude**, which asks the model to run its onboarding. **Files** lists where each level is kept.
  - **Edit**: one key at one level. The level it writes to sits on the title line, at the right (**Project ›**): a press opens the level list, which compares what each level sets, the one in effect marked, and a pick moves the edit there. Under the title is a line only when there is more to say: `Holds acme, but This checkout overrides it.` The files are on **Files** and on **Save to…**. Switching keeps what you typed, so a value can go wherever it belongs. Under the value, **Override it** lists the empty levels above the one in effect: **For the team in this repo**, **Just for me in this repo**, **In this checkout only**. A press moves the edit there, starting from the value now, and the line under the title says what saving does: `Saving here overrides Everywhere (acme) for the whole team in this repo.` The levels are the CLI's layers: **Everywhere** (global), **Project, shared** (repo), **Project, just me** (user-repo) and **This checkout** (local); outside a repository only Everywhere exists, so it is named without a button, with a line saying why. **Save here** writes the value, **Save to…** writes it at another level you pick and leaves this one as it is, **Remove here (back to acme)** drops it from that level so a lower one shows through, and **Block inherited** writes null there, so the levels under it no longer apply. An on/off key picks **on** or **off** there, saved like any value. A level whose file is behind its component's schema is not saved, so the migration it is owed is not lost: **Set up with Claude** migrates it first. Values read and are typed as plain text (`on`, `a, b, c`), as the key's type: a number, on or off, a comma-separated list, or text. A list of anything but text, an empty list (`[]`), or an object, is typed as JSON, so its types survive a save.
  - **Source**: a credential is edited as where the secret lives (1Password, environment variable, .env file, Keychain, command) and that source's fields, never as JSON, and never the secret itself.
  - **Pick from 1Password**: every item of every account, listed once a session with one `op` call per account (↻ lists them again). A fuzzy search over title, vault and account ranks word starts first (`ghact` finds GitHub Actions), and **Account**, **Vault** and **Type** each open a screen of choices. An item opens its fields; a field fills in its `op://` reference, with the account when there are several, and the edit waits for **Save here**. The listing goes through `agent-config 1password`, which prints names and references only, never a field's value. A picked reference is stored by vault and item name where 1Password takes the name, else by id. The names of every listed vault and item are kept in the plugin's store, across sessions, so an id-only reference still reads by name (`op://Private/GitHub Actions/username`) without unlocking 1Password.
- **`/agent-config <name>`** shows whether a component is ready, what is missing, and what is cached.

Any program the session starts can read the cached secrets in that environment variable, the model's shell commands included. A `cacheVar` you export has the same exposure.

## Vendoring

The library is copied into each consuming plugin verbatim rather than imported across plugins. A runtime dependency between plugins breaks the moment a user has one installed and not the other; a copy always works. Drift is caught by diffing the vendored file's body against the canonical one — not a commit hash, which churns on every sync even when nothing changed and misses the case that actually happens, someone editing the copy.

```bash
plugins/ml-agent-config/skills/setup/scripts/vendor.sh sync   # refresh every vendored copy
plugins/ml-agent-config/skills/setup/scripts/vendor.sh check  # fail if any copy has drifted
```

## What's in the box

```
ml-agent-config/
├── .claude-plugin/plugin.json   name, description, keywords; names the Claude Code hooks module
├── .codex-plugin/plugin.json    the same manifest without hooks, so Codex never reads the module
├── claude-code/                 the hooks module and its tests (Claude Code only)
│   ├── screens/                 the pane's screens, one file each
│   └── ui/                      Screen, PickList, fuzzy search, the levels
├── types/index.d.ts             the session state the hooks module keeps
├── skills/setup/
│   ├── SKILL.md                 the onboarding flow — detect missing config, ask, write, gitignore, verify
│   ├── lib/
│   │   ├── config.ts            layer paths, deep merge, gitignore handling, credential validation
│   │   └── credentials.ts       lazy resolution for all five sources, plus the cacheVar session cache; never logs a resolved secret or writes one to disk
│   └── scripts/vendor.sh        sync/check the copies vendored into fellow and orchestrate
└── LICENSE
```

## Tests

```bash
claude plugin test plugins/ml-agent-config      # the hooks module and its pane, in the engine's own runner
bun test plugins/ml-agent-config/src             # the CLI's 1Password listing and session cache
```

## License

[MIT](LICENSE)
