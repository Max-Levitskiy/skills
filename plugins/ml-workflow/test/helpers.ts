// Shared by the specs: the helper run as a subprocess with the fake `claude` and `herdr` first on
// PATH.
import { setDefaultTimeout } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { SPORE_MINIMUM, isOlder } from "../src/version.ts";

export const HELPER = join(import.meta.dir, "..", "bin", "claude-spore");
export const FAKE_BIN = join(import.meta.dir, "fixtures", "bin");
export const PLUGIN_BIN = join(import.meta.dir, "..", "bin");

// A test runs real processes: a spore call takes about 0.3s on a fast Mac, so a test of eight
// calls is near Bun's 5s default on a CI runner. The limit stays to catch a hang.
setDefaultTimeout(30_000);

/** PATH with the fake `claude` and `herdr`, then `claude-spore`, then the Bun running the specs. */
export const PATH = [FAKE_BIN, PLUGIN_BIN, dirname(process.execPath), process.env.PATH].join(":");

/** The real `spore`: $SPORE, else the one on PATH. */
export const SPORE = process.env.SPORE ?? Bun.which("spore") ?? "spore";

/**
 * The per-test timeout of a spec that drives real `spore` runs. Each test there waits on several
 * `spore` and helper processes in turn, which on a CI runner takes longer than Bun's 5 s default.
 */
export const SPORE_TIMEOUT_MS = 30_000;

/**
 * The real spore's version when it is the oldest supported one or later, else null: a spec that
 * needs it is skipped, with the reason printed, unless REQUIRE_SPORE=1 (CI) makes that a failure.
 */
export function sporeVersion(spec: string): string | null {
  let version: string | null = null;
  try {
    const child = Bun.spawnSync([SPORE, "--version"]);
    version = /^spore (\d+\.\d+\.\d+)/.exec(child.stdout.toString())?.[1] ?? null;
  } catch {}
  if (version && isOlder(version, SPORE_MINIMUM)) version = null;
  if (!version) {
    const reason = `no spore ${SPORE_MINIMUM} or later at ${SPORE}; set SPORE to one`;
    if (process.env.REQUIRE_SPORE === "1") throw new Error(reason);
    console.warn(`skipping ${spec}: ${reason}`);
  }
  return version;
}

export function scratch(): string {
  return mkdtempSync(join(tmpdir(), "claude-spore-"));
}

/** Removes a scratch folder, including spore's step files, which it makes read-only. */
export function remove(path: string) {
  const writable = (dir: string) => {
    chmodSync(dir, 0o755);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) writable(join(dir, entry.name));
    }
  };
  if (existsSync(path)) writable(path);
  rmSync(path, { recursive: true, force: true });
}

export type Answer = { stdout?: string; envelope?: Record<string, unknown>; exit?: number; stderr?: string };

export type FakeCall = { args: string[]; stdin: string; cwd: string; retries: string | null };

/** The fake `claude`'s folder: its sessions, its script and the calls it saw. */
export class FakeClaude {
  readonly dir = scratch();

  /** The answers the next calls get, in order, counted from now. */
  answers(...answers: Answer[]) {
    writeFileSync(join(this.dir, "script.json"), JSON.stringify(answers));
    writeFileSync(join(this.dir, "played"), "0");
    rmSync(join(this.dir, "calls.jsonl"), { force: true });
  }

  calls(): FakeCall[] {
    const file = join(this.dir, "calls.jsonl");
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  }

  dispose() {
    remove(this.dir);
  }
}

/** An answer with structured output, as Claude Code gives it after a StructuredOutput call. */
export function answered(outcome: string, output: unknown, envelope: Record<string, unknown> = {}): Answer {
  return { envelope: { structured_output: { answer: { outcome, output } }, ...envelope } };
}

export type StepOptions = {
  params: unknown;
  run?: string;
  node?: string;
  visit?: number;
  attempt?: number;
  instructions?: string;
  stepFiles?: string;
  workDir?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
};

export type StepRun = { exitCode: number; stdout: string; stderr: string; result: any };

/** `claude-spore run` as spore runs it: parameters on stdin, the step's variables in its environment. */
export function runStep(fake: FakeClaude, options: StepOptions): StepRun {
  const work = options.workDir;
  if (work) mkdirSync(work, { recursive: true });
  let instructions: string | undefined;
  if (options.instructions !== undefined) {
    instructions = join(fake.dir, "instructions.md");
    writeFileSync(instructions, options.instructions);
  }
  const env: Record<string, string | undefined> = {
    ...process.env,
    PATH,
    FAKE_CLAUDE_DIR: fake.dir,
    RUNSPORE_RUN_ID: options.run ?? "run_0123456789abcdef0123456789abcdef",
    RUNSPORE_NODE_ID: options.node ?? "implement",
    RUNSPORE_VISIT: String(options.visit ?? 1),
    RUNSPORE_ATTEMPT: String(options.attempt ?? 1),
    RUNSPORE_INSTRUCTIONS: instructions,
    RUNSPORE_STEP_FILES: options.stepFiles,
    RUNSPORE_WORK_DIR: work,
    ...options.env,
  };
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
  const child = Bun.spawnSync([HELPER, "run"], {
    cwd: options.cwd,
    env: env as Record<string, string>,
    stdin: Buffer.from(typeof options.params === "string" ? options.params : JSON.stringify(options.params)),
  });
  const stdout = child.stdout.toString();
  let result: unknown;
  try {
    result = JSON.parse(stdout);
  } catch {
    result = undefined;
  }
  return { exitCode: child.exitCode, stdout, stderr: child.stderr.toString(), result };
}

/** The fake `herdr`'s folder: its panes and agents, the states a test sets, and its calls. */
export class FakeHerdr {
  readonly dir = scratch();

  constructor() {
    mkdirSync(join(this.dir, "status"));
    mkdirSync(join(this.dir, "lose"));
  }

  /** Makes every agent's next `count` prompts lost, as a Claude not yet ready for input loses them. */
  loseEvery(count: number) {
    writeFileSync(join(this.dir, "lose", "_every"), String(count));
  }

  /** Sets the state herdr shows for the agent. */
  status(agent: string, status: "idle" | "working" | "blocked" | "done" | "unknown") {
    writeFileSync(join(this.dir, "status", agent), status);
  }

  /** Sets the state herdr shows for every agent without its own, for a spec that cannot know the name. */
  everyStatus(status: "idle" | "working" | "blocked" | "done" | "unknown") {
    writeFileSync(join(this.dir, "status", "_every"), status);
  }

  /** Makes every call fail, or answer again. */
  down(down = true) {
    if (down) writeFileSync(join(this.dir, "down"), "");
    else rmSync(join(this.dir, "down"), { force: true });
  }

  /** Makes the next `count` `agent start` calls fail as a pane whose shell is not at its prompt yet. */
  shellLate(count: number) {
    writeFileSync(join(this.dir, "shell-late"), String(count));
  }

  /** Sets what `status server --json` prints in place of the recorded answer. */
  server(answer: string) {
    writeFileSync(join(this.dir, "server.json"), answer);
  }

  state(): { panes: Record<string, { cwd: string; env: Record<string, string> }>; agents: Record<string, { pane: string; pid: number }> } {
    const file = join(this.dir, "state.json");
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { panes: {}, agents: {} };
  }

  calls(): string[][] {
    const file = join(this.dir, "calls.jsonl");
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line).args);
  }

  /** Kills every Claude the fake started. */
  dispose() {
    for (const agent of Object.values(this.state().agents)) {
      try {
        process.kill(agent.pid, "SIGKILL");
      } catch {}
    }
    remove(this.dir);
  }
}

/** The line `claude-spore check` prints before its summary for a folder with a watched step, when herdr answers as recorded. */
export function herdrRunning(folder: string): string {
  const answer = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "herdr", "status-server.json"), "utf8"));
  return `${folder}: herdr server running, herdr answered ${JSON.stringify(answer)}\n`;
}

export type InteractiveOptions = Omit<StepOptions, "params"> & { stdin?: string; args?: string[] };

/** The environment `claude-spore start|probe|watch|stop|report` gets from spore, with both fakes. */
export function interactiveEnv(claude: FakeClaude, herdr: FakeHerdr, options: InteractiveOptions): Record<string, string> {
  let instructions: string | undefined;
  if (options.instructions !== undefined) {
    instructions = join(claude.dir, "instructions.md");
    writeFileSync(instructions, options.instructions);
  }
  if (options.workDir) mkdirSync(options.workDir, { recursive: true });
  const env: Record<string, string | undefined> = {
    ...process.env,
    PATH,
    FAKE_CLAUDE_DIR: claude.dir,
    CLAUDE_CONFIG_DIR: claude.dir,
    FAKE_HERDR_DIR: herdr.dir,
    CLAUDE_SPORE_WATCH_POLL_MS: "50",
    RUNSPORE_RUN_ID: options.run ?? "run_0123456789abcdef0123456789abcdef",
    RUNSPORE_NODE_ID: options.node ?? "implement",
    RUNSPORE_VISIT: String(options.visit ?? 1),
    RUNSPORE_ATTEMPT: String(options.attempt ?? 1),
    RUNSPORE_INSTRUCTIONS: instructions,
    RUNSPORE_STEP_FILES: options.stepFiles,
    RUNSPORE_WORK_DIR: options.workDir,
    RUNSPORE_DB: undefined,
    ...options.env,
  };
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
  return env as Record<string, string>;
}

/** One of the interactive commands, run to its end. */
export function interactive(
  command: "start" | "probe" | "watch" | "stop" | "report",
  claude: FakeClaude,
  herdr: FakeHerdr,
  options: InteractiveOptions = {},
): StepRun {
  const child = Bun.spawnSync([HELPER, command, ...(options.args ?? [])], {
    cwd: options.cwd,
    env: interactiveEnv(claude, herdr, options),
    stdin: Buffer.from(options.stdin ?? ""),
  });
  const stdout = child.stdout.toString();
  let result: unknown;
  try {
    result = JSON.parse(stdout);
  } catch {
    result = undefined;
  }
  return { exitCode: child.exitCode, stdout, stderr: child.stderr.toString(), result };
}

export function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
