// Contexts through the CLI: the chain resolved for a place, merged between global and repo,
// overridden with --context / --no-context, and explained by `context explain`.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const BIN = join(import.meta.dir, "..", "bin", "agent-config");

/**
 * A home with a `demo` component declared in a folder of its own, a context `acme` matching the
 * remotes under `github.com/acme/`, and a repository under the home with such a remote.
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
      schema: { version: 1, keys: { site: { description: "The site", layer: "context" } } },
    }),
  );
  writeFileSync(join(component, "actions", "onboard.md"), "---\nid: onboard\ntype: prompt\n---\n\nAsk.\n");

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

  const run = (...args: string[]) => {
    const result = Bun.spawnSync([BIN, ...args, "--from", component], {
      env: { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude"), CLAUDECODE: "1" },
      cwd: home,
    });
    return { code: result.exitCode, json: JSON.parse(result.stdout.toString() || "null"), stderr: result.stderr.toString() };
  };
  return { run, put, putContextDef, putContext, repoDir, home };
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

  test("context explain names what matched and why", () => {
    const { run, repoDir } = sandbox();
    const r = run("context", "explain", "--cwd", repoDir);
    expect(r.json.chain[0]).toMatchObject({ name: "acme", via: "remote" });
    expect(r.json.layers).toContain("context:acme:me");
  });

  test("--context with an unknown name exits 2", () => {
    const { run } = sandbox();
    expect(run("load", "demo", "--context", "nope").code).toBe(2);
  });
});
