// Seam 1: `claude-spore doctor`, the version check (docs/spec.md, p.3, p.5), against a fake spore.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import manifest from "../.claude-plugin/plugin.json";
import { HELPER, remove, scratch } from "./helpers.ts";
import { CAPABILITIES, fakeSpore, pathOf, run } from "./release-fixtures.ts";

let home: string;
let bin: string;

beforeEach(() => {
  // Real paths: on macOS the temporary folder is a symlink, and the check follows symlinks.
  home = realpathSync(scratch());
  bin = join(home, "bin");
  mkdirSync(bin);
});

afterEach(() => {
  chmodSync(bin, 0o755);
  remove(home);
});

function doctor(args: string[] = [], env: Record<string, string> = {}) {
  return run([HELPER, "doctor", ...args], { env: { HOME: home, PATH: pathOf(bin), ...env } });
}

function json(args: string[] = [], env: Record<string, string> = {}) {
  const ran = doctor(["--json", ...args], env);
  return { ...ran, report: JSON.parse(ran.stdout) };
}

const UPDATE = "Update it with: claude-spore install-spore";

test("a spore that fits prints nothing and exits 0", () => {
  fakeSpore(join(bin, "spore"), CAPABILITIES);
  expect(doctor()).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  const { exitCode, report } = json();
  expect(exitCode).toBe(0);
  expect(report).toEqual({ ok: true, spore: { path: join(bin, "spore"), version: "0.2.1" }, problems: [], launcher: "offer" });
});

test("no spore on PATH shows the install line", () => {
  const { exitCode, stdout } = doctor();
  expect(exitCode).toBe(1);
  expect(stdout).toBe("ml-workflow needs spore 0.2.0 or later, and none is on PATH. Install it with: claude-spore install-spore\n");
  expect(json().report.problems).toEqual([
    { code: "spore.missing", message: stdout.trim(), fix: "claude-spore install-spore" },
  ]);
});

test("a spore from before the handshake shows the update line", () => {
  fakeSpore(join(bin, "spore"), null);
  const { exitCode, report } = json();
  expect(exitCode).toBe(1);
  expect(report.ok).toBe(false);
  expect(report.spore).toBeNull();
  expect(report.problems).toEqual([
    {
      code: "spore.old",
      message: `ml-workflow needs spore 0.2.0 or later; ${join(bin, "spore")} does not answer \`spore capabilities\`. ${UPDATE}`,
      fix: "claude-spore install-spore",
    },
  ]);
});

test("a missing version field shows the update line", () => {
  const { version, ...rest } = CAPABILITIES;
  fakeSpore(join(bin, "spore"), rest);
  const { exitCode, report } = json();
  expect(exitCode).toBe(1);
  expect(report.problems.map((p: { code: string }) => p.code)).toEqual(["spore.version"]);
  expect(report.problems[0].message).toContain("names no version");
});

test("a version below 0.2.0 shows the update line", () => {
  fakeSpore(join(bin, "spore"), { ...CAPABILITIES, version: "0.1.9" });
  const { exitCode, stdout } = doctor();
  expect(exitCode).toBe(1);
  expect(stdout).toBe(`ml-workflow needs spore 0.2.0 or later; ${join(bin, "spore")} is 0.1.9. ${UPDATE}\n`);
});

test("a missing contract shows the update line naming it", () => {
  const { store, ...contracts } = CAPABILITIES.contracts;
  fakeSpore(join(bin, "spore"), { ...CAPABILITIES, contracts });
  const { exitCode, report } = json();
  expect(exitCode).toBe(1);
  expect(report.problems).toEqual([
    {
      code: "spore.contract",
      message: `ml-workflow needs spore 0.2.0 or later; ${join(bin, "spore")} (0.2.1) has no store contract. ${UPDATE}`,
      fix: "claude-spore install-spore",
    },
  ]);
});

test("missing contracts altogether name each one", () => {
  const { contracts, ...rest } = CAPABILITIES;
  fakeSpore(join(bin, "spore"), rest);
  expect(json().report.problems[0].message).toContain("has no cli contract, no host contract, no kernel contract, no store contract");
});

test("a contract out of range, newer or older, shows the update line", () => {
  fakeSpore(join(bin, "spore"), { ...CAPABILITIES, contracts: { ...CAPABILITIES.contracts, kernel: "0.3", cli: "0.1" } });
  const { exitCode, report } = json();
  expect(exitCode).toBe(1);
  expect(report.problems[0].code).toBe("spore.contract");
  expect(report.problems[0].message).toContain("has cli 0.1 where 0.2 is needed, kernel 0.3 where 0.2 is needed");
});

test("contracts the plugin does not drive are not checked", () => {
  fakeSpore(join(bin, "spore"), { ...CAPABILITIES, contracts: { ...CAPABILITIES.contracts, dot: "0.9", artifact: "7.0" } });
  expect(doctor().exitCode).toBe(0);
});

test("a newer spore with the same contracts fits", () => {
  fakeSpore(join(bin, "spore"), { ...CAPABILITIES, version: "0.5.3" });
  expect(doctor().exitCode).toBe(0);
});

test("a non-writable PATH copy names the path and runspore's installer as root", () => {
  if (process.getuid?.() === 0) return;
  fakeSpore(join(bin, "spore"), { ...CAPABILITIES, version: "0.1.0" });
  chmodSync(bin, 0o555);
  const { exitCode, report } = json();
  expect(exitCode).toBe(1);
  const fix = `curl -fsSL https://raw.githubusercontent.com/Web-tree/runspore/main/install.sh | sudo env SPORE_INSTALL_DIR=${bin} sh`;
  expect(report.problems).toEqual([
    {
      code: "spore.version",
      message: `ml-workflow needs spore 0.2.0 or later; ${join(bin, "spore")} is 0.1.0. ${join(bin, "spore")} is not writable here; update it with: ${fix}`,
      fix,
    },
  ]);
});

test("a non-writable copy cargo installed names cargo's command", () => {
  if (process.getuid?.() === 0) return;
  const cargo = join(home, ".cargo", "bin");
  fakeSpore(join(cargo, "spore"), null);
  chmodSync(cargo, 0o555);
  try {
    const { report } = json([], { PATH: pathOf(cargo) });
    expect(report.problems[0].fix).toBe("cargo install --git https://github.com/Web-tree/runspore --locked --force runspore-cli");
    expect(report.problems[0].message).toContain(`${join(cargo, "spore")} is not writable here`);
  } finally {
    chmodSync(cargo, 0o755);
  }
});

test("a symlinked spore is judged, and updated, where the link points", () => {
  if (process.getuid?.() === 0) return;
  const real = join(home, "opt", "spore");
  fakeSpore(real, null);
  chmodSync(join(home, "opt"), 0o555);
  Bun.spawnSync(["ln", "-s", real, join(bin, "spore")]);
  try {
    const { report } = json();
    expect(report.problems[0].fix).toContain(`SPORE_INSTALL_DIR=${join(home, "opt")} sh`);
  } finally {
    chmodSync(join(home, "opt"), 0o755);
  }
});

test("a helper of another version than the session's asks for /reload-plugins", () => {
  fakeSpore(join(bin, "spore"), CAPABILITIES);
  const { exitCode, report } = json(["--plugin-version", "0.0.1"]);
  expect(exitCode).toBe(1);
  expect(report.problems).toEqual([
    {
      code: "plugin.reload",
      message: `ml-workflow changed since this session loaded it (helper ${manifest.version}, session 0.0.1). Run /reload-plugins, then try again.`,
      fix: null,
    },
  ]);
  expect(json(["--plugin-version", manifest.version]).exitCode).toBe(0);
});

test("the launcher is offered until it is installed or declined", () => {
  fakeSpore(join(bin, "spore"), CAPABILITIES);
  expect(json().report.launcher).toBe("offer");
  const data = join(home, "data");
  expect(run([HELPER, "launcher", "decline"], { env: { HOME: home, PATH: pathOf(bin), CLAUDE_PLUGIN_DATA: data } }).exitCode).toBe(0);
  expect(json([], { CLAUDE_PLUGIN_DATA: data }).report.launcher).toBe("declined");
  mkdirSync(join(home, ".local", "bin"), { recursive: true });
  writeFileSync(join(home, ".local", "bin", "claude-spore"), "");
  expect(json([], { CLAUDE_PLUGIN_DATA: data }).report.launcher).toBe("installed");
});

test("an unknown flag is a usage error", () => {
  const { exitCode, stderr } = doctor(["--frob"]);
  expect(exitCode).toBe(2);
  expect(stderr).toStartWith("usage: claude-spore doctor");
});
