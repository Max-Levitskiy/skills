// What the GitHub and GitLab fact passes have in common: running a CLI, printing a
// section, shortening a comment, and waiting for CI to settle.

import { spawnSync } from "child_process";
import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";

export type Json = any;

/**
 * Where CI stands on the head commit. `none` is "nothing ran", `other` is settled but
 * neither green nor red (a blocking manual job, a skipped pipeline).
 */
export type Ci = { phase: "none" | "running" | "green" | "red" | "other"; label: string };

/** Exit codes of a `--wait` run. `running` is a watch that hit WAIT_TIMEOUT: run it again. */
const CI_EXIT = { green: 0, red: 10, none: 11, other: 11, running: 12 } as const;
/** A push takes a moment to get its checks; after this long, none are coming. */
const NO_CI_GRACE_S = Number(process.env.NO_CI_GRACE ?? 180);
const WAIT_TIMEOUT_S = Number(process.env.WAIT_TIMEOUT ?? 3600);
const WAIT_POLL_MS = 20_000;

export function exec(cmd: string, args: string[]) {
  const p = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return { status: p.status ?? 1, stdout: p.stdout ?? "", stderr: p.stderr ?? "" };
}

/** Trimmed stdout, or "" when the command failed. */
export function text(cmd: string, args: string[]): string {
  const p = exec(cmd, args);
  return p.status === 0 ? p.stdout.trim() : "";
}

/** Parsed stdout, or null when the command failed or printed something else. */
export function json(cmd: string, args: string[]): Json | null {
  const p = exec(cmd, args);
  if (p.status !== 0) return null;
  try {
    return JSON.parse(p.stdout);
  } catch {
    return null;
  }
}

export function section(title: string) {
  console.log(`\n═══ ${title} ═══`);
}

/** A comment body as one short line: no HTML, no image markup, no hidden bot markers. */
export function gist(body: string | null | undefined, n = 160): string {
  const flat = (body ?? "")
    .replace(/<!--.*?-->/gs, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replaceAll("**", "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return flat.slice(0, n) + (flat.length > n ? "..." : "");
}

/** List the convention docs in this checkout, or say why they are not the PR's. */
export function conventionDocs(prRepo: string, cwdRepo: string, paths: string[]) {
  section("REPO CONVENTION DOCS");
  const root = text("git", ["rev-parse", "--show-toplevel"]);
  if (!root) return;
  if (prRepo !== cwdRepo) {
    console.log(`  (this checkout is ${cwdRepo || "another repo"}, not ${prRepo} — read the PR's own docs instead)`);
    return;
  }
  for (const path of paths) {
    const full = join(root, path);
    if (!existsSync(full)) continue;
    if (statSync(full).isDirectory()) console.log(`  ${path}/ — the description templates`);
    else console.log(`  ${path} (${readFileSync(full, "utf8").split("\n").length - 1} lines) — read it before merging`);
  }
}

/** Poll until CI on the head commit settles, printing each change of state. */
export function waitForCi(read: () => Ci): Ci {
  const start = Date.now();
  let last = "";
  for (;;) {
    const ci = read();
    const waited = (Date.now() - start) / 1000;
    if (ci.label !== last) {
      console.log(`${new Date().toTimeString().slice(0, 8)}  CI on the head commit: ${ci.label}`);
      last = ci.label;
    }
    if (ci.phase === "none" && waited >= NO_CI_GRACE_S) return ci;
    if (ci.phase === "running" && waited >= WAIT_TIMEOUT_S) {
      console.log(`gave up waiting after ${Math.round(waited)}s`);
      return ci;
    }
    if (ci.phase !== "none" && ci.phase !== "running") return ci;
    Bun.sleepSync(WAIT_POLL_MS);
  }
}

export function ciExitCode(ci: Ci): number {
  return CI_EXIT[ci.phase];
}
