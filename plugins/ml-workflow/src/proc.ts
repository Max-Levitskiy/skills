// Processes as the interactive step sees them (docs/spec.md, p.17): `start` and `probe` read the
// boot ID and a process's start time with these same functions, so the two always agree.
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { basename } from "node:path";

export function machine(): string {
  return hostname();
}

/** The machine's boot ID, or null when it cannot be read. */
export function bootId(): string | null {
  if (process.platform === "linux") {
    try {
      return readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim() || null;
    } catch {
      return null;
    }
  }
  const out = output(["sysctl", "-n", "kern.boottime"]);
  const match = out && /sec\s*=\s*(\d+),\s*usec\s*=\s*(\d+)/.exec(out);
  return match ? `${match[1]}.${match[2]}` : null;
}

/**
 * The start time of process `pid` as a string in the system's own form: on Linux field 22 of
 * `/proc/<pid>/stat` (clock ticks since boot), elsewhere `ps -o lstart=` in UTC. Null when no
 * process has that PID or it cannot be read.
 */
export function startTime(pid: number): string | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (process.platform === "linux") {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      // The command name, field 2, is in parentheses and may hold spaces or parentheses itself.
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      return fields[19] ?? null;
    } catch {
      return null;
    }
  }
  return output(["ps", "-o", "lstart=", "-p", String(pid)], { LC_ALL: "C", TZ: "UTC" }) || null;
}

const NOT_CLAUDE = new Set(["herdr", "sh", "bash", "zsh", "dash", "fish", "env", "claude-spore"]);

/**
 * The PID of the Claude process that holds `session`: the one whose arguments carry
 * `--session-id <session>` or `--resume <session>`, leaving out herdr, shells and the helper.
 * The newest when several do; null when none does.
 */
export function sessionProcess(session: string): number | null {
  const out = output(["ps", "-A", "-ww", "-o", "pid=", "-o", "args="]);
  if (!out) return null;
  let found: number | null = null;
  for (const line of out.split("\n")) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    const args = match[2]!;
    if (pid === process.pid) continue;
    if (!args.includes(`--session-id ${session}`) && !args.includes(`--resume ${session}`)) continue;
    // The helper itself runs as `bun …/claude-spore …`.
    const [program = "", script = ""] = args.split(" ");
    if (NOT_CLAUDE.has(basename(program)) || basename(script) === "claude-spore") continue;
    if (found === null || pid > found) found = pid;
  }
  return found;
}

function output(argv: string[], env: Record<string, string> = {}): string | null {
  try {
    const child = Bun.spawnSync(argv, { env: { ...process.env, ...env }, stderr: "ignore" });
    return child.exitCode === 0 ? child.stdout.toString().trim() : null;
  } catch {
    return null;
  }
}
