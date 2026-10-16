// `claude-spore example list | copy` (docs/spec.md, "Starting a bundled example"): the workflows
// `start` offers when a project lacks the one named, copied with each Claude step in the
// background or in a herdr pane, and still building and checking after the copy.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { FakeHerdr, HELPER, PATH, remove, scratch, SPORE, sporeVersion } from "./helpers.ts";

const EXAMPLES = join(import.meta.dir, "..", "skills", "author", "references", "examples");
const version = sporeVersion("example.spec.ts");

let herdr: FakeHerdr;
let dir: string;
beforeAll(() => {
  herdr = new FakeHerdr();
  dir = scratch();
});
afterAll(() => {
  herdr.dispose();
  remove(dir);
});

function sh(argv: string[]) {
  const child = Bun.spawnSync(argv, { env: { ...process.env, PATH, FAKE_HERDR_DIR: herdr.dir } });
  return { exitCode: child.exitCode, stdout: child.stdout.toString(), stderr: child.stderr.toString() };
}

const helper = (...args: string[]) => sh([HELPER, "example", ...args]);
const settings = (folder: string) => JSON.parse(readFileSync(join(folder, "settings.json"), "utf8"));

test("list names every bundled workflow, what it does and its Claude steps", () => {
  const { exitCode, stdout } = helper("list", "--json");
  expect(exitCode).toBe(0);
  const { examples } = JSON.parse(stdout);
  expect(examples.map((e: { name: string }) => e.name)).toEqual(readdirSync(EXAMPLES).sort());
  for (const e of examples) {
    expect(e.description).toContain("Claude implements, a command runs the tests");
    expect(e.claudeSteps).toEqual(["implement"]);
  }
});

test("a copy with every Claude step in the background is the example, file for file", () => {
  const target = join(dir, "background", "coding-loop");
  const { exitCode, stdout } = helper("copy", "coding-loop", target);
  expect(exitCode).toBe(0);
  expect(stdout).toBe(`Copied coding-loop to ${target}, implement in the background.\n`);
  for (const file of ["workflow.dot", "settings.json", "steps/implement.md", "steps/approve.md", "steps/tests_stuck.md"]) {
    expect(readFileSync(join(target, file), "utf8")).toBe(readFileSync(join(EXAMPLES, "coding-loop", file), "utf8"));
  }
});

test("--watch turns a Claude step's action into the watched form and keeps the rest", () => {
  const target = join(dir, "watched", "parallel-coding-loop");
  const { exitCode, stdout } = helper("copy", "parallel-coding-loop", target, "--watch", "implement");
  expect(exitCode).toBe(0);
  expect(stdout).toBe(`Copied parallel-coding-loop to ${target}, implement in a herdr pane.\n`);

  const original = settings(join(EXAMPLES, "parallel-coding-loop"));
  const copied = settings(target);
  expect(copied.actions.implement).toEqual({
    kind: "command",
    argv: ["claude-spore", "start"],
    cwd: { fromInput: "/context/workdir" },
    effect: "idempotent",
    outcomes: ["ok"],
    retry: { maxAttempts: 3 },
    async: {
      timeoutMs: "14400000",
      probe: { command: { argv: ["claude-spore", "probe"] } },
      watch: { command: { argv: ["claude-spore", "watch"] } },
      stop: { command: { argv: ["claude-spore", "stop"] } },
    },
  });
  expect({ ...copied, actions: { ...copied.actions, implement: null } }).toEqual({
    ...original,
    actions: { ...original.actions, implement: null },
  });
});

describe("refusals write nothing", () => {
  test("a folder that already exists", () => {
    const target = join(dir, "background", "coding-loop");
    const before = readFileSync(join(target, "settings.json"), "utf8");
    const { exitCode, stderr } = helper("copy", "coding-loop", target, "--watch", "implement");
    expect(exitCode).toBe(1);
    expect(stderr).toBe(`example: ${target} already exists; nothing was copied\n`);
    expect(readFileSync(join(target, "settings.json"), "utf8")).toBe(before);
  });

  test("a node that is not a Claude step", () => {
    const target = join(dir, "not-claude");
    const { exitCode, stderr } = helper("copy", "coding-loop", target, "--watch", "test");
    expect(exitCode).toBe(1);
    expect(stderr).toBe("example: test is not a Claude step of coding-loop; its Claude steps are implement\n");
    expect(existsSync(target)).toBe(false);
  });

  test("a name the plugin does not ship", () => {
    const target = join(dir, "nope");
    const { exitCode, stderr } = helper("copy", "nope", target);
    expect(exitCode).toBe(1);
    expect(stderr).toBe("example: no bundled workflow \"nope\"; there are coding-loop, parallel-coding-loop\n");
    expect(existsSync(target)).toBe(false);
  });

  test("usage errors exit 2", () => {
    expect(helper().exitCode).toBe(2);
    expect(helper("copy", "coding-loop").exitCode).toBe(2);
    expect(helper("copy", "coding-loop", join(dir, "u"), "--watch").exitCode).toBe(2);
    expect(helper("list", "extra").exitCode).toBe(2);
  });
});

describe.skipIf(!version)(`the copies with a real spore ${version ?? ""}`, () => {
  for (const [name, watch] of [
    ["coding-loop", []],
    ["coding-loop", ["--watch", "implement"]],
    ["parallel-coding-loop", ["--watch", "implement"]],
  ] as const) {
    test(`${name}${watch.length ? ", implement watched," : ""} validates and checks with no warning`, () => {
      const target = join(dir, "real", watch.length ? "watched" : "background", name);
      expect(helper("copy", name, target, ...watch).exitCode).toBe(0);

      const validate = sh([SPORE, "validate", target]);
      expect(validate.stderr).toBe("");
      expect(validate.stdout).toContain("is valid");
      expect(validate.exitCode).toBe(0);

      const check = sh([HELPER, "check", target]);
      expect(check.stdout).toBe(`${target}: 1 Claude step checked, no errors\n`);
      expect(check.exitCode).toBe(0);
    });
  }
});
