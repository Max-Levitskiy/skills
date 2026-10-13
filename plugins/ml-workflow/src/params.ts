// Node parameters (docs/spec.md, p.14): the rules `check` applies to a workflow folder and `run`
// applies again to the values it gets on stdin.
import { isObject, notStrict, type Schemas } from "./schema.ts";
import { isToolName } from "./tools.ts";

export const PARAMETERS = ["format", "schema", "outcome", "model", "tools", "skill", "context"] as const;

/** Parameters that passed `checkParams`, typed. */
export type StepParams = {
  format: "json" | "text";
  schema: Schemas;
  outcome: string;
  model?: string;
  tools?: string[];
  skill?: string;
  context: unknown;
};

export type Problem = { severity: "error" | "warning"; code: string; message: string };

const SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*(:[A-Za-z0-9][A-Za-z0-9._-]*)?$/;

/**
 * Every problem with a node's evaluated parameters. With the action's `outcomes`, also whether the
 * parameters cover them, which only `check` knows: a running step never learns its outcomes.
 */
export function checkParams(params: Record<string, unknown>, outcomes?: string[]): Problem[] {
  const problems: Problem[] = [];
  const error = (code: string, message: string) => problems.push({ severity: "error", code, message });

  for (const key of Object.keys(params)) {
    if (!(PARAMETERS as readonly string[]).includes(key)) {
      error("params.unknown", `"${key}" is not a node parameter; they are ${PARAMETERS.join(", ")}`);
    }
  }

  const format = params.format ?? "json";
  if (format !== "json" && format !== "text") {
    error("params.format", `"format" is ${JSON.stringify(format)}; it must be "json" or "text"`);
  }

  if (format === "json") {
    const schema = params.schema;
    if (!isObject(schema) || Object.keys(schema).length === 0 || !Object.values(schema).every(isObject)) {
      error("params.schema-missing", `a json step needs "schema", a map from each outcome to its schema`);
    } else {
      for (const outcome of outcomes ?? []) {
        if (!(outcome in schema)) error("params.schema-outcome", `outcome "${outcome}" has no schema`);
      }
      for (const outcome of Object.keys(schema)) {
        if (outcomes && !outcomes.includes(outcome)) {
          error("params.schema-outcome", `"schema" names outcome "${outcome}", which the action does not declare`);
        }
        const reason = notStrict(schema[outcome]);
        if (reason) {
          problems.push({
            severity: "warning",
            code: "schema.not-strict",
            message: `the schema of outcome "${outcome}" is outside Claude Code's strict form (${reason}); Claude Code checks answers against it without the grammar guarantee`,
          });
        }
      }
    }
  }

  if (format === "text") {
    const outcome = params.outcome;
    if (typeof outcome !== "string" || outcome === "") {
      error("params.outcome", `a text step needs "outcome", the one outcome it ends with`);
    } else if (outcomes && (outcomes.length !== 1 || outcomes[0] !== outcome)) {
      error(
        "params.outcome",
        `a text step ends only with its "outcome" "${outcome}", but the action declares ${outcomes.map((o) => `"${o}"`).join(", ")}`,
      );
    }
  }

  if (params.model !== undefined && (typeof params.model !== "string" || params.model === "")) {
    error("params.model", `"model" must be a model name`);
  }

  if (params.tools !== undefined) {
    if (!Array.isArray(params.tools) || !params.tools.every((t) => typeof t === "string")) {
      error("params.tools", `"tools" must be a list of tool names`);
    } else {
      for (const tool of params.tools) {
        if (!isToolName(tool)) error("params.tools", `"${tool}" is not a Claude Code tool`);
      }
    }
  }

  if (params.skill !== undefined && (typeof params.skill !== "string" || !SKILL_NAME.test(params.skill))) {
    error("params.skill", `"skill" must be a skill name, "name" or "plugin:name"`);
  }

  return problems;
}

/** The parameters with their defaults filled in. Call only when `checkParams` found no error. */
export function stepParams(params: Record<string, unknown>): StepParams {
  return {
    format: (params.format as "json" | "text" | undefined) ?? "json",
    schema: (params.schema as Schemas | undefined) ?? {},
    outcome: (params.outcome as string | undefined) ?? "",
    model: params.model as string | undefined,
    tools: params.tools as string[] | undefined,
    skill: params.skill as string | undefined,
    context: params.context ?? null,
  };
}
