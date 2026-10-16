// `claude-spore start|probe|watch|report|stop`, the interactive Claude step (docs/spec.md, p.17),
// driven through the executable with the fake `claude` and `herdr` first on PATH.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

import { FakeClaude, FakeHerdr, flag, HELPER, interactive, interactiveEnv, remove, scratch, type InteractiveOptions } from "./helpers.ts";

const SUMMARY = { type: "object", properties: { summary: { type: "string" } }, required: ["summary"], additionalProperties: false };
const PARAMS = { format: "json", schema: { ok: SUMMARY }, tools: ["Read", "Edit"], context: { task: "add a flag" } };

let claude: FakeClaude;
let herdr: FakeHerdr;
let root: string;
let project: string;
let work: string;

beforeEach(() => {
  claude = new FakeClaude();
  herdr = new FakeHerdr();
  root = scratch();
  project = join(root, "project");
  work = join(root, "work", "inv1");
  mkdirSync(project);
});

afterEach(() => {
  herdr.dispose();
  claude.dispose();
  remove(root);
});

function run(command: "start" | "probe" | "watch" | "stop" | "report", options: InteractiveOptions = {}) {
  return interactive(command, claude, herdr, { workDir: work, cwd: project, ...options });
}

function start(options: InteractiveOptions = {}) {
  return run("start", { stdin: JSON.stringify(PARAMS), instructions: "Implement it.", ...options });
}

function report(outcome: string, answer: string, options: InteractiveOptions = {}) {
  return run("report", { args: ["--attempt", String(options.attempt ?? 1), "--outcome", outcome], stdin: answer, ...options });
}

/** The calls the fake herdr saw, by their first two words. */
function herdrCalls(group: string, command: string): string[][] {
  return herdr.calls().filter((args) => args[0] === group && args[1] === command);
}

function readJson(file: string): any {
  return JSON.parse(readFileSync(file, "utf8"));
}

describe("start", () => {
  test("opens a pane in the action's working folder with the work folder and database, and prints the handle", () => {
    const stepFiles = join(root, "step-files");
    mkdirSync(stepFiles);
    const { exitCode, result, stderr } = start({
      stepFiles,
      stdin: JSON.stringify({ ...PARAMS, model: "opus" }),
      env: { RUNSPORE_DB: "/data/runspore.db" },
    });

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(Object.keys(result).sort()).toEqual(["boot", "herdrAgent", "machine", "pid", "session", "started"]);
    expect(result.herdrAgent).toMatch(/^sp-implement-[0-9a-f]{10}$/);
    expect(result.session).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.pid).toBeInteger();
    expect(result.started).toBeString();
    expect(result.boot).toBeString();
    expect(result.machine).toBe(hostname());

    const [[, , , label, , cwd]] = herdrCalls("workspace", "create") as [string[]];
    expect(label).toBe(result.herdrAgent);
    expect(realpathSync(cwd!)).toBe(realpathSync(project));
    const [pane] = Object.values(herdr.state().panes);
    expect(pane!.env).toEqual({ RUNSPORE_WORK_DIR: work, RUNSPORE_DB: "/data/runspore.db" });

    const [call] = claude.calls() as any[];
    expect(call.args).not.toContain("-p");
    expect(flag(call.args, "--session-id")).toBe(result.session);
    expect(flag(call.args, "--permission-mode")).toBe("default");
    expect(flag(call.args, "--tools")).toBe("Read,Edit");
    expect(flag(call.args, "--allowedTools")).toBe("Read,Edit");
    expect(flag(call.args, "--model")).toBe("opus");
    expect(flag(call.args, "--add-dir")).toBe(stepFiles);
    expect(realpathSync(call.cwd)).toBe(realpathSync(project));
    expect(call.env).toMatchObject({ RUNSPORE_WORK_DIR: work, RUNSPORE_DB: "/data/runspore.db" });

    expect(readJson(join(work, "params.json"))).toMatchObject({ format: "json", schema: { ok: SUMMARY }, model: "opus" });
  });

  test("seeds the pane with the instructions, the input, this attempt's report command and each outcome's shape", () => {
    const { result } = start({ stdin: JSON.stringify({ ...PARAMS, schema: { ok: SUMMARY, changes: SUMMARY } }) });
    const [[, , agent, message]] = herdrCalls("agent", "prompt") as [string[]];

    expect(agent).toBe(result.herdrAgent);
    expect(message).toStartWith("Implement it.");
    expect(message).toContain('"task": "add a flag"');
    expect(message).toContain("claude-spore report --attempt 1 --outcome <outcome> <<'ANSWER'");
    expect(message).toContain(`- \`ok\`: ${JSON.stringify(SUMMARY)}`);
    expect(message).toContain(`- \`changes\`: ${JSON.stringify(SUMMARY)}`);
  });

  test("a text step's report command names its one outcome, and a skill starts the message", () => {
    start({ stdin: JSON.stringify({ format: "text", outcome: "done", skill: "ml-grilling:questions", context: null }) });
    const [[, , , message]] = herdrCalls("agent", "prompt") as [string[]];

    expect(message).toStartWith("/ml-grilling:questions Implement it.");
    expect(message).toContain("claude-spore report --attempt 1 --outcome done <<'ANSWER'");
    expect(message).toContain("as plain text");
  });

  test("twice for one live session prints the same handle and opens one pane", () => {
    const first = start();
    const second = start();

    expect(second.exitCode).toBe(0);
    expect(second.stdout).toBe(first.stdout);
    expect(herdrCalls("workspace", "create")).toHaveLength(1);
    expect(herdrCalls("agent", "prompt")).toHaveLength(1);
    expect(claude.calls()).toHaveLength(1);
  });

  test("a later try of the same visit keeps the pane and gives it the new attempt's report command", () => {
    const first = start();
    const second = start({ attempt: 2 });

    expect(second.stdout).toBe(first.stdout);
    const prompts = herdrCalls("agent", "prompt");
    expect(prompts).toHaveLength(2);
    expect(prompts[1]![3]).toStartWith("You were cut off before you finished this step.");
    expect(prompts[1]![3]).toContain("claude-spore report --attempt 2 --outcome");
    expect(readJson(join(work, "pane.json")).attempt).toBe(2);
  });

  test("a new visit closes the earlier visit's pane and resumes the conversation in a new one", () => {
    const first = start();
    const work2 = join(root, "work", "inv2");
    const second = start({ visit: 2, workDir: work2 });

    expect(second.exitCode).toBe(0);
    expect(second.result.herdrAgent).toBe(first.result.herdrAgent);
    expect(second.result.pid).not.toBe(first.result.pid);
    expect(herdrCalls("pane", "close")).toHaveLength(1);
    expect(run("probe", { stdin: first.stdout }).result).toEqual({ holder: "dead" });

    const [, call] = claude.calls() as any[];
    expect(flag(call.args, "--resume")).toBe(first.result.session);
    expect(call.env.RUNSPORE_WORK_DIR).toBe(work2);
    const prompts = herdrCalls("agent", "prompt");
    expect(prompts[1]![3]).toStartWith("The run came back to this step: this is its visit 2.");
  });

  test("a try after one that died before Claude made the session starts it", () => {
    const { exitCode, result } = start({ attempt: 2 });

    expect(exitCode).toBe(0);
    const [call] = claude.calls() as any[];
    expect(flag(call.args, "--session-id")).toBe(result.session);
  });

  test("a later try whose pane is gone resumes, saying it was cut off", () => {
    const first = start();
    expect(run("stop", { stdin: first.stdout }).exitCode).toBe(0);
    const second = start({ attempt: 2 });

    expect(second.exitCode).toBe(0);
    const [, call] = claude.calls() as any[];
    expect(flag(call.args, "--resume")).toBe(first.result.session);
    expect(herdrCalls("agent", "prompt")[1]![3]).toStartWith("You were cut off");
  });

  describe("a failure start finds itself is the try's non-retryable result, behind a pane-less handle", () => {
    function paneless(options: InteractiveOptions, code: string) {
      const { exitCode, result } = start(options);
      const dir = options.workDir ?? work;
      const attempt = options.attempt ?? 1;

      expect(exitCode).toBe(0);
      expect(result).toMatchObject({ herdrAgent: null, pid: null, started: null, boot: null, machine: hostname() });
      expect(readJson(join(dir, `${attempt}.result.json`))).toMatchObject({ error: { code }, retryable: false });

      const watched = run("watch", { stdin: JSON.stringify(result), workDir: dir, attempt });
      expect(watched.exitCode).toBe(0);
      expect(watched.result).toMatchObject({ error: { code }, retryable: false });
      expect(run("probe", { stdin: JSON.stringify(result) }).result).toEqual({ holder: "unknown" });
    }

    test("parameters that do not pass", () => {
      paneless({ stdin: JSON.stringify({ format: "json", prompt: "hi" }) }, "params.invalid");
      expect(herdrCalls("workspace", "create")).toHaveLength(0);
    });

    test("a later visit whose conversation is gone", () => {
      paneless({ visit: 2 }, "session.lost");
      expect(claude.calls()).toHaveLength(0);
    });

    test("a first try whose session already exists", () => {
      const first = start();
      run("stop", { stdin: first.stdout });
      paneless({ workDir: join(root, "work", "other") }, "session.foreign");
      expect(claude.calls()).toHaveLength(1);
    });
  });

  test("without its variables it exits 2", () => {
    const { exitCode, stderr } = start({ workDir: undefined, env: { RUNSPORE_WORK_DIR: undefined } });
    expect(exitCode).toBe(2);
    expect(stderr).toContain("RUNSPORE_WORK_DIR not set");
  });

  test("with herdr not answering it exits 1, a retryable failure", () => {
    herdr.down();
    const { exitCode, stderr } = start();
    expect(exitCode).toBe(1);
    expect(stderr).toContain("herdr");
  });
});

describe("probe", () => {
  test("alive while the pane's Claude runs, dead once it is gone", () => {
    const { stdout } = start();
    expect(run("probe", { stdin: stdout })).toMatchObject({ exitCode: 0, result: { holder: "alive" } });

    run("stop", { stdin: stdout });
    expect(run("probe", { stdin: stdout })).toMatchObject({ exitCode: 0, result: { holder: "dead" } });
  });

  test("dead on another boot", () => {
    const { result } = start();
    expect(run("probe", { stdin: JSON.stringify({ ...result, boot: "another-boot" }) }).result).toEqual({ holder: "dead" });
  });

  test("dead when the PID's process started at another time", () => {
    const { result } = start();
    expect(run("probe", { stdin: JSON.stringify({ ...result, started: "0" }) }).result).toEqual({ holder: "dead" });
  });

  test("unknown from another machine, and for what is not a handle", () => {
    const { result } = start();
    expect(run("probe", { stdin: JSON.stringify({ ...result, machine: "elsewhere" }) }).result).toEqual({ holder: "unknown" });
    expect(run("probe", { stdin: "not json" })).toMatchObject({ exitCode: 0, result: { holder: "unknown" } });
  });
});

/** A watch running in the background, its stdout read line by line. */
function watching(handle: string, options: InteractiveOptions = {}) {
  const child = Bun.spawn([HELPER, "watch"], {
    cwd: project,
    env: interactiveEnv(claude, herdr, { workDir: work, ...options }),
    stdin: Buffer.from(handle),
    stdout: "pipe",
    stderr: "pipe",
  });
  let stdout = "";
  void (async () => {
    for await (const chunk of child.stdout) stdout += Buffer.from(chunk).toString();
  })();
  return {
    child,
    lines: () => stdout.trim().split("\n").filter(Boolean),
    async until(lines: number, ms = 5000) {
      const end = Date.now() + ms;
      while (stdout.trim().split("\n").filter(Boolean).length < lines && Date.now() < end) await Bun.sleep(25);
      return this.lines();
    },
  };
}

describe("watch", () => {
  const NEEDS = { needs: "person", message: "implement waits for you in its pane" };

  test("prints the result once the pane is quiet and the file exists, not while Claude works", async () => {
    const { result, stdout } = start();
    herdr.status(result.herdrAgent, "working");
    expect(report("ok", '{"summary": "Done."}').stdout).toBe("accepted\n");

    const watch = watching(stdout);
    await Bun.sleep(400);
    expect(watch.lines()).toEqual([]);

    herdr.status(result.herdrAgent, "idle");
    expect(await watch.child.exited).toBe(0);
    expect(watch.lines().map((l) => JSON.parse(l))).toEqual([{ outcome: "ok", output: { summary: "Done." } }]);
  });

  test("quiet without the file prints the needs line, then the result when it comes", async () => {
    const { stdout } = start();
    const watch = watching(stdout);

    expect((await watch.until(1)).map((l) => JSON.parse(l))).toEqual([NEEDS]);
    report("ok", '{"summary": "Done."}');
    expect(await watch.child.exited).toBe(0);
    expect(watch.lines().map((l) => JSON.parse(l))).toEqual([NEEDS, { outcome: "ok", output: { summary: "Done." } }]);
  });

  test("a question in the pane (blocked) needs the person too, once per wait", async () => {
    const { result, stdout } = start();
    herdr.status(result.herdrAgent, "blocked");
    const watch = watching(stdout);

    await watch.until(1);
    herdr.status(result.herdrAgent, "working");
    await Bun.sleep(200);
    herdr.status(result.herdrAgent, "done");
    expect((await watch.until(2)).map((l) => JSON.parse(l))).toEqual([NEEDS, NEEDS]);
    watch.child.kill();
  });

  test("a later try carries an earlier try's success over", () => {
    const { stdout } = start();
    report("ok", '{"summary": "From try 1."}');
    const watched = run("watch", { stdin: stdout, attempt: 2 });

    expect(watched.exitCode).toBe(0);
    expect(watched.result).toEqual({ outcome: "ok", output: { summary: "From try 1." } });
    expect(readJson(join(work, "2.result.json"))).toEqual(watched.result);
  });

  test("a failure is never carried over", async () => {
    const { stdout } = start();
    writeFileSync(join(work, "1.result.json"), JSON.stringify({ error: { code: "output.invalid", message: "no" }, retryable: false }));
    const watch = watching(stdout, { attempt: 2 });

    expect((await watch.until(1)).map((l) => JSON.parse(l))).toEqual([NEEDS]);
    expect(existsSync(join(work, "2.result.json"))).toBe(false);
    watch.child.kill();
  });

  test("a pane gone without a result exits 1: the host only loses sight of the step", () => {
    const { stdout } = start();
    run("stop", { stdin: stdout });
    const watched = run("watch", { stdin: stdout });

    expect(watched.exitCode).toBe(1);
    expect(watched.stdout).toBe("");
  });

  describe("a message is never typed while Claude works or asks a question: the watch sends it once Claude is quiet", () => {
    /** The prompts herdr got, once there are `count` of them. */
    async function prompts(count: number, ms = 5000) {
      const end = Date.now() + ms;
      while (herdrCalls("agent", "prompt").length < count && Date.now() < end) await Bun.sleep(25);
      return herdrCalls("agent", "prompt").map((args) => args[3]!);
    }

    test("a later try's, while Claude goes on after it reported", async () => {
      const { result, stdout } = start();
      herdr.status(result.herdrAgent, "working");
      expect(start({ attempt: 2 }).stdout).toBe(stdout);
      expect(herdrCalls("agent", "prompt")).toHaveLength(1);
      const record = readJson(join(work, "pane.json"));
      expect(record.attempt).toBe(2);
      expect(record.unsent).toStartWith("You were cut off");

      const watch = watching(stdout, { attempt: 2 });
      await Bun.sleep(300);
      expect(herdrCalls("agent", "prompt")).toHaveLength(1);
      herdr.status(result.herdrAgent, "blocked");
      expect((await watch.until(1)).map((l) => JSON.parse(l))).toEqual([NEEDS]);
      expect(herdrCalls("agent", "prompt")).toHaveLength(1);

      herdr.status(result.herdrAgent, "idle");
      const [, message] = await prompts(2);
      expect(message).toStartWith("You were cut off before you finished this step.");
      expect(message).toContain("claude-spore report --attempt 2 --outcome");
      expect(readJson(join(work, "pane.json")).unsent).toBeUndefined();

      report("ok", '{"summary": "Done."}', { attempt: 2 });
      expect(await watch.child.exited).toBe(0);
      expect(JSON.parse(watch.lines().at(-1)!)).toEqual({ outcome: "ok", output: { summary: "Done." } });
      expect(herdrCalls("agent", "prompt")).toHaveLength(2);
    });

    test("a new pane's first, kept with a later try's report command when that try comes first", async () => {
      const first = start();
      run("stop", { stdin: first.stdout });
      herdr.status(first.result.herdrAgent, "working");
      const work2 = join(root, "work", "inv2");
      const second = start({ visit: 2, workDir: work2 });
      expect(second.exitCode).toBe(0);
      expect(start({ visit: 2, attempt: 2, workDir: work2 }).stdout).toBe(second.stdout);
      expect(herdrCalls("agent", "prompt")).toHaveLength(1);

      herdr.status(first.result.herdrAgent, "idle");
      const watch = watching(second.stdout, { visit: 2, attempt: 2, workDir: work2 });
      const [, message] = await prompts(2);
      expect(message).toStartWith("The run came back to this step: this is its visit 2.");
      expect(message).toContain("claude-spore report --attempt 2 --outcome");
      expect(message).not.toContain("--attempt 1");
      watch.child.kill();
    });
  });

  test("delivering the answer closes the pane, since the run leaves the node", () => {
    const { result, stdout } = start();
    report("ok", '{"summary": "Done."}');

    expect(run("watch", { stdin: stdout }).result).toEqual({ outcome: "ok", output: { summary: "Done." } });
    expect(herdrCalls("pane", "close")).toHaveLength(1);
    expect(herdr.state().agents[result.herdrAgent]).toBeUndefined();
    expect(run("probe", { stdin: stdout }).result).toEqual({ holder: "dead" });
  });

  test("with keepSeconds the pane stays that long after the answer, then closes", async () => {
    const { result, stdout } = start({ stdin: JSON.stringify({ ...PARAMS, keepSeconds: 1 }) });
    report("ok", '{"summary": "Done."}');
    const watched = run("watch", { stdin: stdout });

    expect(watched.exitCode).toBe(0);
    expect(herdr.state().agents[result.herdrAgent]).toBeDefined();
    const end = Date.now() + 5000;
    while (herdr.state().agents[result.herdrAgent] && Date.now() < end) await Bun.sleep(100);
    expect(herdrCalls("pane", "close")).toHaveLength(1);
    expect(herdr.state().agents[result.herdrAgent]).toBeUndefined();
  });

  test("a kept pane a later visit has replaced is left to that visit", async () => {
    const first = start({ stdin: JSON.stringify({ ...PARAMS, keepSeconds: 1 }) });
    report("ok", '{"summary": "Done."}');
    run("watch", { stdin: first.stdout });
    const second = start({ visit: 2, workDir: join(root, "work", "inv2") });

    const pane = herdr.state().agents[second.result.herdrAgent]!.pane;
    await Bun.sleep(2000);
    expect(herdrCalls("pane", "close")).toHaveLength(1);
    expect(herdr.state().agents[second.result.herdrAgent]?.pane).toBe(pane);
  });

  test("a gone pane's result is still printed", () => {
    const { stdout } = start();
    report("ok", '{"summary": "Done."}');
    run("stop", { stdin: stdout });
    expect(run("watch", { stdin: stdout }).result).toEqual({ outcome: "ok", output: { summary: "Done." } });
  });
});

describe("report", () => {
  beforeEach(() => {
    start();
  });

  test("an answer that fits is written as the attempt's result", () => {
    const { exitCode, stdout } = report("ok", '{"summary": "Done."}');

    expect(stdout).toBe("accepted\n");
    expect(exitCode).toBe(0);
    expect(readJson(join(work, "1.result.json"))).toEqual({ outcome: "ok", output: { summary: "Done." } });
    expect(report("ok", '{"summary": "Again."}')).toMatchObject({ exitCode: 1, stdout: expect.stringContaining("already has its answer") });
  });

  test("prints one error per line, and the third bad answer writes the non-retryable output.invalid", () => {
    const first = report("ok", '{"summary": 3, "extra": true}');
    expect(first.exitCode).toBe(1);
    expect(first.stdout).toStartWith(
      '/summary: expected type "string", got integer (3)\n/extra: not allowed: the schema names no such property\n',
    );
    expect(existsSync(join(work, "1.result.json"))).toBe(false);

    expect(report("nope", '{"summary": "x"}').stdout).toStartWith('"nope" is not an outcome of this step; they are "ok"');
    expect(readFileSync(join(work, "1.answers"), "utf8").trim()).toBe("2");

    const third = report("ok", "{}");
    expect(third.exitCode).toBe(1);
    expect(third.stdout).toContain("/summary: required, but missing");
    expect(third.stdout).toContain("the step failed (output.invalid)");
    expect(readJson(join(work, "1.result.json"))).toMatchObject({
      error: { code: "output.invalid", message: expect.stringContaining("/summary: required, but missing") },
      retryable: false,
    });
  });

  test("bad answers are counted per attempt", () => {
    report("ok", "not json");
    report("ok", "1.5");
    expect(report("ok", '{"summary": "Done."}', { attempt: 2 }).stdout).toBe("accepted\n");
    expect(existsSync(join(work, "2.answers"))).toBe(false);
    expect(existsSync(join(work, "1.result.json"))).toBe(false);
  });

  test("a number with a fraction is refused", () => {
    const { stdout } = report("ok", '{"summary": "x", "n": 1.5}');
    expect(stdout).toStartWith("/n: a number with a fraction");
  });

  test("a text step takes its reply as plain text, with its one outcome", () => {
    writeFileSync(join(work, "params.json"), JSON.stringify({ format: "text", outcome: "done", schema: {}, context: null }));
    expect(report("ok", "All done.\n").stdout).toStartWith('this step ends only with the outcome "done"');
    expect(report("done", "All done.\n").stdout).toBe("accepted\n");
    expect(readJson(join(work, "1.result.json"))).toEqual({ outcome: "done", output: { text: "All done." } });
  });

  test("outside an interactive step's work folder it exits 2", () => {
    const { exitCode, stderr } = report("ok", "{}", { workDir: join(root, "empty") });
    expect(exitCode).toBe(2);
    expect(stderr).toContain("no params.json");
  });
});

describe("stop", () => {
  test("closes the pane by the handle, and a gone pane is nothing to do", () => {
    const { stdout, result } = start();
    expect(run("stop", { stdin: stdout }).exitCode).toBe(0);

    expect(herdrCalls("pane", "close")).toHaveLength(1);
    expect(herdr.state().agents[result.herdrAgent]).toBeUndefined();
    expect(run("stop", { stdin: stdout }).exitCode).toBe(0);
    expect(herdrCalls("pane", "close")).toHaveLength(1);
  });
});
