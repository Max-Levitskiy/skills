# Proposal: multi-site routing for the `atlassian` skill

**Status:** idea, not a spec. Handoff for a later session to think through and cut down.
**Written:** 2026-09-02, from a session where the skill couldn't reach a ticket.
**Repo convention note:** specs here live as GitHub issues (`AGENTS.md`). This file is the
raw thinking; convert to an issue (or `docs/adr/`) once the shape is settled.

---

## What happened

A `DUBL1-321` link on `ideasoftio.atlassian.net` was pasted into a session running in
`ADI-Stack-Server`. The skill was configured — `config check` said `jira: OK` — and could
not read the ticket, because the one configured site was `webtree.atlassian.net`. The
global API token 401s against ideasoftio; the MCP connector grants only webtree.

The ticket was eventually read through `acli`, Atlassian's own CLI, which was already
OAuth-authenticated to ideasoftio and had been the whole time.

Three separate failures worth keeping in view, because a fix that only addresses the first
leaves the other two:

1. **No way to express two sites.** One `jira.baseUrl` per resolved config.
2. **No routing.** Nothing connects "this repo" or "this ticket prefix" to a site.
3. **No diagnosis.** `jira: OK` for the wrong instance, and `config scope DUBL1-321` →
   `No configured scope claims the prefix "DUBL1"`, exit 0. Neither output suggests that
   another instance might hold it. The failure looked like a credential problem for
   several minutes.

## The reframe

The instinct is "associate a credential with a repo." That undershoots. Reaching ideasoftio
needs `baseUrl` + `auth.email` + a *different* token — three fields that are only
meaningful together. Route a bare credential and you get a token pointed at the wrong host,
which is a 401 at best and a write to the wrong company's Jira at worst.

**The routed unit is a site, not a credential.** That gives a three-part decomposition, and
the value of this proposal is mostly in keeping these three apart:

| Concept | Is | Exists today? |
| --- | --- | --- |
| **Site** | An Atlassian instance: base URLs, deployment, auth mode, email, credential ref | Implicit, exactly one, spread across top-level `jira`/`confluence`/`auth`/`credentials` |
| **Scope** | A stream of work *within* a site: projects, labels, board, space, filters | Yes — `scope.ts:33`. Has no site. |
| **Route** | The rule that picks a scope/site for an invocation with no flag | No. `--scope`, `defaultScope`, and `scopeForIssueKey` are the whole story. |

Each scope belongs to exactly one site (recommended — a scope spanning instances makes
every search undefined). Routes select a scope; the scope names the site.

## The layer split — the part I'd keep if only one thing survives

Two things want to live in different places, and today they're the same object:

- **Which stream of work is this?** A property of the *repo*. The whole team agrees
  `ADI-Stack-Server` is DUBL1 work. Belongs in the committed repo layer.
- **How do I reach that stream?** A property of the *person*. Each dev has their own
  account, their own 1Password vault, their own token. Belongs in the home layer.

So: **the repo layer may name a scope but must not define a site or a credential.**

```jsonc
// <repo>/.agents/skill-config/atlassian/config.json — committed, shared, no secrets
{ "version": 1, "scope": "adi" }
```

```jsonc
// ~/.agents/skill-config/atlassian/config.json — personal
{
  "sites": {
    "ideasoftio": {
      "jira": { "baseUrl": "https://ideasoftio.atlassian.net" },
      "auth":  { "email": "maxim.levitskiy@ideasoft.io" },
      "credentials": { "token": { "source": "1password", "ref": "op://Private/…" } }
    }
  },
  "scopes": { "adi": { "site": "ideasoftio", "jira": { "projects": ["DUBL1"] } } }
}
```

This is also a **security property, not just ergonomics**. A repo layer is committed, so
its contents are attacker-influenceable — a PR can add
`.agents/skill-config/atlassian/config.json`. If that file can only reference a scope
*name*, resolved against the user's own home config, the worst a malicious repo achieves is
selecting a site you already trust. If it can define `sites` or `credentials`, it can set a
`baseUrl` it controls and your token is sent there on the next command.

**Related gap to check while you're in there:** `merge()` in `config.ts` is an unconditional
deep merge and the layer order is global → repo → local, so today a repo layer can set
`safety.allowDelete: true` over a global `false`. Safety should be tightening-only across
layers. Same class of problem, same fix location.

## Routing signals

Ordered by how strongly they identify a site. The interesting observation is that the
cheapest ones are also the ones that would have solved the motivating case.

| # | Signal | Example | Config needed |
| --- | --- | --- | --- |
| 1 | Explicit flag | `--site ideasoftio`, `--scope adi` | none |
| 2 | **Host in the argument** | `jira get https://ideasoftio.atlassian.net/browse/DUBL1-321` | **none — the host is right there** |
| 3 | **Issue-key prefix** | `jira get DUBL1-321` → `DUBL1` | scope `projects` (already exists) |
| 4 | Repo identity | remote `github.com/ADI-Foundation-Labs/*` | a routes table |
| 5 | cwd path prefix | `~/Library/CloudStorage/…/NeoChain/**` | a routes table |
| 6 | `defaultScope` | fallback | exists |

**Ship order matters.** Signals 2 and 3 are nearly free — `scopeForIssueKey` (`scope.ts:68`)
already does the prefix lookup, it just resolves to a site-less scope — and together they
cover every "paste a link / name a ticket" interaction, which is most of them. The repo
routing table is more config, more matching subtleties, and covers `jira search` with no key
in it. Consider landing sites + signals 1–3 first and treating the routes table as a second
increment; it may turn out to earn less than it looks like it will.

## Match syntax, if you do build the routes table

The suggested form was `github.com:ADI-Foundation-Labs` and globs like `repo/prefix-*`.
Hazards to resolve:

- **One repo has many remote spellings.** `git@github.com:Org/Repo.git`,
  `https://github.com/Org/Repo`, `ssh://git@github.com/Org/Repo`. Normalise to a canonical
  `host/org/repo`, lowercased, `.git` stripped, before matching. The `:` in the SCP form is
  a path separator, not a host/port delimiter — don't let a URL parser tell you otherwise.
- **Self-hosted hosts and nested groups.** This user already has
  `gitlab.sre.ideasoft.io:adi-foundation/adi-chain/adi-claude-code-marketplace`. GitLab
  subgroups mean the path is not two segments. Decide explicitly whether `*` crosses `/`
  and whether `**` exists.
- **Which remote?** `origin` on a fork is the personal fork; the org is `upstream`. And
  `ADI-Stack-Server` is downstream of `matter-labs/zksync-os-server`, so remotes genuinely
  point at two different organisations here. Suggestion: match against all remotes, prefer
  `origin` on a tie, error on a conflict between two *different* sites.
- **Don't wildcard ticket prefixes.** Project keys are short and collide across instances —
  `INFRA`, `OPS`, and `PLATFORM` exist everywhere. Exact keys in `scope.jira.projects`
  (today's behaviour) is the right granularity. Wildcards make sense for repo paths, where
  the hierarchy carries real meaning, and not much elsewhere.
- **Confluence space keys collide worse than project keys.** Consider whether space→site
  routing is safe at all, or whether Confluence should always inherit the site from the
  Jira side of the same scope.

## Precedence, ambiguity, and saying what you did

The property that matters: **a write must never land on the wrong instance because two
rules matched.**

- Most specific signal wins, in the table order above.
- Within one signal class, the most literal pattern wins — fewest wildcards, longest
  literal prefix.
- A genuine tie is a hard error listing both candidates. Never a silent pick, not even for
  reads. Consistency between read and write behaviour is worth more than the convenience.
- **Extend the existing "what the scope narrowed" line to always name the site and the
  reason it was chosen.** This is the fix for failure #3, and it's cheap:

  ```
  [site "ideasoftio" — matched repo github.com/ADI-Foundation-Labs/ADI-Stack-Server]
  [scope "adi" applied: project IN (DUBL1) — use --no-scope to search everything]
  ```

- `--no-scope` becomes ambiguous under multi-site: "everything" on *which* instance? Decide
  whether it keeps the routed site and drops only the narrowing (my instinct), or falls
  back to a `defaultSite`.
- `config check` should verify every configured site and print a table, not just the active
  one. `config scope DUBL1-321` should distinguish "no scope claims this prefix" from "no
  *site* you have configured serves this prefix" — and probably exit non-zero for the
  latter.

## Backward compatibility

Existing configs have no `sites` key. Treat the top-level `jira`/`confluence`/`auth`/
`credentials` block as an implicit site named `default`, and let `sites` be purely additive.
`resolveProduct` (`config.ts:197`) is the single funnel where a site is materialised — it
takes `cfg` and a product today, and would take `cfg`, product, and a resolved site. That's
the main surgery; most of the rest is plumbing the choice down to it.

## Adjacent finding: `acli` is already a usable credential source

Possibly a shortcut worth evaluating before building token management.

`acli` keeps credentials in the macOS login keychain under service `acli`, with the account
key `jira:<cloudId>:<accountId>` — one item per profile, listed in
`~/.config/acli/jira_config.yaml`. The skill already has a `keychain` credential source.

- For `auth_type: api_token` profiles this should work **today, with no code change** — the
  stored value is the API token.
- For `auth_type: oauth`/`oauth_global` (which is how ideasoftio is authenticated) it's
  harder but not obviously blocked. A 3LO token must go to
  `https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/…`. `http.ts:46` builds URLs by
  plain concatenation, so that base URL composes correctly; `inferDeployment` would guess
  `server` for `api.atlassian.com`, but `deployment: "cloud"` is explicitly settable, so
  that's a config line rather than a code change. *(I said in-session that OAuth reuse was
  blocked by deployment inference — that was wrong, the inference is overridable.)*
- The real obstacle is **expiry**: OAuth access tokens rotate, so a static keychain
  reference goes stale. The shape that survives is `source: "command"` shelling out to
  something that mints a fresh token — and `acli` does not appear to expose a
  token-printing subcommand. Check before betting on this.

Even if OAuth reuse doesn't pan out, "read an existing `acli` profile" is a strong
onboarding move: the sites, cloud ids, emails, and auth types are all sitting in
`~/.config/acli/*.yaml` in plain text, which is most of a `sites` block already.

## Open questions for the next session

1. Does a scope belong to exactly one site? (I think yes. Confirm nothing needs otherwise.)
2. What does `jira search` do with no scope and several sites — error, or fan out? Fan-out
   is attractive ("all my open tickets across both companies") but a union across instances
   with per-instance pagination and no shared total is a real project, not a flag.
3. Is the routes table worth it at all, once signals 2 and 3 exist? What's the concrete case
   that only the repo route solves?
4. Worktrees and submodules: `repoRoot()` shells `git rev-parse --show-toplevel`, which in a
   worktree returns the worktree path. Remote lookup still works, but confirm.
5. Non-git working directories — the `~/Library/CloudStorage/…/MASHREQBANK-NeoChain` folder
   is a real example. Is a path route worth it, or is `--site` enough there?
6. Should the repo layer be allowed to define *anything* beyond a scope name? A strict
   allowlist is easier to reason about than a denylist.

## Where to read

Everything below is `plugins/atlassian/skills/atlassian/`:

| What | Where |
| --- | --- |
| Layer paths, merge, load order | `scripts/lib/config.ts:90` (`layerPath`), `:118` (`loadConfig`), `merge` above it |
| Single-site assumption | `scripts/lib/config.ts:32` (`ProductSettings.baseUrl`), `:197` (`resolveProduct`) |
| Deployment inference | `scripts/lib/config.ts:158` |
| Scope shape — note the absence of a site | `scripts/lib/scope.ts:14`–`:37` |
| Prefix routing that already exists | `scripts/lib/scope.ts:68` (`scopeForIssueKey`) |
| Safety merge gap | `scripts/lib/config.ts:70`, `scripts/lib/scope.ts:214` (`checkSafety`) |
| URL construction | `scripts/lib/http.ts:46` |
| Credential sources | `scripts/lib/credentials.ts:24` |
| Config shape as documented to users | `config.example.json`, `SKILL.md` § Scopes |
| Layering rules | `standards/agent-config.md` |
