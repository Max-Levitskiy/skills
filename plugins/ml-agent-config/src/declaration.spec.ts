// Finding a declaration: at a plugin's root, or in a skill's folder for a plugin of several tools.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const BIN = join(import.meta.dir, "..", "bin", "agent-config");

function writeDeclaration(dir: string, name: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "agent-config.json"), JSON.stringify({ version: 2, name }));
}

/** A Claude Code home with the given plugins installed, each a folder the test fills in. */
function claudeHome(plugins: Record<string, (root: string) => void>): string {
  const home = mkdtempSync(join(tmpdir(), "acs-declaration-"));
  const registry: Record<string, { installPath: string; version: string }[]> = {};
  for (const [key, fill] of Object.entries(plugins)) {
    const root = join(home, "cache", key);
    mkdirSync(root, { recursive: true });
    fill(root);
    registry[key] = [{ installPath: root, version: "1.0.0" }];
  }
  mkdirSync(join(home, "plugins"), { recursive: true });
  writeFileSync(join(home, "plugins", "installed_plugins.json"), JSON.stringify({ version: 2, plugins: registry }));
  return home;
}

function run(home: string, ...args: string[]): { code: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync([BIN, ...args], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: home, CLAUDECODE: "1", HOME: home },
    cwd: home,
  });
  return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

describe("a declaration in a skill's folder", () => {
  const home = claudeHome({
    "ml-workplace@max-skills": (root) => {
      writeDeclaration(join(root, "skills", "fellow"), "fellow");
      writeDeclaration(join(root, "skills", "atlassian"), "atlassian");
      mkdirSync(join(root, "skills", "plain"), { recursive: true });
    },
    "ml-solo@max-skills": (root) => writeDeclaration(root, "solo"),
  });

  test("list names every tool of a plugin, and a root declaration still counts", () => {
    const listed = JSON.parse(run(home, "list").stdout).components;
    expect(listed.map((one: { name: string; plugin: string }) => `${one.name} ${one.plugin}`)).toEqual([
      "atlassian ml-workplace@max-skills",
      "fellow ml-workplace@max-skills",
      "solo ml-solo@max-skills",
    ]);
  });

  test("path finds it, and its actions sit beside it", () => {
    const found = run(home, "path", "fellow");
    expect(found.code).toBe(0);
    expect(JSON.parse(found.stdout).declaration).toBe(
      join(home, "cache", "ml-workplace@max-skills", "skills", "fellow", "agent-config.json"),
    );
  });

  test("one name declared twice inside a plugin is an error, never a guess", () => {
    const twice = claudeHome({
      "ml-twice@max-skills": (root) => {
        writeDeclaration(root, "dup");
        writeDeclaration(join(root, "skills", "dup"), "dup");
      },
    });
    const found = run(twice, "path", "dup");
    expect(found.code).toBe(2);
    expect(found.stderr).toContain("declared more than once inside ml-twice@max-skills");
  });
});
