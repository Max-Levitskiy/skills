# agent-config

The Agent Config Standard (ACS v1) — layered settings, secret-free credential references, and a re-runnable onboarding flow — packaged as a skill plus a zero-dependency TypeScript loader. `fellow` and `orchestrate` both vendor it instead of maintaining their own copy; see [`standards/agent-config.md`](../../standards/agent-config.md) for the full spec this implements.

```bash
/plugin install agent-config@max-skills
```

## Who it is for

**Your skill needs a setting or a credential right now.** Ask Claude. It invokes this skill, walks you through which layer each value belongs in and where the credential lives, writes the file, and verifies it with a real call.

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

## Vendoring

The library is copied into each consuming plugin verbatim rather than imported across plugins. A runtime dependency between plugins breaks the moment a user has one installed and not the other; a copy always works. Drift is caught by diffing the vendored file's body against the canonical one — not a commit hash, which churns on every sync even when nothing changed and misses the case that actually happens, someone editing the copy.

```bash
plugins/agent-config/skills/agent-config/scripts/vendor.sh sync   # refresh every vendored copy
plugins/agent-config/skills/agent-config/scripts/vendor.sh check  # fail if any copy has drifted
```

## What's in the box

```
agent-config/
├── .claude-plugin/plugin.json   name, description, keywords
├── skills/agent-config/
│   ├── SKILL.md                 the onboarding flow — detect missing config, ask, write, gitignore, verify
│   ├── lib/
│   │   ├── config.ts            layer paths, deep merge, gitignore handling, credential validation
│   │   └── credentials.ts       lazy resolution for all five sources, plus the cacheVar session cache; never logs a resolved secret or writes one to disk
│   └── scripts/vendor.sh        sync/check the copies vendored into fellow and orchestrate
└── LICENSE
```

## License

[MIT](LICENSE)
