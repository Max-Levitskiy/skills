# ACS v3, plan 1 of 4: Contexts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A named context (a group of places matched by git remote or path, nestable) becomes a config layer between `global` and `repo`, with a team file and a personal file per context, matched and ordered as the spec says, writable, onboardable, and visible in the pane.

**Architecture:** Three new modules in `plugins/ml-agent-config/src/` — `glob.ts` (git-style wildmatch), `place.ts` (what the current place is: roots, cwd, remotes), `contexts.ts` (definitions, matching, ordering, explain) — and the existing `layers.ts` learns context layers as `context:<name>` / `context:<name>:me`. `Layer` becomes a string union with a template-literal member, so provenance, `describe` levels and the pane keep working on strings. The CLI gains `context list|explain|add`, and `--cwd`, `--context`, `--no-context`. Trust rules for credential references land here because contexts introduce the first synced file.

**Tech Stack:** TypeScript on bun, `bun:test`, no new dependencies. Tests spawn `bin/agent-config` in a sandbox `HOME` (pattern: `src/adopt.spec.ts`).

**Spec:** `docs/superpowers/specs/2026-10-20-agent-config-v3-contexts-design.md` — §5 (Contexts), §9 (Trust, broken context, concurrent readers, exit codes), §8 (standard text). Plans 2–4 cover identifiers/`uses`/`replace`/install (§1–§4), the `identity`/`project` providers (§6), and the consumer migration (§7).

## Global Constraints

- Layer order: `global → context (outermost first, nested inside) → repo → user-repo → local`; within one context the team file merges before `me`.
- Context files: `~/.agents/contexts/<name>/context.json` (team: `schemaVersion`, `id`, `parent`, `match` with `remote` only), `~/.agents/contexts/<name>/context.me.json` (`match` with `path` only), `~/.agents/contexts/<name>/<component>/config.json`, `…/config.me.json`, `~/.agents/contexts/order.json`.
- Glob: `*` does not cross `/`, `**` does; `**/` is prepended unless the pattern starts with `~/`, `./` or `/`; a trailing `/` means `/**`; `~` expands; case-sensitive, `/i` suffix on the field name (`path/i`, `remote/i`) for insensitive.
- Remote normalisation: `host/path`, scheme, `git@`, user, port and `.git` stripped, host lower-cased, path case kept (reuse `normaliseOrigin` in `repo.ts`).
- `path` is tested against checkout root, main worktree root and cwd, each with `/` appended; symlinked and real paths both.
- Trusted layers for a credential reference: `global`, `user-repo`, `context:*:me`, and `local` only when git reports the file untracked or ignored. Elsewhere the reference is ignored and `start`/`load` report `untrusted-layer-key`.
- Every file write is temp-file + rename.
- Exit codes: unknown parent, parent cycle, unknown name in `order.json`, `--context` naming no context → `ConfigError` → exit 2. An unparsable `context*.json` is skipped with `context-unparsable`, exit 2 only when something names it.
- No project names (client or employer) in code, tests, docs or examples; use `acme`.

## Review Focus

1. A path that is a symlink into a cloud-synced folder (`~/Drive/acme` → `/Volumes/…`): both forms must match a `path` entry. Pinned in Task 2 (`matchesPlace` test with a symlinked root).
2. `~/git/acme` is itself a repository and the user is in a linked worktree under `~/.worktrees/acme-fix`: the context must still match through the main root. Pinned in Task 3 (`placeOf` test with `git worktree add`).
3. A `path` entry written into the team `context.json` by hand: `context list` must flag it and matching must ignore it, or a colleague's machine applies a path that is not theirs. Pinned in Task 3.
4. A tracked `config.local.json` holding a `command` credential: `load` must not run the command. Pinned in Task 7.
5. Deleting a context directory that another context names as `parent`: the next `load` anywhere must fail with the name, not with a stack trace. Pinned in Task 3.

---

### Task 1: Git-style glob matcher

**Files:**
- Create: `plugins/ml-agent-config/src/glob.ts`
- Test: `plugins/ml-agent-config/src/glob.spec.ts`

**Interfaces:**
- Produces: `export function compileGlob(pattern: string, opts: { anchored: "path" | "remote"; ignoreCase?: boolean; home?: string }): (subject: string) => boolean`. For `anchored: "path"`: `~/` → `home`, `**/` prefix rule, trailing `/` → `/**`. For `anchored: "remote"`: no prefixing, no `~`, the pattern matches the whole normalised remote.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, test } from "bun:test";
import { compileGlob } from "./glob";

describe("git-style globs", () => {
  test("* stays inside one segment, ** crosses", () => {
    const org = compileGlob("github.com/acme/*", { anchored: "remote" });
    expect(org("github.com/acme/web-app")).toBe(true);
    expect(org("github.com/acme/platform/web")).toBe(false);
    expect(compileGlob("gitlab.example.com/acme/**", { anchored: "remote" })("gitlab.example.com/acme/platform/web")).toBe(true);
  });
  test("a path pattern without ~/, ./ or / is prefixed with **/", () => {
    expect(compileGlob("acme/", { anchored: "path", home: "/h" })("/x/y/acme/sub/")).toBe(true);
  });
  test("a trailing slash means everything under it, including the directory itself", () => {
    const g = compileGlob("~/git/acme/", { anchored: "path", home: "/h" });
    expect(g("/h/git/acme/")).toBe(true);
    expect(g("/h/git/acme/web/")).toBe(true);
    expect(g("/h/git/acme-other/")).toBe(false);
  });
  test("/i makes it case-insensitive", () => {
    expect(compileGlob("GitHub.com/ACME/**", { anchored: "remote", ignoreCase: true })("github.com/acme/x")).toBe(true);
    expect(compileGlob("GitHub.com/ACME/**", { anchored: "remote" })("github.com/acme/x")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test plugins/ml-agent-config/src/glob.spec.ts`
Expected: FAIL, "Cannot find module './glob'".

- [ ] **Step 3: Implement `compileGlob` in `src/glob.ts`**

Translate to a RegExp: `**` → `.*`, `*` → `[^/]*`, `?` → `[^/]`, `[…]` classes passed through, everything else escaped; anchor `^…$`. Apply the path prefixing rules before translation.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test plugins/ml-agent-config/src/glob.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add plugins/ml-agent-config/src/glob.ts plugins/ml-agent-config/src/glob.spec.ts
git commit -m "feat(ml-agent-config): git-style glob matcher for context filters"
```

---

### Task 2: The current place

**Files:**
- Create: `plugins/ml-agent-config/src/place.ts`
- Modify: `plugins/ml-agent-config/src/repo.ts` — export `normaliseOrigin` as `normaliseRemote` (same body; also strip `user@` before the host in the scheme form, which the regex already does, and a `:port`).
- Test: `plugins/ml-agent-config/src/place.spec.ts`

**Interfaces:**
- Consumes: `repoContext(cwd)` from `repo.ts` (`checkout`, `root`).
- Produces:
  ```ts
  export interface Place {
    cwd: string;
    /** checkout root, main root, cwd — deduped, each in both symlinked and real form, trailing "/" appended. */
    paths: string[];
    /** normalised URLs of every remote of the checkout and of each enclosing git superproject. */
    remotes: string[];
  }
  export function placeOf(cwd: string): Place;
  export function remoteUrls(checkout: string): string[];          // `git config --get-regexp '^remote\..*\.url$'`
  export function superprojects(checkout: string): string[];      // `git rev-parse --show-superproject-working-tree`, repeated upward
  ```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, symlinkSync, realpathSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { placeOf } from "./place";

const git = (cwd: string, ...args: string[]) => Bun.spawnSync(["git", ...args], { cwd });

function repoWith(remotes: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "acs-place-"));
  git(dir, "init", "-q");
  for (const [name, url] of Object.entries(remotes)) git(dir, "remote", "add", name, url);
  return dir;
}

describe("the current place", () => {
  test("every remote is normalised to host/path", () => {
    const dir = repoWith({ origin: "git@github.com:me/web-app.git", upstream: "https://user@GitHub.com:443/acme/web-app" });
    expect(placeOf(dir).remotes.sort()).toEqual(["github.com/acme/web-app", "github.com/me/web-app"]);
  });
  test("paths carry the checkout root with a trailing slash, in symlinked and real form", () => {
    const real = repoWith({});
    const link = join(mkdtempSync(join(tmpdir(), "acs-link-")), "acme");
    symlinkSync(real, link);
    const { paths } = placeOf(link);
    expect(paths).toContain(`${link}/`);
    expect(paths).toContain(`${realpathSync(real)}/`);
  });
  test("a linked worktree reports the main root too", () => {
    const main = repoWith({});
    git(main, "commit", "-q", "--allow-empty", "-m", "init");
    const wt = join(mkdtempSync(join(tmpdir(), "acs-wt-")), "fix");
    git(main, "worktree", "add", "-q", wt);
    expect(placeOf(wt).paths).toContain(`${realpathSync(main)}/`);
  });
  test("outside git: cwd only, no remotes", () => {
    const dir = mkdtempSync(join(tmpdir(), "acs-plain-"));
    mkdirSync(join(dir, "docs"));
    const place = placeOf(join(dir, "docs"));
    expect(place.remotes).toEqual([]);
    expect(place.paths).toContain(`${join(dir, "docs")}/`);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test plugins/ml-agent-config/src/place.spec.ts`
Expected: FAIL, "Cannot find module './place'".

- [ ] **Step 3: Implement `place.ts`; rename `normaliseOrigin` → exported `normaliseRemote` in `repo.ts`**

`placeOf` calls `repoContext(cwd)`; paths = `[checkout, root, cwd]` filtered non-null, each expanded to `[p, realpathSync(p)]`, deduped, `/` appended. Remotes = `remoteUrls(checkout)` plus `remoteUrls` of each superproject, normalised, deduped. Outside git: `paths` from cwd only.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test plugins/ml-agent-config/src/place.spec.ts plugins/ml-agent-config/src/adopt.spec.ts`
Expected: PASS; adopt suite still green.

- [ ] **Step 5: Commit**

```bash
git add plugins/ml-agent-config/src/place.ts plugins/ml-agent-config/src/place.spec.ts plugins/ml-agent-config/src/repo.ts
git commit -m "feat(ml-agent-config): the current place — roots, cwd and every remote, normalised"
```

---

### Task 3: Context definitions, matching, ordering

**Files:**
- Create: `plugins/ml-agent-config/src/contexts.ts`
- Modify: `plugins/ml-agent-config/src/types.ts:15-28` — add Problem codes `"context-unparsable" | "untrusted-layer-key" | "sibling-contexts" | "context-stray-path" | "context-stray-dir" | "cachevar-shared"`.
- Test: `plugins/ml-agent-config/src/contexts.spec.ts`

**Interfaces:**
- Consumes: `compileGlob` (Task 1), `Place` (Task 2), `ConfigError` from `layers.ts`.
- Produces:
  ```ts
  export const CONTEXTS_DIR = ".agents/contexts";
  export interface MatchEntry { remote?: string; path?: string; ignoreCase?: boolean }   // from "remote/i" / "path/i"
  export interface ContextDef {
    name: string; id: string | null; parent: string | null; dir: string;
    team: MatchEntry[]; me: MatchEntry[];       // from context.json / context.me.json
    abstract: boolean;                          // no entries in either file
  }
  export interface ContextStore { defs: Map<string, ContextDef>; order: string[]; problems: Problem[] }
  export function readContexts(home?: string): ContextStore;    // skips unparsable files with a `context-unparsable` problem; `context-stray-path` for a `path` in context.json (ignored)
  export interface MatchedContext { name: string; via: "remote" | "path" | "parent" | "explicit"; entry?: MatchEntry }
  export function resolveChain(store: ContextStore, place: Place, opts: { explicit?: string; none?: boolean }): MatchedContext[];
  ```
  `resolveChain`: roots ordered by `order` then alphabetical; parent before child; each once at first position; `explicit` appended last with its chain (`ConfigError` if unknown); `none` → `[]`. Unknown `parent`, cycle, unknown name in `order` → `ConfigError`. A context in `problems` as unparsable throws only when named by a parent, `order`, or `explicit`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readContexts, resolveChain } from "./contexts";
import type { Place } from "./place";

function home() {
  const h = mkdtempSync(join(tmpdir(), "acs-ctx-"));
  const put = (name: string, team: object | string, me?: object) => {
    const dir = join(h, ".agents", "contexts", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "context.json"), typeof team === "string" ? team : JSON.stringify(team));
    if (me) writeFileSync(join(dir, "context.me.json"), JSON.stringify(me));
  };
  return { h, put };
}
const place = (over: Partial<Place>): Place => ({ cwd: "/x", paths: ["/x/"], remotes: [], ...over });

describe("contexts", () => {
  test("remote match, parent forced first, child is innermost", () => {
    const { h, put } = home();
    put("acme", { match: [{ remote: "github.com/acme/**" }] });
    put("acme-web", { parent: "acme", match: [{ remote: "github.com/acme/web-*" }] });
    const chain = resolveChain(readContexts(h), place({ remotes: ["github.com/acme/web-app"] }), {});
    expect(chain.map(c => c.name)).toEqual(["acme", "acme-web"]);
  });
  test("a child matching alone still pulls its parent in, via parent", () => {
    const { h, put } = home();
    put("acme", { match: [{ remote: "gitlab.example.com/acme/**" }] });
    put("acme-web", { parent: "acme" }, { match: [{ path: "~/git/web/" }] });
    const chain = resolveChain(readContexts(h), place({ paths: [`${h}/git/web/`] }), {});
    expect(chain.map(c => [c.name, c.via])).toEqual([["acme", "parent"], ["acme-web", "path"]]);
  });
  test("an abstract context never matches but can be named", () => {
    const { h, put } = home();
    put("neo", {});
    expect(resolveChain(readContexts(h), place({}), {})).toEqual([]);
    expect(resolveChain(readContexts(h), place({}), { explicit: "neo" }).map(c => c.name)).toEqual(["neo"]);
  });
  test("a path in the team file is ignored and reported", () => {
    const { h, put } = home();
    put("acme", { match: [{ path: "/x/" }] });
    const store = readContexts(h);
    expect(store.problems.map(p => p.code)).toContain("context-stray-path");
    expect(resolveChain(store, place({}), {})).toEqual([]);
  });
  test("unknown parent and a cycle are config errors", () => {
    const { h, put } = home();
    put("a", { parent: "b", match: [{ remote: "x/**" }] });
    expect(() => resolveChain(readContexts(h), place({ remotes: ["x/y"] }), {})).toThrow(/parent "b"/);
    put("b", { parent: "a" });
    expect(() => resolveChain(readContexts(h), place({ remotes: ["x/y"] }), {})).toThrow(/cycle/);
  });
  test("an unparsable context is skipped unless something names it", () => {
    const { h, put } = home();
    put("broken", "{ not json");
    put("ok", { match: [{ remote: "x/**" }] });
    const store = readContexts(h);
    expect(store.problems.map(p => p.code)).toContain("context-unparsable");
    expect(resolveChain(store, place({ remotes: ["x/y"] }), {}).map(c => c.name)).toEqual(["ok"]);
    expect(() => resolveChain(store, place({}), { explicit: "broken" })).toThrow(/broken/);
  });
  test("order.json orders roots; an unknown name there is an error", () => {
    const { h, put } = home();
    put("zed", { match: [{ remote: "x/**" }] });
    put("alpha", { match: [{ remote: "x/**" }] });
    writeFileSync(join(h, ".agents", "contexts", "order.json"), JSON.stringify(["zed", "alpha"]));
    expect(resolveChain(readContexts(h), place({ remotes: ["x/y"] }), {}).map(c => c.name)).toEqual(["zed", "alpha"]);
    writeFileSync(join(h, ".agents", "contexts", "order.json"), JSON.stringify(["nope"]));
    expect(() => resolveChain(readContexts(h), place({ remotes: ["x/y"] }), {})).toThrow(/nope/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test plugins/ml-agent-config/src/contexts.spec.ts`
Expected: FAIL, "Cannot find module './contexts'".

- [ ] **Step 3: Implement `contexts.ts` and extend `Problem["code"]`**

`readContexts` lists `~/.agents/contexts/*/` having `context.json`; a directory without one is not a context and is reported as `context-stray-dir`. Parse `match` entries: keys `remote`, `remote/i`, `path`, `path/i`. In `resolveChain`, a context matches when any entry matches (`remote` against `place.remotes`, `path` against `place.paths`); build roots-first order, then DFS parents before children; dedupe.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test plugins/ml-agent-config/src/contexts.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add plugins/ml-agent-config/src/contexts.ts plugins/ml-agent-config/src/contexts.spec.ts plugins/ml-agent-config/src/types.ts
git commit -m "feat(ml-agent-config): context definitions, matching and ordering"
```

---

### Task 4: Context layers in the merge, atomic writes

**Files:**
- Modify: `plugins/ml-agent-config/src/layers.ts` (whole file: `Layer`, `layerPath`, `journalPath`, `layerFiles`, `loadLayers`, `readLayer`, `writeLayer`)
- Modify: `plugins/ml-agent-config/src/repo.ts:181-182` (`writeFileSync` → atomic)
- Test: `plugins/ml-agent-config/src/layers.spec.ts` (extend)

**Interfaces:**
- Consumes: `MatchedContext[]` (Task 3).
- Produces:
  ```ts
  export type ContextLayer = `context:${string}` | `context:${string}:me`;
  export type Layer = "global" | ContextLayer | "repo" | "user-repo" | "local";
  export function contextLayers(chain: MatchedContext[]): ContextLayer[];   // ["context:acme","context:acme:me","context:acme-web","context:acme-web:me"]
  export function parseLayer(value: string): Layer;                         // ConfigError on an unknown layer
  export function layerOrder(chain: MatchedContext[]): Layer[];             // global, …contexts…, repo, user-repo, local
  export function layerPath(name: string, layer: Layer, repo: RepoContext, home?: string): string | null;  // context:<c>[:me] → ~/.agents/contexts/<c>/<name>/config[.me].json
  export function layerFiles(name: string, repo: RepoContext, chain: MatchedContext[]): LayerFile[];
  export function loadLayers(name: string, repo: RepoContext, chain: MatchedContext[]): LoadedLayers;
  export function readLayer(name: string, layer: Layer, repo: RepoContext): ConfigObject | null;
  export function writeLayer(name: string, layer: Layer, config: ConfigObject, schema: {...}, repo: RepoContext): WriteResult;
  export function writeFileAtomic(path: string, text: string): void;       // temp sibling + renameSync
  ```
  `LAYERS` stays as the four fixed names for callers that list them; `layerOrder` is what the merge uses. Journal for a context layer: `~/.agents/journal/<name>/context/<c>/journal.json` and `…/me-journal.json`.

- [ ] **Step 1: Write the failing tests** (append to `layers.spec.ts`)

```ts
import { contextLayers, layerOrder, layerPath, parseLayer, writeFileAtomic } from "./layers";

describe("context layers", () => {
  const chain = [{ name: "acme", via: "remote" as const }, { name: "acme-web", via: "parent" as const }];
  test("team then me, outer then inner, between global and repo", () => {
    expect(layerOrder(chain)).toEqual(["global", "context:acme", "context:acme:me", "context:acme-web", "context:acme-web:me", "repo", "user-repo", "local"]);
  });
  test("paths sit under ~/.agents/contexts/<ctx>/<component>/", () => {
    const repo = { checkout: null, root: null, identity: null, identitySource: null, registered: false, alias: null };
    expect(layerPath("atlassian", "context:acme", repo, "/h")).toBe("/h/.agents/contexts/acme/atlassian/config.json");
    expect(layerPath("atlassian", "context:acme:me", repo, "/h")).toBe("/h/.agents/contexts/acme/atlassian/config.me.json");
  });
  test("parseLayer accepts the fixed four and context:<name>[:me], nothing else", () => {
    expect(parseLayer("context:acme:me")).toBe("context:acme:me");
    expect(() => parseLayer("context:")).toThrow();
    expect(() => parseLayer("team")).toThrow();
  });
  test("an atomic write leaves no temp file behind", () => {
    const dir = mkdtempSync(join(tmpdir(), "acs-atomic-"));
    writeFileAtomic(join(dir, "a.json"), "{}\n");
    expect(readdirSync(dir)).toEqual(["a.json"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test plugins/ml-agent-config/src/layers.spec.ts`
Expected: FAIL on the new exports.

- [ ] **Step 3: Implement in `layers.ts`; switch `writeFileSync` of config, snapshot and journal to `writeFileAtomic`; same in `repo.ts` for `repos.json`**

`loadLayers` iterates `layerFiles(name, repo, chain)`, which builds one `LayerFile` per entry of `layerOrder(chain)`. Context layer paths need no repo. `writeLayer` for a context layer: no gitignore step, journal under the context path above.

- [ ] **Step 4: Run the whole suite**

Run: `bun test plugins/ml-agent-config/src`
Expected: PASS; existing callers of `loadLayers`/`layerFiles` will not compile until Task 5 — pass `[]` for `chain` at each call site in `cli.ts` in this task to keep the build green.

- [ ] **Step 5: Commit**

```bash
git add plugins/ml-agent-config/src/layers.ts plugins/ml-agent-config/src/layers.spec.ts plugins/ml-agent-config/src/repo.ts plugins/ml-agent-config/src/cli.ts
git commit -m "feat(ml-agent-config): context layers in the merge; atomic file writes"
```

---

### Task 5: CLI — resolve the chain, `--cwd`, `--context`, `--no-context`, `context list|explain`

**Files:**
- Modify: `plugins/ml-agent-config/src/cli.ts` (`parseArgs`, `resolve`, `USAGE`, new `context` command, `requireLayer` → `parseLayer`)
- Modify: `plugins/ml-agent-config/src/types.ts` — `StartOutput`, `LoadOutput`, `DescribeOutput`, `PathOutput` gain `contexts: MatchedContext[]`; add `ContextListOutput`.
- Test: `plugins/ml-agent-config/src/context-cli.spec.ts`

**Interfaces:**
- Consumes: `readContexts`, `resolveChain` (Task 3), `placeOf` (Task 2), `layerOrder` (Task 4).
- Produces: `agent-config context list` → `{ acs, contexts: [{ name, id, parent, abstract, team: MatchEntry[], me: MatchEntry[], matched: boolean }], problems }`; `agent-config context explain [--cwd d] [--context n] [--no-context]` → `{ acs, place: Place, chain: MatchedContext[], layers: Layer[] }`. Every command that reads config takes `--cwd <dir>` (default `process.cwd()`), `--context <name>`, `--no-context`. `start`/`load`/`describe`/`path` outputs carry `contexts`.

- [ ] **Step 1: Write the failing tests** (sandbox pattern from `adopt.spec.ts`: a `demo` component with one key `site` of `layer: "context"`, a HOME with contexts `acme` (remote `github.com/acme/**`) and a repo under HOME with that remote)

```ts
test("load merges the matched context between global and repo", () => {
  put("global", { site: "mine" }); putContext("acme", "demo", { site: "theirs" });
  const r = run("load", "demo", "--cwd", repoDir);
  expect(r.json.config.site).toBe("theirs");
  expect(r.json.provenance.site).toBe("context:acme");
  expect(r.json.contexts.map((c: any) => c.name)).toEqual(["acme"]);
});
test("--no-context drops it, --context names an abstract one", () => {
  expect(run("load", "demo", "--cwd", repoDir, "--no-context").json.config.site).toBe("mine");
  putContextDef("neo", {}); putContext("neo", "demo", { site: "neo" });
  expect(run("load", "demo", "--cwd", repoDir, "--context", "neo").json.provenance.site).toBe("context:neo");
});
test("context explain names what matched and why", () => {
  const r = run("context", "explain", "--cwd", repoDir);
  expect(r.json.chain[0]).toMatchObject({ name: "acme", via: "remote" });
  expect(r.json.layers).toContain("context:acme:me");
});
test("--context with an unknown name exits 2", () => {
  expect(run("load", "demo", "--context", "nope").code).toBe(2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test plugins/ml-agent-config/src/context-cli.spec.ts`
Expected: FAIL, unknown flag `--cwd`.

- [ ] **Step 3: Implement**

`resolve(name, parsed)` now: `repo = repoContext(cwd)`, `place = placeOf(cwd)`, `store = readContexts()`, `chain = resolveChain(store, place, { explicit, none })`, `loaded = loadLayers(name, repo, chain)`; store problems flow into the output's `problems`. `requireLayer` → `parseLayer`. Add `context` command with `list` and `explain`.

- [ ] **Step 4: Run the suite**

Run: `bun test plugins/ml-agent-config/src`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/ml-agent-config/src/cli.ts plugins/ml-agent-config/src/types.ts plugins/ml-agent-config/src/context-cli.spec.ts
git commit -m "feat(ml-agent-config): contexts in start/load/describe/path; context list and explain"
```

---

### Task 6: `context add`, writing context layers, `sibling-contexts`

**Files:**
- Modify: `plugins/ml-agent-config/src/contexts.ts` — add `addContext(opts: { name; parent?; remote?: string[]; path?: string[]; home? }): { dir: string; id: string; team: string; me: string | null }` (mints `id` = `ctx_` + 12 hex, writes both files atomically, `ConfigError` if the name exists or `parent` is unknown).
- Modify: `plugins/ml-agent-config/src/cli.ts` — `context add <name> [--parent p] [--remote glob]… [--path glob]…`; `write --layer context:<name>[:me]`.
- Modify: `plugins/ml-agent-config/src/effective.ts` — after merge, when two matched contexts with no ancestor relation both set a declared key, push `sibling-contexts` problem naming both and the key.
- Test: extend `context-cli.spec.ts`.

**Interfaces:**
- Consumes: `writeLayer` with a context layer (Task 4).
- Produces: `context add` output `{ acs, name, id, dir, team, me }`.

- [ ] **Step 1: Write the failing tests**

```ts
test("context add writes remote to the team file and path to the me file, minting an id", () => {
  const r = run("context", "add", "beta", "--remote", "github.com/beta/**", "--path", "~/git/beta/");
  expect(r.code).toBe(0);
  const team = JSON.parse(readFileSync(join(home, ".agents/contexts/beta/context.json"), "utf8"));
  const me = JSON.parse(readFileSync(join(home, ".agents/contexts/beta/context.me.json"), "utf8"));
  expect(team.match).toEqual([{ remote: "github.com/beta/**" }]);
  expect(team.id).toMatch(/^ctx_[0-9a-f]{12}$/);
  expect(me.match).toEqual([{ path: "~/git/beta/" }]);
});
test("write --layer context:acme:me lands in the me file and shows in describe levels", () => {
  const r = runWithStdin("write", "demo", "--layer", "context:acme:me", JSON.stringify({ site: "me" }));
  expect(r.code).toBe(0);
  const d = run("describe", "demo", "--cwd", repoDir).json;
  expect(d.keys.find((k: any) => k.path === "site").levels["context:acme:me"]).toBe("me");
});
test("two unrelated matched contexts setting one key are reported", () => {
  putContextDef("other", { match: [{ remote: "github.com/acme/**" }] }); putContext("other", "demo", { site: "x" });
  const r = run("load", "demo", "--cwd", repoDir);
  expect(r.json.problems.map((p: any) => p.code)).toContain("sibling-contexts");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test plugins/ml-agent-config/src/context-cli.spec.ts`
Expected: FAIL, unknown `context` subcommand `add`.

- [ ] **Step 3: Implement**

For `sibling-contexts`, `effectiveConfig` needs the per-layer own values: pass `loaded.files` plus a reader, or compute in `cli.ts` from `readLayer` per context layer and push into `problems` — the builder picks; the problem's `keys` lists the key and `message` names both contexts.

- [ ] **Step 4: Run the suite**

Run: `bun test plugins/ml-agent-config/src`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/ml-agent-config/src
git commit -m "feat(ml-agent-config): context add, writes into context layers, sibling-contexts report"
```

---

### Task 7: Trust — credential references only from layers the user wrote here

**Files:**
- Modify: `plugins/ml-agent-config/src/layers.ts` — `LayerFile` gains `trusted: boolean`; compute per layer: `global`, `user-repo`, `context:*:me` → true; `local` → `git ls-files --error-unmatch <file>` fails (untracked) or `git check-ignore -q <file>` succeeds; `repo`, `context:<c>` (team) → false.
- Modify: `plugins/ml-agent-config/src/layers.ts` `loadLayers` — before merging an untrusted file, strip its `credentials` subtree and record `{ layer, path, keys }` in a new `LoadedLayers.untrusted: { layer: Layer; path: string; keys: string[] }[]`.
- Modify: `plugins/ml-agent-config/src/cli.ts` — `start`/`load`/`describe` push one `untrusted-layer-key` problem per entry.
- Test: `plugins/ml-agent-config/src/trust.spec.ts`

**Interfaces:**
- Produces: `LayerFile.trusted`, `LoadedLayers.untrusted`.

- [ ] **Step 1: Write the failing tests** (sandbox with a git repo; component `demo` declaring `credentials.token`)

```ts
test("a credential reference in the repo layer is ignored and reported", () => {
  putRepoLayer({ credentials: { token: { source: "command", command: "echo pwned" } } });
  const r = run("load", "demo", "--cwd", repoDir, "--secrets", "token");
  expect(r.code).toBe(2);                                  // nothing configured it
  expect(run("start", "demo", "--cwd", repoDir).json.problems.map((p: any) => p.code)).toContain("untrusted-layer-key");
});
test("a tracked config.local.json is treated as the repo layer", () => {
  putLocalLayer({ credentials: { token: { source: "command", command: "echo pwned" } } });
  git(repoDir, "add", "-f", ".agents/config/demo/config.local.json");
  expect(run("start", "demo", "--cwd", repoDir).json.problems.map((p: any) => p.code)).toContain("untrusted-layer-key");
});
test("an untracked config.local.json and a context me file are trusted", () => {
  putLocalLayer({ credentials: { token: { source: "env", var: "T" } } });
  expect(run("start", "demo", "--cwd", repoDir).json.problems).toEqual([]);
  putContext("acme", "demo", { credentials: { token: { source: "env", var: "T" } } }, "me");
  expect(run("load", "demo", "--cwd", repoDir).json.provenance["credentials.token"]).toBe("context:acme:me");
});
test("a credential reference in a context team file is ignored", () => {
  putContext("acme", "demo", { credentials: { token: { source: "env", var: "T" } } });
  expect(run("start", "demo", "--cwd", repoDir).json.problems.map((p: any) => p.code)).toContain("untrusted-layer-key");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test plugins/ml-agent-config/src/trust.spec.ts`
Expected: FAIL, the repo-layer reference is honoured today.

- [ ] **Step 3: Implement trust**

- [ ] **Step 4: Write the failing `cacheVar` collision test** (append to `trust.spec.ts`)

```ts
test("a cacheVar named by two references in the chain is skipped, and the source answers", () => {
  putGlobal({ credentials: { token: { source: "env", var: "A", cacheVar: "TOK" } } });
  putContext("acme", "demo", { credentials: { token: { source: "env", var: "B", cacheVar: "TOK" } } }, "me");
  const r = run("load", "demo", "--cwd", repoDir, "--secrets", "token", { env: { TOK: "stale", A: "a", B: "b" } });
  expect(r.fd3.token).toBe("b");
  expect(r.json.problems.map((p: any) => p.code)).toContain("cachevar-shared");
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `bun test plugins/ml-agent-config/src/trust.spec.ts`
Expected: FAIL, `fd3.token` is `"stale"`.

- [ ] **Step 6: Implement: in `load`, collect every `credentials.*` reference from each trusted layer's own file (`readLayer`), group by `cacheVar`; a variable named by two references with different `cacheKey` is passed to `resolveCredential` with `cacheVar` removed, and one `cachevar-shared` problem names both layers**

- [ ] **Step 7: Run the suite**

Run: `bun test plugins/ml-agent-config/src`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add plugins/ml-agent-config/src/layers.ts plugins/ml-agent-config/src/cli.ts plugins/ml-agent-config/src/trust.spec.ts
git commit -m "feat(ml-agent-config): honour credential references only from trusted layers; skip a shared cacheVar"
```

---

### Task 8: Onboarding into a context (`layer: "context"`, `context-add` action)

**Files:**
- Modify: `plugins/ml-agent-config/src/declaration.ts:27-32` — `KeyEntry.layer?: Layer | "context"`; `personal?: boolean`.
- Modify: `plugins/ml-agent-config/src/actions.ts` — `PlanInput` gains `chain: MatchedContext[]` and `place: Place`; in `buildPlan`, for a gap whose keys all recommend `context`: if `chain.length > 0`, the emitted onboard action's `context.layer` = innermost context's team or me layer (`me` when any key is `personal` or a credential); else emit builtin `agent-config:context-add` first (new `actions/context-add.md`, `type: prompt`), with `context: { suggestedName, remote: "<host>/<org>/**", path: "<checkout root or cwd>/", alternative: "global" }`, and the onboard action `requires` it.
- Modify: `plugins/ml-agent-config/src/cli.ts` `write` — for a context **team** layer, refuse (ConfigError) any `credentials.*` and any key declared `personal: true`.
- Create: `plugins/ml-agent-config/actions/context-add.md` (frontmatter `id: agent-config:context-add`, `type: prompt`, `parallel: false`; body: show the pre-filled filters, ask for a name or "global instead", then run `agent-config context add …` or write to global).
- Test: extend `context-cli.spec.ts`.

**Interfaces:**
- Consumes: `resolveChain`, `placeOf`.
- Produces: `EmittedAction.context.layer` on onboard actions for context-recommended keys.

- [ ] **Step 1: Write the failing tests**

```ts
test("a context-recommended key onboards into the innermost matched context", () => {
  const r = run("start", "demo", "--cwd", repoDir).json;            // site unset, acme matches
  const onboard = r.actions.find((a: any) => a.id === "onboard");
  expect(onboard.context.layer).toBe("context:acme");
});
test("with no matched context, start plans context-add first, pre-filled from the place", () => {
  const r = run("start", "demo", "--cwd", otherRepoDir).json;       // remote github.com/beta/app, no context
  const add = r.actions.find((a: any) => a.id === "agent-config:context-add");
  expect(add.context.remote).toBe("github.com/beta/**");
  expect(r.actions.find((a: any) => a.id === "onboard").requires).toContain("agent-config:context-add");
});
test("write refuses a credential or a personal key in a context team file", () => {
  expect(runWithStdin("write", "demo", "--layer", "context:acme", JSON.stringify({ credentials: { token: { source: "env", var: "T" } } })).code).toBe(2);
  expect(runWithStdin("write", "demo", "--layer", "context:acme", JSON.stringify({ email: "x@acme.example" })).code).toBe(2);   // email declared personal: true
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test plugins/ml-agent-config/src/context-cli.spec.ts`
Expected: FAIL (`context.layer` undefined; no `context-add` action).

- [ ] **Step 3: Implement**

Widening rule for `remote`: first two segments of the normalised remote (`host/org`) + `/**`. `suggestedName` = the org segment.

- [ ] **Step 4: Run the suite**

Run: `bun test plugins/ml-agent-config/src`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/ml-agent-config/src plugins/ml-agent-config/actions/context-add.md
git commit -m "feat(ml-agent-config): onboard into a context; plan context-add when none matches"
```

---

### Task 9: The pane shows context levels

**Files:**
- Modify: `plugins/ml-agent-config/claude-code/ui/levels.ts` — `LEVELS` becomes a function `levelInfo(layer: string)`; for `context:<c>` → label `Project ${c}, shared`, hint `~/.agents/contexts/${c}, synced to the team`, offer `For the team in ${c}`; for `context:<c>:me` → `Project ${c}, just me`. `ORDER` is replaced by the `layers` list `describe` returns (already in order). `levelStack`, `under`, `over` take that list.
- Modify: `plugins/ml-agent-config/claude-code/screens/saveto.tsx`, `levels.tsx`, `edit.tsx`, `show.tsx`, `files.tsx`, `settings.tsx` — wherever `LEVELS[x]`/`ORDER` is read, use `levelInfo` and the describe order. A credential or `personal` key offers no team context level.
- Test: `plugins/ml-agent-config/claude-code/ui/levels.test.ts`

**Interfaces:**
- Consumes: `DescribeOutput.layers[].layer` strings (Task 5).

- [ ] **Step 1: Write the failing tests**

```ts
import { expect, test } from "bun:test";
import { levelInfo, levelStack } from "./levels";

test("context levels are labelled by context and audience", () => {
  expect(levelInfo("context:acme").label).toBe("Project acme, shared");
  expect(levelInfo("context:acme:me").label).toBe("Project acme, just me");
});
test("the stack follows describe's order, top first", () => {
  const layers = ["global", "context:acme", "context:acme:me", "repo", "user-repo", "local"];
  const setting = { levels: { global: 1, "context:acme:me": 2 }, source: "context:acme:me" } as any;
  expect(levelStack(setting, layers).map(r => r.layer)).toEqual([...layers].reverse());
  expect(levelStack(setting, layers).find(r => r.isWinner)!.layer).toBe("context:acme:me");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test plugins/ml-agent-config/claude-code/ui/levels.test.ts`
Expected: FAIL, `levelInfo` not exported.

- [ ] **Step 3: Implement; load the pane in a session and open a component that has a matched context**

- [ ] **Step 4: Run the suite and the pane check**

Run: `bun test plugins/ml-agent-config/claude-code/ui plugins/ml-agent-config/src`
Expected: PASS. Manual: `/agent-config` in a repo under a matched context shows the two context levels in *Save to…*.

- [ ] **Step 5: Commit**

```bash
git add plugins/ml-agent-config/claude-code
git commit -m "feat(ml-agent-config): the pane shows and saves to context levels"
```

---

### Task 10: Standard text, working-actions, skill docs

**Files:**
- Modify: `standards/agent-config.md` — layer table gains the context rows; new section *Contexts* (definition files, team/me split, matching rules, order, `--context`/`--no-context`, abstract contexts, the worked `acme` example); *Trust* paragraph under *Credential references*; checklist items: "Works with only the global layer", "A credential reference is written only to a trusted layer", "A `path` filter is never in the team file". Version line stays "v2" until plan 2 lands ids; mark the contexts section "since 2.1".
- Modify: `plugins/ml-agent-config/docs/working-actions.md` — `start` output's `contexts`, the `context-add` action, `--cwd` for subagents, the `untrusted-layer-key` and `context-*` problems.
- Modify: `plugins/ml-agent-config/skills/setup/SKILL.md` — when a key recommends `context`, how to offer "this context / a new one / global".
- Modify: `plugins/ml-agent-config/README.md` — layer table and a *Contexts* paragraph.

- [ ] **Step 1: Write the sections** (no code; the glob and ordering rules copied from Global Constraints verbatim)

- [ ] **Step 2: Check every CLI flag and problem code named in the docs exists**

Run: `grep -o -E -- '--(cwd|context|no-context)|context (list|explain|add)|untrusted-layer-key|context-(unparsable|stray-path)|sibling-contexts' standards/agent-config.md plugins/ml-agent-config/docs/working-actions.md | sort -u` and compare with `grep -o -E` of the same over `plugins/ml-agent-config/src/cli.ts plugins/ml-agent-config/src/types.ts`.
Expected: identical sets.

- [ ] **Step 3: Commit**

```bash
git add standards/agent-config.md plugins/ml-agent-config/docs/working-actions.md plugins/ml-agent-config/skills/setup/SKILL.md plugins/ml-agent-config/README.md
git commit -m "docs(agent-config): contexts — layer table, matching rules, trust, worked example"
```

---

### Task 11: End-to-end check on a real layout

- [ ] **Step 1: In a scratch HOME, create `acme` (remote `github.com/acme/**`, path `~/git/acme/`) and `acme-web` (parent `acme`), clone any public repo under `~/git/acme/`, set its `origin` to `https://github.com/acme/web-app`, write a `demo` value per layer, and run `context explain`, `load`, `describe`, `write --layer context:acme:me`.**

Run: the commands above with `HOME=<scratch>`.
Expected: `explain` lists `acme` via remote and `acme-web` not matched; `load` provenance per layer as written; `describe.layers` lists eight entries with `exists` true where written.

- [ ] **Step 2: Run the full plugin suite one last time**

Run: `bun test plugins/ml-agent-config`
Expected: all pass except the pre-existing `claude-code/register.test.ts` module error, unchanged from `main`.

- [ ] **Step 3: Open the PR** with `docs/superpowers/specs/2026-10-20-agent-config-v3-contexts-design.md` linked and "plan 1 of 4" in the title.
