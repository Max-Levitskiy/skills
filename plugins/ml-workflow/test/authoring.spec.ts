// The folders the authoring interview copies (skills/author/references/examples/, docs/spec.md p.22):
// each builds with the real spore and passes `claude-spore check` with no warning, and the
// worktree step of the parallel loop makes one worktree per run that the later steps work in.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { answered, FakeClaude, HELPER, PATH, remove, scratch, SPORE, SPORE_TIMEOUT_MS, sporeVersion } from "./helpers.ts";

const EXAMPLES = join(import.meta.dir, "..", "skills", "author", "references", "examples");
const version = sporeVersion("authoring.spec.ts");
setDefaultTimeout(SPORE_TIMEOUT_MS);

function sh(cwd: string, argv: string[], env: Record<string, string> = {}) {
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
  for (const name of ["coding-loop", "parallel-coding-loop"]) {
    test(`${name} validates and checks with no warning`, () => {
      const folder = join(EXAMPLES, name);
      const validate = sh(folder, [SPORE, "validate", folder]);
      expect(validate.stderr).toBe("");
      expect(validate.stdout).toContain("is valid");
      expect(validate.exitCode).toBe(0);

      const check = sh(folder, [HELPER, "check", folder]);
      expect(check.stdout).toBe(`${folder}: 1 Claude step checked, no errors\n`);
      expect(check.exitCode).toBe(0);
    });
  }
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
