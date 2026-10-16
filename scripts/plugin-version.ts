#!/usr/bin/env bun
// A plugin's version, raised with every change that ships it (AGENTS.md, Releasing a plugin).
// `claude plugin update` compares versions only, so a change merged at the old version never
// reaches an installed copy. Like release-please, `bump` raises the version and writes the
// changelog in the same change; like npm, which refuses to publish over an existing version,
// `check` refuses a change to the plugin that leaves the version where the base has it.
//
//   bun scripts/plugin-version.ts bump <plugin> <patch|minor|major> <note>...
//   bun scripts/plugin-version.ts check <plugin> <base-ref> [<head-ref>]
//
// The version lives in plugins/<plugin>/.claude-plugin/plugin.json, the plugin's entry in
// .claude-plugin/marketplace.json, and `PLUGIN_VERSION` in plugins/<plugin>/src/version.ts when
// that file has one. Each version has a `## <version>` section in plugins/<plugin>/CHANGELOG.md.

import { existsSync } from "node:fs";
import { join } from "node:path";

const MARKETPLACE = ".claude-plugin/marketplace.json";
const PLUGIN_VERSION = /(export const PLUGIN_VERSION = ")([^"]*)(")/;

type Level = "patch" | "minor" | "major";

function git(root: string, ...args: string[]): { ok: boolean; out: string } {
  const r = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  return { ok: r.exitCode === 0, out: r.stdout.toString() };
}

function fail(message: string): never {
  console.error(`plugin-version: ${message}`);
  process.exit(1);
}

function parse(version: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function greater(a: string, b: string): boolean {
  const x = parse(a)!;
  const y = parse(b)!;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! > y[i]!;
  return false;
}

function next(version: string, level: Level): string {
  const [major, minor, patch] = parse(version) ?? fail(`version "${version}" is not major.minor.patch`);
  if (level === "major") return `${major + 1}.0.0`;
  if (level === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

const manifestPath = (plugin: string) => `plugins/${plugin}/.claude-plugin/plugin.json`;
const versionTsPath = (plugin: string) => `plugins/${plugin}/src/version.ts`;
const changelogPath = (plugin: string) => `plugins/${plugin}/CHANGELOG.md`;

function show(root: string, ref: string, path: string): string | null {
  const r = git(root, "show", `${ref}:${path}`);
  return r.ok ? r.out : null;
}

/** Every place the version is written, as committed at `ref`. */
function versions(root: string, plugin: string, ref: string): Record<string, string | null> {
  const read = (path: string) => show(root, ref, path);
  const found: Record<string, string | null> = {};
  const manifest = read(manifestPath(plugin));
  found[manifestPath(plugin)] = manifest === null ? null : (JSON.parse(manifest).version ?? null);
  const market = read(MARKETPLACE);
  if (market !== null) {
    const entry = JSON.parse(market).plugins?.find((p: { name: string }) => p.name === plugin);
    found[MARKETPLACE] = entry?.version ?? null;
  }
  const versionTs = read(versionTsPath(plugin));
  if (versionTs !== null && PLUGIN_VERSION.test(versionTs)) found[versionTsPath(plugin)] = PLUGIN_VERSION.exec(versionTs)![2]!;
  return found;
}

function changelogHas(text: string, version: string): boolean {
  return new RegExp(`^## ${version.replaceAll(".", "\\.")}(\\s|$)`, "m").test(text);
}

async function bump(root: string, plugin: string, level: string, notes: string[]) {
  if (!["patch", "minor", "major"].includes(level)) fail(`level must be patch, minor or major, not "${level}"`);
  if (notes.length === 0) fail("bump needs at least one changelog note");
  const manifestFile = join(root, manifestPath(plugin));
  if (!existsSync(manifestFile)) fail(`no ${manifestPath(plugin)}`);

  const manifest = JSON.parse(await Bun.file(manifestFile).text());
  const from: string = manifest.version;
  const to = next(from, level as Level);
  manifest.version = to;
  await Bun.write(manifestFile, JSON.stringify(manifest, null, 2) + "\n");

  const marketFile = join(root, MARKETPLACE);
  const market = JSON.parse(await Bun.file(marketFile).text());
  const entry = market.plugins.find((p: { name: string }) => p.name === plugin);
  if (!entry) fail(`${MARKETPLACE} has no entry "${plugin}"`);
  entry.version = to;
  await Bun.write(marketFile, JSON.stringify(market, null, 2) + "\n");

  const versionTsFile = join(root, versionTsPath(plugin));
  if (existsSync(versionTsFile)) {
    const text = await Bun.file(versionTsFile).text();
    if (PLUGIN_VERSION.test(text)) await Bun.write(versionTsFile, text.replace(PLUGIN_VERSION, `$1${to}$3`));
  }

  const changelogFile = join(root, changelogPath(plugin));
  const section = `## ${to}\n\n${notes.map((n) => `- ${n}`).join("\n")}\n\n`;
  const old = existsSync(changelogFile) ? await Bun.file(changelogFile).text() : `# Changelog\n\nWhat each ${plugin} version changed.\n\n`;
  const at = old.search(/^## /m);
  await Bun.write(changelogFile, at === -1 ? old + section : old.slice(0, at) + section + old.slice(at));

  console.log(`${plugin} ${from} → ${to}`);
}

function check(root: string, plugin: string, base: string, head = "HEAD") {
  if (!git(root, "rev-parse", "--verify", `${base}^{commit}`).ok) fail(`base "${base}" is not a commit here; fetch it first`);
  const changed = git(root, "diff", "--name-only", `${base}...${head}`, "--", `plugins/${plugin}/`).out.trim();
  if (!changed) {
    console.log(`${plugin}: unchanged since ${base}, no version needed`);
    return;
  }

  const problems: string[] = [];
  const now = versions(root, plugin, head);
  const version = now[manifestPath(plugin)];
  if (!version || !parse(version)) fail(`${manifestPath(plugin)} at ${head} has no major.minor.patch version`);
  for (const [path, v] of Object.entries(now)) {
    if (v !== version) problems.push(`${path} says ${v ?? "no version"}, ${manifestPath(plugin)} says ${version}`);
  }

  const was = versions(root, plugin, base)[manifestPath(plugin)];
  if (was && parse(was) && !greater(version, was)) {
    problems.push(`plugins/${plugin}/ changed but its version is ${version}, not above ${was} at ${base}`);
  }

  const changelog = show(root, head, changelogPath(plugin));
  if (changelog === null || !changelogHas(changelog, version)) problems.push(`${changelogPath(plugin)} has no "## ${version}" section`);

  if (problems.length > 0) {
    for (const p of problems) console.error(`✗ ${p}`);
    console.error(`\nRaise it with: bun scripts/plugin-version.ts bump ${plugin} <patch|minor|major> "<what changed>"`);
    process.exit(1);
  }
  console.log(`${plugin}: ${was ?? "new"} → ${version}`);
}

const [command, plugin, ...rest] = process.argv.slice(2);
const top = git(process.cwd(), "rev-parse", "--show-toplevel");
if (!top.ok) fail("not inside a git repository");
const root = top.out.trim();

if (command === "bump" && plugin) await bump(root, plugin, rest[0] ?? "", rest.slice(1));
else if (command === "check" && plugin && rest[0]) check(root, plugin, rest[0], rest[1]);
else {
  console.error("usage: plugin-version.ts bump <plugin> <patch|minor|major> <note>...");
  console.error("       plugin-version.ts check <plugin> <base-ref> [<head-ref>]");
  process.exit(2);
}
