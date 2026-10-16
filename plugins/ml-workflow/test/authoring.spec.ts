// The folders the authoring interview copies (skills/author/references/examples/, docs/spec.md p.22):
// each builds with the real spore and passes `claude-spore check` with no warning, and the
// worktree step of the parallel loop makes one worktree per run that the later steps work in.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { answered, FakeClaude, FakeHerdr, HELPER, herdrRunning, PATH, remove, scratch, SPORE, SPORE_TIMEOUT_MS, sporeVersion } from "./helpers.ts";

const EXAMPLES = join(import.meta.dir, "..", "skills", "author", "references", "examples");
const version = sporeVersion("authoring.spec.ts");
setDefaultTimeout(SPORE_TIMEOUT_MS);

function sh(cwd: string, argv: string[], env: Record<string, string | undefined> = {}) {
  const child = Bun.spawnSync(argv, { cwd, env: { ...process.env, PATH, ...env } });
  return { exitCode: child.exitCode, stdout: child.stdout.toString(), stderr: child.stderr.toString() };
}

/** A git repository with one commit, inside a scratch folder that also catches its worktrees. */
function repository(): { root: string; repo: string } {
  const root = scratch();
  const repo = join(root, "repo");
  mkdirSync(repo);
  writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "repo", private: true, scripts: { test: "true" } }));
  for (const argv of [
    ["git", "init", "-q", "-b", "main"],
    ["git", "add", "package.json"],
    ["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init"],
  ]) {
    expect(sh(repo, argv).exitCode).toBe(0);
  }
  return { root, repo };
}

describe.skipIf(!version)(`the examples with a real spore ${version ?? ""}`, () => {
  // The watched example's check asks herdr whether a server answers; the fake one does.
  let herdr: FakeHerdr;
  beforeAll(() => (herdr = new FakeHerdr()));
  afterAll(() => herdr.dispose());

  for (const name of ["coding-loop", "parallel-coding-loop", "watched-coding-loop"]) {
    test(`${name} validates and checks with no warning`, () => {
      const folder = join(EXAMPLES, name);
      const validate = sh(folder, [SPORE, "validate", folder]);
      expect(validate.stderr).toBe("");
      expect(validate.stdout).toContain("is valid");
      expect(validate.exitCode).toBe(0);

      const check = sh(folder, [HELPER, "check", folder], { FAKE_HERDR_DIR: herdr.dir });
      const herdrLine = name === "watched-coding-loop" ? herdrRunning(folder) : "";
      expect(check.stdout).toBe(`${herdrLine}${folder}: 1 Claude step checked, no errors\n`);
      expect(check.exitCode).toBe(0);
    });
  }

  test("watched-coding-loop's implement is the interactive step, and herdr is asked", () => {
    const settings = JSON.parse(readFileSync(join(EXAMPLES, "watched-coding-loop", "settings.json"), "utf8"));
    expect(settings.actions.implement.argv).toEqual(["claude-spore", "start"]);
    expect(herdr.calls()).toContainEqual(["status", "server", "--json"]);
  });
});

describe("the helper program of watched-coding-loop", () => {
  const HELPER_PROGRAM = join(EXAMPLES, "watched-coding-loop", "bin", "run-tests");
  const settings = JSON.parse(readFileSync(join(EXAMPLES, "watched-coding-loop", "settings.json"), "utf8"));
  let root: string;
  beforeAll(() => (root = scratch()));
  afterAll(() => remove(root));

  const project = (name: string, files: Record<string, string>) => {
    const dir = join(root, name);
    mkdirSync(dir);
    for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, file), text);
    return dir;
  };

  test("is an asset of the test action, run as ./bin/run-tests, and executable", () => {
    expect(settings.actions.test.assets).toEqual(["bin/run-tests"]);
    expect(settings.actions.test.argv).toEqual(["./bin/run-tests"]);
    expect(statSync(HELPER_PROGRAM).mode & 0o111).not.toBe(0);
  });

  test.skipIf(!Bun.which("npm"))("exits 0 when the project's tests pass, 1 when they fail", () => {
    const green = project("green", { "package.json": JSON.stringify({ name: "g", private: true, scripts: { test: "true" } }) });
    expect(sh(green, [HELPER_PROGRAM]).exitCode).toBe(0);
    const red = project("red", { "package.json": JSON.stringify({ name: "r", private: true, scripts: { test: "false" } }) });
    expect(sh(red, [HELPER_PROGRAM]).exitCode).toBe(1);
  });

  test("exits 1 naming what it looked for when the project has no test command", () => {
    const bare = sh(project("bare", {}), [HELPER_PROGRAM]);
    expect(bare.exitCode).toBe(1);
    expect(bare.stderr).toContain("no package.json, Cargo.toml, go.mod or Makefile test target");
  });
});

// The test step as the interview writes it, run by a real spore: the bundled copy runs, in the
// project's folder, and its exit code picks the outcome.
describe.skipIf(!version || !Bun.which("npm"))("a run of a step with a helper program", () => {
  const DOT = `digraph "helper" {
  dialect = "runspore/0.2";
  start = "test";
  test;
  done [kind="complete"];
  stopped [kind="fail"];
  test -> done [on="ok"];
  test -> stopped [on="red"];
}
`;
  const example = join(EXAMPLES, "watched-coding-loop");
  let root: string;

  beforeAll(() => (root = scratch()));
  afterAll(() => remove(root));

  const runIn = (name: string, script: string) => {
    const repo = join(root, name);
    mkdirSync(repo);
    writeFileSync(join(repo, "package.json"), JSON.stringify({ name, private: true, scripts: { test: script } }));
    // No RUNSPORE_ variable from outside: a spec run inside a spore step would make the run its child.
    const outside = Object.fromEntries(Object.keys(process.env).filter((key) => key.startsWith("RUNSPORE_")).map((key) => [key, undefined]));
    const spore = (...args: string[]) => sh(repo, [SPORE, ...args], outside);
    expect(spore("init").exitCode).toBe(0);
    const folder = join(repo, ".spore", "workflows", "helper");
    mkdirSync(join(folder, "bin"), { recursive: true });
    cpSync(join(example, "bin", "run-tests"), join(folder, "bin", "run-tests"));
    const { actions } = JSON.parse(readFileSync(join(example, "settings.json"), "utf8"));
    writeFileSync(join(folder, "workflow.dot"), DOT);
    writeFileSync(
      join(folder, "settings.json"),
      JSON.stringify({
        format: "runspore.workflow/0.2",
        actions: { test: actions.test },
        nodes: { test: { action: "test" }, stopped: { error: { code: "tests.red", message: "The tests failed." } } },
      }),
    );
    const run = spore("--json", "run", "helper", "--input", "{}");
    return JSON.parse(spore("--json", "status", JSON.parse(run.stdout).runId).stdout);
  };

  test("green tests complete the run", () => {
    expect(runIn("green", "true")).toMatchObject({ status: "completed", end: { nodeId: "done" }, parent: null });
  });

  test("red tests take the red arrow", () => {
    expect(runIn("red", "false")).toMatchObject({ status: "failed", end: { from: { nodeId: "test", outcome: "red" }, nodeId: "stopped" } });
  });
});

describe("the worktree step's command", () => {
  const settings = JSON.parse(readFileSync(join(EXAMPLES, "parallel-coding-loop", "settings.json"), "utf8"));
  const argv = settings.actions.worktree.argv as string[];
  let root: string;
  let repo: string;
  beforeAll(() => ({ root, repo } = repository()));
  afterAll(() => remove(root));

  test("makes a worktree on its own branch beside the repository, and a repeat reuses it", () => {
    const first = sh(repo, argv, { RUNSPORE_RUN_ID: "run_one" });
    expect(first.exitCode).toBe(0);
    const workdir = join(realpathSync(root), "repo.worktrees", "run_one");
    expect(JSON.parse(first.stdout)).toEqual({ workdir });
    expect(sh(workdir, ["git", "branch", "--show-current"]).stdout.trim()).toBe("spore/run_one");

    const again = sh(repo, argv, { RUNSPORE_RUN_ID: "run_one" });
    expect(again.exitCode).toBe(0);
    expect(JSON.parse(again.stdout)).toEqual({ workdir });
  });

  test("gives each run its own worktree", () => {
    const other = sh(repo, argv, { RUNSPORE_RUN_ID: "run_two" });
    expect(JSON.parse(other.stdout).workdir).toEndWith("/repo.worktrees/run_two");
  });
});

describe.skipIf(!version || !Bun.which("npm"))("a run of parallel-coding-loop", () => {
  let root: string;
  let repo: string;
  let fake: FakeClaude;
  const spore = (...args: string[]) => {
    const child = Bun.spawnSync([SPORE, ...args], {
      cwd: repo,
      env: { ...process.env, PATH, FAKE_CLAUDE_DIR: fake.dir, RUNSPORE_DB: undefined },
    });
    return { exitCode: child.exitCode, stdout: child.stdout.toString(), stderr: child.stderr.toString() };
  };

  beforeAll(() => {
    ({ root, repo } = repository());
    fake = new FakeClaude();
    expect(spore("init").exitCode).toBe(0);
    cpSync(join(EXAMPLES, "parallel-coding-loop"), join(repo, ".spore", "workflows", "parallel-coding-loop"), { recursive: true });
  });

  afterAll(() => {
    fake.dispose();
    remove(root);
  });

  test("Claude and the tests work in the run's worktree, and the run waits for approval", () => {
    fake.answers(answered("ok", { summary: "Done." }));
    const run = spore("--json", "run", "parallel-coding-loop", "--input", JSON.stringify({ task: "add a feature" }));
    expect(run.exitCode).toBe(3);
    const runId = JSON.parse(run.stdout).runId;

    const workdir = join(realpathSync(root), "repo.worktrees", runId);
    expect(existsSync(join(workdir, "package.json"))).toBe(true);
    const [call] = fake.calls();
    expect(realpathSync(call!.cwd)).toBe(workdir);
    expect(call!.stdin).toContain(`"workdir": "${workdir}"`);

    const status = JSON.parse(spore("--json", "status", runId).stdout);
    expect(status.position.nodeId).toBe("approve");
  });
});
