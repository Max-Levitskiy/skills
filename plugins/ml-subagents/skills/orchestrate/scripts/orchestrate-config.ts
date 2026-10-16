#!/usr/bin/env bun
// orchestrate's config, through the agent-config CLI (ACS v2).
//
//   bun orchestrate-config.ts show [--json]    layers, effective settings and where each came from
//   bun orchestrate-config.ts path [layer]     where a layer lives
//   bun orchestrate-config.ts verify           resolve the credential and make one real call
//
// Writing a layer is `agent-config write orchestrate --layer <layer>`, which also stamps it,
// journals it and gitignores the local layer. No secret ever reaches argv, stdout, or a config file.

import {
  AgentConfigError,
  CREDENTIAL_FOR,
  describeCredential,
  layerPaths,
  loadConfig,
  loadWithSecret,
  startPlan,
  type Layer,
  type TrackerKind,
} from "./lib/config";
import { verifyTracker } from "./lib/tracker";

function die(msg: string, code = 1): never {
  console.error(msg);
  process.exit(code);
}

/** Run one config call, turning an agent-config failure into its own diagnosis and exit code. */
async function guarded<T>(call: () => T | Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (e: any) {
    if (e instanceof AgentConfigError) die(e.message, e.exitCode === 127 ? 1 : e.exitCode);
    throw e;
  }
}

async function cmdShow(json: boolean) {
  const plan = await guarded(startPlan);
  const layers = await guarded(layerPaths);
  if (json) return console.log(JSON.stringify({ ...plan, layers }, null, 2));

  const { config, provenance } = plan;
  console.log("Config layers (later overrides earlier):");
  for (const one of layers) {
    if (!one.path) console.log(`  · ${one.layer.padEnd(9)} (needs a git repository)`);
    else console.log(`  ${one.exists ? "✓" : "·"} ${one.layer.padEnd(9)} ${one.path}${one.exists ? "" : " (absent)"}`);
  }

  const from = (key: string) => (provenance[key] ? `  [${provenance[key]}]` : "");
  const t = config.tracker ?? {};
  const kind = t.kind || "";
  const target = t.path ?? t.repo ?? (t.site ? `${t.site} ${t.project ?? ""}`.trim() : undefined) ?? t.team;
  const credName = kind ? CREDENTIAL_FOR[kind as TrackerKind] : null;
  const cred = credName ? config.credentials?.[credName] : undefined;
  console.log("\nEffective settings:");
  console.log(`  tracker.kind         ${kind || "(empty: Phase 1 discovers the tracker)"}${from("tracker.kind")}`);
  if (kind) console.log(`  tracker target       ${target ?? "(not set)"}`);
  if (kind === "github") console.log(`  github auth          ${cred ? "token" : t.githubAuth ?? "gh"}${from("tracker.githubAuth")}`);
  if (credName && cred) console.log(`  credential           credentials.${credName}: ${describeCredential(cred)}`);
  console.log(`  questions.path       ${config.questions?.path || "(empty: near the work)"}${from("questions.path")}`);
  console.log(`  questions.human      ${config.questions?.human || "(not set)"}${from("questions.human")}`);
  console.log(`  models.judgment      ${config.models?.judgment || "(inherit session model)"}${from("models.judgment")}`);
  console.log(`  models.mechanical    ${config.models?.mechanical || "(inherit session model)"}${from("models.mechanical")}`);
  console.log(`  maxParallelAgents    ${config.defaults?.maxParallelAgents}${from("defaults.maxParallelAgents")}`);
  console.log(`  maxPackages          ${config.defaults?.maxPackages}${from("defaults.maxPackages")}`);
  console.log(`  verifyOnDisk         ${config.defaults?.verifyOnDisk}${from("defaults.verifyOnDisk")}`);

  for (const problem of plan.problems) console.log(`\n! ${problem.message}`);
  const missing = plan.actions.flatMap((action) => action.keys);
  const outstanding = missing.length ? `Missing: ${missing.join(", ")}` : `Outstanding: ${plan.actions.map((action) => action.id).join(", ")}`;
  console.log(plan.ready ? "\nReady." : `\nNot ready. ${outstanding}. Run: agent-config start orchestrate`);
  if (!plan.ready) process.exit(2);
}

async function cmdPath(arg?: string) {
  const layers = await guarded(layerPaths);
  const wanted = arg ? layers.filter((one) => one.layer === (arg as Layer)) : layers;
  if (!wanted.length) die(`Unknown layer "${arg}". Use one of: ${layers.map((one) => one.layer).join(", ")}`);
  for (const one of wanted) console.log(`${one.layer.padEnd(9)} ${one.path ?? "n/a (needs a git repository)"}`);
}

async function cmdVerify() {
  const config = await guarded(loadConfig);
  const kind = config.tracker?.kind;
  if (!kind) die("tracker.kind is empty: Phase 1 discovers the tracker each time, so there is nothing to verify.", 2);
  const credName = CREDENTIAL_FOR[kind];
  // GitHub without a configured token goes through gh; every other remote tracker requires one.
  const secret = credName && config.credentials?.[credName] ? credName : undefined;
  const { token } = await guarded(() => loadWithSecret(secret));
  const result = await verifyTracker(config, token);
  console.log(result.ok ? `OK — ${result.detail}` : `FAILED — ${result.detail}`);
  process.exit(result.ok ? 0 : 1);
}

const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
  case "show":
    await cmdShow(rest.includes("--json"));
    break;
  case "path":
    await cmdPath(rest[0]);
    break;
  case "verify":
    await cmdVerify();
    break;
  case "help":
  case undefined:
    console.log(
      [
        "orchestrate config (through agent-config)",
        "",
        "  show [--json]      layers, effective settings and their source  (exit 2 = not ready)",
        "  path [layer]       where global | repo | user-repo | local live",
        "  verify             resolve the credential and make one real call to the tracker",
        "",
        "Write a layer with: agent-config write orchestrate --layer <layer>  (JSON on stdin)",
      ].join("\n"),
    );
    break;
  default:
    die(`Unknown command "${cmd}". Run 'help'.`);
}
