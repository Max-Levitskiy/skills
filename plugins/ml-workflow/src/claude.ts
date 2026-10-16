// What the background and the interactive step both send to Claude (docs/spec.md, p.16–p.18): the
// flags that choose the session and the tools, and the messages of the session table.
import { checkParams, stepParams, type StepParams } from "./params.ts";
import { isObject } from "./schema.ts";

const STEP_ENV = ["RUNSPORE_RUN_ID", "RUNSPORE_NODE_ID", "RUNSPORE_VISIT", "RUNSPORE_ATTEMPT"];

/**
 * The visit and attempt of the spore step this runs as, or null after saying on stderr what is
 * missing: these commands only run as a step of a spore workflow.
 */
export function stepNumbers(command: string, also: string[] = []): { visit: number; attempt: number } | null {
  const missing = [...STEP_ENV, ...also].filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(`claude-spore ${command}: ${missing.join(", ")} not set; it runs as a step of a spore workflow`);
    return null;
  }
  const visit = Number(process.env.RUNSPORE_VISIT);
  const attempt = Number(process.env.RUNSPORE_ATTEMPT);
  if (!(visit >= 1 && Number.isInteger(visit)) || !(attempt >= 1 && Number.isInteger(attempt))) {
    console.error(`claude-spore ${command}: RUNSPORE_VISIT and RUNSPORE_ATTEMPT must be numbers from 1`);
    return null;
  }
  return { visit, attempt };
}

/**
 * The node parameters on stdin, checked again with `check`'s rules, or the `params.invalid`
 * message: the same input would fail every try. Warnings go to stderr.
 */
export async function readParams(command: string): Promise<StepParams | string> {
  let raw: unknown;
  try {
    raw = JSON.parse(await Bun.stdin.text());
  } catch {
    return "the step's input on stdin is not JSON";
  }
  if (!isObject(raw)) return "the step's input must be an object of node parameters";
  const problems = checkParams(raw);
  for (const warning of problems.filter((p) => p.severity === "warning")) {
    console.error(`claude-spore ${command}: warning: ${warning.message}`);
  }
  const errors = problems.filter((p) => p.severity === "error");
  if (errors.length > 0) return errors.map((p) => p.message).join("\n");
  return stepParams(raw);
}

/** `--session-id` or `--resume`, the permission mode, tools, model and the step files. */
export function claudeFlags(params: StepParams, mode: "start" | "resume", session: string): string[] {
  const args = [mode === "start" ? "--session-id" : "--resume", session, "--permission-mode", "default"];
  if (params.tools) {
    args.push("--tools", params.tools.join(","));
    if (params.tools.length > 0) args.push("--allowedTools", params.tools.join(","));
  }
  if (params.model) args.push("--model", params.model);
  if (process.env.RUNSPORE_STEP_FILES) args.push("--add-dir", process.env.RUNSPORE_STEP_FILES);
  return args;
}

/** The instructions file's prose, trimmed, or "" without one. */
export async function readInstructions(): Promise<string> {
  return process.env.RUNSPORE_INSTRUCTIONS ? (await Bun.file(process.env.RUNSPORE_INSTRUCTIONS).text()).trim() : "";
}

function inputBlock(params: StepParams): string {
  return `The input of this step:\n\n\`\`\`json\n${JSON.stringify(params.context, null, 2)}\n\`\`\``;
}

/** The first message of a session; `ending` says how to give the answer, and "" leaves it out. */
export function startMessage(params: StepParams, instructions: string, ending: string): string {
  const parts = [];
  if (instructions) parts.push(instructions);
  if (process.env.RUNSPORE_STEP_FILES) parts.push(`The step's files are in ${process.env.RUNSPORE_STEP_FILES}.`);
  parts.push(inputBlock(params));
  if (ending) parts.push(ending);
  const message = parts.join("\n\n");
  return params.skill ? `/${params.skill} ${message}` : message;
}

export function cameBackMessage(params: StepParams, visit: number, ending: string): string {
  return [
    `The run came back to this step: this is its visit ${visit}. Do the step again with the new input.`,
    inputBlock(params),
    ending,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function cutOffMessage(params: StepParams, ending: string): string {
  return [
    "You were cut off before you finished this step. Check what you already did, then finish the step.",
    inputBlock(params),
    ending,
  ]
    .filter(Boolean)
    .join("\n\n");
}
