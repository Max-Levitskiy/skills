# ml-agent-config

The Agent Config Standard (ACS v2) — layered settings, secret-free credential references, and a re-runnable onboarding flow — packaged as the `agent-config` CLI plus a skill that teaches it. `fellow`, `atlassian`, `orchestrate`, `herdr` and `grill-with-ui` each declare their keys in an `agent-config.json` and read their config through the CLI; see [`standards/agent-config.md`](../../standards/agent-config.md) for the full spec this implements.

```bash
/plugin install ml-agent-config@max-skills
```

## Who it is for

**Your skill needs a setting or a credential right now.** Ask Claude. It invokes `/ml-agent-config:setup`, walks you through which layer each value belongs in and where the credential lives, writes the file, and verifies it with a real call.

**You're building a skill or subagent that needs configuration.** Declare its keys in an `agent-config.json` and read config through `agent-config load`, instead of writing a loader, a merge function, and five credential resolvers from scratch. `/ml-agent-config:setup` walks through it, with fellow as the worked example.

## What it gives you

Settings live in four fixed layers, plus two for each context that applies, deep-merged in order: `global → context (outermost first, nested inside) → repo → user-repo → local`, a context's team file before its `me` file. Objects merge key by key; arrays and scalars replace wholesale; an explicit `null` deletes an inherited key.

| Layer | Path | Committed? | Holds |
| --- | --- | --- | --- |
| **global** | `~/.agents/config/<name>/config.json` | n/a | your defaults across every project |
| **context** | `~/.agents/contexts/<context>/<name>/config.json` | n/a | what one organisation shares across all its repositories |
| **context me** | `~/.agents/contexts/<context>/<name>/config.me.json` | n/a | your own answers in that context, credentials included |
| **repo** | `<repo>/.agents/config/<name>/config.json` | yes | settings the whole team shares |
| **user-repo** | `~/.agents/config/<name>/user-repo/<repo identity>/config.json` | n/a | your settings for one repository, in every worktree of it |
| **local** | `<repo>/.agents/config/<name>/config.local.json` | no — gitignored | per-checkout overrides, personal paths |

**Contexts** group one organisation's repositories, so what it shares (a tracker site, issue prefixes) is set once for all of them and kept out of repositories that are not yours. A context lives in `~/.agents/contexts/<context>/`. Its team file, `context.json`, matches by git remote (`github.com/acme/**`) and may name a `parent` context to nest inside. Your own `context.me.json` matches by local path (`~/git/acme/`), with or without a git repository there. `agent-config context add acme --remote 'github.com/acme/**' --path '~/git/acme/'` creates one, `context set` changes its parent and filters, `context remove` deletes it, and `agent-config context explain` shows which contexts apply here and why. `--context <name>` adds one for a single command and `--no-context` drops them all. When a key recommends a context and none matches, `start` plans a step that asks you to create one or keep the answer global. The rules are in the standard, under *Contexts*.

A config file never contains a secret, only a reference to where one lives — the repo layer is committed, so a config file that could hold a secret eventually leaks one:

| Source | Resolves via |
| --- | --- |
| `1password` | `op read <ref>` |
| `env` | an environment variable |
| `dotenv` | a `KEY=value` file (must itself be gitignored) |
| `keychain` | macOS Keychain, via `security find-generic-password` |
| `command` | any shell command — the escape hatch for Bitwarden, `pass`, Vault, and the rest |

A credential reference is honoured only from a layer you wrote on this machine: global, user-repo, a context's `me` file, or a `config.local.json` git does not track. One in the repo layer or a context's team file is ignored and reported, so a cloned repository or a shared context file can never point a credential at a command of its own.

Any reference can also carry `"cacheVar": "MY_API_KEY"`. When that environment variable holds a non-empty value the resolver uses it and never touches the source — one Touch ID prompt per shell session instead of one per command, since every CLI invocation is a fresh process. Nothing is cached to disk: the variable dies with the shell, which is what makes it safe.

A config left at the v1 path, `.agents/skill-config/<name>/`, is not lost. When its layer has no `.agents/config/` file yet, `agent-config start` plans an `agent-config:adopt` step ahead of onboarding, and `agent-config adopt <name>` copies the file over through `write`, which checks it for inline secrets, stamps it and journals it. The old file stays where it is. When both files exist, only the new one is read, and `start` reports the old one rather than merge them.

## On Claude Code

The plugin also ships a hooks module, `claude-code/register.ts`, which Claude Code loads and other harnesses do not. Codex reads its own manifest, `.codex-plugin/plugin.json`, which names no hooks, so it uses the CLI and skill exactly as before. On Claude Code the module adds:

- **The start step, done for the skill.** When a skill of a v2 component expands, the module runs `agent-config start` and puts the output ahead of the skill's text, so the model does not look for the binary or run the step.
- **One 1Password approval per session.** For a ready component, the module runs one `load` for its `1password` references, so you approve once. It keeps the secrets in the `AGENT_CONFIG_SECRETS` environment variable of the Claude Code process, and every later `load` reads them there instead of calling `op`. They are never written to disk or put into the conversation. A reference whose `cacheVar` holds a value in the session is left to that variable and not cached here; one whose variable is unset, as in a fresh terminal or herdr pane, is unlocked and cached like any other, so the secret comes from the config rather than only from the shell that started Claude. If you decline, the module does not ask again on the next skill, unless a reference changed since; a reference added or changed after an approval is asked for on the next skill. `/agent-config unlock <name>` asks again, `/agent-config forget` clears the cache, and the session's end clears it too. While secrets are cached, a band above the prompt says so. **Forget** drops the cache, **×** closes the band for this session, and **Don't show again** saves `notices.cacheBanner: false` in agent-config's own global layer (`~/.agents/config/agent-config/config.json`, declared in `claude-code/agent-config.json`), so the band stays hidden in later sessions. Turn it back on in the `/agent-config` pane, under agent-config.
- **A reload without typing.** The tool `mcp__ml-agent-config__reload_plugins` runs `/reload-plugins` after an install and resumes the work.
- **A settings pane.** `/agent-config` with no name opens a pane of short screens, one at a time, each with **‹ Back**:
  - **Components** and **Contexts**, two tabs on the first screen. **Components**: every installed component with a declaration, plus agent-config itself, and whether each is ready. **Contexts**: every context, the ones that apply here first, each with its parent, its filters and the components it holds values for.
  - **Context**: one context's **Parent ›** (none, or any context not under it), its **Remotes** (in `context.json`, which holds no secret and can be handed to a team) and its **Folders** (in `context.me.json`, yours alone). A press on a filter removes it, and **Add remote** / **Add folder** add one; each change runs `agent-config context set` at once. **Delete context** asks again, naming the component values that go with it, then runs `context remove --force`. **+ New context…** opens the same screen as a draft, filled in from where Claude Code runs: named for the folder that holds this repo (or for this folder, outside one), matching every folder under it and every repo beside this one on its remote; **Create context** runs `context add`.
  - **Settings**: each declared key, its value, the level it comes from, and every value it overrides, top first (`beta · This checkout ← acme (Repo, shared)`). **Show: Effective ›**, beside the path, opens a short screen that switches the rows to one level's own values. Every key, on/off ones included, opens its edit screen on press, and is saved from there. A component that needs setup has **Set up with Claude**, which asks the model to run its onboarding. **Files** lists where each level is kept.
  - **Edit**: one key at one level. On top is its chain: every level, top first, with what it sets and what became of that (`acme  overridden by This checkout`, `wins`, `hidden by the block at Repo, shared`), the level being edited marked ◉, and the default last. A press on a level moves the edit there; what you typed stays, so a value can go wherever it belongs, and an empty level above the one in effect is how an override is added. A level that cannot hold the key is shown dim with why: a credential never goes to **Repo, shared** (committed), and a credential or a personal key never to a context's team file. Under the chain is a line only when there is more to say: `Holds acme, but This checkout overrides it.`, `Saving here overrides Everywhere (acme) for the whole team in this repo.` The levels are the CLI's layers: **Everywhere** (global), **Repo, shared** (repo), **Repo, just me** (user-repo) and **This checkout** (local), and for each context that applies **Context acme** and **Context acme, just me**, its `context.json` and `context.me.json` levels. **Files** lists where each level is kept and the contexts that apply here, outermost first; a key declared for a context opens at the innermost one. Outside a repository and any context only Everywhere exists, so there is no chain, and a line says why. **+ New context…**, on the edit screen and on **Files**, opens the new-context screen (see **Context**), and once it is created an open edit moves to the new context's level. **Save to <level>** writes the value at the level being edited, and the message after it says what that did (`Saved site.url in Repo, just me: it overrides beta from Everywhere.`); **Remove here (back to acme)** drops it from that level so a lower one shows through, and **Block inherited** writes null there, so the levels under it no longer apply. An on/off key picks **on** or **off** there, saved like any value. A level whose file is behind its component's schema is not saved, so the migration it is owed is not lost: **Set up with Claude** migrates it first. Values read and are typed as plain text (`on`, `a, b, c`), as the key's type: a number, on or off, a comma-separated list, or text. A list that `a, b, c` cannot carry (numbers, objects, an empty list `[]`, an item with a comma or a blank one), and an object, are typed as JSON, so they survive a save. Each level is edited as its own value: text under an on/off override is still typed as text. A key whose declaration gives it a JSON Schema is edited by that schema instead: an `enum` is picked, a number is checked as a number, and an object opens its fields, each typed, picked or opened on a screen of its own (fellow's `projects`: each project's label, title rules, people rules and fallback). A map of named entries adds, renames and removes them. Every change stays in the edit until **Save** writes the whole value, and a field its schema refuses is named before anything is written.
  - **Source**: a credential is edited as where the secret lives (1Password, environment variable, .env file, Keychain, command) and that source's fields, never as JSON, and never the secret itself.
  - **Pick from 1Password**: every item of every account, listed once a session with one `op` call per account (↻ lists them again). A fuzzy search over title, vault and account ranks word starts first (`ghact` finds GitHub Actions), and **Account**, **Vault** and **Type** each open a screen of choices. An item opens its fields; a field fills in its `op://` reference, with the account when there are several, and the edit waits for **Save**. The listing goes through `agent-config 1password`, which prints names and references only, never a field's value. A picked reference is stored by vault and item name where 1Password takes the name, else by id. The names of every listed vault and item are kept in the plugin's store, across sessions, so an id-only reference still reads by name (`op://Private/GitHub Actions/username`) without unlocking 1Password.
- **`/agent-config <name>`** shows whether a component is ready, what is missing, and what is cached.

Any program the session starts can read the cached secrets in that environment variable, the model's shell commands included. A `cacheVar` you export has the same exposure.

## What's in the box

```
ml-agent-config/
├── .claude-plugin/plugin.json   name, description, keywords; names the Claude Code hooks module
├── .codex-plugin/plugin.json    the same manifest without hooks, so Codex never reads the module
├── claude-code/                 the hooks module and its tests (Claude Code only)
│   ├── screens/                 the pane's screens, one file each
│   └── ui/                      Screen, PickList, fuzzy search, the levels
├── src/                         the CLI; key-schema.ts, what a key holds, is read by the pane too
├── types/index.d.ts             the session state the hooks module keeps
├── skills/setup/SKILL.md        the onboarding flow and how to wire config into a component
└── LICENSE
```

## Tests

```bash
claude plugin test plugins/ml-agent-config      # the hooks module and its pane, in the engine's own runner
bun test plugins/ml-agent-config/src             # the CLI: adopt, declarations, key schemas, 1Password listing, session cache
```

## License

[MIT](LICENSE)
