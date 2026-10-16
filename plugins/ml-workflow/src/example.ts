// `claude-spore example list | copy` (docs/spec.md, "Starting a bundled example"): the workflows
// the plugin ships in skills/author/references/examples/, and copying one into a project, each
// Claude step in the background or watched in a herdr pane.
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { claudeStep } from "./check.ts";
import { isObject } from "./schema.ts";

const EXAMPLES = join(import.meta.dir, "..", "skills", "author", "references", "examples");

const USAGE = `usage: claude-spore example list [--json]
       claude-spore example copy <name> <folder> [--watch <node>]...`;

/** The watched form of a Claude step's action (skills/author/references/authoring.md §5.3). */
const WATCHED = {
  timeoutMs: "14400000",
  probe: { command: { argv: ["claude-spore", "probe"] } },
  watch: { command: { argv: ["claude-spore", "watch"] } },
  stop: { command: { argv: ["claude-spore", "stop"] } },
};

type Example = { name: string; description: string; claudeSteps: string[] };

export function example(argv: string[]): number {
  const [action, ...rest] = argv;
  if (action === "list") return list(rest);
  if (action === "copy") return copy(rest);
  console.error(USAGE);
  return 2;
}

function list(args: string[]): number {
  const json = args.includes("--json");
  if (args.some((a) => a !== "--json")) {
    console.error(USAGE);
    return 2;
  }
  const examples = readdirSync(EXAMPLES).sort().map(read);
  if (json) {
    console.log(JSON.stringify({ examples }));
  } else {
    for (const e of examples) {
      console.log(`${e.name}: ${e.description}`);
      console.log(`  Claude steps: ${e.claudeSteps.join(", ") || "none"}`);
    }
  }
  return 0;
}

function copy(args: string[]): number {
  const positional: string[] = [];
  const watched: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--watch") {
      const node = args[++i];
      if (node === undefined) {
        console.error(USAGE);
        return 2;
      }
      watched.push(node);
    } else {
      positional.push(args[i]!);
    }
  }
  if (positional.length !== 2) {
    console.error(USAGE);
    return 2;
  }
  const [name, folder] = positional as [string, string];
  const names = readdirSync(EXAMPLES);
  if (!names.includes(name)) {
    console.error(`example: no bundled workflow "${name}"; there are ${names.sort().join(", ")}`);
    return 1;
  }
  const source = join(EXAMPLES, name);
  const { claudeSteps } = read(name);
  const unknown = watched.filter((node) => !claudeSteps.includes(node));
  if (unknown.length > 0) {
    console.error(`example: ${unknown.join(", ")} ${unknown.length === 1 ? "is not a Claude step" : "are not Claude steps"} of ${name}; its Claude steps are ${claudeSteps.join(", ")}`);
    return 1;
  }
  const target = resolve(folder);
  if (existsSync(target)) {
    console.error(`example: ${target} already exists; nothing was copied`);
    return 1;
  }

  cpSync(source, target, { recursive: true });
  if (watched.length > 0) {
    const file = join(target, "settings.json");
    const settings = JSON.parse(readFileSync(file, "utf8"));
    for (const node of new Set(watched)) {
      const action = settings.actions[settings.nodes[node].action];
      action.argv = ["claude-spore", "start"];
      delete action.output;
      delete action.timeoutMs;
      action.async = WATCHED;
    }
    writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
  }
  const how = claudeSteps.map((node) => `${node} ${watched.includes(node) ? "in a herdr pane" : "in the background"}`);
  console.log(`Copied ${name} to ${target}${how.length > 0 ? `, ${how.join(", ")}` : ""}.`);
  return 0;
}

/** An example's name, the comment that opens its `workflow.dot`, and its Claude steps. */
function read(name: string): Example {
  const folder = join(EXAMPLES, name);
  const dot = readFileSync(join(folder, "workflow.dot"), "utf8");
  const comment = dot
    .split("\n")
    .filter((line) => line.startsWith("//"))
    .map((line) => line.replace(/^\/\/\s?/, ""))
    .join(" ");
  const settings = JSON.parse(readFileSync(join(folder, "settings.json"), "utf8"));
  const actions = isObject(settings.actions) ? settings.actions : {};
  const nodes = isObject(settings.nodes) ? settings.nodes : {};
  const claudeSteps = Object.entries(nodes)
    .filter(([, node]) => isObject(node) && typeof node.action === "string" && claudeStep(actions[node.action]))
    .map(([id]) => id);
  return { name, description: comment.trim(), claudeSteps };
}
