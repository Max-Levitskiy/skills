// The end-to-end check (docs/spec.md, p.25): the reference coding loop, copied from the bundled
// example, run by the real `spore`, the real `claude` and the real `herdr`, and killed at every row of
// the corrected C11 table, with `implement` in the background and watched in a herdr pane. At each row
// it reads what the person would see: the session-start line (`claude-spore unfinished`), the menu row
// (`claude-spore menu`), the run line (`claude-spore line`) and the live view (`claude-spore view`).
//
// It spends real Claude turns and opens herdr panes, so it is gated. `bun test` leaves it out, since
// its name does not end in `.spec.ts`; it runs only when named, before a release:
//
//     bun test --bail ./plugins/ml-workflow/test/reference-loop.e2e.ts
//
// `SPORE` names the spore, else the one on PATH; `E2E_MODEL` the model of `implement` (default
// `haiku`); `E2E_FORMS` the forms to run (default `background,interactive`).
//
// How each kill is made. A session that dies takes its follower with it: the follower's process group
// is killed outright, as spore's own check does (Web-tree/runspore `tests/coming_back.rs`). The points
// between a command's end and the next step are spore's failpoints, which abort the follower there. A
// machine that goes down takes the follower, the pane's Claude and its pane at once; its boot ID stays,
// so the probe finds it dead by its process, the branch a new boot ID shares.
//
// The tests step is a stand-in `npm` that the check makes red, or hang so that a kill lands inside a
// try. In the background form a `claude` shim on PATH logs each call and can hang before Claude
// starts; herdr starts the real `claude` for the pane, which hands in its answer with the installed
// plugin's `claude-spore`.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { VERSION } from "../src/cli.ts";
import { HELPER, PLUGIN_BIN, remove, scratch, SPORE } from "./helpers.ts";

// A row waits for real Claude turns and for a cut-off try's lease to run out, about 10 s each.
setDefaultTimeout(20 * 60_000);

const MODEL = process.env.E2E_MODEL ?? "haiku";
const FORMS = (process.env.E2E_FORMS ?? "background,interactive").split(",") as Form[];
const REAL_CLAUDE = Bun.which("claude");

// The path is spelled out: "the current folder" reads, to a small model, as the step's files folder
// the message also names, which is read-only.
const task = (project: string) =>
  `Create the file ${join(project, "hello.txt")} holding the single line \`hello\`, or leave it as it is when it already does. Change nothing else.`;

type Form = "background" | "interactive";

/** Logs each call as `calls/<n>.argv` and `.stdin`, hangs before Claude on the calls `claude.hang` lists, then runs the real one. */
const CLAUDE_SHIM = `#!/bin/sh
calls="$E2E_DIR/calls"
mkdir -p "$calls"
n=$(ls "$calls" | grep -c '\\.argv$')
cat > "$calls/$n.stdin"
for a in "$@"; do printf '%s\\0' "$a"; done > "$calls/next"
mv "$calls/next" "$calls/$n.argv"
if grep -qx "$n" "$E2E_DIR/claude.hang" 2>/dev/null; then sleep 3600; fi
exec "$E2E_CLAUDE" "$@" < "$calls/$n.stdin"
`;

/** The tests step: logs run \`n\` to \`npm.log\`, hangs on the runs \`npm.hang\` lists, red while \`red\` exists. Anyone else (Claude's Bash) is told green. */
const NPM = `#!/bin/sh
[ "$RUNSPORE_NODE_ID" = test ] || { echo "all passing"; exit 0; }
log="$E2E_DIR/npm.log"
n=$(cat "$log" 2>/dev/null | wc -l | tr -d ' ')
echo "$* $n" >> "$log"
if grep -qx "$n" "$E2E_DIR/npm.hang" 2>/dev/null; then sleep 3600; fi
if [ -f "$E2E_DIR/red" ]; then echo "1 failing: hello.txt (run $n)"; exit 1; fi
echo "all passing"
`;

/** What is missing for the form, or null when it can run. */
function missing(form: Form): string | null {
  if (!REAL_CLAUDE) return "no claude on PATH";
  const help = Bun.spawnSync([SPORE, "continue", "--help"]).stdout.toString();
  if (!help.includes("--wait") || Bun.spawnSync([SPORE, "cancel", "--help"]).exitCode !== 0) {
    return `the spore at ${SPORE} has no \`continue --wait\` or no \`cancel\`; set SPORE to one that has both`;
  }
  const doctor = Bun.spawnSync([HELPER, "doctor", "--json"], { env: { ...process.env, PATH: `${dirname(SPORE)}:${process.env.PATH}` } });
  if (doctor.exitCode !== 0) return `claude-spore doctor: ${doctor.stdout.toString()}${doctor.stderr.toString()}`;
  if (form === "interactive") {
    const server = Bun.spawnSync(["herdr", "status", "server", "--json"]).stdout.toString();
    if (!server.includes('"running":true')) return `no herdr server runs: ${server || "herdr did not answer"}`;
    // The pane's Claude reports with the `claude-spore` Claude Code puts on its Bash PATH: the
    // installed plugin's, at user scope, since each project here is new.
    const installed = userInstall();
    if (!installed) return "ml-workflow is not installed at user scope, so the pane's Claude has no claude-spore to report with; run `/plugin install ml-workflow@max-skills`";
    if (installed !== VERSION) console.warn(`the installed ml-workflow is ${installed}, this checkout is ${VERSION}: the pane reports with ${installed}`);
  }
  return null;
}

/** The version of ml-workflow installed at user scope, as Claude Code's registry lists it. */
function userInstall(): string | null {
  try {
    const file = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "plugins", "installed_plugins.json");
    const entries = JSON.parse(readFileSync(file, "utf8")).plugins?.["ml-workflow@max-skills"];
    const user = Array.isArray(entries) ? entries.find((entry) => entry?.scope === "user") : undefined;
    return typeof user?.version === "string" ? user.version : null;
  } catch {
    return null;
  }
}

type Ended = { code: number | null; signal: string | null; json: any; stdout: string; stderr: string };
type Process = { pid: number; done: Promise<Ended> };
type Shown = { needs: string | null; options: string[]; line: RegExp; needsYou: boolean; here?: string };

function parse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function until<T>(what: string, check: () => T | null | undefined | false, ms = 10 * 60_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`${what} never happened`);
    await Bun.sleep(250);
  }
}

function herdr(...args: string[]): any {
  const child = Bun.spawnSync(["herdr", ...args]);
  return child.exitCode === 0 ? (parse(child.stdout.toString()) ?? child.stdout.toString()) : null;
}

/** Claude's transcript of the session, in any project folder (docs/spec.md, p.17). */
function transcript(session: string): string | null {
  const projects = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "projects");
  for (const folder of existsSync(projects) ? readdirSync(projects) : []) {
    const file = join(projects, folder, `${session}.jsonl`);
    if (existsSync(file)) return file;
  }
  return null;
}

/**
 * The projects' folder. Claude Code asks once whether to trust a folder it has not seen, and a pane
 * that asks has not started on its message yet. A person has answered that for their repository
 * before; the check answers it once for this folder, which every project sits in.
 */
const ROOT = scratch();
const TRUST = /trust (this|the files in this) folder/i;

async function trust(folder: string): Promise<void> {
  const pane = herdr("workspace", "create", "--label", "e2e-trust", "--cwd", folder, "--no-focus")?.result?.root_pane?.pane_id;
  if (!pane) throw new Error("herdr opened no pane to answer Claude Code's trust question");
  try {
    herdr("agent", "start", "e2e-trust", "--kind", "claude", "--pane", pane, "--timeout", "60000");
    const screen = () => JSON.stringify(herdr("agent", "read", pane, "--source", "visible") ?? "");
    const asked = await until(
      "Claude Code ready or asking about the folder",
      () => (TRUST.test(screen()) ? "asked" : herdr("agent", "get", "e2e-trust")?.result?.agent?.agent_status === "idle" ? "ready" : null),
      60_000,
    );
    if (asked === "asked") {
      herdr("agent", "send-keys", pane, "Enter");
      await until("Claude Code past the trust question", () => !TRUST.test(screen()), 30_000);
    }
  } finally {
    herdr("pane", "close", pane);
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** One project with the reference loop installed, the stand-ins in a control folder beside it. */
class Project {
  readonly dir = mkdtempSync(join(ROOT, "project-"));
  readonly ctl = scratch();
  readonly real = realpathSync(this.dir);
  readonly env: Record<string, string>;
  db = "";

  constructor(readonly form: Form) {
    const bin = join(this.ctl, "bin");
    mkdirSync(bin);
    for (const [name, text] of [["claude", CLAUDE_SHIM], ["npm", NPM]] as const) {
      writeFileSync(join(bin, name), text);
      chmodSync(join(bin, name), 0o755);
    }
    // No RUNSPORE_ variable from outside: a check run inside a spore step would make each run its child.
    const outside = Object.entries(process.env).filter(([key]) => !key.startsWith("RUNSPORE_")) as [string, string][];
    this.env = {
      ...Object.fromEntries(outside),
      PATH: [bin, PLUGIN_BIN, dirname(SPORE), dirname(process.execPath), process.env.PATH].join(":"),
      E2E_DIR: this.ctl,
      E2E_CLAUDE: REAL_CLAUDE!,
    };
    expect(this.spore("init").code).toBe(0);
    const folder = join(this.dir, ".spore", "workflows", "coding-loop");
    const copied = this.helper("example", "copy", "coding-loop", folder, ...(form === "interactive" ? ["--watch", "implement"] : []));
    expect(copied.code).toBe(0);
    const file = join(folder, "settings.json");
    const settings = JSON.parse(readFileSync(file, "utf8"));
    settings.nodes.implement.input.model = { $literal: MODEL };
    writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
    expect(this.spore("validate", "coding-loop").code).toBe(0);
    expect(this.helper("check", folder).code).toBe(0);
    this.db = this.spore("list", "--json").json.db;
  }

  run(command: string, args: string[], env: Record<string, string> = {}): Ended {
    const child = Bun.spawnSync([command, ...args], { cwd: this.dir, env: { ...this.env, ...env } });
    const stdout = child.stdout.toString();
    return { code: child.exitCode, signal: child.signalCode ?? null, json: parse(stdout), stdout, stderr: child.stderr.toString() };
  }

  spore(...args: string[]): Ended {
    return this.run(SPORE, args);
  }

  helper(...args: string[]): Ended {
    return this.run(HELPER, args);
  }

  /** `spore start` as the start skill runs it; a failpoint aborts it there. */
  start(key: string, failpoint?: string): Ended {
    return this.run(SPORE, ["start", "coding-loop", "--key", key, "--input", JSON.stringify({ task: task(this.real) }), "--json"], failpoint ? { RUNSPORE_FAILPOINTS: failpoint } : {});
  }

  /** The session's follower, in a process group of its own as a Bash tool's background command is. */
  follower(run: string, failpoint?: string): Process {
    const env = { ...this.env, ...(failpoint ? { RUNSPORE_FAILPOINTS: failpoint } : {}) };
    const child = spawn(SPORE, ["continue", run, "--wait", "--json", "--db", this.db], { cwd: this.dir, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => (stdout += data));
    child.stderr.on("data", (data) => (stderr += data));
    const done = new Promise<Ended>((resolve) => child.on("close", (code, signal) => resolve({ code, signal, json: parse(stdout), stdout, stderr })));
    return { pid: child.pid!, done };
  }

  /**
   * Follows the run until it needs a person, as the skills do. A watched step's pane that waits for
   * the person, here only for the folder's trust question, is answered and followed again.
   */
  async follow(run: string): Promise<any> {
    for (;;) {
      const ended = await this.follower(run).done;
      expect(ended.json, ended.stderr).toBeDefined();
      if (ended.json.needs !== "held" || ended.json.step?.waiting !== "person") return ended.json;
      await this.tend();
    }
  }

  /** The session dies: its follower's process group is killed outright. */
  async killSession(follower: Process): Promise<void> {
    try {
      process.kill(-follower.pid, "SIGKILL");
    } catch {}
    await follower.done;
  }

  status(run: string): any {
    return this.spore("status", run, "--json", "--db", this.db).json;
  }

  /** The step's holder once a watched `implement` holds its try, answering the trust question meanwhile. */
  async held(run: string): Promise<{ herdrAgent: string; pid: number; session: string }> {
    return until(`${run} held by a pane`, () => {
      void this.tend();
      const step = this.status(run)?.step;
      return step?.state === "held" && step.holder?.herdrAgent ? step.holder : null;
    });
  }

  /** Answers Claude Code's question whether to trust the project folder, in any pane opened in it. */
  async tend(): Promise<void> {
    if (this.form !== "interactive") return;
    for (const agent of herdr("agent", "list")?.result?.agents ?? []) {
      if (typeof agent.cwd !== "string" || !realpathSync(agent.cwd).startsWith(this.real)) continue;
      const screen = JSON.stringify(herdr("agent", "read", agent.pane_id, "--source", "visible"));
      if (/trust (this|the files in this) folder/i.test(screen)) herdr("agent", "send-keys", agent.pane_id, "Enter");
    }
  }

  /** The `claude -p` calls of the background form, in order. */
  calls(): { argv: string[]; stdin: string }[] {
    const dir = join(this.ctl, "calls");
    if (!existsSync(dir)) return [];
    const count = readdirSync(dir).filter((f) => f.endsWith(".argv")).length;
    return Array.from({ length: count }, (_, n) => ({
      argv: readFileSync(join(dir, `${n}.argv`), "utf8").replace(/\0$/, "").split("\0"),
      stdin: readFileSync(join(dir, `${n}.stdin`), "utf8"),
    }));
  }

  /** The status of each step result spore recorded for the run, in order. */
  results(run: string): string[] {
    const events: { kind: string; payload: { status: string } }[] = this.spore("events", run, "--json", "--db", this.db).json.events;
    return events.filter((e) => e.kind === "activity.result").map((e) => e.payload.status);
  }

  testRuns(): number {
    const log = join(this.ctl, "npm.log");
    return existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).length : 0;
  }

  hang(program: "claude" | "npm", calls: number[]) {
    writeFileSync(join(this.ctl, `${program}.hang`), calls.map((n) => `${n}\n`).join(""));
  }

  red(on: boolean) {
    const file = join(this.ctl, "red");
    if (on) writeFileSync(file, "");
    else rmSync(file, { force: true });
  }

  /** What the person sees of the run: the start line, the menu row, the run line and the live view. */
  shows(run: string, key: string, want: Shown) {
    const listed = this.spore("list", "--unfinished", "--json").json.runs.find((r: { runId: string }) => r.runId === run);
    expect(listed?.needs ?? null).toBe(want.needs);
    const lines: string[] = this.helper("unfinished", "--json").json?.lines ?? [];
    const rows: { key: string; options: { label: string }[] }[] = this.helper("menu", "--json").json.rows;
    const row = rows.find((r) => r.key === `run:${run}`);
    if (want.needs === null) {
      expect(lines.some((l) => l.startsWith(key))).toBe(false);
      expect(row).toBeUndefined();
    } else {
      expect(lines.some((l) => l.startsWith(key))).toBe(true);
      expect(row?.options.map((o) => o.label)).toEqual(want.options);
    }
    const line = this.helper("line", run, "--db", this.db, "--json").json;
    expect(line.text).toMatch(want.line);
    expect(line.needsYou).toBe(want.needsYou);
    const view = this.helper("view", run, "--db", this.db, "--json").json;
    if (want.here) {
      expect(view.facts).toContain(`at ${want.here}`);
      expect(view.dot.filter((l: { mark: string | null }) => l.mark === "here").map((l: { text: string }) => l.text.trim())).toContainEqual(expect.stringMatching(new RegExp(`^${want.here}\\b`)));
    }
  }

  dispose() {
    for (const agent of herdr("agent", "list")?.result?.agents ?? []) {
      if (typeof agent.cwd === "string" && existsSync(agent.cwd) && realpathSync(agent.cwd).startsWith(this.real)) herdr("pane", "close", agent.pane_id);
    }
    remove(this.dir);
    remove(this.ctl);
  }
}

const WORKING = ["Continue", "View", "Cancel"];
const HELD = ["Open its pane", "Continue", "Abandon", "View", "Cancel"];
const STUCK = ["Retry", "Mark done", "Fail", "View", "Cancel"];
const DECIDE = ["Decide", "View", "Cancel"];

for (const form of FORMS) {
  const why = missing(form);
  if (why) console.warn(`skipping the ${form} form of reference-loop.e2e.ts: ${why}`);
  const background = form === "background";

  describe.skipIf(why !== null)(`the reference loop, implement ${background ? "in the background" : "watched in a herdr pane"}`, () => {
    const projects: Project[] = [];
    const project = () => {
      const p = new Project(form);
      projects.push(p);
      return p;
    };
    beforeAll(async () => {
      if (!background) await trust(ROOT);
    });
    afterAll(() => {
      for (const p of projects) p.dispose();
    });

    describe("from the menu to approval, killed at each point on the way", () => {
      let p: Project;
      let run: string;
      const key = `e2e-${form}-a`;
      beforeAll(() => {
        p = project();
      });

      test("starting, before spore start returned: no run, then a run with nothing started", () => {
        expect(p.start(key, "store.create-run.before-commit").code).toBeNull();
        expect(p.spore("list", "--unfinished", "--json").json.runs).toEqual([]);
        expect(p.helper("unfinished", "--json").json.lines).toEqual([]);
        expect(p.helper("menu", "--json").json.rows.map((r: { key: string }) => r.key)).toEqual(["start", "author"]);

        expect(p.start(key, "store.create-run.after-commit").code).toBeNull();
        run = p.spore("list", "--unfinished", "--json").json.runs[0].runId;
        p.shows(run, key, { needs: "working", options: WORKING, line: new RegExp(`^${key}, not started yet$`), needsYou: false });
      });

      if (background) {
        test("implement, try 1 cut off mid-turn: working, and try 2 resumes the same conversation", async () => {
          const follower = p.follower(run);
          const session = await until("Claude's first turn", () => {
            const call = p.calls()[0];
            return call && transcript(call.argv[call.argv.indexOf("--session-id") + 1]!) ? call.argv[call.argv.indexOf("--session-id") + 1] : null;
          });
          await p.killSession(follower);
          expect(p.status(run)).toMatchObject({ status: "running", position: { nodeId: "implement" } });
          p.shows(run, key, { needs: "working", options: WORKING, line: new RegExp(`^${key} at implement.*, try 1/3$`), needsYou: false, here: "implement" });

          // Coming back: the next try resumes once the lease has run out, and Claude finishes. The
          // failpoint is the session dying again after Claude answered, before spore recorded it.
          const again = await p.follower(run, "host.attempt.after-effect").done;
          expect(again.signal).toBe("SIGABRT");
          const [first, second] = p.calls();
          expect(first!.argv.slice(0, 6)).toContain("--session-id");
          expect(second!.argv).toContain("--resume");
          expect(second!.argv[second!.argv.indexOf("--resume") + 1]).toBe(session!);
          expect(second!.stdin).toStartWith("You were cut off before you finished this step.");
          expect(readFileSync(join(p.dir, "hello.txt"), "utf8").trim()).toBe("hello");
          expect(p.status(run)).toMatchObject({ status: "running", position: { nodeId: "implement" } });
          p.shows(run, key, { needs: "working", options: WORKING, line: new RegExp(`^${key} at implement.*, try 2/3$`), needsYou: false, here: "implement" });
        });

        test("implement finished, its answer not recorded: try 3 resumes and answers again, then the run stops between steps", async () => {
          const again = await p.follower(run, "host.attempt.after-finish").done;
          expect(again.signal).toBe("SIGABRT");
          const calls = p.calls();
          expect(calls).toHaveLength(3);
          expect(calls[2]!.argv).toContain("--resume");
          expect(calls[2]!.stdin).toStartWith("You were cut off");
          // The cut-off tries recorded nothing of their own: each expired once its lease ran out.
          expect(p.results(run)).toEqual(["expired", "expired", "success"]);
          expect(p.testRuns()).toBe(0);
          p.shows(run, key, { needs: "working", options: WORKING, line: new RegExp(`^${key} at (implement|test)\\b`), needsYou: false });
        });
      } else {
        test("implement watched, the session dies: held, the pane keeps working, and Continue runs the watch again", async () => {
          const follower = p.follower(run);
          const holder = await p.held(run);
          await p.killSession(follower);
          expect(alive(holder.pid)).toBe(true);
          p.shows(run, key, { needs: "held", options: HELD, line: new RegExp(`^${key} at implement`), needsYou: false, here: "implement" });

          // Coming back: the watch takes the pane's answer; the failpoint stops the run between steps.
          for (;;) {
            const again = await p.follower(run, "host.attempt.after-finish").done;
            if (again.signal === "SIGABRT") break;
            expect(again.json).toMatchObject({ needs: "held", step: { waiting: "person" } });
            await p.tend();
          }
          expect(readFileSync(join(p.dir, "hello.txt"), "utf8").trim()).toBe("hello");
          expect(transcript(holder.session)).not.toBeNull();
          await until("the pane closed as the run left implement", () => herdr("agent", "get", holder.herdrAgent) === null);
          expect(p.results(run).at(-1)).toBe("success");
          expect(p.testRuns()).toBe(0);
          p.shows(run, key, { needs: "working", options: WORKING, line: new RegExp(`^${key} at (implement|test)\\b`), needsYou: false });
        });
      }

      test("between steps, then test try 1 cut off: Continue runs the tests again, implement not", async () => {
        const claudeCalls = p.calls().length;
        p.hang("npm", [0]);
        const follower = p.follower(run);
        await until("the first test run", () => p.testRuns() === 1);
        await p.killSession(follower);
        expect(p.calls()).toHaveLength(claudeCalls);
        expect(p.status(run)).toMatchObject({ status: "running", position: { nodeId: "test" } });
        p.shows(run, key, { needs: "working", options: WORKING, line: new RegExp(`^${key} at test.*, try 1/3$`), needsYou: false, here: "test" });

        // Red from here: three reds go back to implement in the same conversation, the fourth runs out.
        p.red(true);
        const stuck = await p.follow(run);
        expect(stuck).toMatchObject({ needs: "signal", position: { nodeId: "tests_stuck", from: { nodeId: "test", outcome: "exhausted" } } });
        expect(p.testRuns()).toBe(5);
        if (background) {
          const visits = p.calls().slice(claudeCalls);
          expect(visits).toHaveLength(3);
          for (const [i, call] of visits.entries()) expect(call.stdin).toStartWith(`The run came back to this step: this is its visit ${i + 2}.`);
        }
        p.shows(run, key, { needs: "signal", options: DECIDE, line: new RegExp(`^${key} at tests_stuck.*, from test on exhausted`), needsYou: true, here: "tests_stuck" });
      });

      test("a decision sent, not yet acted on: working, and the same decision again changes nothing", async () => {
        p.red(false);
        const id = p.status(run).position.activationId;
        const send = () =>
          p.spore("signal", run, "tests-stuck", "--outcome", "keep-going", "--data", JSON.stringify({ hint: "Check hello.txt." }), "--id", id, "--db", p.db, "--json");
        expect(send().code).toBe(0);
        p.shows(run, key, { needs: "working", options: WORKING, line: new RegExp(`^${key} at tests_stuck`), needsYou: false });
        expect(send().code).toBe(0);

        const approve = await p.follow(run);
        expect(approve).toMatchObject({ needs: "signal", position: { nodeId: "approve", from: { nodeId: "test", outcome: "ok" } } });
        if (background) expect(p.calls().at(-1)!.stdin).toContain("Check hello.txt.");
        p.shows(run, key, { needs: "signal", options: DECIDE, line: new RegExp(`^${key} at approve.*, from test on ok`), needsYou: true, here: "approve" });
      });

      test("rejected with a reason, then approved: the run completes and leaves the start line and the menu", async () => {
        const reject = p.status(run).position.activationId;
        expect(p.spore("signal", run, "approval", "--outcome", "rejected", "--data", JSON.stringify({ reason: "Say hello in hello.txt." }), "--id", reject, "--db", p.db, "--json").code).toBe(0);
        const again = await p.follow(run);
        expect(again).toMatchObject({ needs: "signal", position: { nodeId: "approve" } });
        if (background) expect(p.calls().at(-1)!.stdin).toContain("Say hello in hello.txt.");

        const approve = p.status(run).position.activationId;
        expect(p.spore("signal", run, "approval", "--outcome", "approved", "--id", approve, "--db", p.db, "--json").code).toBe(0);
        expect(await p.follow(run)).toMatchObject({ status: "completed", needs: null });
        p.shows(run, key, { needs: null, options: [], line: new RegExp(`^${key} completed at done, from approve on approved$`), needsYou: false });

        if (background) {
          // One conversation for the whole run: every later call resumed the first.
          const [first, ...rest] = p.calls();
          const session = first!.argv[first!.argv.indexOf("--session-id") + 1];
          for (const call of rest) expect(call.argv[call.argv.indexOf("--resume") + 1]).toBe(session!);
        }
      });
    });

    describe("stuck steps, Retry, and Cancel", () => {
      let p: Project;
      let run: string;
      const key = `e2e-${form}-b`;
      beforeAll(() => {
        p = project();
        expect(p.start(key).code).toBe(0);
        run = p.spore("list", "--unfinished", "--json").json.runs[0].runId;
      });

      test(background ? "implement, try 3 cut off: stuck, and Retry's try 4 resumes the same conversation" : "implement watched, the machine goes down three times: each try opens a new pane and resumes, then stuck, and Retry resumes again", async () => {
        if (background) {
          // Try 1 is cut off mid-turn; tries 2 and 3 before Claude starts.
          p.hang("claude", [1, 2]);
          const first = p.follower(run);
          await until("Claude's first turn", () => {
            const call = p.calls()[0];
            return call && transcript(call.argv[call.argv.indexOf("--session-id") + 1]!);
          });
          await p.killSession(first);
          for (const n of [1, 2]) {
            const follower = p.follower(run);
            await until(`claude call ${n}`, () => p.calls().length > n);
            await p.killSession(follower);
          }
        } else {
          const pids: number[] = [];
          for (let n = 0; n < 3; n++) {
            const follower = p.follower(run);
            const holder = await until(`try ${n + 1}'s pane`, () => {
              void p.tend();
              const step = p.status(run)?.step;
              return step?.state === "held" && step.holder?.pid && !pids.includes(step.holder.pid) ? step.holder : null;
            });
            pids.push(holder.pid);
            // The machine goes down: the follower, the pane's Claude and its pane, all at once.
            const pane = herdr("agent", "get", holder.herdrAgent)?.result?.agent?.pane_id;
            process.kill(holder.pid, "SIGKILL");
            if (pane) herdr("pane", "close", pane);
            await p.killSession(follower);
            p.shows(run, key, { needs: "held", options: HELD, line: new RegExp(`^${key} at implement.*, try ${n + 1}/3$`), needsYou: false, here: "implement" });
          }
        }
        const stuck = await p.follow(run);
        expect(stuck).toMatchObject({ needs: "stuck", intervention: { nodeId: "implement", error: { code: "activity.attempts-exhausted" } } });
        p.shows(run, key, { needs: "stuck", options: STUCK, line: new RegExp(`^${key} at implement.*, try 3/3$`), needsYou: true, here: "implement" });

        // Retry, and the tests hang on their first three runs, so the run stops at test.
        p.hang("npm", [0, 1, 2]);
        expect(p.spore("resolve", run, "--retry", "--db", p.db).code).toBe(0);
        const follower = p.follower(run);
        await until("the first test run", () => p.testRuns() === 1 || null);
        await p.killSession(follower);
        expect(readFileSync(join(p.dir, "hello.txt"), "utf8").trim()).toBe("hello");
        if (background) {
          const retried = p.calls()[3]!;
          expect(retried.argv[retried.argv.indexOf("--resume") + 1]).toBe(p.calls()[0]!.argv[p.calls()[0]!.argv.indexOf("--session-id") + 1]!);
          expect(retried.stdin).toStartWith("You were cut off");
        }
      });

      test("test, try 3 cut off: stuck, Retry runs the tests again, then Cancel at approval ends the run", async () => {
        for (const n of [1, 2]) {
          const follower = p.follower(run);
          await until(`test run ${n + 1}`, () => p.testRuns() === n + 1 || null);
          await p.killSession(follower);
        }
        const stuck = await p.follow(run);
        expect(stuck).toMatchObject({ needs: "stuck", intervention: { nodeId: "test", error: { code: "activity.attempts-exhausted" } } });
        p.shows(run, key, { needs: "stuck", options: STUCK, line: new RegExp(`^${key} at test.*, try 3/3$`), needsYou: true, here: "test" });

        expect(p.spore("resolve", run, "--retry", "--db", p.db).code).toBe(0);
        expect(await p.follow(run)).toMatchObject({ needs: "signal", position: { nodeId: "approve" } });
        expect(p.testRuns()).toBe(4);

        const before = p.calls().length;
        expect(p.spore("cancel", run, "--json", "--db", p.db).json).toMatchObject({ status: "cancelled" });
        expect(await p.follow(run)).toMatchObject({ status: "cancelled", needs: null });
        expect(p.calls()).toHaveLength(before);
        p.shows(run, key, { needs: null, options: [], line: new RegExp(`^${key} cancelled at approve$`), needsYou: false });
      });
    });

    test(background ? "Cancel while implement works: Claude stops and the run ends" : "Cancel while the pane works: its pane closes and the run ends", async () => {
      const p = project();
      const key = `e2e-${form}-c`;
      expect(p.start(key).code).toBe(0);
      const run = p.spore("list", "--unfinished", "--json").json.runs[0].runId;
      const follower = p.follower(run);
      let pid: number | null = null;
      let agent: string | null = null;
      if (background) {
        await until("Claude's first turn", () => p.calls()[0]);
      } else {
        const holder = await p.held(run);
        pid = holder.pid;
        agent = holder.herdrAgent;
      }
      expect(p.spore("cancel", run, "--json", "--db", p.db).json).toMatchObject({ status: "cancelled" });
      expect((await follower.done).json).toMatchObject({ status: "cancelled", needs: null });
      if (agent) {
        expect(herdr("agent", "get", agent)).toBeNull();
        await until("the pane's Claude gone", () => !alive(pid!));
      }
      p.shows(run, key, { needs: null, options: [], line: new RegExp(`^${key} cancelled at implement$`), needsYou: false });
    });
  });
}

afterAll(() => remove(ROOT));
