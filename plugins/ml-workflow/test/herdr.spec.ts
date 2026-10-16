// The fake herdr's `status server --json` (test/fixtures/herdr/status-server.json) against the real
// herdr on PATH, so the two cannot drift. Without a herdr whose server runs it is skipped, with the
// reason printed. RECORD_HERDR=1 records the real answer into the fixture.
import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = join(import.meta.dir, "fixtures", "herdr", "status-server.json");

function realAnswer(): Record<string, unknown> | null {
  const herdr = Bun.which("herdr");
  const skip = (reason: string) => {
    console.warn(`skipping herdr.spec.ts: ${reason}`);
    return null;
  };
  if (!herdr) return skip("no herdr on PATH");
  const child = Bun.spawnSync([herdr, "status", "server", "--json"], { stderr: "pipe" });
  if (child.exitCode !== 0) return skip(`herdr status server --json exited ${child.exitCode}`);
  const answer = JSON.parse(child.stdout.toString());
  if (answer?.running !== true) return skip("the herdr server is not running");
  return answer;
}

const real = realAnswer();

test.skipIf(!real)("the recorded answer has the real herdr's shape", () => {
  if (process.env.RECORD_HERDR === "1") writeFileSync(FIXTURE, `${JSON.stringify(real)}\n`);
  const recorded = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const shape = (value: Record<string, unknown>, keys: string[]) =>
    Object.fromEntries(keys.map((key) => [key, Array.isArray(value[key]) ? "array" : value[key] === null ? "null" : typeof value[key]]));
  const keys = Object.keys(recorded);
  expect(shape(real!, keys)).toEqual(shape(recorded, keys));
  expect(recorded.running).toBe(true);
});
