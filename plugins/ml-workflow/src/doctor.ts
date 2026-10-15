// `claude-spore doctor`: whether the `spore` on PATH is one the plugin drives, whether the helper
// is the version the mod loaded with, and whether to offer the launcher (docs/spec.md, p.3, p.5).
import { accessSync, constants, existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, sep } from "node:path";

import { VERSION } from "./cli.ts";
import { SPORE_CONTRACTS, SPORE_MINIMUM, inRange, isOlder } from "./version.ts";

export type Problem = { code: string; message: string; fix: string | null };
export type Spore = { path: string; version: string };
export type Launcher = "installed" | "offer" | "declined";

export const INSTALL_COMMAND = "claude-spore install-spore";
const CARGO_COMMAND = "cargo install --git https://github.com/Web-tree/runspore --locked --force runspore-cli";

export function home(): string {
  return process.env.HOME || homedir();
}

export function localBin(): string {
  return join(home(), ".local", "bin");
}

/** The plugin's data folder, where the launcher offer is remembered. */
export function dataDir(): string {
  const claude = process.env.CLAUDE_CONFIG_DIR || join(home(), ".claude");
  return process.env.CLAUDE_PLUGIN_DATA || join(claude, "plugins", "data", "ml-workflow-max-skills");
}

/**
 * Where an install or update of spore writes: the PATH copy with its symlinks followed, else
 * `~/.local/bin/spore`. `fix` is the command that updates it, the owner's when it is not writable.
 */
export function sporeTarget(): { found: string | null; target: string; writable: boolean; fix: string } {
  const found = Bun.which("spore");
  if (!found) return { found: null, target: join(localBin(), "spore"), writable: true, fix: INSTALL_COMMAND };
  const target = realpathSync(found);
  if (writable(target)) return { found, target, writable: true, fix: INSTALL_COMMAND };
  const cargo = join(process.env.CARGO_HOME || join(home(), ".cargo"), "bin");
  const fix = isInside(target, cargo)
    ? CARGO_COMMAND
    : `curl -fsSL https://raw.githubusercontent.com/Web-tree/runspore/main/install.sh | sudo env SPORE_INSTALL_DIR=${dirname(target)} sh`;
  return { found, target, writable: false, fix };
}

/** Runs `spore capabilities --json` on the PATH copy and says what does not fit. */
export function checkSpore(): { spore: Spore | null; problems: Problem[] } {
  const where = sporeTarget();
  if (!where.found) {
    const message = `ml-workflow needs spore ${SPORE_MINIMUM} or later, and none is on PATH. Install it with: ${INSTALL_COMMAND}`;
    return { spore: null, problems: [{ code: "spore.missing", message, fix: INSTALL_COMMAND }] };
  }
  const path = where.found;
  const found = misfit(path);
  if (!found.problem) return { spore: found.spore, problems: [] };
  const how = where.writable ? "Update it with" : `${where.target} is not writable here; update it with`;
  const message = `ml-workflow needs spore ${SPORE_MINIMUM} or later; ${found.problem.text}. ${how}: ${where.fix}`;
  return { spore: found.spore, problems: [{ code: found.problem.code, message, fix: where.fix }] };
}

// What in `spore capabilities --json` does not fit, if anything.
function misfit(path: string): { spore: Spore | null; problem?: { code: string; text: string } } {
  let answer: unknown;
  try {
    const child = Bun.spawnSync([path, "capabilities", "--json"], { timeout: 5000, stdin: "ignore" });
    answer = child.exitCode === 0 ? JSON.parse(child.stdout.toString()) : undefined;
  } catch {
    answer = undefined;
  }
  if (!isObject(answer)) return { spore: null, problem: { code: "spore.old", text: `${path} does not answer \`spore capabilities\`` } };

  const version = answer.version;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+/.test(version)) {
    return { spore: null, problem: { code: "spore.version", text: `${path} names no version` } };
  }
  const spore = { path, version };
  if (isOlder(version, SPORE_MINIMUM)) return { spore, problem: { code: "spore.version", text: `${path} is ${version}` } };

  const contracts = isObject(answer.contracts) ? answer.contracts : {};
  const wrong = Object.entries(SPORE_CONTRACTS).flatMap(([name, need]) => {
    const have = contracts[name];
    if (typeof have !== "string") return [`no ${name} contract`];
    return inRange(have, need) ? [] : [`${name} ${have} where ${need} is needed`];
  });
  if (wrong.length === 0) return { spore };
  return { spore, problem: { code: "spore.contract", text: `${path} (${version}) has ${wrong.join(", ")}` } };
}

export function launcherState(): Launcher {
  if (existsSync(join(localBin(), "claude-spore"))) return "installed";
  return existsSync(join(dataDir(), "launcher-offered")) ? "declined" : "offer";
}

const USAGE = "usage: claude-spore doctor [--json] [--plugin-version <version>]";

export function doctor(argv: string[]): number {
  let json = false;
  let pluginVersion: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--json") json = true;
    else if (argv[i] === "--plugin-version" && argv[i + 1] !== undefined) pluginVersion = argv[++i];
    else {
      console.error(USAGE);
      return 2;
    }
  }

  const problems: Problem[] = [];
  if (pluginVersion !== undefined && pluginVersion !== VERSION) {
    problems.push({
      code: "plugin.reload",
      message: `ml-workflow changed since this session loaded it (helper ${VERSION}, session ${pluginVersion}). Run /reload-plugins, then try again.`,
      fix: null,
    });
  }
  const checked = checkSpore();
  problems.push(...checked.problems);

  if (json) {
    console.log(JSON.stringify({ ok: problems.length === 0, spore: checked.spore, problems, launcher: launcherState() }));
  } else {
    for (const problem of problems) console.log(problem.message);
  }
  return problems.length === 0 ? 0 : 1;
}

function writable(path: string): boolean {
  try {
    accessSync(path, constants.W_OK);
    accessSync(dirname(path), constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function isInside(path: string, folder: string): boolean {
  const rel = relative(folder, path);
  return rel !== "" && !rel.startsWith("..") && !rel.startsWith(sep);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
