#!/usr/bin/env bun
// orchestrate — Agent Config Standard (ACS v1) CLI.
//
//   bun orchestrate-config.ts check          layers, effective settings, what's missing
//   bun orchestrate-config.ts show           merged config (credentials described, never revealed)
//   bun orchestrate-config.ts path [layer]   where a layer lives
//   bun orchestrate-config.ts write <layer>  write that layer from JSON on stdin
//   bun orchestrate-config.ts verify         resolve the credential and make one real call
//   bun orchestrate-config.ts gitignore      ensure the local layer is gitignored
//
// No secret ever reaches argv, stdout, or a config file.

import {
  loadConfig,
  layerPath,
  writeLayer,
  ensureGitignored,
  validate,
  repoRoot,
  CREDENTIAL_FOR,
  type Layer,
  type OrchestrateConfig,
} from "./lib/config";
import { describeCredential } from "./lib/credentials";
import { verifyTracker } from "./lib/tracker";

const DEFAULTS = { maxParallelAgents: 5, maxPackages: 8, verifyOnDisk: true };
const LAYERS: Layer[] = ["global", "repo", "local"];

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

/** Redact credential objects down to a human description before anything is printed. */
function forDisplay(c: OrchestrateConfig): any {
  const out: any = structuredClone(c);
  if (out.credentials) {
    for (const [name, ref] of Object.entries(out.credentials)) {
      out.credentials[name] = ref ? describeCredential(ref as any) : ref;
    }
  }
  return out;
}

async function cmdCheck() {
  const { config, found, missing, legacy } = loadConfig();
  const root = repoRoot();

  console.log(`repo root: ${root ?? "(not a git repository — only the global layer applies)"}`);
  console.log("\nlayers:");
  for (const layer of LAYERS) {
    const p = layerPath(layer, root);
    if (!p) {
      console.log(`  ${layer.padEnd(6)} n/a       (needs a git repository)`);
      continue;
    }
    // A layer can hold two files: the current path and the pre-rename one. Print the path
    // actually read, never the expected one — otherwise a legacy-only setup reads as
    // "found" beside a path that does not exist.
    const hits = found.filter((f) => f.layer === layer);
    if (!hits.length) {
      console.log(`  ${layer.padEnd(6)} missing   ${p}`);
      continue;
    }
    for (const h of hits) {
      console.log(`  ${layer.padEnd(6)} ${h.path === p ? "found    " : "legacy   "} ${h.path}`);
    }
  }

  if (legacy.length) {
    console.log(
      `\n${legacy.length} file(s) sit at the pre-rename .agents/skill-config/ path. Both locations are\n` +
        "read and the new one wins, so nothing is broken — move them to .agents/config/ when convenient.",
    );
  }

  if (found.length === 0) {
    console.log(
      "\nNo configuration yet. This is the expected first-run state, not an error — run onboarding\n" +
        "(see the skill's Onboarding section) to create it.",
    );
    process.exit(2);
  }

  const kind = config.tracker?.kind;
  const credName = kind ? CREDENTIAL_FOR[kind] : null;
  console.log("\neffective settings:");
  console.log(`  tracker.kind         ${kind ?? "(unset)"}`);
  console.log(`  tracker target       ${config.tracker?.path ?? config.tracker?.repo ?? config.tracker?.site ?? config.tracker?.team ?? "(unset)"}`);
  console.log(`  questions.path       ${config.questions?.path ?? "(unset — the skill will pick one during setup)"}`);
  console.log(`  models.judgment      ${config.models?.judgment ?? "(inherit session model)"}`);
  console.log(`  models.mechanical    ${config.models?.mechanical ?? "(inherit session model)"}`);
  console.log(`  maxParallelAgents    ${config.defaults?.maxParallelAgents ?? DEFAULTS.maxParallelAgents}`);
  console.log(`  maxPackages          ${config.defaults?.maxPackages ?? DEFAULTS.maxPackages}`);
  console.log(`  credential needed    ${credName ? `credentials.${credName}` : "none (local tracker)"}`);

  const problems = validate(config);
  if (problems.length) {
    console.log("\nnot ready:");
    for (const p of problems) console.log(`  - ${p}`);
    process.exit(2);
  }
  console.log("\nready. Run 'verify' to confirm the tracker is actually reachable.");
}

function cmdShow() {
  const { config, found } = loadConfig();
  if (!found.length) die("No configuration found. Run 'check' for the layer paths.");
  console.log(JSON.stringify(forDisplay(config), null, 2));
}

function cmdPath(arg?: string) {
  const root = repoRoot();
  const layers = arg ? [arg as Layer] : LAYERS;
  for (const layer of layers) {
    if (!LAYERS.includes(layer)) die(`Unknown layer "${layer}". Use one of: ${LAYERS.join(", ")}`);
    console.log(`${layer.padEnd(6)} ${layerPath(layer, root) ?? "n/a (needs a git repository)"}`);
  }
}

async function cmdWrite(layer?: string) {
  if (!layer || !LAYERS.includes(layer as Layer)) {
    die(`Usage: write <${LAYERS.join("|")}>  — the layer's full JSON content on stdin.`);
  }
  const raw = await Bun.stdin.text();
  if (!raw.trim()) die("Nothing on stdin. Pipe the layer's full JSON content in.");
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (e: any) {
    die(`stdin is not valid JSON: ${e.message}`);
  }
  parsed.version ??= 1;
  let written: ReturnType<typeof writeLayer>;
  try {
    written = writeLayer(layer as Layer, parsed);
  } catch (e: any) {
    die(e.message);
  }
  console.log(`wrote ${layer} layer: ${written.path}`);
  const g = written.gitignore;
  if (g?.action === "added") console.log(`gitignored the local layer in ${g.path}`);
  if (g?.action === "already-ignored") console.log(`local layer already gitignored via ${g.path}`);
}

async function cmdVerify() {
  const { config, found } = loadConfig();
  if (!found.length) die("No configuration found — nothing to verify. Run onboarding first.");
  const problems = validate(config);
  if (problems.length) {
    console.error("Config is incomplete:");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(2);
  }
  const result = await verifyTracker(config);
  console.log(result.ok ? `OK — ${result.detail}` : `FAILED — ${result.detail}`);
  process.exit(result.ok ? 0 : 1);
}

function cmdGitignore() {
  const g = ensureGitignored();
  if (g.action === "no-repo") die("Not in a git repository — the local layer does not apply here.");
  console.log(g.action === "added" ? `added the local-layer pattern to ${g.path}` : `already ignored via ${g.path}`);
}

const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
  case "check":
    await cmdCheck();
    break;
  case "show":
    cmdShow();
    break;
  case "path":
    cmdPath(rest[0]);
    break;
  case "write":
    await cmdWrite(rest[0]);
    break;
  case "verify":
    await cmdVerify();
    break;
  case "gitignore":
    cmdGitignore();
    break;
  case "help":
  case undefined:
    console.log(
      [
        "orchestrate config (ACS v1)",
        "",
        "  check              layers, effective settings, what's missing  (exit 2 = not ready)",
        "  show               merged config; credentials shown as descriptions, never values",
        "  path [layer]       where global | repo | local live",
        "  write <layer>      write that layer from JSON on stdin (refuses inlined secrets)",
        "  verify             resolve the credential and make one real call to the tracker",
        "  gitignore          ensure the local layer is gitignored",
      ].join("\n"),
    );
    break;
  default:
    die(`Unknown command "${cmd}". Run 'help'.`);
}
