// `claude-spore run`, the background Claude step (docs/spec.md, p.16, p.18–p.20). It runs as a
// spore `command` with `output: "result"`: whatever happens, it prints one result-mode object and
// exits 0, so spore records an outcome or a failure that says whether another try can help.
import { join } from "node:path";

import { checkParams, stepParams, type StepParams } from "./params.ts";
import { answerSchema, fractionAt, isObject } from "./schema.ts";
import { sessionId } from "./session.ts";

type Result =
  | { outcome: string; output: unknown }
  | { error: { code: string; message: string; details?: unknown }; retryable: boolean };

type Envelope = {
  is_error?: boolean;
  result?: unknown;
  num_turns?: number;
  duration_ms?: number;
  total_cost_usd?: number;
  permission_denials?: { tool_name?: string; tool_input?: unknown }[];
  structured_output?: unknown;
  terminal_reason?: string;
  errors?: unknown;
};

type Call = { exitCode: number; stderr: string; envelope: Envelope | null };

type Facts = {
  session: string;
  turns: number;
  durationMs: number;
  costMicroUsd: number;
  deniedTools: { tool: string; input: unknown }[];
};

const REQUIRED_ENV = ["RUNSPORE_RUN_ID", "RUNSPORE_NODE_ID", "RUNSPORE_VISIT", "RUNSPORE_ATTEMPT"] as const;

// Spore's result limit is 64 KiB; the rest is room for the result's own keys.
const TEXT_LIMIT = 63 * 1024;

const NUDGE = "You ended without giving your answer in the required form. Give it now with the StructuredOutput tool.";

function failure(code: string, message: string, retryable: boolean): Result {
  return { error: { code, message }, retryable };
}

export async function run(): Promise<number> {
  const env = process.env;
  const missing = REQUIRED_ENV.filter((name) => !env[name]);
  if (missing.length > 0) {
    console.error(`claude-spore run: ${missing.join(", ")} not set; it runs as a step of a spore workflow`);
    return 2;
  }
  const visit = Number(env.RUNSPORE_VISIT);
  const attempt = Number(env.RUNSPORE_ATTEMPT);
  if (!(visit >= 1 && Number.isInteger(visit)) || !(attempt >= 1 && Number.isInteger(attempt))) {
    console.error("claude-spore run: RUNSPORE_VISIT and RUNSPORE_ATTEMPT must be numbers from 1");
    return 2;
  }

  const result = await step(visit, attempt);
  console.log(JSON.stringify(result));
  return 0;
}

async function step(visit: number, attempt: number): Promise<Result> {
  let raw: unknown;
  try {
    raw = JSON.parse(await Bun.stdin.text());
  } catch {
    return failure("params.invalid", "the step's input on stdin is not JSON", false);
  }
  if (!isObject(raw)) return failure("params.invalid", "the step's input must be an object of node parameters", false);
  const problems = checkParams(raw);
  for (const warning of problems.filter((p) => p.severity === "warning")) {
    console.error(`claude-spore run: warning: ${warning.message}`);
  }
  const errors = problems.filter((p) => p.severity === "error");
  if (errors.length > 0) return failure("params.invalid", errors.map((p) => p.message).join("\n"), false);

  const params = stepParams(raw);
  const claude = new Conversation(params, sessionId(process.env.RUNSPORE_RUN_ID!, process.env.RUNSPORE_NODE_ID!));
  try {
    return await converse(claude, params, visit, attempt);
  } finally {
    await claude.writeFacts(attempt);
  }
}

/** The session table of docs/spec.md p.18, then the answer. */
async function converse(claude: Conversation, params: StepParams, visit: number, attempt: number): Promise<Result> {
  const instructions = process.env.RUNSPORE_INSTRUCTIONS
    ? (await Bun.file(process.env.RUNSPORE_INSTRUCTIONS).text()).trim()
    : "";
  const start = async (): Promise<Call | Result> => {
    const call = await claude.send("start", startMessage(params, instructions));
    if (call.envelope === null && call.stderr.includes("is already in use")) {
      return failure(
        "session.foreign",
        `the session for this step, ${claude.session}, already belongs to another conversation; this run is on its first try of its first visit`,
        false,
      );
    }
    return call;
  };

  let call: Call | Result;
  if (visit === 1 && attempt === 1) {
    call = await start();
  } else {
    const resumed = await claude.send("resume", attempt > 1 ? cutOffMessage(params) : cameBackMessage(params, visit));
    if (resumed.envelope !== null || !resumed.stderr.includes("No conversation found")) {
      call = resumed;
    } else if (visit === 1) {
      // The first try died before Claude made the session.
      call = await start();
    } else {
      call = failure(
        "session.lost",
        `the conversation of this step, ${claude.session}, is gone (removed, or on another machine); this is visit ${visit}`,
        false,
      );
    }
  }
  if (!("exitCode" in call)) return call;

  const failed = callFailure(call);
  if (failed) return failed;
  if (params.format === "text") return textResult(params.outcome, call.envelope!.result);

  let output = call.envelope!.structured_output;
  if (output == null) {
    const nudged = await claude.send("resume", NUDGE);
    const nudgeFailed = callFailure(nudged);
    if (nudgeFailed) return nudgeFailed;
    output = nudged.envelope!.structured_output;
    if (output == null) {
      return failure("output.missing", "Claude ended twice without giving its answer in the required form", false);
    }
  }
  return answerResult(output, params);
}

function callFailure(call: Call): Result | null {
  const envelope = call.envelope;
  if (envelope?.terminal_reason === "structured_output_retry_exhausted") {
    return failure("output.invalid", `Claude's answer did not fit the schema after two repairs: ${errorsOf(call)}`, false);
  }
  if (call.exitCode !== 0 || envelope === null || envelope.is_error) {
    return failure("claude.failed", `claude exited ${call.exitCode}: ${errorsOf(call)}`, true);
  }
  return null;
}

function errorsOf(call: Call): string {
  const errors = call.envelope?.errors;
  if (Array.isArray(errors) && errors.length > 0) return errors.map(String).join("; ");
  if (typeof errors === "string" && errors !== "") return errors;
  if (typeof call.envelope?.result === "string" && call.envelope.result !== "") return call.envelope.result;
  return call.stderr.trim().slice(-2000) || "no message";
}

function answerResult(structured: unknown, params: StepParams): Result {
  const answer = isObject(structured) ? structured.answer : undefined;
  if (!isObject(answer) || typeof answer.outcome !== "string" || !(answer.outcome in params.schema)) {
    return failure("output.invalid", `Claude's answer names no outcome of this step: ${JSON.stringify(structured)}`, false);
  }
  const output = answer.output ?? null;
  const fraction = fractionAt(output);
  if (fraction !== null) {
    return failure(
      "output.invalid",
      `${fraction === "" ? "(root)" : fraction}: a number with a fraction; a step's output holds integers only`,
      false,
    );
  }
  return { outcome: answer.outcome, output };
}

function textResult(outcome: string, reply: unknown): Result {
  const text = typeof reply === "string" ? reply : "";
  const size = (t: string) => Buffer.byteLength(JSON.stringify({ outcome, output: { text: t } }));
  if (size(text) <= TEXT_LIMIT) return { outcome, output: { text } };
  let kept = text;
  let marked = kept;
  while (size(marked) > TEXT_LIMIT) {
    kept = kept.slice(Math.ceil(kept.length / 2));
    if (/^[\udc00-\udfff]/.test(kept)) kept = kept.slice(1);
    marked = `[claude-spore: the reply's first ${text.length - kept.length} characters were cut]\n${kept}`;
  }
  return { outcome, output: { text: marked } };
}

function inputBlock(params: StepParams): string {
  return `The input of this step:\n\n\`\`\`json\n${JSON.stringify(params.context, null, 2)}\n\`\`\``;
}

function answerLine(params: StepParams): string {
  return params.format === "json"
    ? "End by giving your answer with the StructuredOutput tool: the outcome that fits, and its output."
    : "End with your reply as plain text; it is the step's output.";
}

function startMessage(params: StepParams, instructions: string): string {
  const parts = [];
  if (instructions) parts.push(instructions);
  if (process.env.RUNSPORE_STEP_FILES) parts.push(`The step's files are in ${process.env.RUNSPORE_STEP_FILES}.`);
  parts.push(inputBlock(params), answerLine(params));
  const message = parts.join("\n\n");
  return params.skill ? `/${params.skill} ${message}` : message;
}

function cameBackMessage(params: StepParams, visit: number): string {
  return [
    `The run came back to this step: this is its visit ${visit}. Do the step again with the new input.`,
    inputBlock(params),
    answerLine(params),
  ].join("\n\n");
}

function cutOffMessage(params: StepParams): string {
  return [
    "You were cut off before you finished this step. Check what you already did, then finish the step.",
    inputBlock(params),
    answerLine(params),
  ].join("\n\n");
}

/** The `claude -p` calls of one try, and the facts they add up to. */
class Conversation {
  private facts: Facts;
  private answered = false;

  constructor(
    private params: StepParams,
    readonly session: string,
  ) {
    this.facts = { session, turns: 0, durationMs: 0, costMicroUsd: 0, deniedTools: [] };
  }

  async send(mode: "start" | "resume", message: string): Promise<Call> {
    const { params } = this;
    const args = ["-p", "--output-format", "json", mode === "start" ? "--session-id" : "--resume", this.session];
    args.push("--permission-mode", "default");
    if (params.tools) {
      args.push("--tools", params.tools.join(","));
      if (params.tools.length > 0) args.push("--allowedTools", params.tools.join(","));
    }
    if (params.model) args.push("--model", params.model);
    if (process.env.RUNSPORE_STEP_FILES) args.push("--add-dir", process.env.RUNSPORE_STEP_FILES);
    if (params.format === "json") args.push("--json-schema", JSON.stringify(answerSchema(params.schema)));

    let child;
    try {
      child = Bun.spawn(["claude", ...args], {
        stdin: Buffer.from(message),
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, MAX_STRUCTURED_OUTPUT_RETRIES: "3" },
      });
    } catch (error) {
      return { exitCode: 127, stderr: `could not start claude: ${(error as Error).message}`, envelope: null };
    }
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    const envelope = parseEnvelope(stdout);
    if (envelope) this.count(envelope);
    return { exitCode, stderr, envelope };
  }

  private count(envelope: Envelope) {
    this.answered = true;
    this.facts.turns += whole(envelope.num_turns);
    this.facts.durationMs += whole(envelope.duration_ms);
    this.facts.costMicroUsd += whole(envelope.total_cost_usd, 1e6);
    for (const denial of envelope.permission_denials ?? []) {
      this.facts.deniedTools.push({ tool: String(denial.tool_name ?? ""), input: denial.tool_input ?? null });
    }
  }

  async writeFacts(attempt: number) {
    const dir = process.env.RUNSPORE_WORK_DIR;
    if (!dir || !this.answered) return;
    try {
      await Bun.write(join(dir, `${attempt}.facts.json`), `${JSON.stringify(this.facts)}\n`);
    } catch (error) {
      console.error(`claude-spore run: could not write the facts file: ${(error as Error).message}`);
    }
  }
}

function parseEnvelope(stdout: string): Envelope | null {
  try {
    const value = JSON.parse(stdout);
    return isObject(value) ? (value as Envelope) : null;
  } catch {
    return null;
  }
}

function whole(value: unknown, scale = 1): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value * scale) : 0;
}
