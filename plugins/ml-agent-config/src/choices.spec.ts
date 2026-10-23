// `choices`: the values a key can take, listed by the script its declaration names, handed the
// key, the search and the effective config, and refused when the declaration or the answer is wrong.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parseChoices } from "./cli";

const BIN = join(import.meta.dir, "..", "bin", "agent-config");

// The script echoes what it was handed as its one choice, so a test reads it back.
const ECHO = `const asked = JSON.parse(await Bun.stdin.text());
if (asked.config.provider === "broken") { console.error("the API is down"); process.exit(1); }
console.log(JSON.stringify({ choices: [{ value: asked.key, label: asked.search || "everything", detail: asked.config.provider }, { value: "bare" }], note: process.argv[2] }));
`;

function sandbox(keys: Record<string, object>, global: object = { provider: "fish" }) {
  const root = mkdtempSync(join(tmpdir(), "acs-choices-"));
  const home = join(root, "home");
  const component = join(root, "demo");
  mkdirSync(join(component, "scripts"), { recursive: true });
  writeFileSync(join(component, "agent-config.json"), JSON.stringify({ version: 2, name: "demo", schema: { version: 1, keys } }));
  writeFileSync(join(component, "scripts", "list.ts"), ECHO);
  mkdirSync(join(home, ".agents", "config", "demo"), { recursive: true });
  writeFileSync(join(home, ".agents", "config", "demo", "config.json"), JSON.stringify(global));
  return (...args: string[]) => {
    const ran = spawnSync(BIN, [...args, "--from", component], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude"), CLAUDECODE: "1" },
    });
    return { code: ran.status, stdout: ran.stdout, stderr: ran.stderr, json: () => JSON.parse(ran.stdout) };
  };
}

const PROVIDER = { description: "Who speaks", type: "string" };

describe("agent-config choices", () => {
  test("a local key's script is handed the key and the config, and no search", () => {
    const run = sandbox({ provider: PROVIDER, voice: { description: "The voice", type: "string", choices: { script: "scripts/list.ts" } } });
    const ran = run("choices", "demo", "voice", "--search", "narr");
    expect(ran.code).toBe(0);
    expect(ran.json()).toMatchObject({
      name: "demo",
      key: "voice",
      search: "local",
      choices: [{ value: "voice", label: "everything", detail: "fish" }, { value: "bare", label: "bare" }],
      note: "voice",
    });
  });

  test("a server key's script is handed the search", () => {
    const run = sandbox({ provider: PROVIDER, voice: { description: "The voice", type: "string", choices: { script: "scripts/list.ts", search: "server" } } });
    expect(run("choices", "demo", "voice", "--search", "narr").json().choices[0].label).toBe("narr");
    expect(run("choices", "demo", "voice", "--search", "").json().choices[0].label).toBe("everything");
  });

  test("a script that fails says why, on stderr", () => {
    const run = sandbox({ provider: PROVIDER, voice: { description: "The voice", type: "string", choices: { script: "scripts/list.ts" } } }, { provider: "broken" });
    const ran = run("choices", "demo", "voice");
    expect(ran.code).toBe(1);
    expect(ran.stderr).toContain("could not list voice: the API is down");
  });

  test("a key with no choices, or none at all, is refused", () => {
    const run = sandbox({ provider: PROVIDER });
    expect(run("choices", "demo", "provider").stderr).toContain("declares no choices");
    expect(run("choices", "demo", "nope").stderr).toContain("declares no key nope");
  });

  test("a script outside the declaration's folder is refused with the declaration", () => {
    const run = sandbox({ voice: { description: "The voice", choices: { script: "../elsewhere.ts" } } });
    const ran = run("choices", "demo", "voice");
    expect(ran.code).toBe(2);
    expect(ran.stderr).toContain("outside the declaration's folder");
  });
});

describe("a choices script's answer", () => {
  test("is read as choices, each labelled by its value when it names no label", () => {
    expect(parseChoices('{"choices":[{"value":"a","label":"A","detail":"x"},{"value":"b"}]}')).toEqual({
      choices: [{ value: "a", label: "A", detail: "x" }, { value: "b", label: "b" }],
    });
  });

  test("in another shape says so", () => {
    expect(parseChoices("nope")).toBe("it is not JSON");
    expect(parseChoices("{}")).toBe("it has no choices list");
    expect(parseChoices('{"choices":[{"value":1}]}')).toBe("a choice has no text value");
  });
});
