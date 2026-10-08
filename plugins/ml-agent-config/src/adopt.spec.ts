// Adopting a v1 config from `.agents/skill-config/`: start plans it, adopt copies it, once.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const BIN = join(import.meta.dir, "..", "bin", "agent-config");

/** A home with one component declared in a folder of its own, and an onboard action beside it. */
function sandbox(schemaVersion = 1) {
  const root = mkdtempSync(join(tmpdir(), "acs-adopt-"));
  const home = join(root, "home");
  const component = join(root, "demo");
  mkdirSync(join(component, "actions"), { recursive: true });
  writeFileSync(
    join(component, "agent-config.json"),
    JSON.stringify({
      version: 2,
      name: "demo",
      schema: { version: schemaVersion, keys: { "workspace.subdomain": { description: "The subdomain" } } },
    }),
  );
  writeFileSync(join(component, "actions", "onboard.md"), "---\nid: onboard\ntype: prompt\n---\n\nAsk.\n");
  const legacy = join(home, ".agents", "skill-config", "demo", "config.json");
  const current = join(home, ".agents", "config", "demo", "config.json");
  mkdirSync(home, { recursive: true });
  const run = (...args: string[]) => {
    const result = Bun.spawnSync([BIN, ...args, "--from", component], {
      env: { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude"), CLAUDECODE: "1" },
      cwd: home,
    });
    return { code: result.exitCode, json: JSON.parse(result.stdout.toString() || "null"), stderr: result.stderr.toString() };
  };
  const putLegacy = (config: object) => {
    mkdirSync(join(legacy, ".."), { recursive: true });
    writeFileSync(legacy, JSON.stringify(config));
  };
  return { run, putLegacy, legacy, current };
}

describe("adopting a v1 config", () => {
  test("start plans the adopt before onboarding, and onboarding waits for it", () => {
    const { run, putLegacy } = sandbox();
    putLegacy({ version: 1, workspace: { subdomain: "acme" } });
    const plan = run("start", "demo").json;
    expect(plan.ready).toBe(false);
    expect(plan.actions.map((one: { id: string }) => one.id)).toEqual(["agent-config:adopt", "onboard"]);
    expect(plan.actions[1].requires).toEqual(["agent-config:adopt"]);
    expect(plan.actions[0].type).toBe("code");
    expect(plan.actions[0].command).toContain("adopt demo --from");
    expect(plan.problems.filter((one: { code: string }) => one.code === "legacy-config-path")).toEqual([]);
  });

  test("adopt copies the answers, leaves the old file, and start is then ready", () => {
    const { run, putLegacy, legacy, current } = sandbox();
    putLegacy({ version: 1, workspace: { subdomain: "acme" } });
    const adopted = run("adopt", "demo");
    expect(adopted.code).toBe(0);
    expect(adopted.json.adopted).toHaveLength(1);
    expect(existsSync(legacy)).toBe(true);
    const written = JSON.parse(readFileSync(current, "utf8"));
    expect(written).toEqual({ workspace: { subdomain: "acme" }, schemaVersion: 1 });
    expect(existsSync(current.replace(/\.json$/, ".schema-snapshot.json"))).toBe(true);

    const plan = run("start", "demo").json;
    expect(plan.ready).toBe(true);
    expect(plan.config.workspace.subdomain).toBe("acme");
  });

  test("a second adopt does nothing, and both files existing is reported, never merged", () => {
    const { run, putLegacy } = sandbox();
    putLegacy({ workspace: { subdomain: "acme" } });
    run("adopt", "demo");
    const again = run("adopt", "demo").json;
    expect(again.adopted).toEqual([]);
    expect(again.kept).toHaveLength(1);
    const problems = run("start", "demo").json.problems;
    expect(problems.map((one: { code: string }) => one.code)).toEqual(["legacy-config-path"]);
  });

  test("past schema version 1, the adopted layer is stamped 1 with no snapshot, so migrate asks", () => {
    const { run, putLegacy, current } = sandbox(3);
    putLegacy({ workspace: { subdomain: "acme" } });
    run("adopt", "demo");
    expect(JSON.parse(readFileSync(current, "utf8")).schemaVersion).toBe(1);
    expect(existsSync(current.replace(/\.json$/, ".schema-snapshot.json"))).toBe(false);
    const migrate = run("start", "demo").json.actions.find((one: { id: string }) => one.id === "agent-config:migrate:global");
    expect(migrate.context).toMatchObject({ from: 1, to: 3, snapshot: null });
  });

  test("an inline secret is refused, and nothing is written for that layer", () => {
    const { run, putLegacy, current } = sandbox();
    putLegacy({ workspace: { subdomain: "acme" }, credentials: { apiKey: { value: "sk-live" } } });
    const adopted = run("adopt", "demo");
    expect(adopted.code).toBe(2);
    expect(adopted.json.failed).toHaveLength(1);
    expect(existsSync(current)).toBe(false);
  });
});
