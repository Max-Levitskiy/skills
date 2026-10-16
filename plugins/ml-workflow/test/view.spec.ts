// Seam 1: `claude-spore line`, `view` and `draw`, the run line and the live view (docs/spec.md,
// p.24), against a fake spore that answers `status` and `inspect --run --file` as each test says.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { HELPER, remove, scratch } from "./helpers.ts";
import { pathOf, run } from "./release-fixtures.ts";

const EXAMPLE = join(import.meta.dir, "..", "skills", "author", "references", "examples", "coding-loop");
const DB = "/repo/.spore/runspore.db";
const DIGEST = `sha256:${"ab".repeat(32)}`;
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

let dir: string;
let bin: string;
let data: string;

beforeEach(() => {
  dir = scratch();
  bin = join(dir, "bin");
  data = join(dir, "data");
  mkdirSync(bin);
  mkdirSync(join(dir, "files"));
  // `status <run>` prints status-<run>.json, or error-<run>.json with exit 2; `inspect --run <run>
  // --file <path>` prints files/<path>, or exit 2.
  writeFileSync(
    join(bin, "spore"),
    `#!/bin/sh
echo "$*" >> "${dir}/calls"
case "$1" in
  status)
    if [ -f "${dir}/status-$2.json" ]; then cat "${dir}/status-$2.json"; exit 0; fi
    [ -f "${dir}/error-$2.json" ] && cat "${dir}/error-$2.json"
    exit 2 ;;
  inspect)
    file="${dir}/files/$5"
    [ -f "$file" ] || { echo "spore: artifact.no-file: no file $5" >&2; exit 2; }
    cat "$file" ;;
  *) exit 2 ;;
esac
`,
  );
  chmodSync(join(bin, "spore"), 0o755);
  for (const file of ["workflow.dot", "settings.json", "steps/implement.md", "steps/tests_stuck.md"]) {
    mkdirSync(join(dir, "files", "steps"), { recursive: true });
    writeFileSync(join(dir, "files", file), readFileSync(join(EXAMPLE, file)));
  }
});

afterEach(() => remove(dir));

function status(runId: string, fields: Record<string, unknown>) {
  const base = { format: "runspore.cli/0.2", runId, db: DB, startKey: "coding-loop-0238a2a3", status: "running", artifactDigest: DIGEST, streaks: {} };
  writeFileSync(join(dir, `status-${runId}.json`), JSON.stringify({ ...base, ...fields }));
}

function helper(args: string[], env: Record<string, string> = {}) {
  const ran = run([HELPER, ...args], { env: { PATH: pathOf(bin), CLAUDE_PLUGIN_DATA: data, ...env } });
  let report: any;
  try {
    report = JSON.parse(ran.stdout);
  } catch {}
  return { ...ran, report };
}

function calls(): string[] {
  const file = join(dir, "calls");
  return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n") : [];
}

/** A font file this machine has, for the picture; null skips the tests that draw one. */
function someFont(): string | null {
  const known = ["/System/Library/Fonts/Helvetica.ttc", "/System/Library/Fonts/Supplemental/Arial.ttf"];
  for (const file of known) if (existsSync(file)) return file;
  const walk = (folder: string): string | null => {
    if (!existsSync(folder)) return null;
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) {
        const found = walk(path);
        if (found) return found;
      } else if (/\.(ttf|otf)$/i.test(entry.name)) return path;
    }
    return null;
  };
  return walk("/usr/share/fonts");
}

const FONT = someFont();
if (!FONT) console.warn("skipping the picture tests of view.spec.ts: no font file on this machine");

const at = (nodeId: string, visit: number, from: [string, string] | null = null) => ({
  nodeId,
  activationId: `${nodeId}/${visit}`,
  visit,
  from: from && { nodeId: from[0], outcome: from[1] },
});

const MIN = 60_000;

test("a running run: node, how long it has stood there and visit, the arrow just taken, the try and the loop count", () => {
  status("run_a", {
    position: at("implement", 3, ["test", "red"]),
    invocation: { attempt: 1, maxAttempts: 3, state: "scheduled" },
    running: { attempt: 1, maxAttempts: 3, state: "started", sinceMs: "0", forMs: String(13 * MIN + 20_000) },
    streaks: { test: { outcome: "red", count: 2, limit: 3 } },
  });
  const { exitCode, report } = helper(["line", "run_a", "--json"]);
  expect(exitCode).toBe(0);
  expect(report).toEqual({
    runId: "run_a",
    db: DB,
    name: "coding-loop-0238a2a3",
    text: "coding-loop-0238a2a3 at implement for 13 min, visit 3, from test on red, try 1/3, red 2/3 in a row",
    // The arrow cut down, then dropped, for a band too narrow for the whole line.
    shorter: [
      "coding-loop-0238a2a3 at implement for 13 min, visit 3, from test:red, try 1/3, red 2/3 in a row",
      "coding-loop-0238a2a3 at implement for 13 min, visit 3, try 1/3, red 2/3 in a row",
    ],
    needsYou: false,
    ended: false,
  });
  expect(calls()).toEqual(["status run_a --json --no-probe"]);
});

test("a run waiting for a decision needs you, and says so first", () => {
  status("run_b", { status: "waiting", position: at("approve", 1, ["test", "ok"]), waiting: { nodeId: "approve", signal: "approval", sinceMs: "0", forMs: "40000" } });
  expect(helper(["line", "run_b", "--json", "--db", DB]).report).toMatchObject({ text: "coding-loop-0238a2a3 at approve for 40 s, from test on ok", needsYou: true });
  expect(calls()).toEqual([`status run_b --json --no-probe --db ${DB}`]);
  expect(helper(["line", "run_b"]).stdout).toBe("needs you  coding-loop-0238a2a3 at approve for 40 s, from test on ok\n");
});

test("a first visit says no visit, a stuck step how long it has been stuck, and a try in backoff no time", () => {
  status("run_s", { startKey: "nightly-tue", position: at("build", 1), invocation: { attempt: 1, maxAttempts: 3 }, running: { state: "started", forMs: String(13 * MIN) } });
  status("run_t", { status: "needs-intervention", position: at("test", 2, ["implement", "ok"]), intervention: { reason: "stuck", forMs: String(2 * 60 * MIN) } });
  status("run_u", { position: at("test", 1), invocation: { attempt: 2, maxAttempts: 3 }, running: { state: "backoff", forMs: "0" } });
  expect(["run_s", "run_t", "run_u"].map((id) => helper(["line", id, "--json"]).report)).toMatchObject([
    { text: "nightly-tue at build for 13 min, try 1/3", shorter: [] },
    { text: "coding-loop-0238a2a3 at test for 2 h, visit 2, from implement on ok", needsYou: true },
    { text: "coding-loop-0238a2a3 at test, try 2/3" },
  ]);
});

test("a try past the action's limit, after a person's retry, says so", () => {
  status("run_c", {
    position: at("implement", 1),
    invocation: { attempt: "4", maxAttempts: "3", state: "scheduled" },
  });
  expect(helper(["line", "run_c", "--json"]).report.text).toBe("coding-loop-0238a2a3 at implement, try 4 (past the limit of 3)");
});

test("a stuck step, a quarantine and a ready step for a person need you; an actor's step does not", () => {
  status("run_d", { status: "needs-intervention", position: at("test", 1), intervention: { reason: "stuck" } });
  status("run_e", { position: at("test", 1), quarantine: { code: "host.files-unwritable" } });
  status("run_f", { position: at("review", 1), step: { kind: "external", actor: "person", state: "ready" } });
  status("run_g", { position: at("review", 1), step: { kind: "external", actor: "reviewer", state: "ready" } });
  expect(["run_d", "run_e", "run_f", "run_g"].map((id) => helper(["line", id, "--json"]).report.needsYou)).toEqual([true, true, true, false]);
});

test("an ended run says how it ended, and is ended", () => {
  status("run_h", { status: "completed", position: null, end: { nodeId: "done", from: { nodeId: "approve", outcome: "approved" } } });
  status("run_i", { status: "failed", position: null, end: { nodeId: "stopped", from: { nodeId: "tests_stuck", outcome: "stop" } } });
  status("run_j", { status: "cancelled", position: at("implement", 2), cancel: { reason: null } });
  status("run_k", { position: null });
  expect(["run_h", "run_i", "run_j", "run_k"].map((id) => helper(["line", id, "--json"]).report)).toMatchObject([
    { text: "coding-loop-0238a2a3 completed at done, from approve on approved", shorter: ["coding-loop-0238a2a3 completed at done, from approve:approved", "coding-loop-0238a2a3 completed at done"], ended: true, needsYou: false },
    { text: "coding-loop-0238a2a3 failed at stopped, from tests_stuck on stop", ended: true },
    { text: "coding-loop-0238a2a3 cancelled at implement", ended: true },
    { text: "coding-loop-0238a2a3, not started yet", ended: false },
  ]);
});

test("a run spore does not know is spore's error, and exit 1", () => {
  writeFileSync(join(dir, "error-run_x.json"), JSON.stringify({ format: "runspore.cli/0.2", error: { code: "run.not-found", message: "no run run_x" } }));
  expect(helper(["line", "run_x", "--json"])).toMatchObject({ exitCode: 1, report: { runId: "run_x", db: null, error: { code: "run.not-found", message: "no run run_x" } } });
  expect(helper(["view", "run_x", "--json"]).report.error.code).toBe("run.not-found");
});

test("no spore on PATH is spore.unavailable", () => {
  const ran = run([HELPER, "line", "run_a", "--json"], { env: { PATH: pathOf() } });
  expect(ran.exitCode).toBe(1);
  expect(JSON.parse(ran.stdout).error.code).toBe("spore.unavailable");
});

test("the view marks the current node and the arrow just taken in the files, and gives the instructions' head", () => {
  status("run_a", { position: at("implement", 3, ["test", "red"]), invocation: { attempt: 1, maxAttempts: 3 }, streaks: { test: { outcome: "red", count: 2, limit: 3 } } });
  const { exitCode, report } = helper(["view", "run_a", "--json"], { CLAUDE_SPORE_FONTS: FONT ?? "" });
  expect(exitCode).toBe(0);
  expect(report.facts).toBe("running, at implement, visit 3, try 1/3, red 2/3 in a row");
  expect(report.line.text).toBe("coding-loop-0238a2a3 at implement, visit 3, from test on red, try 1/3, red 2/3 in a row");
  const dot = readFileSync(join(EXAMPLE, "workflow.dot"), "utf8").trimEnd().split("\n");
  expect(report.dot.map((l: any) => l.text)).toEqual(dot);
  expect(report.dot.filter((l: any) => l.mark).map((l: any) => [l.mark, l.text.trim()])).toEqual([
    ["here", 'implement   [label="Implement (Claude)"];'],
    ["taken", 'test        -> implement   [on="red", label="red ×3"];'],
  ]);
  // The action `implement` (lines 12 to 16), then the node `implement` (24 to 47), marked on its first line.
  expect(report.settings.map((l: any) => l.n)).toEqual([...range(12, 16), ...range(24, 47)]);
  expect(report.settings.filter((l: any) => l.mark).map((l: any) => [l.n, l.mark])).toEqual([[24, "here"]]);
  expect(report.instructions.file).toBe("steps/implement.md");
  expect(report.instructions.head).toHaveLength(3);
  expect(report.instructions.text).toBe(readFileSync(join(EXAMPLE, "steps", "implement.md"), "utf8"));
  const rows: string[] = report.dots.map((row: any[]) => row.map((span) => span.text).join(""));
  expect(rows.some((row) => row.includes("│ Implement (Claude) │"))).toBe(true);
  expect(report.dots.flat().filter((span: any) => span.style === "here").map((span: any) => span.text).join("")).toContain("Implement (Claude)");
  expect(report.dots.flat().filter((span: any) => span.style === "taken-label").map((span: any) => span.text).join("").trim()).toBe("red ×3");
});

test("a node on one line is that line; a node without an action or instructions shows its block alone", () => {
  status("run_b", { position: at("test", 1, ["implement", "ok"]) });
  const test = helper(["view", "run_b", "--json"], { CLAUDE_SPORE_FONTS: "" }).report;
  expect(test.settings.map((l: any) => [l.n, l.mark])).toEqual([...range(17, 21).map((n) => [n, null]), [48, "here"]]);
  expect(test.instructions).toBeNull();
  status("run_c", { status: "waiting", position: at("tests_stuck", 1, ["test", "exhausted"]), waiting: {} });
  const stuck = helper(["view", "run_c", "--json"], { CLAUDE_SPORE_FONTS: "" }).report;
  expect(stuck.settings.map((l: any) => l.n)).toEqual(range(61, 71));
  expect(stuck.dot.filter((l: any) => l.mark === "taken").map((l: any) => l.n)).toEqual([19]);
  expect(stuck.instructions.file).toBe("steps/tests_stuck.md");
});

function range(first: number, last: number): number[] {
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

test("each pinned file is read from spore once per artifact", () => {
  status("run_a", { position: at("implement", 1) });
  helper(["view", "run_a", "--json"], { CLAUDE_SPORE_FONTS: "" });
  helper(["view", "run_a", "--json"], { CLAUDE_SPORE_FONTS: "" });
  expect(calls().filter((call) => call.startsWith("inspect"))).toEqual([
    "inspect --run run_a --file workflow.dot --db /repo/.spore/runspore.db",
    "inspect --run run_a --file settings.json --db /repo/.spore/runspore.db",
    "inspect --run run_a --file steps/implement.md --db /repo/.spore/runspore.db",
  ]);
  expect(readFileSync(join(data, "artifacts", "ab".repeat(32), "files", "workflow.dot"), "utf8")).toBe(readFileSync(join(EXAMPLE, "workflow.dot"), "utf8"));
});

test("with no font the view has no picture and draw --png fails naming where it looked", () => {
  status("run_a", { position: at("implement", 1) });
  expect(helper(["view", "run_a", "--json"], { CLAUDE_SPORE_FONTS: "" }).report.picture).toBeNull();
  const out = join(dir, "out.png");
  const ran = helper(["draw", "--run", "run_a", "--png", out], { CLAUDE_SPORE_FONTS: "/no/such/font.ttf" });
  expect(ran.exitCode).toBe(1);
  expect(ran.stderr).toBe("draw: no font to draw the labels with; looked for /no/such/font.ttf\n");
  expect(existsSync(out)).toBe(false);
});

test.skipIf(!FONT)("draw --png writes the moment's picture once, and copies it from the cache after", () => {
  status("run_a", { position: at("implement", 3, ["test", "red"]) });
  const env = { CLAUDE_SPORE_FONTS: FONT! };
  const out = join(dir, "out.png");
  expect(helper(["draw", "--run", "run_a", "--png", out], env)).toMatchObject({ exitCode: 0, stdout: "", stderr: "" });
  const png = readFileSync(out);
  expect([...png.subarray(0, 8)]).toEqual(PNG);
  const cached = join(data, "artifacts", "ab".repeat(32), "implement@test.red.png");
  expect(readFileSync(cached).equals(png)).toBe(true);
  // A second draw of the same moment copies the kept picture, even with no font left.
  const again = join(dir, "again.png");
  expect(helper(["draw", "--run", "run_a", "--png", again], { CLAUDE_SPORE_FONTS: "" }).exitCode).toBe(0);
  expect(readFileSync(again).equals(png)).toBe(true);
  const { report } = helper(["view", "run_a", "--json"], { CLAUDE_SPORE_FONTS: "" });
  expect(report.picture).toEqual({ file: cached, width: png.readUInt32BE(16), height: png.readUInt32BE(20) });
});

test.skipIf(!FONT)("draw --at and --from draw another moment than the run's", () => {
  status("run_a", { position: at("implement", 1) });
  const out = join(dir, "out.png");
  expect(helper(["draw", "--run", "run_a", "--at", "tests_stuck", "--from", "test:exhausted", "--png", out], { CLAUDE_SPORE_FONTS: FONT! }).exitCode).toBe(0);
  expect(existsSync(join(data, "artifacts", "ab".repeat(32), "tests_stuck@test.exhausted.png"))).toBe(true);
});

test("draw --plain prints the dot drawing", () => {
  status("run_a", { position: at("tests_stuck", 1, ["test", "exhausted"]) });
  const { exitCode, stdout } = helper(["draw", "--run", "run_a", "--plain"]);
  expect(exitCode).toBe(0);
  for (const label of ["Implement (Claude)", "Run the tests", "Approve (you)", "Tests keep failing (you)", "done", "stopped", "red ×3", "exhausted", "keep-going"]) {
    expect(stdout).toContain(label);
  }
  expect(stdout).toMatch(/[⠁-⣿]/);
  expect(stdout).toMatch(/[▼▲▶◀]/);
});

test("draw refuses a node the workflow does not have", () => {
  status("run_a", { position: at("implement", 1) });
  expect(helper(["draw", "--run", "run_a", "--at", "nowhere", "--plain"])).toMatchObject({ exitCode: 1, stderr: "draw: the run's workflow has no node nowhere\n" });
});

test("usage errors exit 2", () => {
  expect(helper(["line"]).exitCode).toBe(2);
  expect(helper(["view", "run_a", "--all"]).exitCode).toBe(2);
  expect(helper(["draw", "--run", "run_a"]).exitCode).toBe(2);
  expect(helper(["draw", "--run", "run_a", "--plain", "--png", "x.png"]).exitCode).toBe(2);
  expect(helper(["draw", "--run", "run_a", "--from", "test", "--plain"]).exitCode).toBe(2);
  expect(calls()).toEqual([]);
});
