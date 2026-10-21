// Contexts through the CLI: the chain resolved for a place, merged between global and repo,
// overridden with --context / --no-context, explained by `context explain`, created by
// `context add`, written with `write --layer context:…`, and unrelated ones setting one key reported.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const BIN = join(import.meta.dir, "..", "bin", "agent-config");

/**
 * A home with a `demo` component declared in a folder of its own, a context `acme` matching the
 * remotes under `github.com/acme/`, a repository under the home with such a remote, and another
 * whose remote no context matches.
 */
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "acs-context-cli-"));
  const home = join(root, "home");
  const component = join(root, "demo");
  mkdirSync(join(component, "actions"), { recursive: true });
  writeFileSync(
    join(component, "agent-config.json"),
    JSON.stringify({
      version: 2,
      name: "demo",
      schema: {
        version: 1,
        keys: {
          site: { description: "The site", layer: "context" },
          personalise: { description: "Whether to ask for your own details", default: false },
        },
        groups: [
          {
            when: "personalise",
            action: "personal",
            keys: {
              email: { description: "Your address", layer: "context", personal: true },
              "credentials.token": { description: "Your token", layer: "context" },
            },
          },
        ],
      },
    }),
  );
  writeFileSync(join(component, "actions", "onboard.md"), "---\nid: onboard\ntype: prompt\n---\n\nAsk.\n");
  writeFileSync(join(component, "actions", "personal.md"), "---\nid: personal\ntype: prompt\n---\n\nAsk.\n");

  const writeJson = (path: string, value: object) => {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, JSON.stringify(value));
  };
  const put = (layer: "global", config: object) => writeJson(join(home, ".agents", "config", "demo", "config.json"), config);
  const contextDir = (name: string) => join(home, ".agents", "contexts", name);
  const putContextDef = (name: string, def: object) => writeJson(join(contextDir(name), "context.json"), def);
  const putContext = (name: string, component: string, config: object, which?: "me") =>
    writeJson(join(contextDir(name), component, which === "me" ? "config.me.json" : "config.json"), config);

  const repoDir = join(home, "src", "web-app");
  mkdirSync(repoDir, { recursive: true });
  spawnSync("git", ["init", "-q"], { cwd: repoDir });
  spawnSync("git", ["remote", "add", "origin", "https://github.com/acme/web-app"], { cwd: repoDir });
  putContextDef("acme", { match: [{ remote: "github.com/acme/**" }] });

  const otherRepoDir = join(home, "src", "app");
  mkdirSync(otherRepoDir, { recursive: true });
  spawnSync("git", ["init", "-q"], { cwd: otherRepoDir });
  spawnSync("git", ["remote", "add", "origin", "https://github.com/beta/app"], { cwd: otherRepoDir });

  const spawn = (args: string[], stdin?: string) => {
    const result = Bun.spawnSync([BIN, ...args, "--from", component], {
      env: { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude"), CLAUDECODE: "1" },
      cwd: home,
      stdin: stdin === undefined ? undefined : Buffer.from(stdin),
    });
    return { code: result.exitCode, json: JSON.parse(result.stdout.toString() || "null"), stderr: result.stderr.toString() };
  };
  const run = (...args: string[]) => spawn(args);
  /** `run`, with the last argument fed to the CLI on stdin. */
  const runWithStdin = (...args: string[]) => spawn(args.slice(0, -1), args[args.length - 1]);
  return { run, runWithStdin, put, putContextDef, putContext, repoDir, otherRepoDir, home };
}

describe("contexts through the CLI", () => {
  test("load merges the matched context between global and repo", () => {
    const { run, put, putContext, repoDir } = sandbox();
    put("global", { site: "mine" }); putContext("acme", "demo", { site: "theirs" });
    const r = run("load", "demo", "--cwd", repoDir);
    expect(r.json.config.site).toBe("theirs");
    expect(r.json.provenance.site).toBe("context:acme");
    expect(r.json.contexts.map((c: any) => c.name)).toEqual(["acme"]);
  });

  test("--no-context drops it, --context names an abstract one", () => {
    const { run, put, putContext, putContextDef, repoDir } = sandbox();
    put("global", { site: "mine" }); putContext("acme", "demo", { site: "theirs" });
    expect(run("load", "demo", "--cwd", repoDir, "--no-context").json.config.site).toBe("mine");
    putContextDef("neo", {}); putContext("neo", "demo", { site: "neo" });
    expect(run("load", "demo", "--cwd", repoDir, "--context", "neo").json.provenance.site).toBe("context:neo");
  });

  test("--context naming a matched sibling moves it to the end, as the innermost and the write target", () => {
    const { run, putContextDef, putContext, repoDir, home } = sandbox();
    putContextDef("other", { match: [{ remote: "github.com/acme/**" }] });
    writeFileSync(join(home, ".agents", "contexts", "order.json"), JSON.stringify(["other", "acme"]));
    putContext("other", "demo", { site: "other" }); putContext("acme", "demo", { site: "acme" });
    expect(run("load", "demo", "--cwd", repoDir).json.contexts.map((c: any) => c.name)).toEqual(["other", "acme"]);
    const r = run("load", "demo", "--cwd", repoDir, "--context", "other");
    expect(r.json.contexts.map((c: any) => c.name)).toEqual(["acme", "other"]);
    expect(r.json.provenance.site).toBe("context:other");
    putContext("other", "demo", {}); putContext("acme", "demo", {});
    const onboard = run("start", "demo", "--cwd", repoDir, "--context", "other").json.actions.find((a: any) => a.id === "onboard");
    expect(onboard.context.layer).toBe("context:other");
  });

  test("context explain names what matched and why", () => {
    const { run, repoDir } = sandbox();
    const r = run("context", "explain", "--cwd", repoDir);
    expect(r.json.chain[0]).toMatchObject({ name: "acme", via: "remote" });
    expect(r.json.layers).toContain("context:acme:me");
  });

  test("--context with an unknown name exits 2", () => {
    const { run } = sandbox();
    const r = run("load", "demo", "--context", "nope");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('"nope"');
  });

  test("--cwd that is not a directory exits 2 instead of resolving an empty place", () => {
    const { run, put, home } = sandbox();
    put("global", { site: "mine" });
    const r = run("load", "demo", "--cwd", join(home, "does", "not", "exist"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("is not a directory");
  });

  test("context add writes remote to the team file and path to the me file, minting an id", () => {
    const { run, home } = sandbox();
    const r = run("context", "add", "beta", "--remote", "github.com/beta/**", "--path", "~/git/beta/");
    expect(r.code).toBe(0);
    const team = JSON.parse(readFileSync(join(home, ".agents/contexts/beta/context.json"), "utf8"));
    const me = JSON.parse(readFileSync(join(home, ".agents/contexts/beta/context.me.json"), "utf8"));
    expect(team.match).toEqual([{ remote: "github.com/beta/**" }]);
    expect(team.id).toMatch(/^ctx_[0-9a-f]{12}$/);
    expect(me.match).toEqual([{ path: "~/git/beta/" }]);
  });

  test("context add refuses the reserved name order.json and a hidden name", () => {
    const { run, home } = sandbox();
    const reserved = run("context", "add", "order.json");
    expect(reserved.code).toBe(2);
    expect(reserved.stderr).toContain("reserved");
    expect(run("context", "add", ".hidden").code).toBe(2);
    expect(existsSync(join(home, ".agents/contexts/order.json"))).toBe(false);
    expect(run("context", "list").json.contexts.map((c: any) => c.name)).toEqual(["acme"]);
  });

  test("write --layer context:acme:me lands in the me file and shows in describe levels", () => {
    const { run, runWithStdin, repoDir } = sandbox();
    const r = runWithStdin("write", "demo", "--layer", "context:acme:me", JSON.stringify({ site: "me" }));
    expect(r.code).toBe(0);
    const d = run("describe", "demo", "--cwd", repoDir).json;
    expect(d.keys.find((k: any) => k.path === "site").levels["context:acme:me"]).toBe("me");
  });

  test("describe marks a key declared personal, so an editor offers it no team context level", () => {
    const { run, repoDir } = sandbox();
    const keys = run("describe", "demo", "--cwd", repoDir).json.keys;
    expect(keys.find((k: any) => k.path === "email").personal).toBe(true);
    expect(keys.find((k: any) => k.path === "site").personal).toBe(false);
  });

  test("two unrelated matched contexts setting one key are reported", () => {
    const { run, putContextDef, putContext, repoDir } = sandbox();
    putContextDef("other", { match: [{ remote: "github.com/acme/**" }] }); putContext("other", "demo", { site: "x" });
    putContext("acme", "demo", { site: "me" }, "me");
    const r = run("load", "demo", "--cwd", repoDir);
    expect(r.json.problems.map((p: any) => p.code)).toContain("sibling-contexts");
  });

  test("write --layer naming a context that does not exist exits 2", () => {
    const { runWithStdin } = sandbox();
    const r = runWithStdin("write", "demo", "--layer", "context:nope", JSON.stringify({ site: "x" }));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('"nope"');
  });

  test("a context-recommended key onboards into the innermost matched context", () => {
    const { run, repoDir } = sandbox();
    const r = run("start", "demo", "--cwd", repoDir).json; // site unset, acme matches
    const onboard = r.actions.find((a: any) => a.id === "onboard");
    expect(onboard.context.layer).toBe("context:acme");
  });

  test("a personal or credential key onboards into the innermost context's me file", () => {
    const { run, put, repoDir } = sandbox();
    put("global", { personalise: true });
    const r = run("start", "demo", "--cwd", repoDir).json;
    const personal = r.actions.find((a: any) => a.id === "personal");
    expect(personal.keys).toEqual(["email", "credentials.token"]);
    expect(personal.context.layer).toBe("context:acme:me");
  });

  test("with no matched context, start plans context-add first, pre-filled from the place", () => {
    const { run, put, otherRepoDir } = sandbox();
    put("global", { personalise: true }); // two gaps recommending context, still one context-add
    const r = run("start", "demo", "--cwd", otherRepoDir).json; // remote github.com/beta/app, no context
    const adds = r.actions.filter((a: any) => a.id === "agent-config:context-add");
    expect(adds).toHaveLength(1);
    expect(adds[0].context).toEqual({
      suggestedName: "beta",
      remote: "github.com/beta/**",
      path: `${realpathSync(otherRepoDir)}/`, // the checkout root, as git reports it
      alternative: "global",
    });
    expect(r.actions.find((a: any) => a.id === "onboard").requires).toContain("agent-config:context-add");
    expect(r.actions.find((a: any) => a.id === "personal").requires).toContain("agent-config:context-add");
  });

  test("start --no-context plans no context-add and onboards a context key into global", () => {
    const { run, repoDir } = sandbox();
    const r = run("start", "demo", "--cwd", repoDir, "--no-context").json; // acme would match
    expect(r.actions.map((a: any) => a.id)).not.toContain("agent-config:context-add");
    const onboard = r.actions.find((a: any) => a.id === "onboard");
    expect(onboard.context.layer).toBe("global");
    expect(onboard.requires).not.toContain("agent-config:context-add");
  });

  test("write refuses a credential or a personal key in a context team file", () => {
    const { runWithStdin } = sandbox();
    const credential = runWithStdin("write", "demo", "--layer", "context:acme", JSON.stringify({ credentials: { token: { source: "env", var: "T" } } }));
    expect(credential.code).toBe(2);
    expect(credential.stderr).toContain("credentials.token");
    expect(credential.stderr).toContain("context:acme:me");
    const personal = runWithStdin("write", "demo", "--layer", "context:acme", JSON.stringify({ email: "x@acme.example" })); // email declared personal: true
    expect(personal.code).toBe(2);
    expect(personal.stderr).toContain("email");
    expect(runWithStdin("write", "demo", "--layer", "context:acme:me", JSON.stringify({ email: "x@acme.example" })).code).toBe(0);
  });
});
