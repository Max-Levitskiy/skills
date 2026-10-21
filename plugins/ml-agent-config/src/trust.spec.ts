// Trust: a credential reference is honoured only from a layer the user wrote here — global,
// user-repo, a context's `me` file, and a config.local.json git does not track. The repo layer and a
// context's team file come from other people, so their references are stripped and reported.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const BIN = join(import.meta.dir, "..", "bin", "agent-config");

/**
 * A home with a `demo` component declaring `credentials.token`, a context `acme` matching the
 * remotes under `github.com/acme/`, and a repository under the home with such a remote.
 */
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "acs-trust-"));
  const home = join(root, "home");
  const component = join(root, "demo");
  mkdirSync(join(component, "actions"), { recursive: true });
  writeFileSync(
    join(component, "agent-config.json"),
    JSON.stringify({
      version: 2,
      name: "demo",
      schema: { version: 1, keys: { "credentials.token": { description: "The API token" } } },
    }),
  );
  writeFileSync(join(component, "actions", "onboard.md"), "---\nid: onboard\ntype: prompt\n---\n\nAsk.\n");

  const writeJson = (path: string, value: object) => {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, JSON.stringify(value));
  };
  const contextDir = (name: string) => join(home, ".agents", "contexts", name);
  const putContextDef = (name: string, def: object) => writeJson(join(contextDir(name), "context.json"), def);
  const putContext = (name: string, component: string, config: object, which?: "me") =>
    writeJson(join(contextDir(name), component, which === "me" ? "config.me.json" : "config.json"), config);
  const putGlobal = (config: object) => writeJson(join(home, ".agents", "config", "demo", "config.json"), config);

  const repoDir = join(home, "src", "web-app");
  mkdirSync(repoDir, { recursive: true });
  const git = (cwd: string, ...args: string[]) => spawnSync("git", args, { cwd });
  git(repoDir, "init", "-q");
  git(repoDir, "remote", "add", "origin", "https://github.com/acme/web-app");
  putContextDef("acme", { match: [{ remote: "github.com/acme/**" }] });
  const putRepoLayer = (config: object) => writeJson(join(repoDir, ".agents", "config", "demo", "config.json"), config);
  const localPath = join(repoDir, ".agents", "config", "demo", "config.local.json");
  const putLocalLayer = (config: object) => writeJson(localPath, config);
  const dropLocalLayer = () => rmSync(localPath);
  const putLegacyLocal = (config: object) =>
    writeJson(join(repoDir, ".agents", "skill-config", "demo", "config.local.json"), config);

  /**
   * The CLI, with fd 3 parsed into `fd3` when it was written. Bun's spawnSync returns no output for
   * a fourth pipe, so fd 3 is a file in the sandbox.
   */
  const fd3Path = join(root, "fd3");
  const run = (...args: (string | { env: Record<string, string> })[]) => {
    const last = args[args.length - 1];
    const extra = typeof last === "object" ? last.env : {};
    const argv = args.filter((one): one is string => typeof one === "string");
    const fd = openSync(fd3Path, "w");
    const result = Bun.spawnSync([BIN, ...argv, "--from", component], {
      env: { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude"), CLAUDECODE: "1", ...extra },
      cwd: home,
      stdio: ["ignore", "pipe", "pipe", fd],
    });
    closeSync(fd);
    const fd3 = readFileSync(fd3Path, "utf8");
    return {
      code: result.exitCode,
      json: JSON.parse(result.stdout.toString() || "null"),
      stderr: result.stderr.toString(),
      fd3: fd3 ? JSON.parse(fd3) : null,
    };
  };
  return { run, putGlobal, putContext, putRepoLayer, putLocalLayer, dropLocalLayer, putLegacyLocal, writeJson, localPath, git, repoDir, home };
}

describe("credential references and trust", () => {
  test("a credential reference in the repo layer is ignored and reported", () => {
    const { run, putRepoLayer, repoDir } = sandbox();
    putRepoLayer({ credentials: { token: { source: "command", command: "echo pwned" } } });
    const r = run("load", "demo", "--cwd", repoDir, "--secrets", "token");
    expect(r.code).toBe(2); // nothing configured it
    expect(r.fd3).toBeNull();
    const problem = run("start", "demo", "--cwd", repoDir).json.problems.find((p: any) => p.code === "untrusted-layer-key");
    expect(problem).toMatchObject({ layer: "repo", keys: ["credentials.token.source", "credentials.token.command"] });
    expect(problem.path).toEndWith(join(".agents", "config", "demo", "config.json"));
    const d = run("describe", "demo", "--cwd", repoDir).json;
    expect(d.problems.map((p: any) => p.code)).toContain("untrusted-layer-key");
    expect(d.layers.find((l: any) => l.layer === "repo").trusted).toBe(false);
    expect(d.keys.find((k: any) => k.path === "credentials.token")).toMatchObject({ levels: {}, source: null });
  });

  test("a tracked config.local.json is treated as the repo layer", () => {
    const { run, putLocalLayer, git, repoDir } = sandbox();
    putLocalLayer({ credentials: { token: { source: "command", command: "echo pwned" } } });
    git(repoDir, "add", "-f", ".agents/config/demo/config.local.json");
    expect(run("start", "demo", "--cwd", repoDir).json.problems.map((p: any) => p.code)).toContain("untrusted-layer-key");
    const r = run("load", "demo", "--cwd", repoDir, "--secrets", "token");
    expect(r.code).toBe(2);
    expect(r.fd3).toBeNull();
  });

  test("a config.local.json reached through a committed symlink is untrusted", () => {
    const { run, writeJson, git, repoDir } = sandbox();
    // git does not follow the symlink, so it calls the path untracked though the file is committed.
    writeJson(join(repoDir, "evil", "demo", "config.local.json"), {
      credentials: { token: { source: "command", command: "echo pwned" } },
    });
    mkdirSync(join(repoDir, ".agents"), { recursive: true });
    symlinkSync(join("..", "evil"), join(repoDir, ".agents", "config"));
    git(repoDir, "add", "-f", "evil", ".agents");
    const r = run("load", "demo", "--cwd", repoDir, "--secrets", "token");
    expect(r.code).toBe(2);
    expect(r.fd3).toBeNull();
    const problem = run("start", "demo", "--cwd", repoDir).json.problems.find((p: any) => p.code === "untrusted-layer-key");
    expect(problem).toMatchObject({ layer: "local" });
  });

  test("a config.local.json git cannot vouch for is untrusted", () => {
    const { run, putLocalLayer, repoDir } = sandbox();
    putLocalLayer({ credentials: { token: { source: "env", var: "T" } } });
    writeFileSync(join(repoDir, ".git", "index"), "not an index");
    const d = run("describe", "demo", "--cwd", repoDir).json;
    expect(d.layers.find((l: any) => l.layer === "local").trusted).toBe(false);
    expect(d.problems.map((p: any) => p.code)).toContain("untrusted-layer-key");
  });

  test("adopting a tracked v1 config.local.json leaves its credentials behind and says so", () => {
    const { run, putLegacyLocal, localPath, git, repoDir } = sandbox();
    putLegacyLocal({ credentials: { token: { source: "command", command: "echo pwned" } }, note: "kept" });
    git(repoDir, "add", "-f", ".agents/skill-config/demo/config.local.json");
    const adopted = run("adopt", "demo", "--cwd", repoDir);
    expect(adopted.code).toBe(0);
    expect(adopted.json.problems).toMatchObject([{ code: "untrusted-layer-key", layer: "local", keys: ["credentials.token.source", "credentials.token.command"] }]);
    expect(adopted.stderr).toContain("credentials.token.command");
    expect(existsSync(localPath)).toBe(true);
    const written = JSON.parse(readFileSync(localPath, "utf8"));
    expect(written.credentials).toBeUndefined();
    expect(written.note).toBe("kept");
    const r = run("load", "demo", "--cwd", repoDir, "--secrets", "token");
    expect(r.code).toBe(2);
    expect(r.fd3).toBeNull();
  });

  test("an untracked config.local.json and a context me file are trusted", () => {
    const { run, putLocalLayer, dropLocalLayer, putContext, repoDir } = sandbox();
    putLocalLayer({ credentials: { token: { source: "env", var: "T" } } });
    expect(run("start", "demo", "--cwd", repoDir).json.problems).toEqual([]);
    expect(run("load", "demo", "--cwd", repoDir).json.provenance["credentials.token.var"]).toBe("local");
    // The local layer outranks the me file, so it goes before the me file is checked.
    dropLocalLayer();
    putContext("acme", "demo", { credentials: { token: { source: "env", var: "T" } } }, "me");
    expect(run("start", "demo", "--cwd", repoDir).json.problems).toEqual([]);
    expect(run("load", "demo", "--cwd", repoDir).json.provenance["credentials.token.var"]).toBe("context:acme:me");
  });

  test("a credential reference in a context team file is ignored", () => {
    const { run, putGlobal, putContext, repoDir } = sandbox();
    putContext("acme", "demo", { credentials: { token: { source: "env", var: "T" } } });
    expect(run("start", "demo", "--cwd", repoDir).json.problems.map((p: any) => p.code)).toContain("untrusted-layer-key");
    putGlobal({ credentials: { token: { source: "env", var: "MINE" } } });
    const r = run("load", "demo", "--cwd", repoDir).json;
    expect(r.config.credentials.token.var).toBe("MINE");
    expect(r.provenance["credentials.token.var"]).toBe("global");
    expect(r.problems.map((p: any) => p.code)).toContain("untrusted-layer-key");
  });

  test("a cacheVar named by two references in the chain is skipped, and the source answers", () => {
    const { run, putGlobal, putContext, repoDir } = sandbox();
    putGlobal({ credentials: { token: { source: "env", var: "A", cacheVar: "TOK" } } });
    putContext("acme", "demo", { credentials: { token: { source: "env", var: "B", cacheVar: "TOK" } } }, "me");
    const r = run("load", "demo", "--cwd", repoDir, "--secrets", "token", { env: { TOK: "stale", A: "a", B: "b" } });
    expect(r.fd3.token).toBe("b");
    expect(r.json.problems.map((p: any) => p.code)).toContain("cachevar-shared");
  });
});
