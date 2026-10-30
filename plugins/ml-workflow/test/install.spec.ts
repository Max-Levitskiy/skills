// Seam 1: `claude-spore install-spore` (docs/spec.md, p.3) against local release folders signed by
// the real `ssh-keygen` with a throwaway key, pinned into a copy of the plugin.
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { remove, scratch } from "./helpers.ts";
import { CAPABILITIES, fakeSpore, pathOf, pluginPinnedTo, release, releaseKey, run, sign, sums, thisAsset } from "./release-fixtures.ts";

let keys: string;
let key: { file: string; line: string };
let other: { file: string; line: string };
let helper: string;
let home: string;
let bin: string;
let assets: string;

beforeAll(() => {
  keys = scratch();
  mkdirSync(join(keys, "release"));
  mkdirSync(join(keys, "other"));
  key = releaseKey(join(keys, "release"));
  other = releaseKey(join(keys, "other"));
  helper = pluginPinnedTo(key.line);
});

afterAll(() => {
  remove(keys);
  remove(join(helper, "..", ".."));
});

beforeEach(() => {
  home = realpathSync(scratch());
  bin = join(home, "bin");
  mkdirSync(bin);
  mkdirSync(join(home, "release-build"));
  assets = release(join(home, "release-build"), key.file);
});

afterEach(() => {
  chmodSync(bin, 0o755);
  remove(home);
});

function install(path: string[], env: Record<string, string> = {}) {
  return run([helper, "install-spore"], { env: { HOME: home, PATH: pathOf(...path), SPORE_DOWNLOAD_URL: assets, ...env } });
}

const localBin = () => join(home, ".local", "bin");

test("with no spore on PATH it installs into ~/.local/bin and checks it", () => {
  const { exitCode, stdout, stderr } = install([localBin()]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  expect(stdout).toBe(`Installed spore 0.7.0 at ${join(localBin(), "spore")}.\n`);
  const installed = Bun.spawnSync([join(localBin(), "spore"), "capabilities", "--json"]);
  expect(JSON.parse(installed.stdout.toString())).toEqual(CAPABILITIES);
});

test("an update replaces the copy PATH selects, in its own folder", () => {
  fakeSpore(join(bin, "spore"), null);
  const { exitCode, stdout } = install([bin, localBin()]);
  expect(exitCode).toBe(0);
  expect(stdout).toBe(`Installed spore 0.7.0 at ${join(bin, "spore")}.\n`);
  expect(existsSync(join(localBin(), "spore"))).toBe(false);
  expect(readdirSync(bin)).toEqual(["spore"]);
});

test("a symlinked copy is replaced where the link points, and the link keeps working", () => {
  const real = join(home, "opt", "spore");
  fakeSpore(real, null);
  Bun.spawnSync(["ln", "-s", real, join(bin, "spore")]);
  const { exitCode, stdout } = install([bin]);
  expect(exitCode).toBe(0);
  expect(stdout).toBe(`Installed spore 0.7.0 at ${real}.\n`);
  expect(readFileSync(real, "utf8")).toContain("0.7.0");
});

test("an install whose folder is not on PATH is not reported as success", () => {
  const { exitCode, stderr } = install([]);
  expect(exitCode).toBe(1);
  expect(stderr).toBe(`install-spore: installed ${join(localBin(), "spore")}, but ${localBin()} is not on PATH; put ${localBin()} first on PATH\n`);
});

test("an installed spore that does not fit is not reported as success", () => {
  mkdirSync(join(home, "old"));
  const old = release(join(home, "old"), key.file, { ...CAPABILITIES, contracts: { ...CAPABILITIES.contracts, kernel: "0.1" } });
  const { exitCode, stderr } = install([localBin()], { SPORE_DOWNLOAD_URL: old });
  expect(exitCode).toBe(1);
  expect(stderr).toContain("but it does not fit");
  expect(stderr).toContain("kernel 0.1 where 0.2 is needed");
});

// Each refusal leaves the folder as it was: the old spore, and nothing beside it.
function refused(env: Record<string, string> = {}): string {
  fakeSpore(join(bin, "spore"), null);
  const before = readFileSync(join(bin, "spore"));
  const { exitCode, stdout, stderr } = install([bin], env);
  expect(exitCode).toBe(1);
  expect(stdout).toBe("");
  expect(readFileSync(join(bin, "spore"))).toEqual(before);
  expect(readdirSync(bin)).toEqual(["spore"]);
  expect(stderr).toEndWith("; nothing was installed\n");
  return stderr;
}

test("a tampered archive is refused", () => {
  const archive = join(assets, thisAsset());
  const bytes = readFileSync(archive);
  bytes[bytes.length - 10] ^= 0xff;
  writeFileSync(archive, bytes);
  expect(refused()).toContain(`the SHA-256 of ${thisAsset()} is not the one in SHA256SUMS`);
});

test("a tampered SHA256SUMS that matches a tampered archive is refused", () => {
  const evil = join(home, "evil");
  mkdirSync(evil);
  const swapped = release(evil, other.file, { ...CAPABILITIES, version: "6.6.6" });
  cpSync(join(swapped, thisAsset()), join(assets, thisAsset()));
  sums(assets, thisAsset());
  expect(refused()).toContain("the signature of SHA256SUMS does not match");
});

test("a SHA256SUMS signed by another key is refused", () => {
  sign(assets, other.file);
  expect(refused()).toContain("SHA256SUMS is signed by another key than the pinned release key");
});

test("a missing signature is refused", () => {
  Bun.spawnSync(["rm", join(assets, "SHA256SUMS.sig")]);
  expect(refused()).toContain("SHA256SUMS.sig is missing");
});

test("a signature that is not an SSH signature is refused", () => {
  writeFileSync(join(assets, "SHA256SUMS.sig"), "not a signature\n");
  expect(refused()).toContain("SHA256SUMS.sig is not an SSH signature");
});

test("a SHA256SUMS without a line for the archive is refused", () => {
  writeFileSync(join(assets, "SHA256SUMS"), `${"0".repeat(64)}  spore-other.tar.gz\n`);
  sign(assets, key.file);
  expect(refused()).toContain(`SHA256SUMS has 0 lines for ${thisAsset()}, not one`);
});

test("a non-writable PATH copy is not touched: the path and its owner's command are named", () => {
  if (process.getuid?.() === 0) return;
  fakeSpore(join(bin, "spore"), null);
  chmodSync(bin, 0o555);
  const { exitCode, stderr } = install([bin]);
  expect(exitCode).toBe(1);
  expect(stderr).toBe(
    `install-spore: ${join(bin, "spore")} is not writable here; update it with: curl -fsSL https://raw.githubusercontent.com/Web-tree/runspore/main/install.sh | sudo env SPORE_INSTALL_DIR=${bin} sh\n`,
  );
});

test("arguments are a usage error", () => {
  const { exitCode, stderr } = run([helper, "install-spore", "--now"], { env: { HOME: home, PATH: pathOf(bin) } });
  expect(exitCode).toBe(2);
  expect(stderr).toStartWith("usage: claude-spore install-spore");
  expect(existsSync(join(localBin(), "spore"))).toBe(false);
});
