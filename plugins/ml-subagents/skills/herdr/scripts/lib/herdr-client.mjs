import { spawnSync } from "node:child_process";

const CONTEXT = ["HERDR_SOCKET_PATH", "HERDR_SESSION", "HERDR_PANE_ID", "HERDR_TAB_ID", "HERDR_WORKSPACE_ID"];
export class HerdrError extends Error {
  constructor(code, message, details = {}) { super(message); this.code = code; Object.assign(this, details); }
}
export function bounded(value, limit = 16384) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 65536) throw new HerdrError("invalid_budget", "Character budget must be 1..65536");
  const s = String(value);
  return { text: s.slice(0, limit), truncated: s.length > limit };
}
export function route(scope = {}, args = [], environment = process.env) {
  for (const key of ["session", "machine", "wsl", "binary", "remote"])
    if (scope[key] !== undefined && (typeof scope[key] !== "string" || !scope[key].trim()))
      throw new HerdrError("invalid_target", key + " requires a nonempty string");
  if (scope.machine && scope.session) throw new HerdrError("conflicting_target", "Machine profiles already select a session; do not combine machine/session");
  if (scope.remote) throw new HerdrError("interactive_target", "Remote is an interactive attach path; use a saved machine or execute this CLI on the remote host");
  const prefix = scope.machine ? ["--machine", scope.machine] : scope.session ? ["--session", scope.session] : [];
  const env = { ...environment };
  if (scope.machine || scope.session || scope.wsl) for (const k of CONTEXT) delete env[k];
  const binary = scope.binary || environment.HERDR_BIN_PATH || "herdr";
  return scope.wsl
    ? { command: process.platform === "win32" ? "wsl.exe" : "wsl", args: ["-d", scope.wsl, "--exec", binary, ...prefix, ...args], env }
    : { command: binary, args: [...prefix, ...args], env };
}
export function outcome(agent = {}, verified = false) {
  const status = agent.agent_status || "unknown";
  return { native_status: status, task_verified: Boolean(verified), disposition: verified ? "verified" :
    status === "blocked" ? "inspect-input" : status === "working" ? "running" :
    status === "idle" || status === "done" ? "verify-output" : "inspect-unknown" };
}
export function movedIdentity(record, result) {
  const move = result.move_result;
  if (!move?.pane?.pane_id || move.previous_pane_id !== record.pane_id)
    throw new HerdrError("stale_move", "Move response does not match the tracked pane");
  return { ...record, ...move.pane };
}
export async function mapLimit(items, limit, worker) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new HerdrError("invalid_concurrency", "Concurrency must be 1..100");
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try { results[index] = { ok: true, value: await worker(items[index], index) }; }
      catch (error) { results[index] = { ok: false, error }; }
    }
  }));
  return results;
}
// subscribe must acknowledge readiness and keep draining; events only invalidate snapshots.
export async function reconcileSnapshot(subscribe, snapshot, { maxRefreshes = 3, timeoutMs = 10000 } = {}) {
  if (!Number.isInteger(maxRefreshes) || maxRefreshes < 1 || maxRefreshes > 100 || !Number.isFinite(timeoutMs) || timeoutMs < 1)
    throw new HerdrError("invalid_budget", "Recovery requires finite time/refresh limits");
  let dirty = true, lost = false, unsubscribe;
  const until = Date.now() + timeoutMs;
  const withinDeadline = async (operation) => {
    const left = until - Date.now();
    if (left <= 0) throw new HerdrError("recovery_timeout", "Recovery deadline expired");
    let timer;
    try { return await Promise.race([operation(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new HerdrError("recovery_timeout", "Recovery deadline expired")), left);
    })]); } finally { clearTimeout(timer); }
  };
  try {
    unsubscribe = await withinDeadline(() => Promise.resolve(subscribe(event => {
      if (event?.code === "events_lost") lost = true;
      dirty = true;
    })).then(close => { if (Date.now() >= until) { if (typeof close === "function") close(); throw new HerdrError("recovery_timeout","Subscription completed after deadline"); } return close; }));
    for (let n = 0; n < maxRefreshes; n++) {
      dirty = false;
      const value = await withinDeadline(snapshot);
      if (lost) throw new HerdrError("events_lost", "Cache is stale; open a new subscription before another snapshot");
      if (!dirty) return value;
    }
    throw new HerdrError("recovery_churn", "Cache remains stale at the refresh budget");
  } finally { if (typeof unsubscribe === "function") unsubscribe(); }
}

export function validateRead({lines=80,source="visible"}={}) {
  if (!Number.isInteger(lines) || lines < 1 || lines > 1000 || !["visible","detection","recent","recent-unwrapped"].includes(source))
    throw new HerdrError("invalid_read", "Read requires 1..1000 lines and a documented source");
}

export class HerdrClient {
  constructor(scope = {}, { runner = spawnSync, environment = process.env, maxChars = 16384 } = {}) {
    this.scope = scope; this.runner = runner; this.environment = environment; this.maxChars = maxChars;
    route(scope, [], environment); bounded("", maxChars);
  }
  run(args, { text = false, timeoutMs = 15000 } = {}) {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 3600000)
      throw new HerdrError("invalid_timeout", "CLI timeout must be 1..3600000 ms");
    if (this.scope.wsl && !this.wslChecked) {
      const command = process.platform === "win32" ? "wsl.exe" : "wsl";
      const inventory = this.runner(command,["--list","--verbose"],{env:this.environment,encoding:"utf8",timeout:15000,maxBuffer:524288});
      if (inventory.error || inventory.status !== 0) throw new HerdrError("wsl_unavailable", "Cannot inventory the selected WSL runtime");
      const rows = String(inventory.stdout || "").replace(/\0/g,"").split(/\r?\n/).map(x=>x.trim().replace(/^\*\s*/,""));
      const row = rows.find(x=>x.startsWith(this.scope.wsl+" ") || x.startsWith(this.scope.wsl+"\t"));
      if (!row || row.slice(this.scope.wsl.length).trim().split(/\s+/)[0] !== "Running")
        throw new HerdrError("wsl_not_running", "Selected distro is absent/stopped/unknown; no command was run inside it");
      this.wslChecked=true;
    }
    const r = route(this.scope, args, this.environment);
    const p = this.runner(r.command, r.args, { env: r.env, encoding: "utf8", timeout: timeoutMs, maxBuffer: 524288 });
    if (p.error || p.status !== 0) {
      let error;
      try { error = JSON.parse((p.stderr || p.stdout || "").trim()).error; } catch {}
      throw new HerdrError(error?.code || (p.error ? "transport_error" : "cli_error"),
        bounded(error?.message || p.error?.message || p.stderr || "Herdr command failed", 1000).text);
    }
    if (text) return p.stdout || "";
    try { const j = JSON.parse(p.stdout); if (j.error) throw new HerdrError(j.error.code, j.error.message); return j.result ?? j; }
    catch (e) { if (e instanceof HerdrError) throw e; throw new HerdrError("invalid_response", "Expected native JSON response"); }
  }
  probe({ launch = false, kind } = {}) {
    const version = this.run(["--version"], { text: true }).trim();
    const prompt = this.run(["agent", "prompt", "--help"], { text: true });
    if (!prompt.includes("--wait") || !prompt.includes("--until"))
      throw new HerdrError("unsupported_cli", "This helper requires native agent prompt/wait; inspect installed help or update deliberately");
    if (launch) {
      const start = this.run(["agent", "start", "--help"], { text: true });
      if (!start.includes("--kind") || !start.includes("--pane"))
        throw new HerdrError("unsupported_cli", "This helper requires native managed agent start in an existing pane");
      if (kind) {
        const supported = start.match(/\[possible values:\s*([^\]]+)\]/)?.[1].split(",").map(x=>x.trim());
        if (!supported) throw new HerdrError("unsupported_cli", "Cannot verify managed kinds from installed start help");
        if (!supported.includes(kind)) throw new HerdrError("unsupported_kind", "Installed CLI does not support this managed agent kind");
      }
    }
    const status = this.run(["status", "server", "--json"]);
    const server = status.server || status;
    if (server.running === false || server.compatible === false || server.status === "stopped")
      throw new HerdrError("server_unavailable", "Selected server is not running/compatible");
    return { version, server };
  }
  get(target) {
    if (typeof target !== "string" || !target.trim()) throw new HerdrError("invalid_target", "Agent target must be nonempty");
    return this.run(["agent", "get", target]).agent;
  }
  read(target, { lines = 80, source = "visible" } = {}) {
    validateRead({lines,source});
    if (typeof target !== "string" || !target.trim()) throw new HerdrError("invalid_target", "Agent target must be nonempty");
    return bounded(this.run(["agent", "read", target, "--source", source, "--lines", String(lines), "--format", "text"], { text: true }), this.maxChars);
  }
  ask(target, text, { timeout = 120000, lines = 80, source = "visible" } = {}) {
    validateRead({lines,source});
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 3598000) throw new HerdrError("invalid_timeout", "Reply timeout must be 1..3598000 ms");
    if (typeof text !== "string" || !text.trim() || typeof target !== "string" || !target.trim()) throw new HerdrError("invalid_prompt", "Target and nonempty prompt are required");
    this.probe();
    const before = this.get(target);
    if (!before?.pane_id) throw new HerdrError("agent_not_found", "Agent get returned no hosting pane");
    if (!["idle", "done"].includes(before.agent_status) || before.launch_pending || before.interactive_ready === false)
      throw new HerdrError("agent_not_idle", "Inspect the current turn/dialog before sending; no input was sent", { submission_may_have_occurred: false });
    const pane = before.pane_id;
    let phase = "submission";
    try {
      const result = this.run(["agent", "prompt", pane, text, "--wait", "--until", "idle", "--until", "done", "--until", "blocked", "--timeout", String(timeout)], { timeoutMs: timeout + 2000 });
      phase = "observation"; // Successful prompt response proves acceptance, even if later inspection fails.
      const after = result.agent || this.get(pane);
      if (after.terminal_id && before.terminal_id && after.terminal_id !== before.terminal_id)
        throw new HerdrError("agent_replaced", "The terminal occupant changed during submission");
      return { pane_id: pane, agent: after, before, ...outcome(after), reply: this.read(pane, { lines, source }) };
    } catch (error) {
      // Only agent_blocked is documented to reject before input; other in-flight errors remain uncertain.
      const details = { pane_id: pane, submission_may_have_occurred: phase !== "submission" || error.code !== "agent_blocked", task_verified: false };
      try { details.observation = { agent: this.get(pane), read: this.read(pane, { lines, source: "visible" }) }; } catch {}
      Object.assign(error, details);
      throw error; // Never resend a prompt or Enter automatically.
    }
  }
}
