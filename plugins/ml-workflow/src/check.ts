// `claude-spore check <folder>` (docs/spec.md, p.15): the node parameters of every Claude step in
// a workflow folder's `settings.json`. It builds nothing; `spore validate` checks the rest.
import { basename, join } from "node:path";

import { checkParams, PARAMETERS, type Problem } from "./params.ts";
import { isObject } from "./schema.ts";

type NodeProblem = Problem & { node: string | null };

export async function check(args: string[]): Promise<number> {
  const json = args.includes("--json");
  const rest = args.filter((a) => a !== "--json");
  if (rest.length !== 1) {
    console.error("usage: claude-spore check <folder> [--json]");
    return 2;
  }
  const folder = rest[0]!;
  const { problems, steps } = await checkFolder(folder);
  const errors = problems.filter((p) => p.severity === "error");
  const warnings = problems.filter((p) => p.severity === "warning");
  if (json) {
    const strip = ({ severity, ...rest }: NodeProblem) => rest;
    console.log(JSON.stringify({ ok: errors.length === 0, errors: errors.map(strip), warnings: warnings.map(strip) }));
  } else {
    for (const p of problems) console.log(`${p.severity}: ${p.node ?? folder}: ${p.message}`);
    if (errors.length === 0) {
      console.log(`${folder}: ${steps} Claude ${steps === 1 ? "step" : "steps"} checked, no errors`);
    }
  }
  return errors.length > 0 ? 2 : 0;
}

async function checkFolder(folder: string): Promise<{ problems: NodeProblem[]; steps: number }> {
  let settings: unknown;
  try {
    settings = JSON.parse(await Bun.file(join(folder, "settings.json")).text());
  } catch (error) {
    const message = `cannot read ${join(folder, "settings.json")}: ${(error as Error).message}`;
    return { problems: [{ severity: "error", code: "workflow.unreadable", message, node: null }], steps: 0 };
  }
  const actions = isObject(settings) && isObject(settings.actions) ? settings.actions : {};
  const nodes = isObject(settings) && isObject(settings.nodes) ? settings.nodes : {};

  const problems: NodeProblem[] = [];
  let steps = 0;
  for (const [nodeId, node] of Object.entries(nodes)) {
    if (!isObject(node) || typeof node.action !== "string") continue;
    const action = actions[node.action];
    if (!isClaudeStep(action)) continue;
    steps++;
    const outcomes = Array.isArray(action.outcomes) ? action.outcomes.map(String) : ["ok"];
    for (const problem of nodeProblems(node, outcomes)) problems.push({ ...problem, node: nodeId });
  }
  return { problems, steps };
}

/** A `command` running `claude-spore run` or `start`, by name or by a path to it. */
function isClaudeStep(action: unknown): action is Record<string, unknown> {
  if (!isObject(action) || action.kind !== "command" || !Array.isArray(action.argv)) return false;
  const [program, command] = action.argv;
  return (
    typeof program === "string" && basename(program) === "claude-spore" && (command === "run" || command === "start")
  );
}

/** The node's parameters as `run` will get them, then the rules both share. */
function nodeProblems(node: Record<string, unknown>, outcomes: string[]): Problem[] {
  const input = node.input ?? {};
  if (!isObject(input)) {
    return [{ severity: "error", code: "params.not-literal", message: `the node's "input" must be an object of node parameters` }];
  }
  const problems: Problem[] = [];
  const values: Record<string, unknown> = {};
  let schemaReported = false;
  for (const [key, value] of Object.entries(input)) {
    if (!(PARAMETERS as readonly string[]).includes(key)) {
      problems.push({
        severity: "error",
        code: "params.unknown",
        message: `"${key}" is not a node parameter; they are ${PARAMETERS.join(", ")}`,
      });
    } else if (key === "context") {
      values.context = value;
    } else if (key === "schema" && isOutputSchemasRef(value)) {
      if (isObject(node.outputSchemas)) {
        values.schema = node.outputSchemas;
      } else {
        schemaReported = true;
        problems.push({
          severity: "error",
          code: "params.schema-missing",
          message: `"schema" is {"$outputSchemas": {}}, but the node declares no "outputSchemas"`,
        });
      }
    } else if (isObject(value) && Object.keys(value).length === 1 && "$literal" in value) {
      values[key] = value.$literal;
    } else {
      if (key === "schema") schemaReported = true;
      problems.push({
        severity: "error",
        code: "params.not-literal",
        message: `"${key}" must be a {"$literal": …} value${key === "schema" ? ` or {"$outputSchemas": {}}` : ""}`,
      });
    }
  }
  for (const problem of checkParams(values, outcomes)) {
    // A schema already reported above is not reported again as missing.
    if (!(schemaReported && problem.code === "params.schema-missing")) problems.push(problem);
  }
  return problems;
}

function isOutputSchemasRef(value: unknown): boolean {
  return (
    isObject(value) &&
    Object.keys(value).length === 1 &&
    isObject(value.$outputSchemas) &&
    Object.keys(value.$outputSchemas).length === 0
  );
}
