// The command surface. JSON on stdout, diagnostics on stderr, secrets on fd 3 (D4).
//
// The exit code is read by scripts; the JSON is read by agents. They are different audiences, and
// conflating them is what makes "not configured" look like a failure — so needing onboarding is
// exit 0, and a caller that genuinely wants it fatal passes --require-ready.

import { readFileSync, writeSync } from "fs";
import { join } from "path";
import { detectHarness } from "./harness";
import { repoContext, registerRepo, type RepoContext } from "./repo";
import {
  ConfigError,
  LAYERS,
  layerFiles,
  legacyConfigPaths,
  loadLayers,
  readJournal,
  readLayer,
  writeLayer,
  type ConfigObject,
  type Layer,
  type LoadedLayers,
} from "./layers";
import { findDeclaration, type FoundDeclaration } from "./declaration";
import { effectiveConfig, unmetKeys, type Effective } from "./effective";
import { buildPlan, guidePath } from "./actions";
import { CredentialError, resolveCredential, type CredentialRef } from "./credentials";
import {
  ACS_VERSION,
  type DescribeOutput,
  type LoadOutput,
  type PathOutput,
  type Problem,
  type RepoReport,
  type StartOutput,
} from "./types";

export const EXIT = {
  /** A plan was produced — ready or not. */
  ok: 0,
  /** Unexpected or internal. */
  internal: 1,
  /** The declaration is missing or invalid, the name is ambiguous, or config is incomplete. */
  config: 2,
  /** A credential reference is present but unresolvable (`load` only). */
  credential: 3,
  /** A config file's schema version is behind the declaration's (`load` only). */
  staleSchema: 4,
} as const;

// Every command ends in an explicit exit code, and an async stdout write can still be in flight
// when the process leaves. Both streams are written synchronously so the caller always sees them.
function out(text: string): void {
  writeSync(1, text);
}

function report(text: string): void {
  writeSync(2, text);
}

const USAGE = `agent-config <command>

  start <name> [--from <dir>] [--require-ready]   what this component still needs, as JSON
  load <name> [--secrets <key>...] [--from <dir>] config on stdout, secrets on fd 3
  write <name> --layer <layer> [--from <dir>]     replace one layer from JSON on stdin
  describe <name> [--from <dir>]                  the full questionnaire, with current answers
  path <name> [--layer <layer>] [--from <dir>]    where the layers live
  repos register [--alias <alias>]                add this repository to the repo registry

Layers: ${LAYERS.join(", ")}. Output is JSON only — rendering for a human is the agent's job.`;

interface ParsedArgs {
  command: string;
  positionals: string[];
  from?: string;
  layer?: string;
  alias?: string;
  secrets: string[];
  requireReady: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = { command: argv[0] ?? "", positionals: [], secrets: [], requireReady: false };
  let collecting: "secrets" | null = null;

  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--require-ready") {
      collecting = null;
      parsed.requireReady = true;
    } else if (argument === "--from" || argument === "--layer" || argument === "--alias") {
      collecting = null;
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new ConfigError(`${argument} needs a value`);
      index += 1;
      if (argument === "--from") parsed.from = value;
      if (argument === "--layer") parsed.layer = value;
      if (argument === "--alias") parsed.alias = value;
    } else if (argument === "--secrets") {
      // Several keys in one call, so a script needing two secrets does not trigger two prompts.
      collecting = "secrets";
    } else if (argument.startsWith("--")) {
      throw new ConfigError(`Unknown flag ${argument}\n\n${USAGE}`);
    } else if (collecting === "secrets") {
      parsed.secrets.push(argument);
    } else {
      parsed.positionals.push(argument);
    }
  }
  return parsed;
}

function requireName(parsed: ParsedArgs): string {
  const name = parsed.positionals[0];
  if (!name) throw new ConfigError(`${parsed.command} needs a component name\n\n${USAGE}`);
  return name;
}

function requireLayer(value: string | undefined): Layer {
  if (!value) throw new ConfigError(`--layer is required (${LAYERS.join(", ")})`);
  if (!LAYERS.includes(value as Layer)) throw new ConfigError(`Unknown layer "${value}" (${LAYERS.join(", ")})`);
  return value as Layer;
}

function repoReport(repo: RepoContext): RepoReport {
  return {
    checkout: repo.checkout,
    root: repo.root,
    identity: repo.identity,
    registered: repo.registered,
    alias: repo.alias,
  };
}

/**
 * v2 reads only `.agents/config/`. A file still at the pre-rename path is reported rather than
 * silently ignored — five live configs sit there on the reference machine (D6), and moving them is
 * a one-off action D5 owns.
 */
function legacyProblems(name: string, repo: RepoContext): Problem[] {
  return legacyConfigPaths(name, repo).map((path) => ({
    code: "legacy-config-path" as const,
    message:
      `${path} is a v1 config at the pre-rename path. agent-config v2 reads only .agents/config/, ` +
      `so nothing in this file is in effect. Move it to the matching .agents/config/ path.`,
    path,
  }));
}

interface Resolved {
  found: FoundDeclaration;
  repo: RepoContext;
  loaded: LoadedLayers;
  effective: Effective;
}

function resolve(name: string, from: string | undefined): Resolved {
  const repo = repoContext();
  const found = findDeclaration(name, detectHarness(), from);
  const loaded = loadLayers(name, repo);
  return { found, repo, loaded, effective: effectiveConfig(found.declaration, loaded) };
}

function start(parsed: ParsedArgs): number {
  const name = requireName(parsed);
  const harness = detectHarness();
  const { found, repo, loaded, effective } = resolve(name, parsed.from);
  const plan = buildPlan({
    found,
    harness,
    repo: repoReport(repo),
    effective,
    layers: loaded.files,
    userRepoLayer: readLayer(name, "user-repo", repo),
  });

  const output: StartOutput = {
    acs: ACS_VERSION,
    name,
    harness,
    repo: repoReport(repo),
    ready: plan.actions.length === 0,
    guide: guidePath(),
    config: effective.config,
    provenance: effective.provenance,
    actions: plan.actions,
    problems: [...effective.problems, ...plan.problems, ...legacyProblems(name, repo)],
  };
  out(`${JSON.stringify(output, null, 2)}\n`);

  if (parsed.requireReady && !output.ready) {
    report(`${name} is not ready: ${output.actions.length} action(s) outstanding. ` +
      `Drop --require-ready to get the plan as a normal result.\n`);
    return EXIT.config;
  }
  return EXIT.ok;
}

/**
 * `load` is the consumer script's surface, and the mirror image of `start`: not-ready is a normal
 * answer there and a refusal here, because a script must not run on half-configured settings.
 * It never returns an action list, which is what makes "a subagent cannot onboard" structural
 * rather than prose (D6).
 */
function load(parsed: ParsedArgs): number {
  const name = requireName(parsed);
  const { found, repo, loaded, effective } = resolve(name, parsed.from);
  const problems: Problem[] = [...effective.problems, ...legacyProblems(name, repo)];

  for (const file of loaded.files) {
    if (!file.exists || file.schemaVersion === null) continue;
    if (file.schemaVersion < found.schemaVersion) {
      report(`${file.path} was written against ${name} schema version ${file.schemaVersion}, but the installed ` +
        `component declares ${found.schemaVersion}. Its answers may mean something else now, and handing ` +
        `them over unchanged is silent corruption. Run: agent-config start ${name}\n`);
      return EXIT.staleSchema;
    }
    if (file.schemaVersion > found.schemaVersion) {
      problems.push({
        code: "schema-rolled-back",
        layer: file.layer,
        path: file.path ?? undefined,
        message:
          `${file.path} is stamped schema version ${file.schemaVersion}, ahead of the declared ` +
          `${found.schemaVersion}. Proceeding: a rollback has no repair path.`,
      });
    }
  }

  const unmet = unmetKeys(effective);
  if (unmet.length > 0) {
    report(`${name} is not configured. Missing or malformed: ${unmet.join(", ")}. Run: agent-config start ${name}\n`);
    return EXIT.config;
  }

  const output: LoadOutput = {
    acs: ACS_VERSION,
    name,
    config: effective.config,
    provenance: effective.provenance,
    problems,
  };
  out(`${JSON.stringify(output, null, 2)}\n`);

  if (parsed.secrets.length === 0) return EXIT.ok;

  const secrets: Record<string, string> = {};
  for (const key of parsed.secrets) {
    const logical = key.startsWith("credentials.") ? key.slice("credentials.".length) : key;
    const reference = effective.config.credentials;
    const entry =
      typeof reference === "object" && reference !== null && !Array.isArray(reference)
        ? reference[logical]
        : undefined;
    if (entry === undefined) {
      report(`credentials.${logical} is not configured, so it cannot be resolved.\n`);
      return EXIT.config;
    }
    secrets[key] = resolveCredential(entry as unknown as CredentialRef, logical, repo.checkout);
  }

  // fd 3, never stdout: a script opens the third descriptor deliberately, while a naive
  // `bash -c "agent-config load … --secrets …"` run by an agent gets nothing on it.
  try {
    writeSync(3, `${JSON.stringify(secrets)}\n`);
  } catch {
    report(`--secrets writes to file descriptor 3, which is not open. Open it in the caller, e.g.\n` +
      `  secrets=$(agent-config load ${name} --secrets ${parsed.secrets.join(" ")} 3>&1 1>/dev/null)\n`);
    return EXIT.internal;
  }
  return EXIT.ok;
}

function write(parsed: ParsedArgs): number {
  const name = requireName(parsed);
  const layer = requireLayer(parsed.layer);
  const repo = repoContext();
  const found = findDeclaration(name, detectHarness(), parsed.from);

  const raw = readFileSync(0, "utf8").trim();
  if (!raw) throw new ConfigError("write expects the whole layer as JSON on stdin");
  let config: ConfigObject;
  try {
    config = JSON.parse(raw) as ConfigObject;
  } catch (error) {
    throw new ConfigError(`stdin is not valid JSON: ${(error as Error).message}`);
  }
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw new ConfigError("write expects a JSON object — one layer, whole, not a fragment");
  }

  const result = writeLayer(
    name,
    layer,
    config,
    { version: found.schemaVersion, declared: found.declaration.schema ?? {} },
    repo,
  );
  out(`${JSON.stringify({ acs: ACS_VERSION, name, ...result }, null, 2)}\n`);
  return EXIT.ok;
}

/**
 * `describe` is what makes onboarding stop being a special case: every declared key with its
 * description, recommended layer, default and condition, plus the current answers and the layer
 * each came from. Onboarding is the case where the answers are empty; editing is the same
 * questionnaire, filled in (D6).
 */
function describe(parsed: ParsedArgs): number {
  const name = requireName(parsed);
  const harness = detectHarness();
  const { found, repo, loaded, effective } = resolve(name, parsed.from);

  const output: DescribeOutput = {
    acs: ACS_VERSION,
    name,
    harness,
    schemaVersion: found.schemaVersion,
    repo: repoReport(repo),
    keys: effective.keys,
    layers: loaded.files.map((file) => ({ ...file, journal: readJournal(name, file.layer, repo) })),
    problems: [...effective.problems, ...legacyProblems(name, repo)],
  };
  out(`${JSON.stringify(output, null, 2)}\n`);
  return EXIT.ok;
}

function path(parsed: ParsedArgs): number {
  const name = requireName(parsed);
  const repo = repoContext();
  const found = findDeclaration(name, detectHarness(), parsed.from);
  const files = layerFiles(name, repo);
  const wanted = parsed.layer ? requireLayer(parsed.layer) : null;

  const output: PathOutput = {
    acs: ACS_VERSION,
    name,
    declaration: found.path,
    agentConfig: { root: join(import.meta.dir, ".."), bin: join(import.meta.dir, "..", "bin", "agent-config") },
    layers: wanted ? files.filter((file) => file.layer === wanted) : files,
  };
  out(`${JSON.stringify(output, null, 2)}\n`);
  return EXIT.ok;
}

function repos(parsed: ParsedArgs): number {
  const subcommand = parsed.positionals[0];
  if (subcommand !== "register") {
    throw new ConfigError(
      `Unknown repos subcommand ${JSON.stringify(subcommand ?? "")}. Only "register" exists so far.`,
    );
  }
  const result = registerRepo(process.cwd(), parsed.alias ?? null);
  out(`${JSON.stringify({ acs: ACS_VERSION, ...result }, null, 2)}\n`);
  return EXIT.ok;
}

export function main(argv: string[]): number {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    report(`${(error as Error).message}\n`);
    return EXIT.config;
  }

  try {
    switch (parsed.command) {
      case "start":
        return start(parsed);
      case "load":
        return load(parsed);
      case "write":
        return write(parsed);
      case "describe":
        return describe(parsed);
      case "path":
        return path(parsed);
      case "repos":
        return repos(parsed);
      case "":
      case "help":
      case "--help":
      case "-h":
        out(`${USAGE}\n`);
        return EXIT.ok;
      default:
        report(`Unknown command "${parsed.command}"\n\n${USAGE}\n`);
        return EXIT.config;
    }
  } catch (error) {
    if (error instanceof ConfigError) {
      report(`${error.message}\n`);
      return EXIT.config;
    }
    if (error instanceof CredentialError) {
      report(`${error.message}\n`);
      return EXIT.credential;
    }
    report(`agent-config failed unexpectedly: ${(error as Error).stack ?? String(error)}\n`);
    return EXIT.internal;
  }
}
