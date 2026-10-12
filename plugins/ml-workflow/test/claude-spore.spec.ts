// Seam 1 (docs/spec.md, Testing): the helper run as a subprocess. These are `.spec.ts` so that
// `claude plugin test`, which loads `*.test.ts`, leaves them to `bun test`.
import { expect, test } from "bun:test";
import { join } from "node:path";

import manifest from "../.claude-plugin/plugin.json";

const HELPER = join(import.meta.dir, "..", "bin", "claude-spore");
const OLD_BUN = join(import.meta.dir, "fixtures", "old-bun.ts");

function run(args: string[], options: { bunVersion?: string } = {}) {
  const preload = options.bunVersion ? ["--preload", OLD_BUN] : [];
  const child = Bun.spawnSync([process.execPath, ...preload, HELPER, ...args], {
    env: { ...process.env, FAKE_BUN_VERSION: options.bunVersion },
  });
  return { exitCode: child.exitCode, stdout: child.stdout.toString(), stderr: child.stderr.toString() };
}

test("--version prints the plugin's version and nothing else", () => {
  const { exitCode, stdout, stderr } = run(["--version"]);
  expect(exitCode).toBe(0);
  expect(stdout).toBe(`${manifest.version}\n`);
  expect(stderr).toBe("");
});

test("the helper runs by its own name, as steps on PATH run it", () => {
  const child = Bun.spawnSync([HELPER, "--version"]);
  expect(child.exitCode).toBe(0);
  expect(child.stdout.toString()).toBe(`${manifest.version}\n`);
});

test("an old Bun exits 2 naming the version needed, before any command runs", () => {
  const { exitCode, stdout, stderr } = run(["--version"], { bunVersion: "1.1.38" });
  expect(exitCode).toBe(2);
  expect(stdout).toBe("");
  expect(stderr).toBe("claude-spore needs Bun 1.2.0 or later; this is Bun 1.1.38. Update it with: bun upgrade\n");
});

test("Bun 1.2.0 itself is new enough", () => {
  const { exitCode, stdout, stderr } = run(["--version"], { bunVersion: "1.2.0" });
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  expect(stdout).toBe(`${manifest.version}\n`);
});

test("an unknown command exits 2 with the usage", () => {
  const { exitCode, stdout, stderr } = run(["frobnicate"]);
  expect(exitCode).toBe(2);
  expect(stdout).toBe("");
  expect(stderr).toStartWith('claude-spore: unknown command "frobnicate"');
  expect(stderr).toContain("usage: claude-spore --version");
});

test("no command exits 2 with the usage", () => {
  const { exitCode, stderr } = run([]);
  expect(exitCode).toBe(2);
  expect(stderr).toStartWith("usage: claude-spore --version");
});
