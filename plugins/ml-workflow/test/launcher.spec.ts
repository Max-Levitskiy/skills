// Seam 1: the launcher and `claude-spore launcher install | decline` (docs/spec.md, p.5).
import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { HELPER, remove, scratch } from "./helpers.ts";
import { pathOf, run } from "./release-fixtures.ts";

const LAUNCHER = join(import.meta.dir, "..", "launcher", "claude-spore");

let home: string;

beforeEach(() => {
  home = realpathSync(scratch());
});

afterEach(() => remove(home));

const target = () => join(home, ".local", "bin", "claude-spore");
const data = () => join(home, ".claude", "plugins", "data", "ml-workflow-max-skills");

function helper(args: string[]) {
  return run([HELPER, ...args], { env: { HOME: home, PATH: pathOf() } });
}

test("install copies the launcher to ~/.local/bin and remembers the offer", () => {
  const { exitCode, stdout } = helper(["launcher", "install"]);
  expect(exitCode).toBe(0);
  expect(stdout).toBe(`Installed the claude-spore launcher at ${target()}. ${join(home, ".local", "bin")} is not on PATH; add it there.\n`);
  expect(readFileSync(target(), "utf8")).toBe(readFileSync(LAUNCHER, "utf8"));
  expect(Bun.spawnSync(["test", "-x", target()]).exitCode).toBe(0);
  expect(readFileSync(join(data(), "launcher-offered"), "utf8")).toBe("install\n");
  expect(helper(["launcher", "install"]).exitCode).toBe(0);
});

test("decline remembers the offer and installs nothing", () => {
  const { exitCode } = helper(["launcher", "decline"]);
  expect(exitCode).toBe(0);
  expect(existsSync(target())).toBe(false);
  expect(readFileSync(join(data(), "launcher-offered"), "utf8")).toBe("decline\n");
});

test("install never replaces another program of that name", () => {
  mkdirSync(join(home, ".local", "bin"), { recursive: true });
  writeFileSync(target(), "#!/bin/sh\necho mine\n");
  const { exitCode, stderr } = helper(["launcher", "install"]);
  expect(exitCode).toBe(1);
  expect(stderr).toBe(`launcher: ${target()} exists and is not the ml-workflow launcher; move it away, then try again\n`);
  expect(readFileSync(target(), "utf8")).toBe("#!/bin/sh\necho mine\n");
});

test("a wrong action is a usage error", () => {
  expect(helper(["launcher"]).exitCode).toBe(2);
  expect(helper(["launcher", "remove"]).stderr).toBe("usage: claude-spore launcher install | decline\n");
});

// An installation of the plugin: a helper that says which one it is and what it was given.
function installation(name: string): string {
  const root = join(home, "installs", name);
  mkdirSync(join(root, "bin"), { recursive: true });
  const bin = join(root, "bin", "claude-spore");
  writeFileSync(bin, `#!/bin/sh\necho "${name} $*"\ncat\nexit 7\n`);
  chmodSync(bin, 0o755);
  return root;
}

function registry(entries: object[]) {
  mkdirSync(join(home, ".claude", "plugins"), { recursive: true });
  writeFileSync(
    join(home, ".claude", "plugins", "installed_plugins.json"),
    JSON.stringify({ version: 2, plugins: { "ml-other@max-skills": [{ scope: "user", installPath: installation("other") }], "ml-workflow@max-skills": entries } }),
  );
}

function launch(cwd: string, env: Record<string, string> = {}) {
  mkdirSync(cwd, { recursive: true });
  return run([LAUNCHER, "run", "--flag"], { cwd, stdin: "params\n", env: { HOME: home, PATH: pathOf(), ...env } });
}

test("the launcher runs the user installation's helper, passing arguments, stdin and the exit code", () => {
  registry([{ scope: "user", installPath: installation("user"), version: "0.4.0" }]);
  expect(launch(join(home, "anywhere"))).toEqual({ exitCode: 7, stdout: "user run --flag\nparams\n", stderr: "" });
});

test("a project-scope entry holding the current folder beats the user entry, the deepest first", () => {
  const repo = join(home, "repo");
  registry([
    { scope: "user", installPath: installation("user") },
    { scope: "project", projectPath: repo, installPath: installation("repo") },
    { scope: "local", projectPath: join(repo, "packages", "app"), installPath: installation("app") },
    { scope: "project", projectPath: join(home, "elsewhere"), installPath: installation("elsewhere") },
  ]);
  expect(launch(repo).stdout).toStartWith("repo run --flag");
  expect(launch(join(repo, "src")).stdout).toStartWith("repo run --flag");
  expect(launch(join(repo, "packages", "app", "src")).stdout).toStartWith("app run --flag");
  expect(launch(join(home, "repo-other")).stdout).toStartWith("user run --flag");
});

test("CLAUDE_CONFIG_DIR moves the registry", () => {
  const config = join(home, "config");
  mkdirSync(join(config, "plugins"), { recursive: true });
  writeFileSync(
    join(config, "plugins", "installed_plugins.json"),
    JSON.stringify({ version: 2, plugins: { "ml-workflow@max-skills": [{ scope: "user", installPath: installation("moved") }] } }),
  );
  expect(launch(home, { CLAUDE_CONFIG_DIR: config }).stdout).toStartWith("moved run");
});

test("with no installation for this folder the launcher exits 2 naming the plugin install", () => {
  const message = (cwd: string) =>
    `claude-spore: ml-workflow@max-skills is not installed for ${cwd}; install it in Claude Code with /plugin install ml-workflow@max-skills\n`;
  expect(launch(home)).toEqual({ exitCode: 2, stdout: "", stderr: message(home) });

  registry([{ scope: "project", projectPath: join(home, "repo"), installPath: installation("repo") }]);
  expect(launch(join(home, "other"))).toEqual({ exitCode: 2, stdout: "", stderr: message(join(home, "other")) });

  registry([{ scope: "user", installPath: join(home, "gone") }]);
  expect(launch(home).exitCode).toBe(2);
});
