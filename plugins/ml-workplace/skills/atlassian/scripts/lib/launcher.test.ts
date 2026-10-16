// bun test scripts/lib/launcher.test.ts
//
// The stable `atlassian` name: the plugin's bin/atlassian runs the CLI, `atlassian launcher install`
// copies the launcher to ~/.local/bin, and the launcher runs the CLI of the ml-workplace installation
// for the current folder, read from a scratch installed_plugins.json.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";

const PLUGIN = resolve(import.meta.dir, "../../../..");
const BIN = join(PLUGIN, "bin", "atlassian");
const LAUNCHER = join(PLUGIN, "launcher", "atlassian");
// bun's own folder only, so a launcher on the developer's PATH is not found.
const PATH = `${dirname(process.execPath)}:/usr/bin:/bin`;

let home: string;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "atlassian-launcher-")));
});

afterEach(() => rmSync(home, { recursive: true, force: true }));

function run(argv: string[], options: { cwd?: string; stdin?: string; env?: Record<string, string> } = {}) {
  const result = Bun.spawnSync(argv, {
    cwd: options.cwd ?? home,
    stdin: options.stdin === undefined ? "ignore" : Buffer.from(options.stdin),
    env: { HOME: home, PATH, ...options.env },
  });
  return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

const target = () => join(home, ".local", "bin", "atlassian");

test("bin/atlassian runs the CLI with its arguments", () => {
  const { exitCode, stdout } = run([BIN, "help"]);
  expect(exitCode).toBe(0);
  expect(stdout).toStartWith("atlassian — Jira + Confluence over REST");
  expect(stdout).toContain("launcher install");
});

test("launcher install copies the launcher to ~/.local/bin, and again over its own copy", () => {
  const { exitCode, stdout } = run([BIN, "launcher", "install"]);
  expect(exitCode).toBe(0);
  expect(stdout).toBe(`Installed the atlassian launcher at ${target()}. ${join(home, ".local", "bin")} is not on PATH; add it there.\n`);
  expect(readFileSync(target(), "utf8")).toBe(readFileSync(LAUNCHER, "utf8"));
  expect(Bun.spawnSync(["test", "-x", target()]).exitCode).toBe(0);
  expect(run([BIN, "launcher", "install"]).exitCode).toBe(0);
});

test("launcher install never replaces another program of that name", () => {
  mkdirSync(join(home, ".local", "bin"), { recursive: true });
  writeFileSync(target(), "#!/bin/sh\necho mine\n");
  const { exitCode, stderr } = run([BIN, "launcher", "install"]);
  expect(exitCode).toBe(1);
  expect(stderr).toBe(`launcher: ${target()} exists and is not the ml-workplace launcher; move it away, then try again\n`);
  expect(readFileSync(target(), "utf8")).toBe("#!/bin/sh\necho mine\n");
});

test("a wrong launcher action is a usage error", () => {
  expect(run([BIN, "launcher"]).exitCode).toBe(2);
  expect(run([BIN, "launcher", "remove"]).stderr).toBe("usage: atlassian launcher install\n");
});

// An installation of the plugin: a CLI that says which one it is and what it was given.
function installation(name: string): string {
  const root = join(home, "installs", name);
  mkdirSync(join(root, "bin"), { recursive: true });
  const bin = join(root, "bin", "atlassian");
  writeFileSync(bin, `#!/bin/sh\necho "${name} $*"\ncat\nexit 7\n`);
  chmodSync(bin, 0o755);
  return root;
}

function registry(entries: object[], at = join(home, ".claude")) {
  mkdirSync(join(at, "plugins"), { recursive: true });
  writeFileSync(
    join(at, "plugins", "installed_plugins.json"),
    JSON.stringify({ version: 2, plugins: { "ml-other@max-skills": [{ scope: "user", installPath: installation("other") }], "ml-workplace@max-skills": entries } }),
  );
}

function launch(cwd: string, env: Record<string, string> = {}) {
  mkdirSync(cwd, { recursive: true });
  return run([LAUNCHER, "jira", "get", "NEO-1"], { cwd, stdin: "body\n", env });
}

test("the launcher runs the user installation's CLI, passing arguments, stdin and the exit code", () => {
  registry([{ scope: "user", installPath: installation("user"), version: "0.6.0" }]);
  expect(launch(join(home, "anywhere"))).toEqual({ exitCode: 7, stdout: "user jira get NEO-1\nbody\n", stderr: "" });
});

test("a project-scope entry holding the current folder beats the user entry, the deepest first", () => {
  const repo = join(home, "repo");
  registry([
    { scope: "user", installPath: installation("user") },
    { scope: "project", projectPath: repo, installPath: installation("repo") },
    { scope: "local", projectPath: join(repo, "packages", "app"), installPath: installation("app") },
    { scope: "project", projectPath: join(home, "elsewhere"), installPath: installation("elsewhere") },
  ]);
  expect(launch(join(repo, "src")).stdout).toStartWith("repo jira get");
  expect(launch(join(repo, "packages", "app", "src")).stdout).toStartWith("app jira get");
  expect(launch(join(home, "repo-other")).stdout).toStartWith("user jira get");
});

test("CLAUDE_CONFIG_DIR moves the registry", () => {
  const config = join(home, "config");
  registry([{ scope: "user", installPath: installation("moved") }], config);
  expect(launch(home, { CLAUDE_CONFIG_DIR: config }).stdout).toStartWith("moved jira get");
});

test("with no installation for this folder the launcher exits 2 naming the plugin install", () => {
  const message = (cwd: string) =>
    `atlassian: ml-workplace@max-skills is not installed for ${cwd}; install it in Claude Code with /plugin install ml-workplace@max-skills\n`;
  expect(launch(home)).toEqual({ exitCode: 2, stdout: "", stderr: message(home) });

  registry([{ scope: "user", installPath: join(home, "gone") }]);
  expect(launch(home).exitCode).toBe(2);
  expect(existsSync(join(home, "gone"))).toBe(false);
});
