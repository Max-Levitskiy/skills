// The herdr calls of the interactive step (docs/spec.md, p.17). Every call prints `{"result": …}`
// on success, or `{"error": {"code", "message"}}` on stderr with exit 1.
import { isObject } from "./schema.ts";

export type Agent = { status: string; pane: string };

export class HerdrError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function call(args: string[]): Record<string, unknown> {
  let child;
  try {
    child = Bun.spawnSync(["herdr", ...args], { stderr: "pipe" });
  } catch (error) {
    throw new HerdrError("unavailable", `could not run herdr: ${(error as Error).message}`);
  }
  const parse = (text: string) => {
    try {
      const value = JSON.parse(text);
      return isObject(value) ? value : null;
    } catch {
      return null;
    }
  };
  if (child.exitCode !== 0) {
    const stderr = child.stderr.toString();
    const error = parse(stderr)?.error;
    if (isObject(error)) throw new HerdrError(String(error.code ?? "error"), String(error.message ?? stderr.trim()));
    throw new HerdrError("error", `herdr ${args[0]} ${args[1] ?? ""} exited ${child.exitCode}: ${stderr.trim()}`);
  }
  const result = parse(child.stdout.toString())?.result;
  return isObject(result) ? result : {};
}

/** The live agent by that name, or null when herdr says it is gone. Throws when herdr does not answer. */
export function getAgent(name: string): Agent | null {
  let result;
  try {
    result = call(["agent", "get", name]);
  } catch (error) {
    if (error instanceof HerdrError && error.code.includes("not_found")) return null;
    throw error;
  }
  const agent = isObject(result.agent) ? result.agent : {};
  return { status: String(agent.agent_status ?? "unknown"), pane: String(agent.pane_id ?? "") };
}

/** A new workspace for the agent, in `cwd`, with `env` in its shell; returns its pane. */
export function openPane(name: string, cwd: string, env: Record<string, string>): string {
  const args = ["workspace", "create", "--label", name, "--cwd", cwd, "--no-focus"];
  for (const [key, value] of Object.entries(env)) args.push("--env", `${key}=${value}`);
  const result = call(args);
  const pane = isObject(result.root_pane) ? result.root_pane.pane_id : undefined;
  if (typeof pane !== "string" || pane === "") throw new HerdrError("error", "herdr created a workspace without a pane");
  return pane;
}

export function startClaude(name: string, pane: string, args: string[]) {
  call(["agent", "start", name, "--kind", "claude", "--pane", pane, "--timeout", "60000", "--", ...args]);
}

export function prompt(name: string, message: string) {
  call(["agent", "prompt", name, message]);
}

export function closePane(pane: string) {
  call(["pane", "close", pane]);
}

/** Whether a herdr server answers and runs. */
export function reachable(): boolean {
  try {
    const server = call(["status", "server", "--json"]).server;
    return isObject(server) && server.running === true;
  } catch {
    return false;
  }
}
