// `claude-spore unfinished`: the session-start lines (docs/spec.md, p.9). One line per unfinished run
// of the database spore finds from here, saying where it is, what it waits for and why, then one
// hint naming the menu, so a new session shows a run its last one left without being asked, as
// `git status` shows an unfinished rebase. The menu (src/menu.ts) labels its rows with the same words.

const USAGE = "usage: claude-spore unfinished [--json]";

// Each spore call is cut off here, and the statuses run side by side, so the whole answer fits the
// mod's 10 s.
const LIMIT_MS = 4000;

// The kept error's words in a line stop here.
const GIST = 60;

export type Row = { runId: string; startKey?: string | null; nodeId?: string | null; needs?: string | null; since?: string | null; actor?: string | null };
type Attempt = { attempt?: string | number; maxAttempts?: string | number; state?: string };
type Kept = { code?: string | null; message?: string | null };
export type Status = {
  running?: Attempt | null;
  intervention?: (Attempt & { error?: Kept | null }) | null;
  step?: { actor?: string | null; deadlineMs?: string | number | null; holder?: { herdrAgent?: string | null } | null } | null;
  quarantine?: { code?: string | null; details?: unknown } | null;
};
export type Run = { row: Row; status: Status | null };

/**
 * The unfinished runs, those that need the person first, each part newest first, each with its
 * status. `runs` is null when spore is missing or cannot list, and empty inside a step, where spore
 * is asked nothing.
 */
export async function unfinishedRuns(): Promise<{ db: string | null; runs: Run[] | null }> {
  // A Claude that spore started for a step is not the person's session: its run is the one it works.
  if (process.env.RUNSPORE_RUN_ID || process.env.RUNSPORE_WORK_DIR) return { db: null, runs: [] };
  const listed = await spore(["list", "--unfinished", "--json"]);
  const rows: Row[] | null = Array.isArray(listed?.runs) ? listed.runs : null;
  const db: string | null = typeof listed?.db === "string" ? listed.db : null;
  if (!rows || !db) return { db: null, runs: null };
  const statuses = await Promise.all(rows.map((row) => spore(["status", row.runId, "--json", "--no-probe", "--db", db])));
  const runs = rows.map((row, i) => ({ row, status: statuses[i] ?? null }));
  return { db, runs: [...runs.filter(needsPerson), ...runs.filter((run) => !needsPerson(run))] };
}

/** A decision, a stuck step, a quarantine, or a step for the person to claim: the run waits for them. */
function needsPerson({ row }: Run): boolean {
  return ["signal", "stuck", "quarantined"].includes(row.needs ?? "") || (row.needs === "external-ready" && row.actor === "person");
}

// A try a worker holds goes on by itself: nothing to pick up.
function isRunning({ row, status }: Run): boolean {
  return Boolean(row.nodeId) && row.needs === "working" && status?.running?.state === "started";
}

export async function unfinished(argv: string[]): Promise<number> {
  const json = argv.length === 1 && argv[0] === "--json";
  if (argv.length > 0 && !json) {
    console.error(USAGE);
    return 2;
  }
  const { db, runs } = await unfinishedRuns();
  const now = Date.now();
  const lines = (runs ?? []).map(({ row, status }) => describe(row, status, now));
  const waiting = (runs ?? []).filter((run) => !isRunning(run)).length;
  if (waiting) lines.push(`/ml-workflow:menu to pick ${waiting === 1 ? "it" : "them"} up`);
  if (json) console.log(JSON.stringify({ db, lines }));
  else for (const text of lines) console.log(text);
  return db ? 0 : 1;
}

/** `coding-loop-0238a2a3 at implement, attempt 2 of 3, paused 14 min ago` */
export function describe(row: Row, status: Status | null, now: number): string {
  const name = row.startKey || row.runId;
  const since = Number(row.since);
  const age = Number.isFinite(since) ? duration(now - since) : null;
  const where = row.nodeId ? `${name} at ${row.nodeId}` : `${name}, not started yet`;
  const what = row.nodeId ? state(row, status, age) : age && `created ${age} ago`;
  return what ? `${where}, ${what}` : where;
}

// What the run waits for, in the words of the status skill. Every `needs` spore documents (cli.md,
// What a run needs) has its words; one it adds later reads as itself, as kubectl prints a pod phase
// it does not know.
function state(row: Row, status: Status | null, age: string | null): string {
  const ago = age ? ` ${age} ago` : "";
  const lasting = age ? ` for ${age}` : "";
  switch (row.needs) {
    case "working": {
      const running = status?.running;
      const tries = attempts(running);
      const prefix = tries ? `${tries}, ` : "";
      return running?.state === "started" ? `${prefix}running${lasting}` : `${prefix}paused${ago}`;
    }
    // A worker claimed the try and nothing works it any more: `spore continue` runs it again.
    case "driver":
      return `${attempts(status?.running) || "its try"} was cut off${ago}; nothing is running it`;
    case "signal":
      return `waiting for your decision${lasting}`;
    case "child":
      return `waiting for the runs it started${lasting}`;
    case "stuck": {
      const tries = attempts(status?.intervention);
      const error = status?.intervention?.error;
      return `stuck${tries ? ` after ${tries}` : ""}${lasting}${why(error?.code, error?.message)}`;
    }
    case "held": {
      const pane = status?.step?.holder?.herdrAgent;
      const holder = pane ? `its pane (${pane})` : row.actor || status?.step?.actor || "its holder";
      return `held by ${holder}${lasting}`;
    }
    case "external-ready":
      return `waiting for ${row.actor || "its actor"} to claim it${lasting}`;
    case "quarantined":
      return `quarantined${lasting}${why(status?.quarantine?.code, status?.quarantine?.details)}`;
    case "capability-missing":
      return `at a step this spore cannot run${lasting}`;
    default:
      return `${row.needs ?? "unfinished"}${lasting}`;
  }
}

// `: command.exit: connection refused`, the kept error's code and the first line of its words, cut
// short; nothing when spore keeps neither.
function why(code: string | null | undefined, words: unknown): string {
  const line = typeof words === "string" ? words.trim().split("\n")[0]!.trim() : "";
  const gist = line.length > GIST ? `${line.slice(0, GIST).replace(/\s+\S*$/, "")}…` : line;
  const parts = [code, gist].filter(Boolean);
  return parts.length ? `: ${parts.join(": ")}` : "";
}

// "attempt 2 of 3", or nothing when the status does not say.
function attempts(attempt: Attempt | null | undefined): string {
  const n = Number(attempt?.attempt);
  const of = Number(attempt?.maxAttempts);
  if (!Number.isInteger(n) || n < 1 || !Number.isInteger(of) || of < 1) return "";
  return `attempt ${n} of ${of}`;
}

/** `40 s`, `14 min`, `2 h`, `3 d`: the largest unit, rounded down. */
export function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 48 * 3600) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86400)} d`;
}

// One `spore … --json` call: its JSON on exit 0, else null.
async function spore(args: string[]): Promise<any> {
  const path = Bun.which("spore");
  if (!path) return null;
  try {
    const child = Bun.spawn([path, ...args], { stdin: "ignore", stdout: "pipe", stderr: "ignore", timeout: LIMIT_MS });
    const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    return code === 0 ? JSON.parse(stdout) : null;
  } catch {
    return null;
  }
}
