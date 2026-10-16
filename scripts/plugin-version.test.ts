import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "plugin-version.ts");
let repo: string;

function sh(...cmd: string[]) {
  const r = Bun.spawnSync(cmd, { cwd: repo, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
}
const run = (...args: string[]) => sh("bun", SCRIPT, ...args);
const write = (path: string, text: string) => Bun.write(join(repo, path), text);
const read = (path: string) => Bun.file(join(repo, path)).text();
const commit = (message: string) => {
  sh("git", "add", "-A");
  sh("git", "commit", "-qm", message);
};

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "plugin-version-"));
  sh("git", "init", "-q", "-b", "main");
  sh("git", "config", "user.email", "test@example.com");
  sh("git", "config", "user.name", "test");
  await write(".claude-plugin/marketplace.json", JSON.stringify({ plugins: [{ name: "ml-demo", version: "0.9.0" }, { name: "ml-other", version: "1.0.0" }] }, null, 2) + "\n");
  await write("plugins/ml-demo/.claude-plugin/plugin.json", JSON.stringify({ name: "ml-demo", version: "0.9.0" }, null, 2) + "\n");
  await write("plugins/ml-demo/src/version.ts", 'export const PLUGIN_VERSION = "0.9.0";\n');
  await write("plugins/ml-demo/src/code.ts", "export const a = 1;\n");
  await write("plugins/ml-demo/CHANGELOG.md", "# Changelog\n\nWhat each ml-demo version changed.\n\n## 0.9.0\n\n- First.\n");
  await write("plugins/ml-other/x.md", "x\n");
  commit("base");
  sh("git", "branch", "base");
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

test("a change to the plugin at the base's version is refused", async () => {
  await write("plugins/ml-demo/src/code.ts", "export const a = 2;\n");
  commit("change");
  const r = run("check", "ml-demo", "base");
  expect(r.code).toBe(1);
  expect(r.out).toContain("plugins/ml-demo/ changed but its version is 0.9.0, not above 0.9.0 at base");
  expect(r.out).toContain("bun scripts/plugin-version.ts bump ml-demo");
});

test("bump raises every copy of the version and adds a changelog section, which check accepts", async () => {
  await write("plugins/ml-demo/src/code.ts", "export const a = 2;\n");
  expect(run("bump", "ml-demo", "minor", "The run line fits.", "Follows by status.").out).toContain("ml-demo 0.9.0 → 0.10.0");
  commit("change");

  expect(JSON.parse(await read("plugins/ml-demo/.claude-plugin/plugin.json")).version).toBe("0.10.0");
  const market = JSON.parse(await read(".claude-plugin/marketplace.json"));
  expect(market.plugins.map((p: { version: string }) => p.version)).toEqual(["0.10.0", "1.0.0"]);
  expect(await read("plugins/ml-demo/src/version.ts")).toBe('export const PLUGIN_VERSION = "0.10.0";\n');
  expect(await read("plugins/ml-demo/CHANGELOG.md")).toBe(
    "# Changelog\n\nWhat each ml-demo version changed.\n\n## 0.10.0\n\n- The run line fits.\n- Follows by status.\n\n## 0.9.0\n\n- First.\n",
  );

  const r = run("check", "ml-demo", "base");
  expect(r.out).toContain("ml-demo: 0.9.0 → 0.10.0");
  expect(r.code).toBe(0);
});

test("patch and major levels", () => {
  expect(run("bump", "ml-demo", "patch", "x").out).toContain("0.9.0 → 0.9.1");
  expect(run("bump", "ml-demo", "major", "x").out).toContain("0.9.1 → 1.0.0");
});

test("a copy of the version left behind, or no changelog section, is refused", async () => {
  await write("plugins/ml-demo/.claude-plugin/plugin.json", JSON.stringify({ name: "ml-demo", version: "0.9.1" }, null, 2) + "\n");
  commit("half a bump");
  const r = run("check", "ml-demo", "base");
  expect(r.code).toBe(1);
  expect(r.out).toContain(".claude-plugin/marketplace.json says 0.9.0, plugins/ml-demo/.claude-plugin/plugin.json says 0.9.1");
  expect(r.out).toContain("plugins/ml-demo/src/version.ts says 0.9.0");
  expect(r.out).toContain('plugins/ml-demo/CHANGELOG.md has no "## 0.9.1" section');
});

test("a version the base already reached is refused, as npm refuses to publish over one", async () => {
  sh("git", "checkout", "-q", "-b", "pr", "base");
  await write("plugins/ml-demo/src/code.ts", "export const a = 3;\n");
  run("bump", "ml-demo", "patch", "Mine.");
  commit("pr");
  sh("git", "checkout", "-q", "main");
  await write("plugins/ml-demo/src/code.ts", "export const a = 2;\n");
  run("bump", "ml-demo", "patch", "Theirs.");
  commit("main moved on");

  const r = run("check", "ml-demo", "main", "pr");
  expect(r.code).toBe(1);
  expect(r.out).toContain("its version is 0.9.1, not above 0.9.1 at main");
});

test("a change elsewhere needs no version", async () => {
  await write("plugins/ml-other/x.md", "y\n");
  commit("other");
  const r = run("check", "ml-demo", "base");
  expect(r.code).toBe(0);
  expect(r.out).toContain("ml-demo: unchanged since base");
});

test("bump without a note, or with an unknown level, changes nothing", async () => {
  expect(run("bump", "ml-demo", "minor").code).toBe(1);
  expect(run("bump", "ml-demo", "feat", "x").code).toBe(1);
  expect(sh("git", "status", "--porcelain").out).toBe("");
});
