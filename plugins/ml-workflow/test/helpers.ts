// Shared by the specs: the helper run as a subprocess with the fake `claude` first on PATH.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const HELPER = join(import.meta.dir, "..", "bin", "claude-spore");
export const FAKE_BIN = join(import.meta.dir, "fixtures", "bin");
export const PLUGIN_BIN = join(import.meta.dir, "..", "bin");

/** PATH with the fake `claude`, then `claude-spore`, then the Bun running the specs. */
export const PATH = [FAKE_BIN, PLUGIN_BIN, dirname(process.execPath), process.env.PATH].join(":");

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

export function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
