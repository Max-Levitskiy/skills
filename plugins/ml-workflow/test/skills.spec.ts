// The sub-skills' frontmatter (docs/spec.md, p.2, p.6, the sub-skills step by step), and the one
// reaction table `start` and `continue` both carry (p.10).
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SKILLS = join(import.meta.dir, "..", "skills");
const TYPED_ONLY = ["act", "author", "menu"];
// What a sub-skill pre-approves past spore and claude-spore: `author` makes the helper programs it
// writes executable (p.22), `act` brings a step's pane to the front, and `menu` opens the pane
// through the mod's tool (p.11).
const EXTRA_TOOLS: Record<string, string[]> = {
  act: ["Bash(herdr", "agent", "focus", "*)"],
  author: ["Bash(chmod", "+x", "*)"],
  menu: ["mcp__ml-workflow__open_menu"],
};

function skill(name: string): { front: Record<string, string>; body: string } {
  const text = readFileSync(join(SKILLS, name, "SKILL.md"), "utf8");
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!match) throw new Error(`${name}/SKILL.md has no frontmatter`);
  const front = Object.fromEntries(
    match[1]!.split("\n").map((line) => {
      const colon = line.indexOf(":");
      return [line.slice(0, colon), line.slice(colon + 1).trim()];
    }),
  );
  return { front, body: match[2]! };
}

const names = readdirSync(SKILLS);

test("the seven sub-skills are there", () => {
  expect(names.sort()).toEqual(["act", "author", "cancel", "continue", "menu", "start", "status"]);
});

for (const name of names) {
  test(`${name} names itself, pre-approves spore and claude-spore, and checks Claude Code first`, () => {
    const { front, body } = skill(name);
    expect(front.name).toBe(name);
    const extra = EXTRA_TOOLS[name] ?? [];
    expect(front["allowed-tools"]!.split(" ")).toEqual(["Bash(claude", "--version)", "Bash(spore", "*)", "Bash(claude-spore", "*)", ...extra]);
    expect(body).toContain("## 1. Check Claude Code's version\n\nThis Claude Code reports: !`claude --version`");
    expect(front["disable-model-invocation"] === "true").toBe(TYPED_ONLY.includes(name));
  });
}

/** The rows of the reaction table under "## Following a run". */
function reactions(name: string): string[] {
  const following = skill(name).body.split("## Following a run")[1] ?? "";
  return following.split("\n").filter((line) => line.startsWith("| "));
}

test("start and continue react to each exit code the same way", () => {
  const rows = reactions("continue");
  expect(rows.map((row) => row.split("|")[1]!.trim())).toEqual(["Exit", "0", "1", "7", "3", "4", "5", "6", "2", "130", "other"]);
  expect(reactions("start")).toEqual(rows);
  // A decision, a stuck step and an async step, as each offers them.
  const offers = (name: string) => skill(name).body.split("**A decision.**")[1]!.split("The run does not need this session.")[0];
  expect(offers("start")).toContain("**An async step**, by `needs`:");
  expect(offers("start")).toBe(offers("continue"));
});
